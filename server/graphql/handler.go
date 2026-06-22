package graphql

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strings"

	gqlgenhandler "github.com/99designs/gqlgen/graphql/handler"
	"github.com/tasuku43/vivi/server/application"
	"github.com/tasuku43/vivi/server/graphql/generated"
)

type requestEnvelope struct {
	Query         string `json:"query"`
	OperationName string `json:"operationName,omitempty"`
}

type gqlError struct {
	Message string `json:"message"`
}

type gqlErrorResponse struct {
	Errors []gqlError `json:"errors"`
}

func NewHandler(service *application.Service, safeJSONWrite func(*http.Request) bool) http.Handler {
	server := gqlgenhandler.NewDefaultServer(generated.NewExecutableSchema(generated.Config{
		Resolvers: NewResolver(service),
	}))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeGraphQLError(w, http.StatusMethodNotAllowed, "GraphQL endpoint requires POST")
			return
		}
		if r.Method == http.MethodPost {
			writeRequest, err := isGraphQLWriteRequest(r)
			if err != nil {
				writeGraphQLError(w, http.StatusBadRequest, err.Error())
				return
			}
			activityObserver := activityObserverFromRequest(service, r)
			if (writeRequest || activityObserver != nil) && !safeJSONWrite(r) {
				writeGraphQLError(w, http.StatusOK, "invalid Host or Origin header for local write API")
				return
			}
			if clientEventID := strings.TrimSpace(r.Header.Get("X-Vivi-Client-Event-Id")); clientEventID != "" {
				r = r.WithContext(application.WithClientEventID(r.Context(), clientEventID))
			}
			if activityObserver != nil {
				r = r.WithContext(application.WithThreadActivityObserver(r.Context(), activityObserver))
			}
		}
		server.ServeHTTP(w, r)
	})
}

func activityObserverFromRequest(service *application.Service, r *http.Request) application.ThreadActivityObserver {
	actorID := strings.TrimSpace(r.Header.Get("X-Vivi-Actor-Id"))
	if actorID == "" {
		return nil
	}
	actor := map[string]any{
		"id":   actorID,
		"kind": strings.TrimSpace(r.Header.Get("X-Vivi-Actor-Kind")),
	}
	if displayName := strings.TrimSpace(r.Header.Get("X-Vivi-Actor-Name")); displayName != "" {
		actor["displayName"] = displayName
	}
	return service.NewThreadActivityObserver(actor, r.Header.Get("X-Vivi-Client-Event-Id"))
}

func isGraphQLWriteRequest(r *http.Request) (bool, error) {
	body, err := io.ReadAll(io.LimitReader(r.Body, 1024*1024))
	if err != nil {
		return false, err
	}
	r.Body = io.NopCloser(bytes.NewReader(body))
	var request requestEnvelope
	if err := json.Unmarshal(body, &request); err != nil {
		return false, err
	}
	operation := strings.ToLower(request.OperationName)
	query := strings.ToLower(request.Query)
	return strings.Contains(query, "mutation") ||
		operation == "createcomment" ||
		operation == "updatecomment" ||
		operation == "updatecommentstatus", nil
}

func writeGraphQLError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("content-type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(gqlErrorResponse{
		Errors: []gqlError{{Message: message}},
	})
}
