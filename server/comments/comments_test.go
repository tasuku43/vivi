package comments

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestStoreProjectsLegacyCommentsAndPersistsThreadLifecycleEvents(t *testing.T) {
	dataDir := t.TempDir()
	legacy := `{"id":"legacy-1","path":"README.md","viewerKind":"markdown","anchor":{"surface":"source","canonical":{"path":"README.md","lineStart":1}},"body":"legacy body","status":"open","createdAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-01T00:00:00Z"}` + "\n"
	commentPath := filepath.Join(dataDir, "comments.jsonl")
	if err := os.WriteFile(commentPath, []byte(legacy), 0o644); err != nil {
		t.Fatal(err)
	}
	store, err := NewStore(dataDir)
	if err != nil {
		t.Fatal(err)
	}

	threads, err := store.ListThreads(Filters{Status: "open"})
	if err != nil {
		t.Fatal(err)
	}
	if len(threads) != 1 || threads[0]["id"] != "legacy-1" {
		t.Fatalf("legacy projection = %#v", threads)
	}
	messages := threads[0]["comments"].([]map[string]any)
	if messages[0]["threadId"] != "legacy-1" || messages[0]["source"] != "unknown" {
		t.Fatalf("legacy message = %#v", messages[0])
	}

	if _, err := store.UpdateThreadStatus("legacy-1", "resolved"); err != nil {
		t.Fatal(err)
	}
	after, err := os.ReadFile(commentPath)
	if err != nil {
		t.Fatal(err)
	}
	if string(after) != legacy {
		t.Fatalf("status transition rewrote legacy comments.jsonl:\n%s", after)
	}
	resolved, err := store.ListThreads(Filters{Status: "resolved"})
	if err != nil || len(resolved) != 1 {
		t.Fatalf("resolved threads = %#v, err = %v", resolved, err)
	}
	if _, err := store.UpdateThreadStatus("legacy-1", "archived"); err != nil {
		t.Fatal(err)
	}
	if _, err := store.UpdateThreadStatus("legacy-1", "resolved"); err == nil {
		t.Fatal("archived -> resolved must be rejected")
	}
	if _, err := store.UpdateThreadStatus("legacy-1", "open"); err != nil {
		t.Fatal(err)
	}

	exported, err := store.ExportJSONL(Filters{Status: "open"})
	if err != nil {
		t.Fatal(err)
	}
	var record map[string]any
	if err := json.Unmarshal([]byte(exported), &record); err != nil {
		t.Fatal(err)
	}
	if record["type"] != "commentThread" || record["schemaVersion"] != float64(2) {
		t.Fatalf("export = %#v", record)
	}
	if len(record["comments"].([]any)) != 1 {
		t.Fatalf("export comments = %#v", record["comments"])
	}
	events, err := os.ReadFile(filepath.Join(dataDir, "comment-threads.jsonl"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Count(strings.TrimSpace(string(events)), "\n") != 2 {
		t.Fatalf("events = %s", events)
	}
}

func TestStoreCreatesThreadMetadataWithoutChangingCommentsJSONLShape(t *testing.T) {
	store, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	created, err := store.Create(map[string]any{
		"path": "README.md", "body": "agent reply", "source": "codex",
		"anchor": map[string]any{"surface": "source", "canonical": map[string]any{"path": "README.md"}},
	}, "sha256:file", "markdown")
	if err != nil {
		t.Fatal(err)
	}
	threads, err := store.ListThreads(Filters{})
	if err != nil {
		t.Fatal(err)
	}
	if len(threads) != 1 || threads[0]["id"] != created["id"] {
		t.Fatalf("threads = %#v", threads)
	}
	if threads[0]["status"] != "open" {
		t.Fatalf("status = %v", threads[0]["status"])
	}
}

func TestStoreAppendsIdempotentReadActivityWithoutChangingThreadStatus(t *testing.T) {
	store, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	created, err := store.Create(map[string]any{"path": "README.md", "body": "review this", "actor": map[string]any{"id": "human:tasuku", "kind": "human", "displayName": "Tasuku"}, "anchor": map[string]any{"surface": "source", "canonical": map[string]any{"path": "README.md"}}}, "sha256:file", "markdown")
	if err != nil {
		t.Fatal(err)
	}
	threadID := created["threadId"].(string)
	actor := map[string]any{"id": "claude-code:session-1", "kind": "claude_code", "displayName": "Claude Code"}
	first, err := store.AppendThreadReadActivity(threadID, actor, "read-request-1")
	if err != nil {
		t.Fatal(err)
	}
	retried, err := store.AppendThreadReadActivity(threadID, actor, "read-request-1")
	if err != nil {
		t.Fatal(err)
	}
	if first["id"] != retried["id"] {
		t.Fatalf("idempotent ids differ: %v != %v", first["id"], retried["id"])
	}
	activities, err := store.ListActivities(ActivityFilters{ThreadID: threadID, First: 100})
	if err != nil {
		t.Fatal(err)
	}
	readCount := 0
	for _, event := range activities {
		if event["type"] == "thread_read" {
			readCount++
			eventActor := event["actor"].(map[string]any)
			if eventActor["id"] != actor["id"] {
				t.Fatalf("actor = %#v", eventActor)
			}
		}
	}
	if readCount != 1 {
		t.Fatalf("read activity count = %d, want 1", readCount)
	}
	threads, err := store.ListThreads(Filters{})
	if err != nil {
		t.Fatal(err)
	}
	if threads[0]["status"] != "open" {
		t.Fatalf("read changed status to %v", threads[0]["status"])
	}
}
