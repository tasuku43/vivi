package server

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
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

func TestHTMLPreviewCSPIncludesSandbox(t *testing.T) {
	defaultPolicy := htmlPreviewCSP(false, "nonce")
	if !strings.Contains(defaultPolicy, "sandbox allow-same-origin") {
		t.Fatalf("default CSP = %q, want sandbox", defaultPolicy)
	}
	if strings.Contains(defaultPolicy, "allow-scripts") {
		t.Fatalf("default CSP = %q, should not allow scripts", defaultPolicy)
	}

	scriptPolicy := htmlPreviewCSP(true, "nonce")
	if !strings.Contains(scriptPolicy, "sandbox allow-same-origin allow-scripts") {
		t.Fatalf("script CSP = %q, want opt-in scripts in sandbox", scriptPolicy)
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
		`vivi-html-thread-layout`,
		`drafting-rendered-comment`,
		`rendered-comment-marker`,
		`--rendered-comment-block-left:-12px`,
		`.vivi-rendered-comment-block:not(tr)::before`,
		`rendered-comment-range-join-after:not(tr)::after`,
		`--rendered-comment-join-after`,
		`block.style.setProperty("--rendered-comment-block-left"`,
		`block.style.setProperty("--rendered-comment-block-right"`,
		`blockquote.vivi-rendered-comment-block.has-rendered-comment`,
		`li.vivi-rendered-comment-block{--rendered-comment-block-left:calc(-1.45em - 12px);}`,
		`Open comment thread with `,
	} {
		if !strings.Contains(html, want) {
			t.Fatalf("preview runtime missing %q", want)
		}
	}
	for _, unwanted := range []string{
		`rendered-comment-range-join-after:not(tr)::after{content:"";position:absolute;z-index:1;left:var(--rendered-comment-block-left);right:var(--rendered-comment-block-right);top:100%;height:var(--rendered-comment-join-after,0);pointer-events:none;background:linear-gradient(90deg,var(--comment-tint-active),color-mix(in srgb,var(--comment-tint) 56%,transparent) 68%,transparent);box-shadow`,
		`active-rendered-comment.rendered-comment-range-join-after:not(tr)::after{background:linear-gradient(90deg,color-mix(in srgb,var(--comment-tint-active) 86%,white),var(--comment-tint) 72%,transparent);box-shadow`,
	} {
		if strings.Contains(html, unwanted) {
			t.Fatalf("preview runtime should not paint a left rail through comment gaps")
		}
	}
}
