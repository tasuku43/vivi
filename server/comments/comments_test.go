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

func TestWorkspaceDataDirScopesCommentsByCanonicalWorkspaceRoot(t *testing.T) {
	dataDir := t.TempDir()
	t.Setenv("VIVI_DATA_DIR", dataDir)

	parentA := t.TempDir()
	parentB := t.TempDir()
	rootA := filepath.Join(parentA, "project")
	rootB := filepath.Join(parentB, "project")
	if err := os.Mkdir(rootA, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(rootB, 0o755); err != nil {
		t.Fatal(err)
	}
	linkA := filepath.Join(parentA, "project-link")
	if err := os.Symlink(rootA, linkA); err != nil {
		t.Fatal(err)
	}

	scopedA := WorkspaceDataDir(rootA)
	scopedB := WorkspaceDataDir(rootB)
	scopedLinkA := WorkspaceDataDir(linkA)

	if scopedA == filepath.Join(dataDir, "comments.jsonl") || filepath.Dir(scopedA) == dataDir {
		t.Fatalf("workspace data dir was not nested under scoped workspaces: %s", scopedA)
	}
	if !strings.HasPrefix(scopedA, filepath.Join(dataDir, "workspaces")+string(os.PathSeparator)) {
		t.Fatalf("workspace data dir escaped base data dir: %s", scopedA)
	}
	if scopedA == scopedB {
		t.Fatalf("different workspace roots with the same basename shared comment data dir: %s", scopedA)
	}
	if scopedA != scopedLinkA {
		t.Fatalf("symlink to the same workspace used a different comment data dir: %s != %s", scopedA, scopedLinkA)
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

func TestStoreAppendsThreadClaimActivityAsLeaseWithoutChangingStatus(t *testing.T) {
	store, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	created, err := store.Create(map[string]any{"path": "README.md", "body": "please fix", "actor": map[string]any{"id": "human:tasuku", "kind": "human"}, "anchor": map[string]any{"surface": "source", "canonical": map[string]any{"path": "README.md"}}}, "sha256:file", "markdown")
	if err != nil {
		t.Fatal(err)
	}
	threadID := created["threadId"].(string)
	actor := map[string]any{"id": "codex:session-1", "kind": "codex", "displayName": "Codex"}
	first, err := store.AppendThreadClaimActivity(threadID, actor, "claim-request-1", 60)
	if err != nil {
		t.Fatal(err)
	}
	retried, err := store.AppendThreadClaimActivity(threadID, actor, "claim-request-1", 60)
	if err != nil {
		t.Fatal(err)
	}
	if first["id"] != retried["id"] {
		t.Fatalf("idempotent claim ids differ: %v != %v", first["id"], retried["id"])
	}
	if first["type"] != "thread_claimed" || first["leaseExpiresAt"] == "" {
		t.Fatalf("claim activity = %#v", first)
	}
	if _, err := store.AppendThreadClaimActivity(threadID, map[string]any{"id": "claude-code:session-2", "kind": "claude_code"}, "claim-request-2", 60); err == nil || !strings.Contains(err.Error(), "already claimed") {
		t.Fatalf("second actor claim err = %v", err)
	}
	released, err := store.AppendThreadClaimReleaseActivity(threadID, actor, "release-request-1")
	if err != nil {
		t.Fatal(err)
	}
	retriedRelease, err := store.AppendThreadClaimReleaseActivity(threadID, actor, "release-request-1")
	if err != nil {
		t.Fatal(err)
	}
	if released["id"] != retriedRelease["id"] || released["type"] != "thread_claim_released" {
		t.Fatalf("release activity = %#v, retried = %#v", released, retriedRelease)
	}
	if _, err := store.AppendThreadClaimActivity(threadID, map[string]any{"id": "claude-code:session-2", "kind": "claude_code"}, "claim-request-2", 60); err != nil {
		t.Fatalf("claim after release failed: %v", err)
	}
	threads, err := store.ListThreads(Filters{})
	if err != nil {
		t.Fatal(err)
	}
	if threads[0]["status"] != "open" {
		t.Fatalf("claim changed status to %v", threads[0]["status"])
	}
	activities, err := store.ListActivities(ActivityFilters{ThreadID: threadID, First: 100})
	if err != nil {
		t.Fatal(err)
	}
	claimCount := 0
	releaseCount := 0
	for _, event := range activities {
		if event["type"] == "thread_claimed" {
			claimCount++
		}
		if event["type"] == "thread_claim_released" {
			releaseCount++
		}
	}
	if claimCount != 2 || releaseCount != 1 {
		t.Fatalf("claim activity count = %d, activities = %#v", claimCount, activities)
	}
}

func TestStoreKeepsDraftReviewCommentsHiddenUntilBatchPublish(t *testing.T) {
	store, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	sourceDraft, err := store.CreateDraft(map[string]any{
		"path": "README.md", "body": "Draft source note", "source": "human",
		"anchor": map[string]any{"surface": "source", "canonical": map[string]any{"path": "README.md", "lineStart": float64(1), "lineEnd": float64(1)}},
	}, "sha256:readme", "markdown")
	if err != nil {
		t.Fatal(err)
	}
	diffDraft, err := store.CreateDraft(map[string]any{
		"path": "src/app.ts", "body": "Draft diff note", "source": "human",
		"anchor": map[string]any{"surface": "diff", "canonical": map[string]any{"path": "src/app.ts"}, "diff": map[string]any{"path": "src/app.ts", "base": "HEAD", "ref": "working-tree", "hunkId": "h1", "side": "new", "newLineStart": float64(2), "newLineEnd": float64(2)}},
	}, "sha256:app", "text")
	if err != nil {
		t.Fatal(err)
	}
	threadsBefore, err := store.ListThreads(Filters{Status: "open"})
	if err != nil {
		t.Fatal(err)
	}
	if len(threadsBefore) != 0 {
		t.Fatalf("drafts leaked as open threads: %#v", threadsBefore)
	}
	drafts, err := store.ListDrafts(Filters{})
	if err != nil || len(drafts) != 2 {
		t.Fatalf("drafts = %#v, err = %v", drafts, err)
	}
	if _, err := store.UpdateDraft(sourceDraft["id"].(string), map[string]any{"body": "Edited source draft"}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.DeleteDraft(diffDraft["id"].(string)); err != nil {
		t.Fatal(err)
	}
	if _, err := store.CreateDraft(map[string]any{
		"path": "README.md", "body": "Draft Markdown rendered note", "source": "human",
		"anchor": map[string]any{"surface": "rendered", "canonical": map[string]any{"path": "README.md"}, "rendered": map[string]any{"kind": "markdown", "selector": "p:nth-of-type(1)", "textQuote": "Hello Markdown", "sourceLineStart": float64(3), "sourceLineEnd": float64(3)}},
	}, "sha256:readme", "markdown"); err != nil {
		t.Fatal(err)
	}
	if _, err := store.CreateDraft(map[string]any{
		"path": "index.html", "body": "Draft HTML source note", "source": "human",
		"anchor": map[string]any{"surface": "source", "canonical": map[string]any{"path": "index.html", "lineStart": float64(1), "lineEnd": float64(1), "quote": "<h1>Hello</h1>"}},
	}, "sha256:html", "html"); err != nil {
		t.Fatal(err)
	}
	if _, err := store.CreateDraft(map[string]any{
		"path": "index.html", "body": "Draft HTML note", "source": "human",
		"anchor": map[string]any{"surface": "rendered", "canonical": map[string]any{"path": "index.html"}, "rendered": map[string]any{"kind": "html", "selector": "h1", "textQuote": "Hello", "sourceLineStart": float64(1), "sourceLineEnd": float64(1)}},
	}, "sha256:html", "html"); err != nil {
		t.Fatal(err)
	}
	if _, err := store.CreateDraft(map[string]any{
		"path": "index.html", "body": "Draft HTML diff note", "source": "human",
		"anchor": map[string]any{"surface": "diff", "canonical": map[string]any{"path": "index.html", "lineStart": float64(2), "lineEnd": float64(2)}, "diff": map[string]any{"path": "index.html", "base": "HEAD", "ref": "working-tree", "hunkId": "html-h1", "side": "new", "newLineStart": float64(2), "newLineEnd": float64(2), "changeKind": "added"}},
	}, "sha256:html", "html"); err != nil {
		t.Fatal(err)
	}
	batch, err := store.PublishDrafts(nil, map[string]any{"id": "human:tasuku", "kind": "human", "displayName": "Tasuku"})
	if err != nil {
		t.Fatal(err)
	}
	reviewBatchID := batch["reviewBatchId"].(string)
	if !strings.HasPrefix(reviewBatchID, "review-batch-") {
		t.Fatalf("reviewBatchId = %q", reviewBatchID)
	}
	threads, err := store.ListThreads(Filters{Status: "open"})
	if err != nil {
		t.Fatal(err)
	}
	if len(threads) != 5 {
		t.Fatalf("published threads = %#v", threads)
	}
	surfaces := map[string]bool{}
	for _, thread := range threads {
		if thread["reviewBatchId"] != reviewBatchID {
			t.Fatalf("thread missing batch id: %#v", thread)
		}
		messages := thread["comments"].([]map[string]any)
		if messages[0]["reviewBatchId"] != reviewBatchID {
			t.Fatalf("comment missing batch id: %#v", messages[0])
		}
		anchor := messages[0]["anchor"].(map[string]any)
		surface := stringValue(anchor["surface"])
		if rendered := mapValue(anchor["rendered"]); rendered != nil {
			surface += ":" + stringValue(rendered["kind"])
		}
		if diff := mapValue(anchor["diff"]); diff != nil && stringValue(diff["path"]) == "index.html" {
			surface += ":html-diff"
		}
		surfaces[surface] = true
	}
	for _, surface := range []string{"source", "rendered:markdown", "rendered:html", "diff:html-diff"} {
		if !surfaces[surface] {
			t.Fatalf("published surfaces missing %s in %#v", surface, surfaces)
		}
	}
	remainingDrafts, err := store.ListDrafts(Filters{})
	if err != nil || len(remainingDrafts) != 0 {
		t.Fatalf("remaining drafts = %#v, err = %v", remainingDrafts, err)
	}
}

func TestStorePublishesSameAnchorDraftsAsOneThread(t *testing.T) {
	store, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	anchor := map[string]any{
		"surface": "source",
		"canonical": map[string]any{
			"path":      "README.md",
			"lineStart": float64(4),
			"lineEnd":   float64(4),
			"quote":     "same line",
		},
	}
	for _, body := range []string{"First same-line draft", "Second same-line draft"} {
		if _, err := store.CreateDraft(map[string]any{
			"path": "README.md", "body": body, "source": "human", "anchor": anchor,
		}, "sha256:readme", "markdown"); err != nil {
			t.Fatal(err)
		}
	}

	batch, err := store.PublishDrafts(nil, map[string]any{"id": "human:tasuku", "kind": "human", "displayName": "Tasuku"})
	if err != nil {
		t.Fatal(err)
	}
	reviewBatchID := batch["reviewBatchId"].(string)
	threads := batch["threads"].([]map[string]any)
	if len(threads) != 1 {
		t.Fatalf("published threads = %#v", threads)
	}
	thread := threads[0]
	if thread["reviewBatchId"] != reviewBatchID {
		t.Fatalf("thread missing batch id: %#v", thread)
	}
	messages := thread["comments"].([]map[string]any)
	if len(messages) != 2 {
		t.Fatalf("published thread messages = %#v", messages)
	}
	threadID := stringValue(thread["id"])
	for _, message := range messages {
		threadID := stringValue(message["threadId"])
		if threadID == "" {
			t.Fatalf("message missing thread id: %#v", message)
		}
		if threadID != stringValue(thread["id"]) {
			t.Fatalf("message thread id %s did not match thread %s: %#v", threadID, thread["id"], message)
		}
		if message["reviewBatchId"] != reviewBatchID {
			t.Fatalf("message missing batch id: %#v", message)
		}
	}
	if threadID == "" {
		t.Fatalf("thread missing id: %#v", thread)
	}

	listed, err := store.ListThreads(Filters{Status: "open"})
	if err != nil {
		t.Fatal(err)
	}
	if len(listed) != 1 {
		t.Fatalf("listed threads = %#v", listed)
	}
	if len(listed[0]["comments"].([]map[string]any)) != 2 {
		t.Fatalf("listed thread messages = %#v", listed[0])
	}
}

func TestStorePublishesDraftWithThreadIDAsReply(t *testing.T) {
	store, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	anchor := map[string]any{
		"surface": "source",
		"canonical": map[string]any{
			"path":      "README.md",
			"lineStart": float64(4),
			"lineEnd":   float64(4),
			"quote":     "same line",
		},
	}
	created, err := store.Create(map[string]any{
		"path": "README.md", "body": "Existing thread", "source": "human", "anchor": anchor,
	}, "sha256:readme", "markdown")
	if err != nil {
		t.Fatal(err)
	}
	threadID := stringValue(created["threadId"])
	if _, err := store.CreateDraft(map[string]any{
		"threadId": threadID,
		"path":     "README.md",
		"body":     "Reply draft",
		"source":   "human",
		"anchor":   anchor,
	}, "sha256:readme", "markdown"); err != nil {
		t.Fatal(err)
	}

	batch, err := store.PublishDrafts(nil, map[string]any{"id": "human:tasuku", "kind": "human", "displayName": "Tasuku"})
	if err != nil {
		t.Fatal(err)
	}
	threads := batch["threads"].([]map[string]any)
	if len(threads) != 1 || stringValue(threads[0]["id"]) != threadID {
		t.Fatalf("published reply threads = %#v", threads)
	}
	messages := threads[0]["comments"].([]map[string]any)
	if len(messages) != 2 || stringValue(messages[0]["threadId"]) != threadID || stringValue(messages[1]["threadId"]) != threadID {
		t.Fatalf("reply messages = %#v", messages)
	}
}

func TestStoreKeepsDraftsWhenPublishFails(t *testing.T) {
	store, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	draft, err := store.CreateDraft(map[string]any{
		"threadId": "missing-thread",
		"path":     "README.md",
		"body":     "Do not lose me if publish fails",
		"source":   "human",
		"anchor": map[string]any{
			"surface": "source",
			"canonical": map[string]any{
				"path":      "README.md",
				"lineStart": float64(1),
				"lineEnd":   float64(1),
			},
		},
	}, "sha256:readme", "markdown")
	if err != nil {
		t.Fatal(err)
	}

	if _, err := store.PublishDrafts([]string{draft["id"].(string)}, map[string]any{"id": "human:tasuku", "kind": "human"}); err == nil {
		t.Fatal("publish with missing target thread must fail")
	}
	drafts, err := store.ListDrafts(Filters{})
	if err != nil {
		t.Fatal(err)
	}
	if len(drafts) != 1 || drafts[0]["body"] != "Do not lose me if publish fails" {
		t.Fatalf("drafts after failed publish = %#v", drafts)
	}
	threads, err := store.ListThreads(Filters{Status: "open"})
	if err != nil {
		t.Fatal(err)
	}
	if len(threads) != 0 {
		t.Fatalf("failed publish leaked open threads = %#v", threads)
	}
}
