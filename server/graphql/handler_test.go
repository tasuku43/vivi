package graphql

import (
	"bytes"
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
	"github.com/tasuku43/vivi/server/workspace"
)

func TestHandlerServesWorkspaceAndCommentThreads(t *testing.T) {
	root := t.TempDir()
	dataDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "README.md"), []byte("# Vivi\n"), 0o644); err != nil {
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
	store, err := comments.NewStore(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	handler := NewHandler(application.NewService(application.Options{
		Workspace: fsys,
		Git:       reviewer,
		Comments:  store,
	}), func(*http.Request) bool { return true })

	workspaceData := graphql(t, handler, map[string]any{
		"operationName": "ViviWorkspace",
		"query": `query ViviWorkspace($depth: Int) {
			workspace(depth: $depth) {
				config { root allowHtmlScripts maxFileSizeBytes }
				tree { nodes { path kind childrenLoaded } }
			}
		}`,
		"variables": map[string]any{"depth": float64(1)},
	})
	workspaceValue := workspaceData["workspace"].(map[string]any)
	config := workspaceValue["config"].(map[string]any)
	if config["root"] != root {
		t.Fatalf("root = %v, want %v", config["root"], root)
	}

	createdData := graphql(t, handler, map[string]any{
		"operationName": "CreateComment",
		"query": `mutation CreateComment($input: CommentInput!) {
			createComment(input: $input) {
				id
				threadId
				path
				viewerKind
				status
			}
		}`,
		"variables": map[string]any{
			"input": map[string]any{
				"path": "README.md",
				"body": "GraphQL Go comment",
				"anchor": map[string]any{
					"surface": "source",
					"canonical": map[string]any{
						"path":      "README.md",
						"lineStart": float64(1),
						"lineEnd":   float64(1),
						"quote":     "# Vivi",
					},
				},
			},
		},
	})
	created := createdData["createComment"].(map[string]any)
	if created["viewerKind"] != "markdown" {
		t.Fatalf("viewerKind = %v, want markdown", created["viewerKind"])
	}
	if created["threadId"] != created["id"] {
		t.Fatalf("threadId = %v, want %v", created["threadId"], created["id"])
	}

	commentsData := graphql(t, handler, map[string]any{
		"operationName": "ViviComments",
		"query": `query ViviComments($path: String) {
			comments(path: $path) { id path }
			commentThreads(path: $path) {
				id
				path
				status
				comments { id threadId }
			}
		}`,
		"variables": map[string]any{"path": "README.md"},
	})
	threads := commentsData["commentThreads"].([]any)
	if len(threads) != 1 {
		t.Fatalf("thread count = %d, want 1", len(threads))
	}
	thread := threads[0].(map[string]any)
	if thread["id"] != created["id"] {
		t.Fatalf("thread id = %v, want %v", thread["id"], created["id"])
	}
	fileContextData := graphql(t, handler, map[string]any{
		"operationName": "ViviFileContext",
		"query": `query ViviFileContext($path: String!, $includeComments: Boolean) {
			fileContext(path: $path, includeComments: $includeComments) {
				commentThreads {
					id
					comments { id threadId }
				}
			}
		}`,
		"variables": map[string]any{"path": "README.md", "includeComments": true},
	})
	fileContext := fileContextData["fileContext"].(map[string]any)
	contextThreads := fileContext["commentThreads"].([]any)
	if len(contextThreads) != 1 {
		t.Fatalf("fileContext thread count = %d, want 1", len(contextThreads))
	}
	exportData := graphql(t, handler, map[string]any{
		"operationName": "ViviCommentExport",
		"query": `query ViviCommentExport($path: String, $status: CommentStatus) {
			commentExport(path: $path, status: $status, format: jsonl) {
				format
				contentType
				content
			}
		}`,
		"variables": map[string]any{"path": "README.md", "status": "open"},
	})
	export := exportData["commentExport"].(map[string]any)
	if export["format"] != "jsonl" {
		t.Fatalf("export format = %v, want jsonl", export["format"])
	}
	if !bytes.Contains([]byte(export["content"].(string)), []byte("GraphQL Go comment")) {
		t.Fatalf("export content = %v, want created comment", export["content"])
	}
	updatedThreadData := graphql(t, handler, map[string]any{
		"operationName": "UpdateCommentThreadStatus",
		"query": `mutation UpdateCommentThreadStatus($id: ID!, $status: CommentStatus!) {
			updateCommentThread(id: $id, input: { status: $status }) {
				id
				status
				comments { id status resolvedAt }
			}
		}`,
		"variables": map[string]any{"id": created["id"], "status": "resolved"},
	})
	updatedThread := updatedThreadData["updateCommentThread"].(map[string]any)
	if updatedThread["status"] != "resolved" {
		t.Fatalf("thread status = %v, want resolved", updatedThread["status"])
	}
}

func TestHandlerSupportsExplicitThreadLifecycleMutations(t *testing.T) {
	root := t.TempDir()
	dataDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "README.md"), []byte("# Vivi\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	fsys, _ := workspace.New(workspace.Options{Root: root})
	reviewer, _ := gitreview.New(root, time.Second)
	store, _ := comments.NewStore(dataDir)
	handler := NewHandler(application.NewService(application.Options{Workspace: fsys, Git: reviewer, Comments: store}), func(*http.Request) bool { return true })
	created := graphql(t, handler, map[string]any{"operationName": "CreateThread", "query": `mutation CreateThread($input: CommentInput!) { createThread(input: $input) { id status createdAt comments { id source body } } }`, "variables": map[string]any{"input": map[string]any{"path": "README.md", "body": "human request", "source": "human", "anchor": map[string]any{"surface": "source", "canonical": map[string]any{"path": "README.md", "lineStart": float64(1)}}}}})["createThread"].(map[string]any)
	id := created["id"].(string)
	if created["status"] != "open" {
		t.Fatalf("created = %#v", created)
	}
	added := graphql(t, handler, map[string]any{"operationName": "AddComment", "query": `mutation AddComment($threadId: ID!, $input: AddCommentInput!) { addComment(threadId: $threadId, input: $input) { threadId source body } }`, "variables": map[string]any{"threadId": id, "input": map[string]any{"body": "fixed", "source": "codex"}}})["addComment"].(map[string]any)
	if added["threadId"] != id || added["source"] != "codex" {
		t.Fatalf("added = %#v", added)
	}
	for _, transition := range []struct{ operation, field, status string }{{"ResolveThread", "resolveThread", "resolved"}, {"ArchiveThread", "archiveThread", "archived"}, {"ReopenThread", "reopenThread", "open"}} {
		result := graphql(t, handler, map[string]any{"operationName": transition.operation, "query": `mutation ` + transition.operation + `($id: ID!) { ` + transition.field + `(id: $id) { id status comments { status } } }`, "variables": map[string]any{"id": id}})[transition.field].(map[string]any)
		if result["status"] != transition.status {
			t.Fatalf("%s = %#v", transition.operation, result)
		}
	}
}

func TestHandlerRecordsActorAwareReadActivityWithoutChangingStatus(t *testing.T) {
	root := t.TempDir()
	dataDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "README.md"), []byte("# Vivi\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	fsys, _ := workspace.New(workspace.Options{Root: root})
	reviewer, _ := gitreview.New(root, time.Second)
	store, _ := comments.NewStore(dataDir)
	handler := NewHandler(application.NewService(application.Options{Workspace: fsys, Git: reviewer, Comments: store}), func(*http.Request) bool { return true })
	created := graphql(t, handler, map[string]any{"operationName": "CreateThread", "query": `mutation CreateThread($input: CommentInput!) { createThread(input: $input) { id status comments { createdBy { id kind displayName } } } }`, "variables": map[string]any{"input": map[string]any{"path": "README.md", "body": "please review", "actor": map[string]any{"id": "human:tasuku", "kind": "human", "displayName": "Tasuku"}, "anchor": map[string]any{"surface": "source", "canonical": map[string]any{"path": "README.md"}}}}})["createThread"].(map[string]any)
	threadID := created["id"].(string)
	commentsValue := created["comments"].([]any)
	createdBy := commentsValue[0].(map[string]any)["createdBy"].(map[string]any)
	if createdBy["id"] != "human:tasuku" {
		t.Fatalf("createdBy = %#v", createdBy)
	}
	readData := graphqlWithHeaders(t, handler, map[string]any{"operationName": "ReadOpenThreads", "query": `query ReadOpenThreads { commentThreads(status: open) { id comments { id } } }`}, map[string]string{
		"X-Vivi-Actor-Id":        "claude-code:run-1",
		"X-Vivi-Actor-Kind":      "claude_code",
		"X-Vivi-Actor-Name":      "Claude Code",
		"X-Vivi-Client-Event-Id": "fetch-open-1",
	})
	if len(readData["commentThreads"].([]any)) != 1 {
		t.Fatalf("read threads = %#v", readData["commentThreads"])
	}
	result := graphql(t, handler, map[string]any{"operationName": "ActivityAndThread", "query": `query ActivityAndThread($threadId: ID!) { commentThreadActivities(threadId: $threadId) { id type actor { id kind } } commentThreads(status: open) { id status } }`, "variables": map[string]any{"threadId": threadID}})
	activities := result["commentThreadActivities"].([]any)
	if len(activities) != 2 {
		t.Fatalf("activities = %#v", activities)
	}
	read := activities[1].(map[string]any)
	if read["type"] != "thread_read" {
		t.Fatalf("read event = %#v", read)
	}
	actor := read["actor"].(map[string]any)
	if actor["id"] != "claude-code:run-1" || actor["kind"] != "claude_code" {
		t.Fatalf("read actor = %#v", actor)
	}
	threads := result["commentThreads"].([]any)
	if len(threads) != 1 || threads[0].(map[string]any)["status"] != "open" {
		t.Fatalf("read changed thread: %#v", threads)
	}
}

func graphql(t *testing.T, handler http.Handler, request map[string]any) map[string]any {
	return graphqlWithHeaders(t, handler, request, nil)
}

func graphqlWithHeaders(t *testing.T, handler http.Handler, request map[string]any, headers map[string]string) map[string]any {
	t.Helper()
	body, err := json.Marshal(request)
	if err != nil {
		t.Fatal(err)
	}
	recorder := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/graphql", bytes.NewReader(body))
	req.Header.Set("content-type", "application/json")
	for key, value := range headers {
		req.Header.Set(key, value)
	}
	handler.ServeHTTP(recorder, req)
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	var payload struct {
		Data   map[string]any   `json:"data"`
		Errors []map[string]any `json:"errors"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if len(payload.Errors) > 0 {
		t.Fatalf("graphql errors: %#v", payload.Errors)
	}
	return payload.Data
}
