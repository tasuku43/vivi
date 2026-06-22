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
		addHeadingIDs(withPreviewBase(rawHTML, requestedPath)),
		requestedPath,
		nonce,
		themeFromRequest(r),
		server.options.AllowHTMLScripts,
	)
	w.Header().Set("content-type", "text/html; charset=utf-8")
	w.Header().Set("x-content-type-options", "nosniff")
	w.Header().Set("cache-control", "no-store")
	w.Header().Set("content-security-policy", htmlPreviewCSP(server.options.AllowHTMLScripts, nonce))
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
	if allowScripts {
		script = "script-src 'self' 'unsafe-inline'"
	}
	return strings.Join([]string{
		"default-src 'self' data: blob:",
		"object-src 'none'",
		"base-uri 'self'",
		"style-src 'self' 'unsafe-inline'",
		script,
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
		return fmt.Sprintf(
			`<figure class="html-mermaid" id="%s" data-vivi-html-mermaid data-mermaid-status="pending" data-mermaid-custom-style="%t" data-mermaid-source="%s"><figcaption>Mermaid preview - %s</figcaption><div class="mermaid-render-target" aria-live="polite"></div><div class="markdown-mermaid-fallback unsupported"><p>Mermaid preview is loading. Source is shown below if rendering fails.</p><details class="markdown-mermaid-source"><summary>Mermaid source</summary><pre><code>%s</code></pre></details></div></figure>`,
			escapeAttribute(id),
			hasCustomMermaidStyle(source),
			escapeAttribute(source),
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
	if theme == "light" {
		paletteBackground = "#fbfaf7"
		paletteText = "#172426"
		paletteLine = "#d4c9b8"
		palettePanel = "#ffffff"
		paletteMuted = "#66736f"
		paletteCodeBackground = "#f2f0ea"
		paletteCodeText = "#172426"
		paletteAccent = "#2f6f73"
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
</style>`, theme, theme, paletteBackground, paletteBackground, paletteText, paletteAccent, paletteCodeBackground, paletteCodeText, paletteLine, paletteMuted, paletteLine, palettePanel, paletteLine, paletteCodeBackground, paletteCodeText, paletteLine, palettePanel)
	selectionBridge := fmt.Sprintf(`<script nonce="%s">
(() => {
  const path = %s;
  const cssPath = (element) => {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return undefined;
    if (element.id) return "#" + CSS.escape(element.id);
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
  const publish = () => {
    const selection = document.getSelection();
    const text = selection?.toString().trim() ?? "";
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    const node = range?.commonAncestorContainer ?? null;
    const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
    const rect = range?.getBoundingClientRect();
    parent.postMessage({
      type: "vivi-html-selection",
      path,
      text,
      selector: cssPath(element),
      rect: rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : undefined
    }, window.location.origin);
  };
  const publishSoon = () => window.requestAnimationFrame(() => window.setTimeout(publish, 0));
  document.addEventListener("selectionchange", publish);
  document.addEventListener("mouseup", publishSoon);
  document.addEventListener("keyup", publishSoon);
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
