package workspace

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"io"
	"mime"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/tasuku43/vivi/internal/telemetry"
)

type Node struct {
	ID             string  `json:"id"`
	Path           string  `json:"path"`
	Name           string  `json:"name"`
	Kind           string  `json:"kind"`
	ParentPath     *string `json:"parentPath"`
	ViewerKind     string  `json:"viewerKind,omitempty"`
	Children       []Node  `json:"children,omitempty"`
	ChildrenLoaded *bool   `json:"childrenLoaded,omitempty"`
	Size           int64   `json:"size,omitempty"`
	MtimeMs        float64 `json:"mtimeMs,omitempty"`
	Version        int     `json:"version,omitempty"`
}

type TreeStats struct {
	DurationMs         int64 `json:"durationMs"`
	ScannedDirectories int   `json:"scannedDirectories"`
	ScannedFiles       int   `json:"scannedFiles"`
	ReturnedNodes      int   `json:"returnedNodes"`
}

type TreeSnapshot struct {
	Root    string     `json:"root"`
	Version int        `json:"version"`
	Path    string     `json:"path,omitempty"`
	Depth   int        `json:"depth,omitempty"`
	Nodes   []Node     `json:"nodes"`
	Stats   *TreeStats `json:"stats,omitempty"`
}

type FilePayload struct {
	Path         string  `json:"path"`
	ViewerKind   string  `json:"viewerKind"`
	Encoding     string  `json:"encoding"`
	Content      string  `json:"content"`
	Etag         string  `json:"etag"`
	Size         int64   `json:"size"`
	MtimeMs      float64 `json:"mtimeMs"`
	MimeType     string  `json:"mimeType,omitempty"`
	Truncated    bool    `json:"truncated,omitempty"`
	MaxSizeBytes int64   `json:"maxSizeBytes,omitempty"`
	PreviewBytes int64   `json:"previewBytes,omitempty"`
}

type Config struct {
	Root             string `json:"root"`
	AllowHTMLScripts bool   `json:"allowHtmlScripts"`
	MaxFileSizeBytes int64  `json:"maxFileSizeBytes"`
}

type FileSearchResult struct {
	Path       string  `json:"path"`
	Name       string  `json:"name"`
	ViewerKind string  `json:"viewerKind"`
	Size       int64   `json:"size,omitempty"`
	MtimeMs    float64 `json:"mtimeMs,omitempty"`
	Score      int     `json:"score"`
}

type TextSearchResult struct {
	Path        string `json:"path"`
	ViewerKind  string `json:"viewerKind"`
	LineNumber  int    `json:"lineNumber"`
	LineText    string `json:"lineText"`
	MatchStart  int    `json:"matchStart"`
	MatchLength int    `json:"matchLength"`
}

type SearchStats struct {
	DurationMs         int64 `json:"durationMs"`
	ScannedDirectories int   `json:"scannedDirectories"`
	ScannedFiles       int   `json:"scannedFiles"`
	ReadFiles          int   `json:"readFiles"`
	SkippedFiles       int   `json:"skippedFiles"`
	Cached             bool  `json:"cached,omitempty"`
}

type FileSearchResponse struct {
	Query   string             `json:"query"`
	Results []FileSearchResult `json:"results"`
	Stats   SearchStats        `json:"stats"`
}

type TextSearchResponse struct {
	Query   string             `json:"query"`
	Results []TextSearchResult `json:"results"`
	Stats   SearchStats        `json:"stats"`
}

type WatchEntry struct {
	Path    string
	Kind    string
	Size    int64
	MtimeNs int64
}

type WatchStats struct {
	DurationMs         int64
	ScannedDirectories int
	ScannedFiles       int
	ReturnedEntries    int
}

type FS struct {
	root             string
	rootReal         string
	ignored          map[string]bool
	include          map[string]bool
	maxFileSizeBytes int64
	allowHTMLScripts bool
	version          int
}

type Options struct {
	Root             string
	Include          []string
	MaxFileSizeBytes int64
	AllowHTMLScripts bool
}

func New(options Options) (*FS, error) {
	root, err := filepath.Abs(options.Root)
	if err != nil {
		return nil, err
	}
	rootReal, err := filepath.EvalSymlinks(root)
	if err != nil {
		rootReal = root
	}
	include := map[string]bool{}
	for _, item := range options.Include {
		item = strings.TrimPrefix(strings.ToLower(strings.TrimSpace(item)), ".")
		if item != "" {
			include[item] = true
		}
	}
	maxSize := options.MaxFileSizeBytes
	if maxSize <= 0 {
		maxSize = 1024 * 1024
	}
	return &FS{
		root:             root,
		rootReal:         rootReal,
		ignored:          defaultIgnored(),
		include:          include,
		maxFileSizeBytes: maxSize,
		allowHTMLScripts: options.AllowHTMLScripts,
		version:          1,
	}, nil
}

func (fsys *FS) Config() Config {
	return Config{
		Root:             fsys.root,
		AllowHTMLScripts: fsys.allowHTMLScripts,
		MaxFileSizeBytes: fsys.maxFileSizeBytes,
	}
}

func (fsys *FS) ReadTree() (TreeSnapshot, error) {
	return fsys.readDirectory("", 0, false)
}

func (fsys *FS) ReadDirectory(relativePath string, depth int) (TreeSnapshot, error) {
	if depth <= 0 {
		depth = 1
	}
	return fsys.readDirectory(relativePath, depth, true)
}

func (fsys *FS) readDirectory(relativePath string, depth int, bounded bool) (TreeSnapshot, error) {
	started := time.Now()
	resolved, err := fsys.resolveDirectory(relativePath)
	if err != nil {
		return TreeSnapshot{}, err
	}
	stats := &TreeStats{}
	scanDepth := depth
	if !bounded {
		scanDepth = 1_000_000
	}
	nodes, err := fsys.scan(resolved.relative, nil, scanDepth, stats)
	if err != nil {
		return TreeSnapshot{}, err
	}
	stats.DurationMs = time.Since(started).Milliseconds()
	snapshot := TreeSnapshot{
		Root:    fsys.root,
		Version: fsys.version,
		Nodes:   nodes,
		Stats:   stats,
	}
	if bounded {
		snapshot.Path = resolved.relative
		snapshot.Depth = depth
	}
	return snapshot, nil
}

func (fsys *FS) ReadFile(relativePath string) (FilePayload, error) {
	resolved, err := fsys.resolveFile(relativePath)
	if err != nil {
		return FilePayload{}, err
	}
	info, err := os.Stat(resolved.absolute)
	if err != nil {
		return FilePayload{}, err
	}
	if !info.Mode().IsRegular() {
		return FilePayload{}, requestError("path is not a file")
	}
	viewerKind := ClassifyViewer(resolved.relative)
	mimeType := mimeTypeFor(resolved.relative, viewerKind)
	if info.Size() > fsys.maxFileSizeBytes {
		previewLimit := fsys.maxFileSizeBytes
		if previewLimit <= 0 {
			previewLimit = 1
		}
		content, err := readLeadingBytes(resolved.absolute, previewLimit)
		if err != nil {
			return FilePayload{}, err
		}
		if viewerKind == "unsupported" {
			viewerKind = sniffFallbackViewerKind(content, true)
			mimeType = mimeTypeFor(resolved.relative, viewerKind)
		}
		if supportsPartialTextPreview(viewerKind) && isSafeUTF8Text(content, true) {
			text, previewBytes := utf8PreviewString(content)
			return FilePayload{
				Path:         resolved.relative,
				ViewerKind:   viewerKind,
				Encoding:     "utf8",
				Content:      text,
				Etag:         mtimeEtag(info, int64(previewBytes)),
				Size:         info.Size(),
				MtimeMs:      mtimeMs(info),
				MimeType:     mimeType,
				Truncated:    true,
				MaxSizeBytes: fsys.maxFileSizeBytes,
				PreviewBytes: int64(previewBytes),
			}, nil
		}
		metadataViewerKind := viewerKind
		if viewerKind == "binary" || (supportsPartialTextPreview(viewerKind) && !isSafeUTF8Text(content, true)) {
			metadataViewerKind = "binary"
		}
		return FilePayload{
			Path:         resolved.relative,
			ViewerKind:   metadataViewerKind,
			Encoding:     "none",
			Content:      "",
			Etag:         mtimeEtag(info, 0),
			Size:         info.Size(),
			MtimeMs:      mtimeMs(info),
			MimeType:     mimeTypeFor(resolved.relative, metadataViewerKind),
			Truncated:    true,
			MaxSizeBytes: fsys.maxFileSizeBytes,
		}, nil
	}
	content, err := os.ReadFile(resolved.absolute)
	if err != nil {
		return FilePayload{}, err
	}
	if viewerKind == "unsupported" {
		viewerKind = sniffFallbackViewerKind(content, false)
		mimeType = mimeTypeFor(resolved.relative, viewerKind)
	}
	hash := sha256.Sum256(content)
	encoding := "utf8"
	body := string(content)
	if viewerKind == "image" {
		encoding = "base64"
		body = base64.StdEncoding.EncodeToString(content)
	} else if viewerKind == "binary" || !isSafeUTF8Text(content, false) {
		viewerKind = "binary"
		mimeType = mimeTypeFor(resolved.relative, viewerKind)
		encoding = "none"
		body = ""
	} else {
		body, _ = utf8PreviewString(content)
	}
	return FilePayload{
		Path:       resolved.relative,
		ViewerKind: viewerKind,
		Encoding:   encoding,
		Content:    body,
		Etag:       "sha256:" + hex.EncodeToString(hash[:]),
		Size:       info.Size(),
		MtimeMs:    mtimeMs(info),
		MimeType:   mimeType,
	}, nil
}

func (fsys *FS) ReadHTMLPreview(relativePath string) (string, error) {
	file, err := fsys.ReadFile(relativePath)
	if err != nil {
		return "", err
	}
	if file.ViewerKind != "html" {
		return "", requestError("path is not an HTML file")
	}
	if file.Truncated {
		return "", requestError("file is too large to preview")
	}
	return file.Content, nil
}

func (fsys *FS) SearchFiles(query string, limit int) (FileSearchResponse, error) {
	if limit <= 0 {
		limit = 40
	}
	started := time.Now()
	stats := SearchStats{}
	terms := strings.Fields(strings.ToLower(strings.TrimSpace(query)))
	results := []FileSearchResult{}
	err := fsys.walkFiles("", &stats, func(file FileSearchResult) bool {
		score := 1
		if len(terms) > 0 {
			score = fileSearchScore(strings.ToLower(file.Path), terms)
			if score <= 0 {
				return true
			}
		}
		file.Score = score
		results = append(results, file)
		sort.Slice(results, func(i, j int) bool {
			if results[i].Score == results[j].Score {
				return results[i].Path < results[j].Path
			}
			return results[i].Score > results[j].Score
		})
		if len(results) > limit {
			results = results[:limit]
		}
		return true
	})
	stats.DurationMs = time.Since(started).Milliseconds()
	telemetry.RecordOperation(context.Background(), "workspace.file_search", telemetry.OperationStats{
		DurationMs:         stats.DurationMs,
		ScannedDirectories: stats.ScannedDirectories,
		ScannedFiles:       stats.ScannedFiles,
		ResultCount:        len(results),
		Error:              err != nil,
	})
	return FileSearchResponse{Query: strings.TrimSpace(query), Results: results, Stats: stats}, err
}

func (fsys *FS) SearchText(query string, limit int) (TextSearchResponse, error) {
	normalized := strings.TrimSpace(query)
	if limit <= 0 {
		limit = 40
	}
	started := time.Now()
	stats := SearchStats{}
	results := []TextSearchResult{}
	if normalized == "" {
		stats.DurationMs = time.Since(started).Milliseconds()
		return TextSearchResponse{Query: normalized, Results: results, Stats: stats}, nil
	}
	lowerQuery := strings.ToLower(normalized)
	err := fsys.walkFiles("", &stats, func(file FileSearchResult) bool {
		if len(results) >= limit {
			return false
		}
		if !isTextSearchable(file.ViewerKind) || file.Size > fsys.maxFileSizeBytes {
			stats.SkippedFiles++
			return true
		}
		payload, err := fsys.ReadFile(file.Path)
		if err != nil || payload.Encoding != "utf8" || payload.Truncated || strings.Contains(payload.Content, "\x00") {
			stats.SkippedFiles++
			return true
		}
		stats.ReadFiles++
		lines := strings.Split(payload.Content, "\n")
		matchesForFile := 0
		for index, line := range lines {
			match := strings.Index(strings.ToLower(line), lowerQuery)
			if match < 0 {
				continue
			}
			results = append(results, TextSearchResult{
				Path:        payload.Path,
				ViewerKind:  payload.ViewerKind,
				LineNumber:  index + 1,
				LineText:    strings.TrimSuffix(line, "\r"),
				MatchStart:  match,
				MatchLength: len(normalized),
			})
			matchesForFile++
			if len(results) >= limit || matchesForFile >= 3 {
				break
			}
		}
		return len(results) < limit
	})
	stats.DurationMs = time.Since(started).Milliseconds()
	telemetry.RecordOperation(context.Background(), "workspace.content_search", telemetry.OperationStats{
		DurationMs:         stats.DurationMs,
		ScannedDirectories: stats.ScannedDirectories,
		ScannedFiles:       stats.ScannedFiles,
		ReadFiles:          stats.ReadFiles,
		ResultCount:        len(results),
		Error:              err != nil,
	})
	return TextSearchResponse{Query: normalized, Results: results, Stats: stats}, err
}

func (fsys *FS) WatchEntries() (map[string]WatchEntry, error) {
	entries, _, err := fsys.WatchEntriesWithStats()
	return entries, err
}

func (fsys *FS) WatchEntriesWithStats() (map[string]WatchEntry, WatchStats, error) {
	started := time.Now()
	entries := map[string]WatchEntry{}
	stats := WatchStats{}
	err := fsys.walkWatchEntries("", entries, &stats)
	stats.DurationMs = time.Since(started).Milliseconds()
	stats.ReturnedEntries = len(entries)
	telemetry.RecordOperation(context.Background(), "workspace.watch_entries", telemetry.OperationStats{
		DurationMs:         stats.DurationMs,
		ScannedDirectories: stats.ScannedDirectories,
		ScannedFiles:       stats.ScannedFiles,
		ResultCount:        stats.ReturnedEntries,
		Error:              err != nil,
	})
	return entries, stats, err
}

type resolvedPath struct {
	absolute string
	relative string
}

func (fsys *FS) resolveFile(input string) (resolvedPath, error) {
	resolved, err := fsys.resolvePath(input, true)
	if err != nil {
		return resolvedPath{}, err
	}
	if !fsys.isIncluded(resolved.relative) {
		return resolvedPath{}, requestError("path is excluded")
	}
	return resolved, nil
}

func (fsys *FS) resolveDirectory(input string) (resolvedPath, error) {
	resolved, err := fsys.resolvePath(input, false)
	if err != nil {
		return resolvedPath{}, err
	}
	info, err := os.Stat(resolved.absolute)
	if err != nil {
		return resolvedPath{}, err
	}
	if !info.IsDir() {
		return resolvedPath{}, requestError("path is not a directory")
	}
	return resolved, nil
}

func (fsys *FS) resolvePath(input string, requireNonEmpty bool) (resolvedPath, error) {
	relative, err := normalizeRelativePath(input)
	if err != nil {
		return resolvedPath{}, err
	}
	if requireNonEmpty && relative == "" {
		return resolvedPath{}, requestError("file path is required")
	}
	if relative != "" && fsys.isIgnored(relative) {
		return resolvedPath{}, requestError("path is ignored")
	}
	absolute := filepath.Join(fsys.root, filepath.FromSlash(relative))
	if !insidePath(fsys.root, absolute) {
		return resolvedPath{}, requestError("path escapes root")
	}
	inside, err := fsys.realPathInsideRoot(absolute)
	if err != nil {
		return resolvedPath{}, err
	}
	if !inside {
		return resolvedPath{}, requestError("path escapes root")
	}
	return resolvedPath{absolute: absolute, relative: relative}, nil
}

func (fsys *FS) scan(relativeDir string, parent *string, depth int, stats *TreeStats) ([]Node, error) {
	absoluteDir := filepath.Join(fsys.root, filepath.FromSlash(relativeDir))
	entries, err := os.ReadDir(absoluteDir)
	if err != nil {
		return nil, err
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].Name() < entries[j].Name() })
	stats.ScannedDirectories++
	nodes := []Node{}
	for _, entry := range entries {
		relative := entry.Name()
		if relativeDir != "" {
			relative = relativeDir + "/" + entry.Name()
		}
		if fsys.isIgnored(relative) {
			continue
		}
		absolute := filepath.Join(fsys.root, filepath.FromSlash(relative))
		inside, err := fsys.realPathInsideRoot(absolute)
		if err != nil || !inside {
			continue
		}
		info, err := os.Stat(absolute)
		if err != nil {
			continue
		}
		if entry.Type()&os.ModeSymlink != 0 && info.IsDir() {
			continue
		}
		if info.IsDir() {
			var children []Node
			loaded := false
			if depth > 1 {
				childParent := relative
				children, err = fsys.scan(relative, &childParent, depth-1, stats)
				if err != nil {
					return nil, err
				}
				loaded = true
			}
			nodes = append(nodes, Node{
				ID:             relative,
				Path:           relative,
				Name:           entry.Name(),
				Kind:           "directory",
				ParentPath:     parent,
				Children:       children,
				ChildrenLoaded: boolPtr(loaded),
				MtimeMs:        mtimeMs(info),
				Version:        fsys.version,
			})
			stats.ReturnedNodes++
			continue
		}
		if !info.Mode().IsRegular() {
			continue
		}
		stats.ScannedFiles++
		if !fsys.isIncluded(relative) {
			continue
		}
		nodes = append(nodes, Node{
			ID:         relative,
			Path:       relative,
			Name:       entry.Name(),
			Kind:       "file",
			ParentPath: parent,
			ViewerKind: ClassifyViewer(relative),
			Size:       info.Size(),
			MtimeMs:    mtimeMs(info),
			Version:    fsys.version,
		})
		stats.ReturnedNodes++
	}
	return nodes, nil
}

func (fsys *FS) walkFiles(relativeDir string, stats *SearchStats, onFile func(FileSearchResult) bool) error {
	entries, err := os.ReadDir(filepath.Join(fsys.root, filepath.FromSlash(relativeDir)))
	if err != nil {
		return nil
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].Name() < entries[j].Name() })
	stats.ScannedDirectories++
	for _, entry := range entries {
		relative := entry.Name()
		if relativeDir != "" {
			relative = relativeDir + "/" + entry.Name()
		}
		if fsys.isIgnored(relative) {
			continue
		}
		absolute := filepath.Join(fsys.root, filepath.FromSlash(relative))
		inside, err := fsys.realPathInsideRoot(absolute)
		if err != nil || !inside {
			continue
		}
		info, err := os.Stat(absolute)
		if err != nil {
			stats.SkippedFiles++
			continue
		}
		if entry.Type()&os.ModeSymlink != 0 && info.IsDir() {
			continue
		}
		if info.IsDir() {
			if err := fsys.walkFiles(relative, stats, onFile); err != nil {
				return err
			}
			continue
		}
		if !info.Mode().IsRegular() {
			continue
		}
		stats.ScannedFiles++
		if !fsys.isIncluded(relative) {
			continue
		}
		if !onFile(FileSearchResult{
			Path:       relative,
			Name:       entry.Name(),
			ViewerKind: ClassifyViewer(relative),
			Size:       info.Size(),
			MtimeMs:    mtimeMs(info),
		}) {
			return nil
		}
	}
	return nil
}

func (fsys *FS) walkWatchEntries(relativeDir string, entries map[string]WatchEntry, stats *WatchStats) error {
	absoluteDir := filepath.Join(fsys.root, filepath.FromSlash(relativeDir))
	dirEntries, err := os.ReadDir(absoluteDir)
	if err != nil {
		return nil
	}
	stats.ScannedDirectories++
	for _, entry := range dirEntries {
		relative := entry.Name()
		if relativeDir != "" {
			relative = relativeDir + "/" + entry.Name()
		}
		if fsys.isIgnored(relative) {
			continue
		}
		absolute := filepath.Join(fsys.root, filepath.FromSlash(relative))
		inside, err := fsys.realPathInsideRoot(absolute)
		if err != nil || !inside {
			continue
		}
		info, err := os.Stat(absolute)
		if err != nil {
			continue
		}
		if entry.Type()&os.ModeSymlink != 0 && info.IsDir() {
			continue
		}
		if info.IsDir() {
			entries[relative] = WatchEntry{
				Path:    relative,
				Kind:    "directory",
				MtimeNs: info.ModTime().UnixNano(),
			}
			if err := fsys.walkWatchEntries(relative, entries, stats); err != nil {
				return err
			}
			continue
		}
		if !info.Mode().IsRegular() || !fsys.isIncluded(relative) {
			continue
		}
		stats.ScannedFiles++
		entries[relative] = WatchEntry{
			Path:    relative,
			Kind:    "file",
			Size:    info.Size(),
			MtimeNs: info.ModTime().UnixNano(),
		}
	}
	return nil
}

func (fsys *FS) realPathInsideRoot(absolute string) (bool, error) {
	target, err := filepath.EvalSymlinks(absolute)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return true, nil
		}
		return false, err
	}
	return insidePath(fsys.rootReal, target), nil
}

func (fsys *FS) isIgnored(relative string) bool {
	for _, segment := range strings.Split(relative, "/") {
		if fsys.ignored[segment] {
			return true
		}
	}
	return false
}

func (fsys *FS) isIncluded(relative string) bool {
	if len(fsys.include) == 0 {
		return true
	}
	ext := strings.TrimPrefix(strings.ToLower(filepath.Ext(relative)), ".")
	return fsys.include[ext]
}

func normalizeRelativePath(input string) (string, error) {
	raw := strings.TrimSpace(strings.ReplaceAll(input, "\\", "/"))
	if strings.Contains(raw, "\x00") {
		return "", requestError("path contains invalid characters")
	}
	if raw == "" || raw == "." {
		return "", nil
	}
	if strings.HasPrefix(raw, "/") {
		return "", requestError("absolute paths are not allowed")
	}
	segments := []string{}
	for _, segment := range strings.Split(raw, "/") {
		if segment == "" || segment == "." {
			continue
		}
		if segment == ".." {
			if len(segments) == 0 {
				return "", requestError("path escapes root")
			}
			segments = segments[:len(segments)-1]
			continue
		}
		segments = append(segments, segment)
	}
	return strings.Join(segments, "/"), nil
}

func insidePath(root, target string) bool {
	rel, err := filepath.Rel(root, target)
	if err != nil {
		return false
	}
	return rel == "." || (!strings.HasPrefix(rel, "..") && !filepath.IsAbs(rel))
}

func ClassifyViewer(pathname string) string {
	lower := strings.ToLower(pathname)
	base := filepath.Base(lower)
	ext := filepath.Ext(lower)
	switch {
	case inSet(ext, ".md", ".markdown", ".mdown"):
		return "markdown"
	case inSet(ext, ".html", ".htm"):
		return "html"
	case inSet(ext, ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"):
		return "image"
	case inSet(ext, ".json", ".jsonc"):
		return "json"
	case inSet(ext, ".mmd", ".mermaid"):
		return "mermaid"
	case inSet(ext, ".txt", ".log", ".csv", ".tsv"):
		return "text"
	case inSet(ext, ".pdf", ".zip", ".gz", ".tgz", ".wasm", ".sqlite", ".db", ".bin", ".exe", ".dmg", ".mp3", ".mp4", ".mov"):
		return "binary"
	case base == "dockerfile" || inSet(ext, ".js", ".jsx", ".ts", ".tsx", ".css", ".scss", ".go", ".rs", ".py", ".rb", ".java", ".kt", ".c", ".cpp", ".h", ".hpp", ".sh", ".zsh", ".bash", ".yml", ".yaml", ".toml", ".xml", ".sql"):
		return "code"
	default:
		return "unsupported"
	}
}

func inSet(value string, items ...string) bool {
	for _, item := range items {
		if value == item {
			return true
		}
	}
	return false
}

func mimeTypeFor(relativePath, viewerKind string) string {
	switch viewerKind {
	case "markdown":
		return "text/markdown; charset=utf-8"
	case "html":
		return "text/html; charset=utf-8"
	case "json":
		return "application/json; charset=utf-8"
	case "code", "text", "mermaid":
		return "text/plain; charset=utf-8"
	case "binary":
		return "application/octet-stream"
	}
	ext := strings.ToLower(filepath.Ext(relativePath))
	if mimeType := mime.TypeByExtension(ext); mimeType != "" {
		return mimeType
	}
	if ext == ".svg" {
		return "image/svg+xml"
	}
	return ""
}

func supportsPartialTextPreview(viewerKind string) bool {
	return viewerKind == "text" || viewerKind == "code" || viewerKind == "markdown" || viewerKind == "json" || viewerKind == "mermaid"
}

func isTextSearchable(viewerKind string) bool {
	return supportsPartialTextPreview(viewerKind) || viewerKind == "html"
}

func readLeadingBytes(pathname string, limit int64) ([]byte, error) {
	file, err := os.Open(pathname)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	buffer := make([]byte, limit)
	n, err := io.ReadFull(file, buffer)
	if err != nil && !errors.Is(err, io.ErrUnexpectedEOF) && !errors.Is(err, io.EOF) {
		return nil, err
	}
	return buffer[:n], nil
}

func sniffFallbackViewerKind(content []byte, allowTrailingPartial bool) string {
	if isSafeUTF8Text(content, allowTrailingPartial) {
		return "text"
	}
	return "binary"
}

func isSafeUTF8Text(content []byte, allowTrailingPartial bool) bool {
	if len(content) == 0 {
		return true
	}
	content = bytes.TrimPrefix(content, []byte{0xEF, 0xBB, 0xBF})
	if bytes.IndexByte(content, 0) >= 0 {
		return false
	}
	if !utf8.Valid(content) {
		if !allowTrailingPartial {
			return false
		}
		trimmed := content
		for len(trimmed) > 0 && !utf8.Valid(trimmed) {
			trimmed = trimmed[:len(trimmed)-1]
		}
		if len(trimmed) == 0 && len(content) > 0 {
			return false
		}
		content = trimmed
	}
	control := 0
	runes := 0
	for len(content) > 0 {
		r, size := utf8.DecodeRune(content)
		if r == utf8.RuneError && size == 1 {
			return false
		}
		runes++
		if r < 0x20 && r != '\n' && r != '\r' && r != '\t' && r != '\f' {
			control++
		}
		content = content[size:]
	}
	return runes == 0 || control*100/runes <= 2
}

func utf8PreviewString(content []byte) (string, int) {
	for !utf8.Valid(content) && len(content) > 0 {
		content = content[:len(content)-1]
	}
	return string(content), len(content)
}

func fileSearchScore(pathname string, terms []string) int {
	score := 0
	for _, term := range terms {
		index := strings.Index(pathname, term)
		if index >= 0 {
			score += 100 - index
			continue
		}
		if isSubsequence(term, pathname) {
			score += 10
			continue
		}
		return 0
	}
	return score
}

func isSubsequence(needle, haystack string) bool {
	cursor := 0
	for _, ch := range haystack {
		if cursor < len(needle) && byte(ch) == needle[cursor] {
			cursor++
		}
		if cursor == len(needle) {
			return true
		}
	}
	return false
}

func mtimeMs(info os.FileInfo) float64 {
	return float64(info.ModTime().UnixNano()) / float64(time.Millisecond)
}

func mtimeEtag(info os.FileInfo, previewBytes int64) string {
	return "mtime:" + info.ModTime().Format(time.RFC3339Nano) + ":size:" + strconvFormatInt(info.Size()) + ":preview:" + strconvFormatInt(previewBytes)
}

func strconvFormatInt(value int64) string {
	return strconv.FormatInt(value, 10)
}

func defaultIgnored() map[string]bool {
	return map[string]bool{
		".git":         true,
		"node_modules": true,
		".turbo":       true,
		".next":        true,
		".cache":       true,
		"dist":         true,
		"coverage":     true,
	}
}

func boolPtr(value bool) *bool {
	return &value
}

type RequestError string

func (err RequestError) Error() string {
	return string(err)
}

func requestError(reason string) error {
	return RequestError(reason)
}

func IsRequestError(err error) bool {
	var requestErr RequestError
	return errors.As(err, &requestErr)
}

func IsBinary(content []byte) bool {
	return bytes.IndexByte(content, 0) >= 0
}
