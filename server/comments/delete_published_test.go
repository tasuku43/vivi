package comments

import (
	"os"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestDeletePublishedTombstoneSurvivesReopenAndStaleWrites(t *testing.T) {
	dir := t.TempDir()
	store, _ := NewStore(dir)
	first, err := store.Create(map[string]any{"path": "gone.md", "body": "delete me", "source": "human"}, "", "markdown")
	if err != nil {
		t.Fatal(err)
	}
	second, err := store.Create(map[string]any{"path": "gone.md", "body": "keep me", "source": "human", "threadId": first["threadId"]}, "", "markdown")
	if err != nil {
		t.Fatal(err)
	}
	stale, _ := os.ReadFile(store.path)
	deleted, err := store.DeletePublished(stringValue(first["id"]))
	if err != nil {
		t.Fatal(err)
	}
	if len(deleted) != 3 || deleted["threadId"] != first["threadId"] || deleted["path"] != "gone.md" {
		t.Fatalf("result: %#v", deleted)
	}
	retry, err := store.DeletePublished(stringValue(first["id"]))
	if err != nil || !reflect.DeepEqual(deleted, retry) {
		t.Fatalf("retry: %#v %v", retry, err)
	}
	events, _ := store.readThreadEvents()
	count := 0
	for _, e := range events {
		if e["type"] == "comment.deleted" {
			count++
		}
	}
	if count != 1 {
		t.Fatalf("tombstones: %d", count)
	}
	// An older process may replace comments.jsonl after reading before deletion.
	if err := os.WriteFile(store.path, stale, 0644); err != nil {
		t.Fatal(err)
	}
	reopened, _ := NewStore(dir)
	items, err := reopened.List(Filters{})
	if err != nil || len(items) != 1 || items[0]["id"] != second["id"] {
		t.Fatalf("comments: %#v %v", items, err)
	}
	threads, err := reopened.ListThreads(Filters{UnseenBy: "codex"})
	if err != nil || len(threads) != 1 || len(threads[0]["comments"].([]map[string]any)) != 1 {
		t.Fatalf("threads: %#v %v", threads, err)
	}
	exported, err := reopened.ExportJSONL(Filters{})
	if err != nil || strings.Contains(exported, "delete me") || !strings.Contains(exported, "keep me") {
		t.Fatalf("export: %s %v", exported, err)
	}
	if _, err := reopened.AppendThreadReadActivity(stringValue(first["threadId"]), map[string]any{"id": "codex", "kind": "codex"}, ""); err != nil {
		t.Fatal(err)
	}
	if _, err := reopened.DeletePublished(stringValue(second["id"])); err != nil {
		t.Fatal(err)
	}
	threads, err = reopened.ListThreads(Filters{})
	if err != nil || len(threads) != 0 {
		t.Fatalf("empty threads: %#v %v", threads, err)
	}
	receipts, err := reopened.RecentReadReceipts(time.Time{})
	if err != nil || len(receipts) != 0 {
		t.Fatalf("receipts: %#v %v", receipts, err)
	}
	exported, err = reopened.ExportJSONL(Filters{UnseenBy: "codex"})
	if err != nil || exported != "" {
		t.Fatalf("empty export: %s %v", exported, err)
	}
}

func TestDeletePublishedRejectsInvalidAndNonHumanComments(t *testing.T) {
	for _, source := range []string{"codex", "claude_code", "unknown"} {
		t.Run(source, func(t *testing.T) {
			store, _ := NewStore(t.TempDir())
			c, err := store.Create(map[string]any{"path": "a.md", "body": "keep", "source": source}, "", "markdown")
			if err != nil {
				t.Fatal(err)
			}
			for _, id := range []string{"", "missing", stringValue(c["id"])} {
				if _, err := store.DeletePublished(id); err == nil {
					t.Fatalf("accepted %q", id)
				}
			}
			items, err := store.List(Filters{})
			if err != nil || len(items) != 1 {
				t.Fatalf("changed: %#v %v", items, err)
			}
		})
	}
}
func TestDeletePublishedUsesActorAndPropagatesJournalFailure(t *testing.T) {
	store, _ := NewStore(t.TempDir())
	c, err := store.Create(map[string]any{"path": "a.md", "body": "human", "actor": map[string]any{"kind": "human", "id": "human:legacy"}}, "", "markdown")
	if err != nil {
		t.Fatal(err)
	}
	original := store.threadPath
	store.threadPath = store.path + "/invalid"
	if _, err := store.DeletePublished(stringValue(c["id"])); err == nil {
		t.Fatal("expected journal error")
	}
	store.threadPath = original
	items, err := store.List(Filters{})
	if err != nil || len(items) != 1 {
		t.Fatalf("changed after failure: %#v %v", items, err)
	}
	if _, err := store.DeletePublished(stringValue(c["id"])); err != nil {
		t.Fatal(err)
	}
}
