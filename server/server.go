package server

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	stdhtml "html"
	"io"
	"io/fs"
	"mime"
	"net"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/tasuku43/vivi/internal/telemetry"
	"github.com/tasuku43/vivi/server/application"
	"github.com/tasuku43/vivi/server/comments"
	"github.com/tasuku43/vivi/server/gitreview"
	vivigraphql "github.com/tasuku43/vivi/server/graphql"
	"github.com/tasuku43/vivi/server/workspace"
	uiassets "github.com/tasuku43/vivi/ui"
)

type Options struct {
	Host             string
	Port             int
	Workspace        *workspace.FS
	Git              *gitreview.Reviewer
	Comments         *comments.Store
	AllowHTMLScripts bool
}

type Server struct {
	httpServer  *http.Server
	listener    net.Listener
	url         string
	options     Options
	app         *application.Service
	graphql     http.Handler
	connections map[net.Conn]struct{}
	connMu      sync.Mutex
}

const (
	watchBaseInterval    = 750 * time.Millisecond
	watchMaxIdleInterval = 2 * time.Second
)

func Start(ctx context.Context, options Options) (*Server, error) {
	mux := http.NewServeMux()
	app := application.NewService(application.Options{
		Workspace: options.Workspace,
		Git:       options.Git,
		Comments:  options.Comments,
	})
	server := &Server{
		options:     options,
		app:         app,
		connections: map[net.Conn]struct{}{},
	}
	server.graphql = vivigraphql.NewHandler(app, func(r *http.Request) bool {
		return safeJSONWriteRequest(r, server.options.Host)
	})
	mux.HandleFunc("/", server.route)
	listener, err := net.Listen("tcp", net.JoinHostPort(options.Host, strconv.Itoa(options.Port)))
	if err != nil {
		return nil, err
	}
	httpServer := &http.Server{Handler: mux, ConnState: server.trackConnection}
	server.httpServer = httpServer
	server.listener = listener
	server.url = "http://" + net.JoinHostPort(options.Host, strconv.Itoa(listener.Addr().(*net.TCPAddr).Port))
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = server.Close(shutdownCtx)
	}()
	go func() {
		if err := httpServer.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
			fmt.Fprintf(os.Stderr, "[vivi] server failed: %v\n", err)
		}
	}()
	go server.watch(ctx)
	return server, nil
}

func (server *Server) URL() string {
	return server.url
}

func (server *Server) Close(ctx context.Context) error {
	done := make(chan error, 1)
	go func() {
		done <- server.httpServer.Shutdown(ctx)
	}()
	select {
	case err := <-done:
		if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) || errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	case <-ctx.Done():
		server.closeConnections()
		select {
		case err := <-done:
			if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) || errors.Is(err, http.ErrServerClosed) {
				return nil
			}
			return err
		case <-time.After(500 * time.Millisecond):
			return nil
		}
	}
}

func (server *Server) handleHTMLPreview(w http.ResponseWriter, r *http.Request) {
	requestedPath := r.URL.Query().Get("path")
	rawHTML, err := server.options.Workspace.ReadHTMLPreview(requestedPath)
	if err != nil {
		writeError(w, r, err)
		return
	}
	nonce := randomNonce()
	preview := renderEmbeddedMermaidPreviewHTML(
		addRenderedCommentBlockIDsToHTML(addHeadingIDs(withPreviewBase(rawHTML, requestedPath))),
		requestedPath,
		nonce,
		themeFromRequest(r),
		server.options.AllowHTMLScripts,
	)
	w.Header().Set("content-type", "text/html; charset=utf-8")
	w.Header().Set("x-content-type-options", "nosniff")
	w.Header().Set("cache-control", "no-store")
	w.Header().Set("content-security-policy", htmlPreviewCSP(server.options.AllowHTMLScripts, nonce))

	// codeql[go/reflected-xss]
	_, _ = w.Write([]byte(preview))
}

func (server *Server) handleRawPreview(w http.ResponseWriter, r *http.Request) {
	requestedPath := strings.TrimPrefix(r.URL.Path, "/preview/raw/")
	file, err := server.options.Workspace.ReadFile(requestedPath)
	if err != nil {
		writeError(w, r, err)
		return
	}
	if file.Truncated {
		writeError(w, r, fmt.Errorf("file is too large to preview"))
		return
	}
	contentType := file.MimeType
	if contentType == "" {
		contentType = mime.TypeByExtension(filepath.Ext(file.Path))
	}
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	w.Header().Set("content-type", contentType)
	w.Header().Set("x-content-type-options", "nosniff")
	w.Header().Set("cache-control", "no-store")
	if file.Encoding == "base64" {
		bytes, _ := base64.StdEncoding.DecodeString(file.Content)
		_, _ = w.Write(bytes)
		return
	}
	_, _ = w.Write([]byte(file.Content))
}

func (server *Server) handleEvents(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("content-type", "text/event-stream")
	w.Header().Set("cache-control", "no-cache, no-transform")
	w.Header().Set("connection", "keep-alive")
	events, unsubscribe := server.app.SubscribeWorkspaceEvents()
	defer unsubscribe()
	_, _ = io.WriteString(w, ": connected\n\n")
	if flusher, ok := w.(http.Flusher); ok {
		flusher.Flush()
	}
	for {
		select {
		case <-r.Context().Done():
			return
		case event := <-events:
			payload, err := json.Marshal(event)
			if err != nil {
				continue
			}
			_, _ = io.WriteString(w, "event: fs\n")
			_, _ = io.WriteString(w, "data: "+string(payload)+"\n\n")
			if flusher, ok := w.(http.Flusher); ok {
				flusher.Flush()
			}
		}
	}
}

func (server *Server) handleGraphqlEvents(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("content-type", "text/event-stream")
	w.Header().Set("cache-control", "no-cache, no-transform")
	w.Header().Set("connection", "keep-alive")
	events, unsubscribe := server.app.SubscribeWorkspaceEvents()
	defer unsubscribe()
	_, _ = io.WriteString(w, ": connected\n\n")
	if flusher, ok := w.(http.Flusher); ok {
		flusher.Flush()
	}
	for {
		select {
		case <-r.Context().Done():
			return
		case event := <-events:
			payload, err := json.Marshal(map[string]any{
				"data": map[string]any{"workspaceEvents": event},
			})
			if err != nil {
				continue
			}
			_, _ = io.WriteString(w, "event: next\n")
			_, _ = io.WriteString(w, "data: "+string(payload)+"\n\n")
			if flusher, ok := w.(http.Flusher); ok {
				flusher.Flush()
			}
		}
	}
}

func isGraphqlWorkspaceEventsRequest(r *http.Request) bool {
	return r.URL.Query().Get("operationName") == "WorkspaceEvents" ||
		strings.Contains(r.URL.Query().Get("query"), "workspaceEvents")
}

func isGraphqlCommentActivityRequest(r *http.Request) bool {
	return r.URL.Query().Get("operationName") == "CommentThreadActivity" || strings.Contains(r.URL.Query().Get("query"), "commentThreadActivity")
}

func (server *Server) handleGraphqlCommentActivities(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("content-type", "text/event-stream")
	w.Header().Set("cache-control", "no-cache, no-transform")
	w.Header().Set("connection", "keep-alive")
	_, _ = io.WriteString(w, ": connected\n\n")
	if flusher, ok := w.(http.Flusher); ok {
		flusher.Flush()
	}
	threadID := ""
	if raw := r.URL.Query().Get("variables"); raw != "" {
		var variables map[string]any
		if json.Unmarshal([]byte(raw), &variables) == nil {
			threadID, _ = variables["threadId"].(string)
		}
	}
	events, unsubscribe := server.app.SubscribeCommentThreadActivities()
	defer unsubscribe()
	for {
		select {
		case <-r.Context().Done():
			return
		case event, ok := <-events:
			if !ok {
				return
			}
			if threadID != "" && threadID != stringValue(event["threadId"]) {
				continue
			}
			payload, err := json.Marshal(map[string]any{"data": map[string]any{"commentThreadActivity": event}})
			if err != nil {
				continue
			}
			_, _ = io.WriteString(w, "event: next\n")
			_, _ = io.WriteString(w, "data: "+string(payload)+"\n\n")
			if flusher, ok := w.(http.Flusher); ok {
				flusher.Flush()
			}
		}
	}
}

func stringValue(value any) string { text, _ := value.(string); return text }

func (server *Server) handleStatic(w http.ResponseWriter, r *http.Request) {
	requested := strings.TrimPrefix(r.URL.Path, "/")
	if requested == "" {
		requested = "index.html"
	}
	filePath := path.Clean(requested)
	if strings.HasPrefix(filePath, "../") || filePath == ".." {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "static path escapes root"})
		return
	}
	content, err := fs.ReadFile(uiassets.StaticFiles, path.Join(uiassets.StaticRoot, filePath))
	if err != nil {
		content, err = fs.ReadFile(uiassets.StaticFiles, path.Join(uiassets.StaticRoot, "index.html"))
		if err != nil {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		filePath = "index.html"
	}
	contentType := mime.TypeByExtension(path.Ext(filePath))
	if contentType == "" && strings.HasSuffix(filePath, ".js") {
		contentType = "text/javascript; charset=utf-8"
	}
	if contentType == "" {
		contentType = "text/html; charset=utf-8"
	}
	w.Header().Set("content-type", contentType)
	_, _ = w.Write(content)
}

func (server *Server) publish(event application.WorkspaceEvent) {
	server.app.PublishWorkspaceEvent(event)
}

func (server *Server) trackConnection(conn net.Conn, state http.ConnState) {
	server.connMu.Lock()
	defer server.connMu.Unlock()
	switch state {
	case http.StateNew, http.StateActive, http.StateIdle:
		server.connections[conn] = struct{}{}
	case http.StateHijacked, http.StateClosed:
		delete(server.connections, conn)
	}
}

func (server *Server) closeConnections() {
	server.connMu.Lock()
	connections := make([]net.Conn, 0, len(server.connections))
	for conn := range server.connections {
		connections = append(connections, conn)
	}
	server.connMu.Unlock()
	for _, conn := range connections {
		_ = conn.Close()
	}
}

func (server *Server) watch(ctx context.Context) {
	previous, err := server.options.Workspace.WatchEntries()
	if err != nil {
		fmt.Fprintf(os.Stderr, "[vivi] watcher initial scan failed: %v\n", err)
		previous = map[string]workspace.WatchEntry{}
	}
	idleScans := 0
	for {
		timer := time.NewTimer(watchInterval(idleScans))
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
			started := time.Now()
			current, stats, err := server.options.Workspace.WatchEntriesWithStats()
			if err != nil {
				telemetry.RecordOperation(ctx, "server.watch_loop", telemetry.OperationStats{
					DurationMs:         time.Since(started).Milliseconds(),
					ScannedDirectories: stats.ScannedDirectories,
					ScannedFiles:       stats.ScannedFiles,
					Error:              true,
				})
				fmt.Fprintf(os.Stderr, "[vivi] watcher scan failed: %v\n", err)
				idleScans = 0
				continue
			}
			emittedEvents := 0
			for pathname, entry := range current {
				old, ok := previous[pathname]
				if !ok {
					server.publish(application.WorkspaceEvent{Type: "add", Path: pathname, Kind: entry.Kind})
					emittedEvents++
					continue
				}
				if entry.Kind == "file" && (entry.Size != old.Size || entry.MtimeNs != old.MtimeNs) {
					server.publish(application.WorkspaceEvent{Type: "change", Path: pathname})
					emittedEvents++
				}
			}
			for pathname, old := range previous {
				if _, ok := current[pathname]; !ok {
					server.publish(application.WorkspaceEvent{Type: "unlink", Path: pathname, Kind: old.Kind})
					emittedEvents++
				}
			}
			telemetry.RecordOperation(ctx, "server.watch_loop", telemetry.OperationStats{
				DurationMs:         time.Since(started).Milliseconds(),
				ScannedDirectories: stats.ScannedDirectories,
				ScannedFiles:       stats.ScannedFiles,
				EmittedEvents:      emittedEvents,
				ResultCount:        len(current),
			})
			if emittedEvents > 0 {
				server.options.Workspace.InvalidateSearchIndex()
			}
			previous = current
			if emittedEvents == 0 {
				idleScans++
			} else {
				idleScans = 0
			}
		}
	}
}

func watchInterval(idleScans int) time.Duration {
	if idleScans <= 0 {
		return watchBaseInterval
	}
	interval := watchBaseInterval
	for range idleScans {
		interval *= 2
		if interval >= watchMaxIdleInterval {
			return watchMaxIdleInterval
		}
	}
	return interval
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("content-type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func writeError(w http.ResponseWriter, r *http.Request, err error) {
	status := statusForError(err)
	reason := reasonForError(err)
	if status >= 500 {
		fmt.Fprintf(os.Stderr, "[vivi] %s %s failed with %d: %s\n", r.Method, r.URL.String(), status, reason)
	}
	writeJSON(w, status, map[string]string{
		"error":  errorLabel(err),
		"reason": reason,
		"status": statusLabel(err, status),
	})
}

func statusForError(err error) int {
	if errors.Is(err, os.ErrNotExist) {
		return http.StatusNotFound
	}
	if errors.Is(err, os.ErrPermission) {
		return http.StatusForbidden
	}
	message := err.Error()
	if strings.Contains(message, "too large") {
		return http.StatusRequestEntityTooLarge
	}
	if workspace.IsRequestError(err) || strings.Contains(message, "path") || strings.Contains(message, "invalid") || strings.Contains(message, "required") || strings.Contains(message, "must") {
		return http.StatusBadRequest
	}
	return http.StatusInternalServerError
}

func reasonForError(err error) string {
	if errors.Is(err, os.ErrNotExist) {
		return "The requested path does not exist."
	}
	if errors.Is(err, os.ErrPermission) {
		return "The requested path cannot be read due to filesystem permissions."
	}
	return err.Error()
}

func errorLabel(err error) string {
	if errors.Is(err, os.ErrNotExist) || errors.Is(err, os.ErrPermission) {
		return "filesystem error"
	}
	return err.Error()
}

func statusLabel(err error, status int) string {
	if errors.Is(err, os.ErrNotExist) {
		return "ENOENT"
	}
	if errors.Is(err, os.ErrPermission) {
		return "EACCES"
	}
	if status >= 500 {
		return "internal_error"
	}
	return "request_error"
}

func readJSON(r *http.Request, target any) error {
	if !strings.Contains(strings.ToLower(r.Header.Get("content-type")), "application/json") {
		return fmt.Errorf("comment write APIs require application/json")
	}
	decoder := json.NewDecoder(io.LimitReader(r.Body, 1024*1024))
	return decoder.Decode(target)
}

func safeJSONWriteRequest(r *http.Request, configuredHost string) bool {
	host := r.Host
	hostName, _, err := net.SplitHostPort(host)
	if err != nil {
		hostName = strings.Trim(host, "[]")
	}
	if hostName != configuredHost && hostName != "localhost" && hostName != "127.0.0.1" && hostName != "::1" && hostName != "0.0.0.0" {
		return false
	}
	if origin := r.Header.Get("origin"); origin != "" && !strings.Contains(origin, host) {
		return false
	}
	return true
}

func metaResponse() map[string]any {
	return map[string]any{
		"version": "v1",
		"comments": map[string]any{
			"statuses":      []string{"open", "resolved", "archived"},
			"surfaces":      []string{"source", "rendered", "diff"},
			"exportFormats": []string{"jsonl"},
		},
	}
}

func positiveInt(value string) int {
	parsed, err := strconv.Atoi(value)
	if err != nil || parsed <= 0 {
		return 0
	}
	return parsed
}

func randomNonce() string {
	var bytes [16]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		return strconv.FormatInt(time.Now().UnixNano(), 10)
	}
	return base64.StdEncoding.EncodeToString(bytes[:])
}

func htmlPreviewCSP(allowScripts bool, nonce string) string {
	script := "script-src 'nonce-" + nonce + "'"
	sandbox := "sandbox allow-same-origin"
	if allowScripts {
		script = "script-src 'self' 'unsafe-inline'"
		sandbox = "sandbox allow-same-origin allow-scripts"
	}
	return strings.Join([]string{
		"default-src 'self' data: blob:",
		"object-src 'none'",
		"base-uri 'self'",
		"style-src 'self' 'unsafe-inline'",
		script,
		sandbox,
	}, "; ")
}

func withPreviewBase(html, relativePath string) string {
	dir := path.Dir(strings.ReplaceAll(relativePath, "\\", "/"))
	basePath := "/preview/raw/"
	if dir != "." && dir != "/" {
		segments := []string{}
		for _, segment := range strings.Split(dir, "/") {
			if segment != "" {
				segments = append(segments, pathEscape(segment))
			}
		}
		basePath = "/preview/raw/" + strings.Join(segments, "/") + "/"
	}
	base := `<base href="` + basePath + `">`
	if regexp.MustCompile(`(?i)<base\s`).MatchString(html) {
		return html
	}
	head := regexp.MustCompile(`(?i)<head(\s[^>]*)?>`)
	if head.MatchString(html) {
		return head.ReplaceAllStringFunc(html, func(match string) string { return match + base })
	}
	return "<head>" + base + "</head>" + html
}

func addHeadingIDs(html string) string {
	used := map[string]int{}
	re := regexp.MustCompile(`(?is)<h([12])(\s[^>]*)?>(.*?)</h[12]>`)
	return re.ReplaceAllStringFunc(html, func(match string) string {
		parts := re.FindStringSubmatch(match)
		if len(parts) < 4 || regexp.MustCompile(`(?i)\sid\s*=`).MatchString(parts[2]) {
			return match
		}
		text := regexp.MustCompile(`<[^>]+>`).ReplaceAllString(parts[3], "")
		slug := slugify(text)
		if slug == "" {
			slug = fmt.Sprintf("heading-%d", len(used)+1)
		}
		used[slug]++
		id := slug
		if used[slug] > 1 {
			id = fmt.Sprintf("%s-%d", slug, used[slug])
		}
		return fmt.Sprintf(`<h%s%s id="%s">%s</h%s>`, parts[1], parts[2], id, parts[3], parts[1])
	})
}

type htmlCommentBlock struct {
	blockID         string
	tagName         string
	sourceLineStart int
	sourceLineEnd   int
	openingStart    int
	openingEnd      int
}

type openHTMLElement struct {
	tagName string
	block   *htmlCommentBlock
}

var renderedCommentBlockTags = map[string]bool{
	"h1": true, "h2": true, "h3": true, "h4": true, "h5": true, "h6": true,
	"p": true, "li": true, "pre": true, "tr": true,
	"blockquote": true, "aside": true, "figure": true,
}

var rawTextHTMLTags = map[string]bool{"script": true, "style": true, "textarea": true}
var voidHTMLTags = map[string]bool{
	"area": true, "base": true, "br": true, "col": true, "embed": true,
	"hr": true, "img": true, "input": true, "link": true, "meta": true,
	"param": true, "source": true, "track": true, "wbr": true,
}

func addRenderedCommentBlockIDsToHTML(html string) string {
	blocks := parseRenderedCommentBlocks(html)
	output := html
	for i := len(blocks) - 1; i >= 0; i-- {
		block := blocks[i]
		openingTag := output[block.openingStart:block.openingEnd]
		annotated := annotateRenderedCommentOpeningTag(openingTag, block)
		output = output[:block.openingStart] + annotated + output[block.openingEnd:]
	}
	return output
}

func parseRenderedCommentBlocks(html string) []*htmlCommentBlock {
	lowerHTML := strings.ToLower(html)
	blocks := []*htmlCommentBlock{}
	stack := []openHTMLElement{}
	cursor := 0
	blockIndex := 0
	rawTextTag := ""
	templateDepth := 0
	for cursor < len(html) {
		if rawTextTag != "" {
			closingIndex := strings.Index(lowerHTML[cursor:], "</"+rawTextTag)
			if closingIndex < 0 {
				break
			}
			cursor += closingIndex
		}
		tagStartRelative := strings.Index(html[cursor:], "<")
		if tagStartRelative < 0 {
			break
		}
		tagStart := cursor + tagStartRelative
		if strings.HasPrefix(html[tagStart:], "<!--") {
			commentEnd := strings.Index(html[tagStart+4:], "-->")
			if commentEnd < 0 {
				break
			}
			cursor = tagStart + 4 + commentEnd + 3
			continue
		}
		tagEnd := findHTMLTagEnd(html, tagStart+1)
		if tagEnd < 0 {
			break
		}
		tag := html[tagStart : tagEnd+1]
		match := regexp.MustCompile(`^<\s*(/?)\s*([a-zA-Z][\w:-]*)`).FindStringSubmatch(tag)
		if len(match) < 3 {
			cursor = tagEnd + 1
			continue
		}
		closing := match[1] == "/"
		tagName := strings.ToLower(match[2])
		if closing {
			closeOpenHTMLElements(&stack, tagName, htmlLineNumberAt(html, tagEnd))
			if tagName == "template" && templateDepth > 0 {
				templateDepth--
			}
			if tagName == rawTextTag {
				rawTextTag = ""
			}
		} else {
			insideTemplate := templateDepth > 0
			autoCloseOptionalHTMLElements(&stack, tagName, htmlLineNumberAt(html, maxInt(0, tagStart-1)))
			if tagName == "template" {
				templateDepth++
			}
			if rawTextHTMLTags[tagName] {
				rawTextTag = tagName
			}
			var block *htmlCommentBlock
			if !insideTemplate && tagName != "template" && renderedCommentBlockTags[tagName] {
				lineStart := htmlLineNumberAt(html, tagStart)
				block = &htmlCommentBlock{
					blockID:         fmt.Sprintf("vivi-block-%d", blockIndex+1),
					tagName:         tagName,
					sourceLineStart: lineStart,
					sourceLineEnd:   lineStart,
					openingStart:    tagStart,
					openingEnd:      tagEnd + 1,
				}
				blocks = append(blocks, block)
				blockIndex++
			}
			selfClosing := regexp.MustCompile(`/\s*>$`).MatchString(tag) || voidHTMLTags[tagName]
			if !selfClosing {
				stack = append(stack, openHTMLElement{tagName: tagName, block: block})
			}
		}
		cursor = tagEnd + 1
	}
	finalLine := htmlLineNumberAt(html, maxInt(0, len(html)-1))
	for len(stack) > 0 {
		element := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		if element.block != nil {
			element.block.sourceLineEnd = finalLine
		}
	}
	return blocks
}

func annotateRenderedCommentOpeningTag(tag string, block *htmlCommentBlock) string {
	clean := regexp.MustCompile(`(?i)\sdata-vivi-comment-block-id\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)`).ReplaceAllString(tag, "")
	clean = regexp.MustCompile(`(?i)\sdata-vivi-source-line-(start|end)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)`).ReplaceAllString(clean, "")
	attribute := fmt.Sprintf(`data-vivi-comment-block-id="%s" data-vivi-source-line-start="%d" data-vivi-source-line-end="%d"`, block.blockID, block.sourceLineStart, block.sourceLineEnd)
	suffix := ">"
	if regexp.MustCompile(`/\s*>$`).MatchString(clean) {
		suffix = "/>"
	}
	body := strings.TrimRight(clean[:len(clean)-len(suffix)], " \t\r\n")
	return body + " " + attribute + suffix
}

func findHTMLTagEnd(html string, start int) int {
	var quote rune
	for index := start; index < len(html); index++ {
		character := rune(html[index])
		if quote != 0 {
			if character == quote {
				quote = 0
			}
			continue
		}
		if character == '"' || character == '\'' {
			quote = character
			continue
		}
		if character == '>' {
			return index
		}
	}
	return -1
}

func closeOpenHTMLElements(stack *[]openHTMLElement, tagName string, endLine int) {
	matchIndex := -1
	for index := len(*stack) - 1; index >= 0; index-- {
		if (*stack)[index].tagName == tagName {
			matchIndex = index
			break
		}
	}
	if matchIndex < 0 {
		return
	}
	for len(*stack) > matchIndex {
		element := (*stack)[len(*stack)-1]
		*stack = (*stack)[:len(*stack)-1]
		if element.block != nil {
			element.block.sourceLineEnd = endLine
		}
	}
}

func autoCloseOptionalHTMLElements(stack *[]openHTMLElement, nextTag string, endLine int) {
	if len(*stack) > 0 && (*stack)[len(*stack)-1].tagName == "p" && isBlockOpeningHTMLTag(nextTag) {
		closeOpenHTMLElements(stack, "p", endLine)
	}
	if nextTag == "li" {
		closePeerWithinHTMLContainer(stack, "li", map[string]bool{"ul": true, "ol": true}, endLine)
	}
	if nextTag == "tr" {
		closePeerWithinHTMLContainer(stack, "tr", map[string]bool{"table": true, "thead": true, "tbody": true, "tfoot": true}, endLine)
	}
}

func closePeerWithinHTMLContainer(stack *[]openHTMLElement, peer string, containers map[string]bool, endLine int) {
	peerIndex := -1
	containerIndex := -1
	for index := len(*stack) - 1; index >= 0; index-- {
		if peerIndex < 0 && (*stack)[index].tagName == peer {
			peerIndex = index
		}
		if containerIndex < 0 && containers[(*stack)[index].tagName] {
			containerIndex = index
		}
	}
	if peerIndex > containerIndex {
		for len(*stack) > peerIndex {
			element := (*stack)[len(*stack)-1]
			*stack = (*stack)[:len(*stack)-1]
			if element.block != nil {
				element.block.sourceLineEnd = endLine
			}
		}
	}
}

func isBlockOpeningHTMLTag(tagName string) bool {
	if renderedCommentBlockTags[tagName] {
		return true
	}
	return map[string]bool{
		"address": true, "article": true, "div": true, "dl": true,
		"fieldset": true, "footer": true, "form": true, "header": true,
		"hr": true, "main": true, "nav": true, "ol": true,
		"section": true, "table": true, "ul": true,
	}[tagName]
}

func htmlLineNumberAt(source string, offset int) int {
	if offset < 0 {
		offset = 0
	}
	if offset > len(source) {
		offset = len(source)
	}
	return strings.Count(source[:offset], "\n") + 1
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func renderEmbeddedMermaidPreviewHTML(rawHTML, relativePath, nonce, theme string, allowScripts bool) string {
	if regexp.MustCompile(`(?i)data-vivi-mermaid-preview`).MatchString(rawHTML) {
		return rawHTML
	}
	blockIndex := 0
	blockRe := regexp.MustCompile(`(?is)<(pre|div|code)(\s[^>]*)?>(.*?)</(?:pre|div|code)>`)
	rendered := blockRe.ReplaceAllStringFunc(rawHTML, func(match string) string {
		parts := blockRe.FindStringSubmatch(match)
		if len(parts) < 4 || !hasMermaidClass(parts[2]) {
			return match
		}
		source := strings.TrimSpace(htmlToText(parts[3]))
		if source == "" {
			return match
		}
		id := fmt.Sprintf("vivi-html-mermaid-%d", blockIndex)
		blockIndex++
		scriptStatus := "user scripts inactive"
		if allowScripts {
			scriptStatus = "user scripts active"
		}
		commentAttributes := htmlCommentBlockAttributes(parts[2])
		return fmt.Sprintf(
			`<figure class="html-mermaid" id="%s" data-vivi-html-mermaid data-mermaid-status="pending" data-mermaid-custom-style="%t" data-mermaid-source="%s"%s><figcaption>Mermaid preview - %s</figcaption><div class="mermaid-render-target" aria-live="polite"></div><div class="markdown-mermaid-fallback unsupported"><p>Mermaid preview is loading. Source is shown below if rendering fails.</p><details class="markdown-mermaid-source"><summary>Mermaid source</summary><pre><code>%s</code></pre></details></div></figure>`,
			escapeAttribute(id),
			hasCustomMermaidStyle(source),
			escapeAttribute(source),
			commentAttributes,
			scriptStatus,
			escapeHTML(source),
		)
	})
	return injectPreviewRuntime(rendered, relativePath, nonce, theme, allowScripts, blockIndex > 0)
}

func injectPreviewRuntime(html, relativePath, nonce, theme string, allowScripts bool, includeMermaidRuntime bool) string {
	paletteBackground := "#0e1316"
	paletteText := "#edf7f5"
	paletteLine := "#34474d"
	palettePanel := "#152126"
	paletteMuted := "#96aaa9"
	paletteCodeBackground := "#11191d"
	paletteCodeText := "#edf7f5"
	paletteAccent := "#7dd3c7"
	paletteSoftLine := "rgba(255,255,255,.06)"
	paletteCommentTint := "rgba(169,134,255,.14)"
	paletteCommentTintActive := "rgba(169,134,255,.22)"
	paletteCommentLine := "rgba(169,134,255,.42)"
	paletteCommentText := "#d8c7ff"
	if theme == "light" {
		paletteBackground = "#fbfaf7"
		paletteText = "#172426"
		paletteLine = "#d4c9b8"
		palettePanel = "#ffffff"
		paletteMuted = "#66736f"
		paletteCodeBackground = "#f2f0ea"
		paletteCodeText = "#172426"
		paletteAccent = "#2f6f73"
		paletteSoftLine = "rgba(24,32,47,.08)"
		paletteCommentTint = "rgba(126,87,194,.12)"
		paletteCommentTintActive = "rgba(126,87,194,.2)"
		paletteCommentLine = "rgba(126,87,194,.35)"
		paletteCommentText = "#5e3aa3"
	}
	styles := fmt.Sprintf(`<style data-vivi-mermaid-preview data-vivi-html-theme="%s">
html{color-scheme:%s;background:%s;}
body{background:%s;color:%s;}
body:not([data-vivi-preserve-spacing]){font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;}
a{color:%s;}
pre,code{background:%s;color:%s;}
pre{border:1px solid %s;border-radius:8px;padding:12px;overflow:auto;}
.html-mermaid{margin:18px 0;}
.html-mermaid figcaption,.markdown-mermaid-source summary{color:%s;font-size:12px;}
.mermaid-render-target{overflow:auto;border:1px solid %s;border-radius:8px;background:%s;padding:14px;}
.mermaid-render-target svg{display:block;max-width:100%%;height:auto;}
.html-mermaid[data-mermaid-status="rendered"] .markdown-mermaid-fallback{display:none;}
.markdown-mermaid-source{margin-top:10px;}
.markdown-mermaid-source summary{cursor:pointer;}
.markdown-mermaid-source pre{overflow:auto;border:1px solid %s;border-radius:8px;background:%s;color:%s;padding:10px;}
.html-mermaid.unsupported{border:1px solid %s;border-radius:8px;background:%s;padding:12px;}
	.vivi-rendered-comment-block{--rendered-comment-block-left:-12px;--rendered-comment-block-right:-12px;--soft-line:%s;--panel:%s;--palette:%s;--comment-tint:%s;--comment-tint-active:%s;--comment-line:%s;--comment-text:%s;isolation:isolate;position:relative;border-radius:8px;transition:background 140ms ease,box-shadow 140ms ease;}
	li.vivi-rendered-comment-block{--rendered-comment-block-left:calc(-1.45em - 12px);}
	.vivi-rendered-comment-block:not(tr)::before{content:"";position:absolute;z-index:-1;top:0;right:var(--rendered-comment-block-right);bottom:0;left:var(--rendered-comment-block-left);border-radius:inherit;pointer-events:none;transition:background 140ms ease,box-shadow 140ms ease;}
	.vivi-rendered-comment-block:not(tr):hover::before,tr.vivi-rendered-comment-block:hover{background:var(--soft-line);}
		.vivi-rendered-comment-block.has-rendered-comment,.vivi-rendered-comment-block.drafting-rendered-comment{border-radius:8px;}
		.vivi-rendered-comment-block.has-rendered-comment:not(tr),.vivi-rendered-comment-block.drafting-rendered-comment:not(tr){background:transparent;box-shadow:none;}
		blockquote.vivi-rendered-comment-block.has-rendered-comment,blockquote.vivi-rendered-comment-block.drafting-rendered-comment,blockquote.vivi-rendered-comment-block.active-rendered-comment{border-left-color:transparent!important;}
		.vivi-rendered-comment-block.has-rendered-comment:not(tr)::before,.vivi-rendered-comment-block.drafting-rendered-comment:not(tr)::before,tr.vivi-rendered-comment-block.has-rendered-comment,tr.vivi-rendered-comment-block.drafting-rendered-comment{background:linear-gradient(90deg,var(--comment-tint-active),color-mix(in srgb,var(--comment-tint) 56%%,transparent) 68%%,transparent);box-shadow:inset 2px 0 0 var(--comment-line);}
	.vivi-rendered-comment-block.active-rendered-comment{background:transparent;box-shadow:none;}
	.vivi-rendered-comment-block.active-rendered-comment:not(tr)::before,tr.vivi-rendered-comment-block.active-rendered-comment{background:linear-gradient(90deg,color-mix(in srgb,var(--comment-tint-active) 86%%,white),var(--comment-tint) 72%%,transparent);box-shadow:inset 3px 0 0 var(--comment-text),0 0 0 1px color-mix(in srgb,var(--comment-line) 46%%,transparent);}
	.vivi-rendered-comment-block.rendered-comment-range-start.has-rendered-comment,.vivi-rendered-comment-block.rendered-comment-range-start.drafting-rendered-comment{border-bottom-left-radius:0;border-bottom-right-radius:0;}
	.vivi-rendered-comment-block.rendered-comment-range-middle.has-rendered-comment,.vivi-rendered-comment-block.rendered-comment-range-middle.drafting-rendered-comment{border-radius:0;}
	.vivi-rendered-comment-block.rendered-comment-range-end.has-rendered-comment,.vivi-rendered-comment-block.rendered-comment-range-end.drafting-rendered-comment{border-top-left-radius:0;border-top-right-radius:0;}
	.vivi-rendered-comment-block.rendered-comment-range-join-after:not(tr)::after{content:"";position:absolute;z-index:1;left:var(--rendered-comment-block-left);right:var(--rendered-comment-block-right);top:100%%;height:var(--rendered-comment-join-after,0);pointer-events:none;background:linear-gradient(90deg,var(--comment-tint-active),color-mix(in srgb,var(--comment-tint) 56%%,transparent) 68%%,transparent);box-shadow:inset 2px 0 0 var(--comment-line);}
	.vivi-rendered-comment-block.active-rendered-comment.rendered-comment-range-join-after:not(tr)::after{background:linear-gradient(90deg,color-mix(in srgb,var(--comment-tint-active) 86%%,white),var(--comment-tint) 72%%,transparent);box-shadow:inset 3px 0 0 var(--comment-text);}
	.rendered-comment-marker{position:absolute;z-index:2147483646;top:calc(50%% + 1px);right:8px;width:20px;height:20px;border:1px solid var(--comment-line);border-radius:6px;background:var(--panel);color:var(--comment-text);box-shadow:0 5px 14px rgba(0,0,0,.22);cursor:pointer;padding:0;transform:translateY(-50%%);transition:background 140ms ease,border-color 140ms ease,transform 140ms ease;}
	.rendered-comment-marker::before{content:"";position:absolute;left:5px;top:5px;width:7px;height:6px;border:1.25px solid currentColor;border-radius:3px;}
	.rendered-comment-marker::after{content:"";position:absolute;left:7px;top:10px;width:3px;height:3px;border-left:1.25px solid currentColor;transform:skew(-22deg);}
	.rendered-comment-marker:hover,.rendered-comment-marker:focus-visible{outline:none;background:var(--comment-tint-active);border-color:var(--comment-text);transform:translateY(calc(-50%% - 1px));}
	.rendered-comment-marker-count{position:absolute;right:-5px;top:-6px;display:grid;place-items:center;min-width:13px;height:13px;border:1px solid var(--comment-line);border-radius:999px;background:var(--palette);color:var(--comment-text);font-size:8px;font-weight:800;line-height:1;padding:0 2px;}
	.vivi-rendered-comment-action-host{position:relative;}
	</style>`, theme, theme, paletteBackground, paletteBackground, paletteText, paletteAccent, paletteCodeBackground, paletteCodeText, paletteLine, paletteMuted, paletteLine, palettePanel, paletteLine, paletteCodeBackground, paletteCodeText, paletteLine, palettePanel, paletteSoftLine, palettePanel, paletteBackground, paletteCommentTint, paletteCommentTintActive, paletteCommentLine, paletteCommentText)
	selectionBridge := fmt.Sprintf(`<script nonce="%s">
(() => {
  const path = %s;
  const blockSelector = "[data-vivi-comment-block-id]";
  const preferredBlockSelectors = ["tr","li","pre","figure","aside","blockquote","h1","h2","h3","h4","h5","h6","p"];
  const interactiveSelector = "a,button,input,select,textarea,summary,[contenteditable]";
  let renderedComments = [];
  let activeCommentId = null;
  let draftingBlockIds = [];
  let openBlockIds = [];
  const post = (message) => parent.postMessage({ path, ...message }, "*");
  const escapeSelectorValue = (value) => String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const escapeCssIdentifier = (value) => globalThis.CSS?.escape ? CSS.escape(value) : String(value).replace(/[^a-zA-Z0-9_-]/g, (character) => "\\" + character);
  const cssPath = (element) => {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return undefined;
    if (element.id) return "#" + escapeCssIdentifier(element.id);
    const parts = [];
    let current = element;
    while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.body) {
      const name = current.localName;
      const parent = current.parentElement;
      if (!parent) break;
      const siblings = Array.from(parent.children).filter((item) => item.localName === name);
      const index = siblings.indexOf(current) + 1;
      parts.unshift(siblings.length > 1 ? name + ":nth-of-type(" + index + ")" : name);
      current = parent;
    }
    return parts.join(">");
  };
  const readableText = (element) => {
    const clone = element?.cloneNode(true);
    clone?.querySelectorAll?.(".rendered-comment-marker").forEach((item) => item.remove());
    return (clone?.innerText || clone?.textContent || "").replace(/\s+/g, " ").trim();
  };
  const rectLikeForBlocks = (blocks) => {
    if (!blocks.length) return null;
    const first = blocks[0].getBoundingClientRect();
    const last = blocks[blocks.length - 1].getBoundingClientRect();
    const left = Math.min(first.left, last.left);
    const top = Math.min(first.top, last.top);
    const right = Math.max(first.right, last.right);
    const bottom = Math.max(first.bottom, last.bottom);
    return { left, top, width: right - left, height: bottom - top };
  };
  const closestBlock = (target) => {
    if (!target || target.nodeType !== Node.ELEMENT_NODE) return null;
    for (const selector of preferredBlockSelectors) {
      const block = target.closest(selector + blockSelector);
      if (block) return block;
    }
    return target.closest(blockSelector);
  };
  const commentableBlocks = () => Array.from(document.querySelectorAll(blockSelector)).filter((block) => closestBlock(block) === block);
  const sourceRange = (blocks) => {
    const starts = blocks.map((block) => Number(block.dataset.viviSourceLineStart)).filter(Number.isInteger);
    const ends = blocks.map((block) => Number(block.dataset.viviSourceLineEnd || block.dataset.viviSourceLineStart)).filter(Number.isInteger);
    return starts.length && ends.length ? { sourceLineStart: starts[0], sourceLineEnd: ends[ends.length - 1] } : {};
  };
  const targetForBlocks = (blocks, selectedText) => {
    const targets = blocks.filter((block) => block.dataset.viviCommentBlockId);
    if (!targets.length) return null;
    const text = selectedText?.trim() || targets.map(readableText).join("\n");
    const rect = rectLikeForBlocks(targets);
    if (!text || !rect) return null;
    return {
      blockId: targets[0].dataset.viviCommentBlockId,
      blockIds: targets.map((block) => block.dataset.viviCommentBlockId),
      selector: cssPath(targets[0]),
      text,
      rect,
      ...sourceRange(targets)
    };
  };
  const actionLabel = (count) => "Open comment thread with " + count + " " + (count === 1 ? "message" : "messages");
  const removeAction = (block) => {
    block.querySelectorAll(".rendered-comment-marker").forEach((action) => action.remove());
    block.classList.remove("vivi-rendered-comment-action-host");
    block.lastElementChild?.classList.remove("vivi-rendered-comment-action-host");
  };
  const ensureAction = (block, count) => {
    const host = block.localName === "tr" && block.lastElementChild ? block.lastElementChild : block;
    if (host !== block) host.classList.add("vivi-rendered-comment-action-host");
    const action = document.createElement("button");
    action.type = "button";
    action.className = "rendered-comment-marker";
    action.dataset.commentCount = String(count);
    action.setAttribute("aria-label", actionLabel(count));
    action.title = actionLabel(count);
    const countNode = document.createElement("span");
    countNode.className = "rendered-comment-marker-count";
    countNode.setAttribute("aria-hidden", "true");
    countNode.textContent = String(count);
    action.append(countNode);
    host.append(action);
    return action;
  };
  const findBlocksForComment = (comment) => {
    const byRange = Number.isInteger(comment.sourceLineStart)
      ? commentableBlocks().filter((block) => {
          const start = Number(block.dataset.viviSourceLineStart);
          const end = Number(block.dataset.viviSourceLineEnd);
          const commentEnd = Number.isInteger(comment.sourceLineEnd) ? comment.sourceLineEnd : comment.sourceLineStart;
          return Number.isInteger(start) && Number.isInteger(end) && start <= commentEnd && end >= comment.sourceLineStart;
        })
      : [];
    if (comment.blockId) {
      const byBlock = document.querySelector("[data-vivi-comment-block-id=\"" + escapeSelectorValue(comment.blockId) + "\"]");
      const closest = byBlock ? closestBlock(byBlock) : null;
      if (closest) {
        const spansMultipleLines = Number.isInteger(comment.sourceLineStart) && Number.isInteger(comment.sourceLineEnd) && comment.sourceLineEnd > comment.sourceLineStart;
        if (spansMultipleLines && byRange.length > 1 && byRange.includes(closest)) return byRange;
        return [closest];
      }
    }
    if (comment.selector) {
      try {
        const bySelector = document.querySelector(comment.selector);
        if (bySelector?.matches(blockSelector)) return [bySelector];
        const nearest = bySelector?.closest(blockSelector);
        if (nearest) return [nearest];
      } catch {}
    }
    if (byRange.length) return byRange;
    const quote = comment.textQuote?.trim();
    const byQuote = quote ? Array.from(document.querySelectorAll(blockSelector)).find((block) => readableText(block).includes(quote)) ?? null : null;
    return byQuote ? [byQuote] : [];
  };
	  const pixelValue = (value) => {
	    const parsed = Number.parseFloat(value);
	    return Number.isFinite(parsed) ? parsed : 0;
	  };
	  const applyRangeBridge = (blocks) => {
	    if (blocks.length < 2) return;
	    const bounds = blocks.map((block) => {
	      const rect = block.getBoundingClientRect();
	      const before = getComputedStyle(block, "::before");
	      return {left: rect.left + pixelValue(before.left), right: rect.right - pixelValue(before.right)};
	    });
	    const rangeLeft = Math.min(...bounds.map((bound) => bound.left));
	    const rangeRight = Math.max(...bounds.map((bound) => bound.right));
	    blocks.forEach((block, index) => {
	      const rect = block.getBoundingClientRect();
	      block.style.setProperty("--rendered-comment-block-left", Math.round(rangeLeft - rect.left) + "px");
	      block.style.setProperty("--rendered-comment-block-right", Math.round(rect.right - rangeRight) + "px");
	      block.classList.add(index === 0 ? "rendered-comment-range-start" : index === blocks.length - 1 ? "rendered-comment-range-end" : "rendered-comment-range-middle");
	      const next = blocks[index + 1];
	      if (!next) return;
	      const gap = Math.max(0, Math.round(next.getBoundingClientRect().top - block.getBoundingClientRect().bottom));
	      if (gap <= 1) return;
	      block.classList.add("rendered-comment-range-join-after");
	      block.style.setProperty("--rendered-comment-join-after", gap + "px");
	    });
	  };
  const bindBlockAction = (block) => {
    if (block.dataset.viviCommentClickBound === "true") return;
    block.dataset.viviCommentClickBound = "true";
    block.addEventListener("click", (event) => {
      if (event.target.closest?.(".rendered-comment-marker")) return;
      if (event.target.closest?.(interactiveSelector)) return;
      if (document.getSelection()?.toString().trim()) return;
      const target = targetForBlocks([block]);
      const commentId = block.dataset.viviCommentId;
      postTarget(target, commentId ? "vivi-html-comment-open" : "vivi-html-block-target", commentId);
    });
  };
  const applyHighlights = () => {
    const blocks = commentableBlocks();
    blocks.forEach((block) => {
      bindBlockAction(block);
      block.classList.add("vivi-rendered-comment-block");
	      block.classList.remove("has-rendered-comment", "active-rendered-comment", "drafting-rendered-comment", "rendered-comment-range-start", "rendered-comment-range-middle", "rendered-comment-range-end", "rendered-comment-range-join-after");
	      block.style.removeProperty("--rendered-comment-block-left");
	      block.style.removeProperty("--rendered-comment-block-right");
	      block.style.removeProperty("--rendered-comment-join-after");
      delete block.dataset.viviCommentId;
      delete block.dataset.viviCommentCount;
      removeAction(block);
    });
    const commentsByBlock = new Map();
    const markerCommentsByBlock = new Map();
    for (const comment of renderedComments) {
      const commentBlocks = findBlocksForComment(comment);
      applyRangeBridge(commentBlocks);
      for (const block of commentBlocks) {
        const list = commentsByBlock.get(block) || [];
        list.push(comment);
        commentsByBlock.set(block, list);
      }
      const markerBlock = commentBlocks[commentBlocks.length - 1];
      if (markerBlock) {
        const list = markerCommentsByBlock.get(markerBlock) || [];
        list.push(comment);
        markerCommentsByBlock.set(markerBlock, list);
      }
    }
    for (const [block, comments] of commentsByBlock) {
      const firstComment = comments[0];
      block.classList.add("has-rendered-comment");
      if (comments.some((comment) => comment.id === activeCommentId)) block.classList.add("active-rendered-comment");
      block.dataset.viviCommentId = firstComment.id;
      block.dataset.viviCommentCount = String(comments.length);
    }
    for (const [block, comments] of markerCommentsByBlock) {
      const action = ensureAction(block, comments.length);
      action.dataset.commentId = comments[0].id;
    }
    const drafting = blocks.filter((block) => draftingBlockIds.includes(block.dataset.viviCommentBlockId));
    applyRangeBridge(drafting);
    drafting.forEach((block) => block.classList.add("drafting-rendered-comment"));
    postThreadLayout();
  };
  const postTarget = (target, type = "vivi-html-block-target", id) => {
    if (!target) return;
    post({ type, id, ...target });
  };
  const postThreadLayout = () => {
    if (!openBlockIds.length) return;
    const byId = new Set(openBlockIds);
    const blocks = commentableBlocks().filter((block) => byId.has(block.dataset.viviCommentBlockId));
    const target = targetForBlocks(blocks);
    if (target) post({ type: "vivi-html-thread-layout", blockIds: target.blockIds, rect: target.rect });
  };
  const publishSelection = () => {
    const selection = document.getSelection();
    if (!selection?.toString().trim() || !selection.rangeCount) return;
    const range = selection.getRangeAt(0);
    const blocks = commentableBlocks().filter((block) => {
      try { return range.intersectsNode(block); } catch { return false; }
    });
    postTarget(targetForBlocks(blocks, selection.toString()));
  };
  const publishSoon = () => window.requestAnimationFrame(() => window.setTimeout(publishSelection, 0));
  window.addEventListener("message", (event) => {
    if (event.source && event.source !== parent) return;
    const data = event.data;
    if (data?.type !== "vivi-html-comments" || data.path !== path) return;
    renderedComments = Array.isArray(data.comments) ? data.comments : [];
    activeCommentId = typeof data.activeCommentId === "string" ? data.activeCommentId : null;
    draftingBlockIds = Array.isArray(data.draftingBlockIds) ? data.draftingBlockIds : [];
    openBlockIds = Array.isArray(data.openBlockIds) ? data.openBlockIds : [];
    applyHighlights();
  });
  document.addEventListener("click", (event) => {
    const marker = event.target.closest?.(".rendered-comment-marker");
    const block = closestBlock(marker || event.target);
    if (marker) {
      event.preventDefault();
      event.stopPropagation();
      const target = targetForBlocks(block ? [block] : []);
      postTarget(target, "vivi-html-comment-open", marker.dataset.commentId);
      return;
    }
    if (!block) {
      post({ type: "vivi-html-comment-clear" });
      return;
    }
    if (event.target.closest?.(interactiveSelector)) return;
    if (document.getSelection()?.toString().trim()) return;
    const target = targetForBlocks([block]);
    const commentId = block.dataset.viviCommentId;
    postTarget(target, commentId ? "vivi-html-comment-open" : "vivi-html-block-target", commentId);
  });
  document.addEventListener("mouseup", publishSoon);
  document.addEventListener("keyup", publishSoon);
  window.addEventListener("scroll", () => window.requestAnimationFrame(postThreadLayout), true);
  window.addEventListener("resize", postThreadLayout);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", applyHighlights, { once: true });
  else applyHighlights();
})();
</script>`, escapeAttribute(nonce), strconv.Quote(relativePath))
	mermaidScripts := ""
	if includeMermaidRuntime {
		mermaidScripts = fmt.Sprintf(`<script nonce="%s" src="/vivi/vendor/mermaid.min.js"></script><script nonce="%s">
(() => {
  const renderBlocks = async () => {
    const mermaid = globalThis.mermaid;
    if (!mermaid) return;
    const blocks = Array.from(document.querySelectorAll("[data-vivi-html-mermaid]"));
    for (const [index, block] of blocks.entries()) {
      const source = block.dataset.mermaidSource;
      const target = block.querySelector(".mermaid-render-target");
      if (!source || !target || block.dataset.mermaidStatus === "rendered") continue;
      try {
        mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "base", flowchart: { htmlLabels: false } });
        const result = await mermaid.render("vivi-html-mermaid-" + index + "-" + Date.now(), source);
        target.innerHTML = result.svg;
        block.dataset.mermaidStatus = "rendered";
      } catch (error) {
        block.dataset.mermaidStatus = "error";
        target.textContent = error instanceof Error ? error.message : "Mermaid could not render this diagram.";
      }
    }
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", renderBlocks, { once: true });
  else renderBlocks();
})();
</script>`, escapeAttribute(nonce), escapeAttribute(nonce))
	}
	injection := styles + selectionBridge + mermaidScripts
	if strings.Contains(strings.ToLower(html), "</head>") {
		return regexp.MustCompile(`(?i)</head>`).ReplaceAllString(html, injection+"</head>")
	}
	return injection + html
}

func hasMermaidClass(attributes string) bool {
	match := regexp.MustCompile(`(?is)\sclass\s*=\s*["']([^"']*)["']`).FindStringSubmatch(attributes)
	if len(match) < 2 {
		return false
	}
	for _, className := range strings.Fields(match[1]) {
		if className == "mermaid" {
			return true
		}
	}
	return false
}

func htmlCommentBlockAttributes(attributes string) string {
	patterns := []string{
		`(?i)\sdata-vivi-comment-block-id="[^"]*"`,
		`(?i)\sdata-vivi-source-line-start="\d+"`,
		`(?i)\sdata-vivi-source-line-end="\d+"`,
	}
	output := ""
	for _, pattern := range patterns {
		if match := regexp.MustCompile(pattern).FindString(attributes); match != "" {
			output += match
		}
	}
	return output
}

func htmlToText(value string) string {
	value = regexp.MustCompile(`(?i)<br\s*/?>`).ReplaceAllString(value, "\n")
	value = regexp.MustCompile(`<[^>]+>`).ReplaceAllString(value, "")
	return stdhtml.UnescapeString(value)
}

func hasCustomMermaidStyle(source string) bool {
	return strings.Contains(source, "themeVariables") || strings.Contains(source, "%%{init")
}

func escapeHTML(value string) string {
	return stdhtml.EscapeString(value)
}

func escapeAttribute(value string) string {
	replacer := strings.NewReplacer(
		"&", "&amp;",
		`"`, "&quot;",
		"<", "&lt;",
	)
	return replacer.Replace(value)
}

func themeFromRequest(r *http.Request) string {
	if r.URL.Query().Get("theme") == "light" {
		return "light"
	}
	return "dark"
}

func slugify(text string) string {
	text = strings.ToLower(strings.TrimSpace(text))
	var builder strings.Builder
	lastDash := false
	for _, r := range text {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			builder.WriteRune(r)
			lastDash = false
			continue
		}
		if !lastDash && builder.Len() > 0 {
			builder.WriteByte('-')
			lastDash = true
		}
	}
	return strings.Trim(builder.String(), "-")
}

func pathEscape(value string) string {
	return strings.ReplaceAll(path.Clean(value), " ", "%20")
}
