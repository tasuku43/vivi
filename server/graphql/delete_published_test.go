package graphql

import (
	"bytes"
	"encoding/json"
	"github.com/tasuku43/vivi/server/application"
	"github.com/tasuku43/vivi/server/comments"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestDeletePublishedCommentGraphQL(t *testing.T) {
	store, _ := comments.NewStore(t.TempDir())
	c, err := store.Create(map[string]any{"path": "missing.md", "body": "human", "source": "human"}, "", "markdown")
	if err != nil {
		t.Fatal(err)
	}
	handler := NewHandler(application.NewService(application.Options{Comments: store}), func(*http.Request) bool { return true })
	query := "mutation($id: ID!){deletePublishedComment(id:$id){id threadId path}}"
	for attempt := 0; attempt < 2; attempt++ {
		data := graphql(t, handler, map[string]any{"query": query, "variables": map[string]any{"id": c["id"]}})
		result := data["deletePublishedComment"].(map[string]any)
		if result["id"] != c["id"] || result["threadId"] != c["threadId"] || result["path"] != "missing.md" {
			t.Fatalf("result: %#v", result)
		}
	}
	activityData := graphql(t, handler, map[string]any{"query": "query($thread: ID!){commentThreadActivities(threadId:$thread){type commentId}}", "variables": map[string]any{"thread": c["threadId"]}})
	activities := activityData["commentThreadActivities"].([]any)
	last := activities[len(activities)-1].(map[string]any)
	if last["type"] != "comment_deleted" || last["commentId"] != c["id"] {
		t.Fatalf("activity: %#v", last)
	}
	data := graphql(t, handler, map[string]any{"query": "{comments {id}}"})
	if len(data["comments"].([]any)) != 0 {
		t.Fatalf("deleted returned: %#v", data)
	}
	agent, err := store.Create(map[string]any{"path": "missing.md", "body": "agent", "source": "codex"}, "", "markdown")
	if err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"unknown", stringValue(agent["id"])} {
		body, _ := json.Marshal(map[string]any{"query": query, "variables": map[string]any{"id": id}})
		req := httptest.NewRequest(http.MethodPost, "/graphql", bytes.NewReader(body))
		req.Header.Set("content-type", "application/json")
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, req)
		var result map[string]any
		if err := json.Unmarshal(recorder.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		if result["errors"] == nil {
			t.Fatalf("accepted %q: %s", id, recorder.Body.String())
		}
	}
}
