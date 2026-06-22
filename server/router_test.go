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
