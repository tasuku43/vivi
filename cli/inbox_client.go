package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"
	"time"
)

// The transport carries only published feedback and optional read identity.
type inboxRequestOptions struct {
	URL       string
	ActorID   string
	ActorKind string
	ActorName string
}

type graphqlRequest struct {
	OperationName string         `json:"operationName"`
	Query         string         `json:"query"`
	Variables     map[string]any `json:"variables,omitempty"`
}

type graphqlResponse struct {
	Data   map[string]json.RawMessage `json:"data"`
	Errors []struct {
		Message string `json:"message"`
	} `json:"errors"`
}

type commentThreadOutput struct {
	ID            string          `json:"id"`
	Path          string          `json:"path"`
	Status        string          `json:"status"`
	ReviewBatchID string          `json:"reviewBatchId,omitempty"`
	Anchor        json.RawMessage `json:"anchor,omitempty"`
	CreatedAt     string          `json:"createdAt"`
	UpdatedAt     string          `json:"updatedAt,omitempty"`
	ResolvedAt    string          `json:"resolvedAt,omitempty"`
	ArchivedAt    string          `json:"archivedAt,omitempty"`
	Comments      []commentOutput `json:"comments"`
}

type commentOutput struct {
	ID            string          `json:"id"`
	ThreadID      string          `json:"threadId,omitempty"`
	Path          string          `json:"path"`
	ViewerKind    string          `json:"viewerKind"`
	ReviewBatchID string          `json:"reviewBatchId,omitempty"`
	Anchor        json.RawMessage `json:"anchor,omitempty"`
	Body          string          `json:"body"`
	Status        string          `json:"status"`
	CreatedAt     string          `json:"createdAt"`
	UpdatedAt     string          `json:"updatedAt"`
	ResolvedAt    string          `json:"resolvedAt,omitempty"`
	ArchivedAt    string          `json:"archivedAt,omitempty"`
	CreatedBy     actorOutput     `json:"createdBy"`
}

type actorOutput struct {
	ID          string `json:"id"`
	Kind        string `json:"kind"`
	DisplayName string `json:"displayName,omitempty"`
}

func fetchCommentThreads(ctx context.Context, options inboxRequestOptions) ([]commentThreadOutput, error) {
	var threads []commentThreadOutput
	if err := postGraphQL(ctx, options, graphqlRequest{
		OperationName: "AgentCommentThreads",
		Query: `query AgentCommentThreads($status: CommentStatus) {
			commentThreads(status: $status) {
				id
				path
				status
				reviewBatchId
				anchor
				createdAt
				updatedAt
				resolvedAt
				archivedAt
				comments {
					id
					threadId
					path
					viewerKind
					reviewBatchId
					anchor
					body
					createdAt
					updatedAt
					resolvedAt
					archivedAt
					status
					createdBy { id kind displayName }
				}
			}
		}`,
		Variables: map[string]any{"status": "open"},
	}, "commentThreads", &threads); err != nil {
		return nil, err
	}
	return threads, nil
}

func orderCommentThreadsForAgent(threads []commentThreadOutput) []commentThreadOutput {
	ordered := append([]commentThreadOutput(nil), threads...)
	sort.SliceStable(ordered, func(i, j int) bool {
		left := ordered[i]
		right := ordered[j]
		if left.CreatedAt != right.CreatedAt {
			return left.CreatedAt < right.CreatedAt
		}
		if left.UpdatedAt != right.UpdatedAt {
			return left.UpdatedAt < right.UpdatedAt
		}
		if left.Path != right.Path {
			return left.Path < right.Path
		}
		return left.ID < right.ID
	})
	return ordered
}

func latestHumanComment(thread commentThreadOutput) *commentOutput {
	for index := len(thread.Comments) - 1; index >= 0; index-- {
		if thread.Comments[index].CreatedBy.Kind == "human" {
			return &thread.Comments[index]
		}
	}
	return nil
}

func postGraphQL(ctx context.Context, options inboxRequestOptions, request graphqlRequest, dataKey string, target any) error {
	body, err := json.Marshal(request)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, options.URL+"/graphql", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("content-type", "application/json")
	if options.ActorID != "" {
		req.Header.Set("X-Vivi-Actor-Id", options.ActorID)
		req.Header.Set("X-Vivi-Actor-Kind", options.ActorKind)
		if options.ActorName != "" {
			req.Header.Set("X-Vivi-Actor-Name", options.ActorName)
		}
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	responseBody, err := io.ReadAll(io.LimitReader(res.Body, 4*1024*1024))
	if err != nil {
		return err
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return fmt.Errorf("graphql request failed with status %d: %s", res.StatusCode, strings.TrimSpace(string(responseBody)))
	}
	var payload graphqlResponse
	if err := json.Unmarshal(responseBody, &payload); err != nil {
		return err
	}
	if len(payload.Errors) > 0 {
		messages := make([]string, 0, len(payload.Errors))
		for _, item := range payload.Errors {
			messages = append(messages, item.Message)
		}
		return fmt.Errorf("graphql error: %s", strings.Join(messages, "; "))
	}
	raw, ok := payload.Data[dataKey]
	if !ok {
		return fmt.Errorf("graphql response missing data.%s", dataKey)
	}
	return json.Unmarshal(raw, target)
}

func writeJSON(stdout io.Writer, value any) error {
	encoder := json.NewEncoder(stdout)
	encoder.SetEscapeHTML(false)
	encoder.SetIndent("", "  ")
	return encoder.Encode(value)
}

func formatViviCommand(args []string) string {
	parts := make([]string, 0, len(args)+1)
	parts = append(parts, shellQuoteCLIArg(viviExecutable))
	for _, arg := range args {
		parts = append(parts, shellQuoteCLIArg(arg))
	}
	return strings.Join(parts, " ")
}

func shellQuoteCLIArg(arg string) string {
	if arg == "" {
		return "''"
	}
	if strings.IndexFunc(arg, func(r rune) bool {
		return !(r == '-' || r == '_' || r == '.' || r == '/' || r == ':' || r == '=' || r == '+' || r == '@' || r == '%' || r == ',' ||
			(r >= '0' && r <= '9') ||
			(r >= 'A' && r <= 'Z') ||
			(r >= 'a' && r <= 'z'))
	}) < 0 {
		return arg
	}
	return "'" + strings.ReplaceAll(arg, "'", "'\\''") + "'"
}
