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
