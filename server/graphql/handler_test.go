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

func graphql(t *testing.T, handler http.Handler, request map[string]any) map[string]any {
	t.Helper()
	body, err := json.Marshal(request)
	if err != nil {
		t.Fatal(err)
	}
	recorder := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/graphql", bytes.NewReader(body))
	req.Header.Set("content-type", "application/json")
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
