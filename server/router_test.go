package server

import (
	"bytes"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"path"
	"strings"
	"testing"

	"github.com/tasuku43/vivi/server/application"
	"github.com/tasuku43/vivi/server/reviewledger"
	uiassets "github.com/tasuku43/vivi/ui"
)

func TestLegacyDataRoutesAreNotServed(t *testing.T) {
	server := &Server{}
	for _, target := range []string{
		"/api/tree",
		"/api/file?path=README.md",
		"/api/search?q=vivi",
		"/api/v1/comments",
	} {
		t.Run(target, func(t *testing.T) {
			response := httptest.NewRecorder()
			server.route(response, httptest.NewRequest(http.MethodGet, target, nil))
			if response.Code != http.StatusNotFound {
				t.Fatalf("status = %d, want %d", response.Code, http.StatusNotFound)
			}
		})
	}
}

func TestMissingStaticAssetsDoNotUseSPAFallback(t *testing.T) {
	server := &Server{}
	for _, target := range []string{
		"/assets/index-OLDHASH.js",
		"/assets",
		"/assets/../index-OLDHASH.js",
		"/assets/%2e%2e/index-OLDHASH.js",
		"/assets%2findex-OLDHASH.js",
	} {
		t.Run(target, func(t *testing.T) {
			response := httptest.NewRecorder()
			server.route(response, httptest.NewRequest(http.MethodGet, target, nil))

			if response.Code != http.StatusNotFound {
				t.Fatalf("status = %d, want %d", response.Code, http.StatusNotFound)
			}
			if strings.Contains(response.Body.String(), "<html") {
				t.Fatalf("missing asset returned the SPA shell: %s", response.Body.String())
			}
		})
	}
}

func TestStaticRoutesKeepSPAFallbackAndAssetContentType(t *testing.T) {
	server := &Server{}

	spa := httptest.NewRecorder()
	server.route(spa, httptest.NewRequest(http.MethodGet, "/workspace/deep-link", nil))
	if spa.Code != http.StatusOK {
		t.Fatalf("SPA status = %d, want %d", spa.Code, http.StatusOK)
	}
	if contentType := spa.Header().Get("content-type"); !strings.Contains(contentType, "text/html") {
		t.Fatalf("SPA content-type = %q, want text/html", contentType)
	}
	if !strings.Contains(spa.Body.String(), `id="root"`) {
		t.Fatalf("SPA fallback did not return index.html: %s", spa.Body.String())
	}

	entries, err := fs.ReadDir(uiassets.StaticFiles, path.Join(uiassets.StaticRoot, "assets"))
	if err != nil {
		t.Fatal(err)
	}
	var javascriptAsset string
	for _, entry := range entries {
		if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".js") {
			javascriptAsset = "/assets/" + entry.Name()
			break
		}
	}
	if javascriptAsset == "" {
		t.Fatal("embedded UI has no JavaScript asset")
	}

	asset := httptest.NewRecorder()
	server.route(asset, httptest.NewRequest(http.MethodGet, javascriptAsset, nil))
	if asset.Code != http.StatusOK {
		t.Fatalf("asset status = %d, want %d", asset.Code, http.StatusOK)
	}
	if contentType := asset.Header().Get("content-type"); !strings.Contains(contentType, "javascript") {
		t.Fatalf("asset content-type = %q, want JavaScript", contentType)
	}
}

func TestHTMLPreviewCSPIncludesSandbox(t *testing.T) {
	defaultPolicy := htmlPreviewCSP(false, "nonce")
	if !strings.Contains(defaultPolicy, "sandbox allow-same-origin") {
		t.Fatalf("default CSP = %q, want sandbox", defaultPolicy)
	}
	if !strings.Contains(defaultPolicy, "sandbox allow-same-origin allow-scripts") {
		t.Fatalf("default CSP = %q, want Vivi runtime scripts in sandbox", defaultPolicy)
	}
	if strings.Contains(defaultPolicy, "script-src 'self' 'unsafe-inline'") {
		t.Fatalf("default CSP = %q, should not allow user scripts", defaultPolicy)
	}

	scriptPolicy := htmlPreviewCSP(true, "nonce")
	if !strings.Contains(scriptPolicy, "sandbox allow-same-origin allow-scripts") {
		t.Fatalf("script CSP = %q, want opt-in scripts in sandbox", scriptPolicy)
	}
}

func TestReviewLedgerRouteStoresWorkspaceScopedSnapshot(t *testing.T) {
	ledger, err := reviewledger.NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	server := &Server{
		app:     application.NewService(application.Options{ReviewLedger: ledger}),
		options: Options{Host: "127.0.0.1"},
	}
	body := []byte(`{"decisions":[{"path":"src/app.ts","fingerprint":"f1","reason":"accepted_change","createdAt":"2026-07-01T00:00:00Z"}],"receipts":[]}`)
	put := httptest.NewRequest(http.MethodPut, "/api/v1/review-ledger", bytes.NewReader(body))
	put.Host = "127.0.0.1"
	put.Header.Set("content-type", "application/json")
	putResponse := httptest.NewRecorder()
	server.route(putResponse, put)
	if putResponse.Code != http.StatusOK {
		t.Fatalf("put status = %d body = %s", putResponse.Code, putResponse.Body.String())
	}

	getResponse := httptest.NewRecorder()
	server.route(getResponse, httptest.NewRequest(http.MethodGet, "/api/v1/review-ledger", nil))
	if getResponse.Code != http.StatusOK {
		t.Fatalf("get status = %d", getResponse.Code)
	}
	if !strings.Contains(getResponse.Body.String(), `"fingerprint":"f1"`) {
		t.Fatalf("ledger response = %s", getResponse.Body.String())
	}
}

func TestHTMLPreviewRuntimeHandlesRepeatedBodyLikeInput(t *testing.T) {
	input := "<body " + strings.Repeat("<body ", 2000) + "><p>ok</p></body>"

	rendered := injectPreviewRuntime(input, "index.html", "nonce", "dark", false, false)

	if !strings.Contains(rendered, `data-vivi-mermaid-preview`) {
		t.Fatalf("rendered preview is missing runtime style marker")
	}
	if !strings.Contains(rendered, input) {
		t.Fatalf("rendered preview should preserve the local HTML body")
	}
}

func TestWithPreviewBaseSkipsHeadRegexForRepeatedBodyLikeInput(t *testing.T) {
	input := "<body " + strings.Repeat("<body ", 2000) + "><p>ok</p></body>"

	rendered := withPreviewBase(input, "docs/index.html")

	if !strings.HasPrefix(rendered, `<head><base href="/preview/raw/docs/"></head>`) {
		t.Fatalf("rendered preview should prepend a relative preview base")
	}
	if !strings.Contains(rendered, input) {
		t.Fatalf("rendered preview should preserve the local HTML body")
	}
}

func TestHTMLPreviewSkipsUnclosedMermaidCandidates(t *testing.T) {
	input := `<body ` + strings.Repeat("<body ", 2000) + `><pre class="mermaid">` + strings.Repeat("<div>a", 4000) + `</body>`

	rendered := renderEmbeddedMermaidPreviewHTML(input, "index.html", "nonce", "dark", false)

	if !strings.Contains(rendered, `data-vivi-mermaid-preview`) {
		t.Fatalf("rendered preview is missing runtime style marker")
	}
	if strings.Contains(rendered, `data-vivi-html-mermaid`) {
		t.Fatalf("unclosed mermaid candidate should not be converted")
	}
}

func TestHTMLPreviewRecognizesCommonMermaidClassForms(t *testing.T) {
	input := `<pre class=mermaid>flowchart LR\nA-->B</pre><pre><code class="language-mermaid">sequenceDiagram\nA->>B: Hi</code></pre>`

	rendered := renderEmbeddedMermaidPreviewHTML(input, "index.html", "nonce", "dark", false)

	if count := strings.Count(rendered, `<figure class="html-mermaid"`); count != 2 {
		t.Fatalf("converted mermaid blocks = %d, want 2\n%s", count, rendered)
	}
	if !strings.Contains(rendered, `/vivi/vendor/mermaid.min.js`) {
		t.Fatalf("rendered preview is missing Mermaid runtime")
	}
}

func TestHTMLPreviewKeepsNestedMermaidElementBalanced(t *testing.T) {
	input := `<main data-vivi-mermaid-preview="authored"><div class="preview-wrapper"><div class="mermaid">flowchart LR
A-->B</div></div><p>After diagram</p></main>`

	rendered := renderEmbeddedMermaidPreviewHTML(input, "index.html", "nonce", "dark", false)

	if count := strings.Count(rendered, `<figure class="html-mermaid"`); count != 1 {
		t.Fatalf("converted mermaid blocks = %d, want 1\n%s", count, rendered)
	}
	if !strings.Contains(rendered, `<p>After diagram</p></main>`) {
		t.Fatalf("nested conversion malformed the surrounding document: %s", rendered)
	}
	if !strings.Contains(rendered, `/vivi/vendor/mermaid.min.js`) {
		t.Fatalf("authored marker must not suppress the preview runtime")
	}
	if !strings.Contains(rendered, "data-mermaid-source=\"flowchart LR\nA-->B\"") {
		t.Fatalf("nested Mermaid source lost its line break: %s", rendered)
	}
}

func TestHTMLPreviewLeavesMermaidLikeRawTextUntouched(t *testing.T) {
	input := `<script>window.template = "<div class=mermaid>graph TD; A-->B</div>";</script><style>.x::after{content:"<pre class=mermaid>A-->B</pre>"}</style><textarea><div class=mermaid>not markup</div></textarea><title><div class=mermaid>title</div></title><pre class=mermaid>flowchart LR\nA-->B</pre>`

	rendered := renderEmbeddedMermaidPreviewHTML(input, "index.html", "nonce", "dark", true)

	if count := strings.Count(rendered, `<figure class="html-mermaid"`); count != 1 {
		t.Fatalf("converted mermaid blocks = %d, want only the authored element\n%s", count, rendered)
	}
	for _, decoy := range []string{
		`window.template = "<div class=mermaid>graph TD; A-->B</div>";`,
		`.x::after{content:"<pre class=mermaid>A-->B</pre>"}`,
		`<textarea><div class=mermaid>not markup</div></textarea>`,
		`<title><div class=mermaid>title</div></title>`,
	} {
		if !strings.Contains(rendered, decoy) {
			t.Fatalf("raw-text content was rewritten: %q\n%s", decoy, rendered)
		}
	}
}

func TestAddHeadingIDsSkipsDocumentsWithoutHeadingCandidates(t *testing.T) {
	input := `<body ` + strings.Repeat("<body ", 2000) + `><p>ok</p></body>`

	rendered := addHeadingIDs(input)

	if rendered != input {
		t.Fatalf("document without h1/h2 candidates should be unchanged")
	}
}

func TestRenderedHTMLCommentBlocksAreAnnotatedSafely(t *testing.T) {
	html := addRenderedCommentBlockIDsToHTML(`<script>const example = "<p>not markup</p>";</script>
<template><p>not rendered</p></template>
<h1>Hello</h1>
<p title="one > two">Visible</p>`)

	if strings.Contains(html, `not markup" data-vivi-comment-block-id`) {
		t.Fatalf("script text was annotated: %s", html)
	}
	if strings.Contains(html, `<template><p data-vivi-comment-block-id`) {
		t.Fatalf("template content was annotated: %s", html)
	}
	for _, want := range []string{
		`<h1 data-vivi-comment-block-id="vivi-block-1" data-vivi-source-line-start="3" data-vivi-source-line-end="3">Hello</h1>`,
		`<p title="one > two" data-vivi-comment-block-id="vivi-block-2" data-vivi-source-line-start="4" data-vivi-source-line-end="4">Visible</p>`,
	} {
		if !strings.Contains(html, want) {
			t.Fatalf("annotated html missing %q in %s", want, html)
		}
	}
}

func TestRenderedHTMLCommentBlocksMapSemanticControls(t *testing.T) {
	html := addRenderedCommentBlockIDsToHTML(`<section>
  <header><h1>Settings</h1></header>
  <button
    type="button"
  >Unseen</button>
</section>`)

	for _, want := range []string{
		`<section data-vivi-comment-block-id="vivi-block-1" data-vivi-source-line-start="1" data-vivi-source-line-end="6">`,
		`<header data-vivi-comment-block-id="vivi-block-2" data-vivi-source-line-start="2" data-vivi-source-line-end="2"><h1 data-vivi-comment-block-id="vivi-block-3" data-vivi-source-line-start="2" data-vivi-source-line-end="2">Settings</h1></header>`,
		`<button
    type="button" data-vivi-comment-block-id="vivi-block-4" data-vivi-source-line-start="3" data-vivi-source-line-end="5"`,
	} {
		if !strings.Contains(html, want) {
			t.Fatalf("annotated html missing %q in %s", want, html)
		}
	}
}

func TestHTMLPreviewRuntimeUsesRenderedThreadContract(t *testing.T) {
	html := renderEmbeddedMermaidPreviewHTML(
		addRenderedCommentBlockIDsToHTML(`<h1>Hello</h1>`),
		"index.html",
		"nonce-test",
		"dark",
		false,
	)

	for _, want := range []string{
		`data-vivi-comment-block-id="vivi-block-1"`,
		`vivi-html-block-target`,
		`vivi-html-comment-open`,
		`vivi-html-open-path`,
		`vivi-html-thread-layout`,
		`renderedCommentStateSignature`,
		`drafting-rendered-comment`,
		`rendered-comment-marker`,
		`--rendered-comment-block-left:0px`,
		`.vivi-rendered-comment-block:not(tr)::before`,
		`.vivi-rendered-comment-block:not(tr)::before{content:"";position:absolute;z-index:0;`,
		`.vivi-rendered-comment-block:not(tr)>*{position:relative;z-index:1;}`,
		`.vivi-rendered-comment-block.hover-rendered-comment-block:not(tr)::before`,
		`rendered-comment-range-join-after:not(tr)::after`,
		`--rendered-comment-join-after`,
		`block.style.setProperty("--rendered-comment-block-left"`,
		`block.style.setProperty("--rendered-comment-block-right"`,
		`blockquote.vivi-rendered-comment-block.has-rendered-comment`,
		`li.vivi-rendered-comment-block{--rendered-comment-block-left:calc(-1.45em);}`,
		`Open comment thread with `,
		`shouldProjectSourceRange`,
		`const layoutContainerBlockTags = new Set(["main", "section", "article", "nav", "aside", "header", "footer", "figure"]);`,
		`const commentableBlocks = () => Array.from(document.querySelectorAll(blockSelector)).filter(isCommentableBlock);`,
		`document.addEventListener("pointermove", (event) => setHoveredBlock(renderedThreadOpen() ? null : closestBlock(event.target)));`,
		`const interactiveSelector = "input,select,textarea,[contenteditable]";`,
		`block.addEventListener("dblclick", (event) => {`,
		`const workspacePathForHref = (href) => {`,
		`post({ type: "vivi-html-open-path", targetPath });`,
		`document.getSelection()?.removeAllRanges();`,
		`event.preventDefault();`,
	} {
		if !strings.Contains(html, want) {
			t.Fatalf("preview runtime missing %q", want)
		}
	}
	for _, unwanted := range []string{
		`z-index:-1`,
		`.vivi-rendered-comment-block:not(tr):hover::before`,
		`rendered-comment-range-join-after:not(tr)::after{content:"";position:absolute;z-index:1;left:var(--rendered-comment-block-left);right:var(--rendered-comment-block-right);top:100%;height:var(--rendered-comment-join-after,0);pointer-events:none;background:linear-gradient(90deg,var(--comment-tint-active),color-mix(in srgb,var(--comment-tint) 56%,transparent) 68%,transparent);box-shadow`,
		`active-rendered-comment.rendered-comment-range-join-after:not(tr)::after{background:linear-gradient(90deg,color-mix(in srgb,var(--comment-tint-active) 86%,white),var(--comment-tint) 72%,transparent);box-shadow`,
	} {
		if strings.Contains(html, unwanted) {
			t.Fatalf("preview runtime should not paint a left rail through comment gaps")
		}
	}
}
