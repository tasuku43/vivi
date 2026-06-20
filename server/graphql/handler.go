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
			if writeRequest && !safeJSONWrite(r) {
				writeGraphQLError(w, http.StatusOK, "invalid Host or Origin header for local write API")
				return
			}
		}
		server.ServeHTTP(w, r)
	})
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
