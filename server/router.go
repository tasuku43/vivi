package server

import (
	"fmt"
	"net/http"
	"strings"
)

// route is transport wiring only. Domain work is delegated to application
// services through the transport-specific handlers.
func (server *Server) route(w http.ResponseWriter, r *http.Request) {
	defer func() {
		if recovered := recover(); recovered != nil {
			writeError(w, r, fmt.Errorf("%v", recovered))
		}
	}()
	switch {
	case r.URL.Path == "/graphql":
		if r.Method == http.MethodGet && isGraphqlCommentActivityRequest(r) {
			server.handleGraphqlCommentActivities(w, r)
			return
		}
		if r.Method == http.MethodGet && isGraphqlWorkspaceEventsRequest(r) {
			server.handleGraphqlEvents(w, r)
			return
		}
		server.graphql.ServeHTTP(w, r)
	case r.URL.Path == "/preview/html":
		server.handleHTMLPreview(w, r)
	case strings.HasPrefix(r.URL.Path, "/preview/raw/"):
		server.handleRawPreview(w, r)
	case r.URL.Path == "/events":
		server.handleEvents(w, r)
	case r.URL.Path == "/api/v1/review-ledger":
		server.handleReviewLedger(w, r)
	case strings.HasPrefix(r.URL.Path, "/api/"):
		http.NotFound(w, r)
	default:
		server.handleStatic(w, r)
	}
}
