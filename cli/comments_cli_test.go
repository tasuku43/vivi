package main

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/tasuku43/vivi/server/application"
	"github.com/tasuku43/vivi/server/comments"
	"github.com/tasuku43/vivi/server/gitreview"
	vivigraphql "github.com/tasuku43/vivi/server/graphql"
	"github.com/tasuku43/vivi/server/workspace"
)

func TestCommentsCLIReadsRepliesAndMovesThreadLifecycle(t *testing.T) {
	server := newCommentsCLITestServer(t)
	defer server.Close()
	threadID := createCommentThreadForCLI(t, server.URL)

	active := runCommentsCLIForTest(t, "active", "--url", server.URL, "--actor", "claude-code", "--actor-name", "Claude Code", "--client-event-id", "read-open-1", "--json")
	var activePayload struct {
		Threads []commentThreadOutput `json:"threads"`
		Count   int                   `json:"count"`
	}
	decodeCLIJSON(t, active, &activePayload)
	if activePayload.Count != 1 || activePayload.Threads[0].ID != threadID {
		t.Fatalf("active payload = %s", active.String())
	}
	if activePayload.Threads[0].Comments[0].Body != "Please check the docs" {
		t.Fatalf("active comment body = %#v", activePayload.Threads[0].Comments)
	}

	readActivities := graphqlForCLI(t, server.URL, map[string]any{
		"operationName": "Activities",
		"query":         `query Activities($threadId: ID!) { commentThreadActivities(threadId: $threadId) { type actor { id kind displayName } clientEventId } }`,
		"variables":     map[string]any{"threadId": threadID},
	})
	activities := readActivities["commentThreadActivities"].([]any)
	if len(activities) != 2 {
		t.Fatalf("activities after active = %#v", activities)
	}
	read := activities[1].(map[string]any)
	actor := read["actor"].(map[string]any)
	if read["type"] != "thread_read" || read["clientEventId"] != "read-open-1" || actor["id"] != "claude-code" || actor["kind"] != "claude_code" {
		t.Fatalf("read activity = %#v", read)
	}

	events, unsubscribe := server.service.SubscribeCommentThreadActivities()
	defer unsubscribe()

	reply := runCommentsCLIForTest(t, "reply", threadID, "--url", server.URL, "--actor", "codex:run-1", "--actor-kind", "codex", "--body", "Implemented in this branch", "--json")
	var replyPayload struct {
		Comment commentOutput `json:"comment"`
	}
	decodeCLIJSON(t, reply, &replyPayload)
	if replyPayload.Comment.ThreadID != threadID || replyPayload.Comment.Body != "Implemented in this branch" || replyPayload.Comment.CreatedBy.Kind != "codex" {
		t.Fatalf("reply payload = %s", reply.String())
	}
	expectActivityEvent(t, events, "comment_added", threadID)

	resolved := runCommentsCLIForTest(t, "resolve", threadID, "--url", server.URL, "--actor", "codex:run-1", "--actor-kind", "codex", "--json")
	var lifecyclePayload struct {
		Thread commentThreadOutput `json:"thread"`
	}
	decodeCLIJSON(t, resolved, &lifecyclePayload)
	if lifecyclePayload.Thread.Status != "resolved" || lifecyclePayload.Thread.ResolvedAt == "" {
		t.Fatalf("resolved payload = %s", resolved.String())
	}
	expectActivityEvent(t, events, "thread_status_changed", threadID)

	archived := runCommentsCLIForTest(t, "archive", threadID, "--url", server.URL, "--actor", "codex:run-1", "--actor-kind", "codex", "--json")
	decodeCLIJSON(t, archived, &lifecyclePayload)
	if lifecyclePayload.Thread.Status != "archived" || lifecyclePayload.Thread.ArchivedAt == "" {
		t.Fatalf("archived payload = %s", archived.String())
	}

	reopened := runCommentsCLIForTest(t, "reopen", threadID, "--url", server.URL, "--actor", "codex:run-1", "--actor-kind", "codex", "--json")
	decodeCLIJSON(t, reopened, &lifecyclePayload)
	if lifecyclePayload.Thread.Status != "open" {
		t.Fatalf("reopened payload = %s", reopened.String())
	}

	show := runCommentsCLIForTest(t, "show", threadID, "--url", server.URL, "--json")
	var showPayload struct {
		Thread     commentThreadOutput     `json:"thread"`
		Activities []commentActivityOutput `json:"activities"`
	}
	decodeCLIJSON(t, show, &showPayload)
	if showPayload.Thread.ID != threadID || len(showPayload.Activities) < 5 {
		t.Fatalf("show payload = %s", show.String())
	}
}

func TestCommentsCLIShowsPublishedReviewBatchAndHidesDrafts(t *testing.T) {
	server := newCommentsCLITestServer(t)
	defer server.Close()
	for _, input := range []map[string]any{
		{"path": "README.md", "body": "Draft one", "anchor": map[string]any{"surface": "source", "canonical": map[string]any{"path": "README.md", "lineStart": float64(1)}}},
		{"path": "README.md", "body": "Draft two", "anchor": map[string]any{"surface": "source", "canonical": map[string]any{"path": "README.md", "lineStart": float64(1)}}},
	} {
		graphqlForCLI(t, server.URL, map[string]any{"operationName": "CreateDraftReviewComment", "query": `mutation CreateDraftReviewComment($input: DraftReviewCommentInput!) { createDraftReviewComment(input: $input) { id } }`, "variables": map[string]any{"input": input}})
	}
	before := runCommentsCLIForTest(t, "active", "--url", server.URL, "--actor", "codex:agent", "--actor-kind", "codex", "--json")
	var beforePayload struct {
		Threads []commentThreadOutput `json:"threads"`
		Count   int                   `json:"count"`
	}
	decodeCLIJSON(t, before, &beforePayload)
	if beforePayload.Count != 0 {
		t.Fatalf("drafts leaked to active CLI = %s", before.String())
	}
	published := graphqlForCLI(t, server.URL, map[string]any{"operationName": "PublishDraftReviewComments", "query": `mutation PublishDraftReviewComments { publishDraftReviewComments { reviewBatchId threads { id } } }`})["publishDraftReviewComments"].(map[string]any)
	reviewBatchID := published["reviewBatchId"].(string)
	after := runCommentsCLIForTest(t, "active", "--url", server.URL, "--actor", "codex:agent", "--actor-kind", "codex", "--json")
	var afterPayload struct {
		Threads []commentThreadOutput `json:"threads"`
		Count   int                   `json:"count"`
	}
	decodeCLIJSON(t, after, &afterPayload)
	if afterPayload.Count != 1 {
		t.Fatalf("active after publish = %s", after.String())
	}
	for _, thread := range afterPayload.Threads {
		if thread.ReviewBatchID != reviewBatchID || thread.Comments[0].ReviewBatchID != reviewBatchID {
			t.Fatalf("thread missing batch id: %#v", thread)
		}
		if len(thread.Comments) != 2 {
			t.Fatalf("thread did not keep both same-anchor comments: %#v", thread)
		}
	}
}

type commentsCLITestServer struct {
	URL        string
	oldClient  *http.Client
	httpClient *http.Client
	service    *application.Service
}

func (server *commentsCLITestServer) Close() {
	http.DefaultClient = server.oldClient
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (fn roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return fn(req)
}

func newCommentsCLITestServer(t *testing.T) *commentsCLITestServer {
	t.Helper()
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "README.md"), []byte("# Vivi\n\nHello\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	fsys, err := workspace.New(workspace.Options{Root: root})
	if err != nil {
		t.Fatal(err)
	}
	reviewer, err := gitreview.New(root, time.Second)
	if err != nil {
		t.Fatal(err)
	}
	store, err := comments.NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	service := application.NewService(application.Options{
		Workspace: fsys,
		Git:       reviewer,
		Comments:  store,
	})
	handler := vivigraphql.NewHandler(service, func(*http.Request) bool { return true })
	oldClient := http.DefaultClient
	httpClient := &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, req)
		return recorder.Result(), nil
	})}
	http.DefaultClient = httpClient
	return &commentsCLITestServer{
		URL:        "http://vivi.test",
		oldClient:  oldClient,
		httpClient: httpClient,
		service:    service,
	}
}

func expectActivityEvent(t *testing.T, events <-chan map[string]any, eventType, threadID string) {
	t.Helper()
	select {
	case event := <-events:
		if event["type"] != eventType || event["threadId"] != threadID {
			t.Fatalf("activity event = %#v, want type=%s thread=%s", event, eventType, threadID)
		}
	case <-time.After(time.Second):
		t.Fatalf("timed out waiting for activity event %s", eventType)
	}
}

func createCommentThreadForCLI(t *testing.T, serverURL string) string {
	t.Helper()
	data := graphqlForCLI(t, serverURL, map[string]any{
		"operationName": "CreateThread",
		"query": `mutation CreateThread($input: CommentInput!) {
			createThread(input: $input) { id }
		}`,
		"variables": map[string]any{"input": map[string]any{
			"path": "README.md",
			"body": "Please check the docs",
			"actor": map[string]any{
				"id":          "human:tasuku",
				"kind":        "human",
				"displayName": "Tasuku",
			},
			"anchor": map[string]any{
				"surface": "source",
				"canonical": map[string]any{
					"path":      "README.md",
					"lineStart": float64(1),
					"lineEnd":   float64(1),
					"quote":     "# Vivi",
				},
			},
		}},
	})
	created := data["createThread"].(map[string]any)
	return created["id"].(string)
}

func runCommentsCLIForTest(t *testing.T, args ...string) *bytes.Buffer {
	t.Helper()
	var output bytes.Buffer
	if err := runCommentsCommand(context.Background(), args, &output); err != nil {
		t.Fatalf("runCommentsCommand(%v): %v\noutput:\n%s", args, err, output.String())
	}
	return &output
}

func decodeCLIJSON(t *testing.T, output *bytes.Buffer, target any) {
	t.Helper()
	if err := json.Unmarshal(output.Bytes(), target); err != nil {
		t.Fatalf("invalid json %q: %v", output.String(), err)
	}
}

func graphqlForCLI(t *testing.T, serverURL string, request map[string]any) map[string]any {
	t.Helper()
	body, err := json.Marshal(request)
	if err != nil {
		t.Fatal(err)
	}
	res, err := http.Post(serverURL+"/graphql", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var payload struct {
		Data   map[string]any   `json:"data"`
		Errors []map[string]any `json:"errors"`
	}
	if err := json.NewDecoder(res.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	if res.StatusCode != http.StatusOK || len(payload.Errors) > 0 {
		t.Fatalf("graphql status=%d errors=%#v", res.StatusCode, payload.Errors)
	}
	return payload.Data
}
