package workspace

import (
	"bytes"
	"io"
	"os"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/yuin/goldmark"
	goldmarkhtml "github.com/yuin/goldmark/renderer/html"
	"golang.org/x/net/html"
)

const documentHeadingReadLimit = 64 * 1024
const documentHeadingCacheLimit = 1024

type headingCacheEntry struct {
	size     int64
	modified time.Time
	heading  *string
}

// InvalidateDocumentHeading drops cached metadata before a workspace event is
// delivered, so a notified change never relies only on cached stat values.
func (fsys *FS) InvalidateDocumentHeading(path string) {
	fsys.headingMu.Lock()
	defer fsys.headingMu.Unlock()
	for key := range fsys.headingCache {
		if key == path || strings.HasPrefix(key, path+"/") {
			delete(fsys.headingCache, key)
		}
	}
}

func (fsys *FS) populateDocumentHeadings(nodes []Node) {
	for i := range nodes {
		node := &nodes[i]
		if node.Kind == "directory" {
			fsys.populateDocumentHeadings(node.Children)
			continue
		}
		if node.ViewerKind == "markdown" || node.ViewerKind == "html" {
			node.DocumentHeading = fsys.readDocumentHeading(node.Path, node.ViewerKind)
		}
	}
}

func (fsys *FS) readDocumentHeading(path, kind string) *string {
	fsys.headingMu.Lock()
	defer fsys.headingMu.Unlock()
	resolved, err := fsys.resolveFile(path, false)
	if err != nil {
		return nil
	}
	info, err := os.Stat(resolved.absolute)
	if err != nil || !info.Mode().IsRegular() {
		return nil
	}
	if entry, ok := fsys.headingCache[path]; ok && entry.size == info.Size() && entry.modified.Equal(info.ModTime()) {
		return entry.heading
	}
	file, err := os.Open(resolved.absolute)
	if err != nil {
		return nil
	}
	defer file.Close()
	limit := min(int64(documentHeadingReadLimit), fsys.maxFileSizeBytes)
	content, err := io.ReadAll(io.LimitReader(file, limit+1))
	if err != nil {
		return nil
	}
	after, err := file.Stat()
	if err != nil || !os.SameFile(info, after) || info.Size() != after.Size() || !info.ModTime().Equal(after.ModTime()) {
		return nil
	}
	truncated := int64(len(content)) > limit
	if truncated {
		content = content[:limit]
	}
	heading := extractDocumentHeading(content, kind, truncated)
	if fsys.headingCache == nil {
		fsys.headingCache = make(map[string]headingCacheEntry)
	}
	if len(fsys.headingCache) >= documentHeadingCacheLimit {
		for key := range fsys.headingCache {
			delete(fsys.headingCache, key)
			break
		}
	}
	fsys.headingCache[path] = headingCacheEntry{info.Size(), info.ModTime(), heading}
	return heading
}

// nil means unavailable; an empty string means a complete document without H1.
func extractDocumentHeading(content []byte, kind string, truncated bool) *string {
	if truncated && kind == "markdown" {
		if end := bytes.LastIndexByte(content, '\n'); end >= 0 {
			content = content[:end+1]
		} else {
			return nil
		}
	}
	// A byte limit can split a UTF-8 character after an otherwise complete H1.
	if truncated && kind == "html" {
		for n := 0; n < utf8.UTFMax-1 && len(content) > 0 && !utf8.Valid(content); n++ {
			content = content[:len(content)-1]
		}
	}
	if !utf8.Valid(content) {
		return nil
	}
	if kind == "markdown" {
		// YAML front matter is document metadata, not a setext heading.
		content = bytes.TrimPrefix(content, []byte("\xef\xbb\xbf"))
		lines := bytes.Split(content, []byte("\n"))
		if len(lines) > 0 && strings.TrimSpace(string(lines[0])) == "---" {
			for i := 1; i < len(lines); i++ {
				line := strings.TrimSpace(string(lines[i]))
				if line == "---" || line == "..." {
					content = bytes.Join(lines[i+1:], []byte("\n"))
					break
				}
			}
		}
		// Raw HTML is tokenized for text only; this buffer is never served or executed.
		var rendered bytes.Buffer
		if err := goldmark.New(goldmark.WithRendererOptions(goldmarkhtml.WithUnsafe())).Convert(content, &rendered); err != nil {
			return nil
		}
		content = rendered.Bytes()
	}
	tokenizer := html.NewTokenizer(bytes.NewReader(content))
	var heading strings.Builder
	inHeading := false
	skipped := 0
	for {
		tokenType := tokenizer.Next()
		if tokenType == html.ErrorToken {
			break
		}
		token := tokenizer.Token()
		if tokenType == html.StartTagToken || tokenType == html.SelfClosingTagToken {
			if token.Data == "script" || token.Data == "style" || token.Data == "template" {
				skipped++
				continue
			}
			if skipped > 0 {
				continue
			}
			if token.Data == "h1" {
				inHeading = true
			}
			if inHeading && token.Data == "img" {
				for _, attr := range token.Attr {
					if attr.Key == "alt" {
						heading.WriteString(attr.Val)
					}
				}
			}
			if inHeading && token.Data == "br" {
				heading.WriteByte(' ')
			}
		} else if tokenType == html.EndTagToken {
			if token.Data == "script" || token.Data == "style" || token.Data == "template" {
				if skipped > 0 {
					skipped--
				}
				continue
			}
			if skipped == 0 && token.Data == "h1" && inHeading {
				value := strings.Join(strings.Fields(heading.String()), " ")
				return &value
			}
		} else if tokenType == html.TextToken && inHeading && skipped == 0 {
			heading.WriteString(token.Data)
		}
	}
	if truncated {
		return nil
	}
	value := strings.Join(strings.Fields(heading.String()), " ")
	return &value
}
