package server

import (
	"net/http"
	"net/http/httptest"
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
