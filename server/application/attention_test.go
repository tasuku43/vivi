package application

import (
	"context"
	"github.com/tasuku43/vivi/server/attention"
	"github.com/tasuku43/vivi/server/workspace"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestAttentionScopeRestartAndSemanticChanges(t *testing.T) {
	root := t.TempDir()
	for p, body := range map[string]string{"guide.md": "# Guide\n", "old.md": "# Old\n", "style.css": "body{}"} {
		if err := os.WriteFile(filepath.Join(root, p), []byte(body), 0600); err != nil {
			t.Fatal(err)
		}
	}
	old := time.Now().Add(-time.Hour)
	if err := os.Chtimes(filepath.Join(root, "old.md"), old, old); err != nil {
		t.Fatal(err)
	}
	fs, err := workspace.New(workspace.Options{Root: root, Include: []string{"md"}})
	if err != nil {
		t.Fatal(err)
	}
	store := attention.New(t.TempDir())
	makeService := func() *AttentionService {
		return &AttentionService{Store: store, workspace: fs, hashes: map[string]string{}}
	}
	ctx := context.Background()
	s := makeService()
	snapshot, err := s.Snapshot(ctx, []string{"guide.md", "style.css", "missing.md", "../secret.md"})
	if err != nil || len(snapshot.Events) != 1 || snapshot.Events[0].Path != "guide.md" || len(snapshot.EligiblePaths) != 1 || snapshot.Headings["guide.md"] != "Guide" {
		t.Fatalf("snapshot: %#v %v", snapshot, err)
	}
	hidden, err := s.Observe(ctx, "guide.md", "hidden")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Observe(ctx, "guide.md", "Updated"); err != nil {
		t.Fatal(err)
	}
	snapshot, err = makeService().Snapshot(ctx, nil)
	if err != nil || len(snapshot.Events) != 0 {
		t.Fatalf("restart/replay restored hidden item: %#v %v", snapshot, err)
	}
	// A genuine write after dismissal restores it, whereas stat-only changes do not.
	for time.Now().UnixMilli() <= hidden.At {
		time.Sleep(time.Millisecond)
	}
	if err = os.WriteFile(filepath.Join(root, "guide.md"), []byte("# New guide\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err = s.Observe(ctx, "guide.md", "Updated"); err != nil {
		t.Fatal(err)
	}
	snapshot, err = s.Snapshot(ctx, nil)
	if err != nil || len(snapshot.Events) != 1 || snapshot.Headings["guide.md"] != "New guide" {
		t.Fatalf("change: %#v %v", snapshot, err)
	}
	if _, err = s.Observe(ctx, "style.css", "Opened"); err == nil {
		t.Fatal("accepted excluded CSS")
	}
	if _, err = s.Observe(ctx, "old.md", "Opened"); err != nil {
		t.Fatal(err)
	}
	snapshot, err = s.Snapshot(ctx, nil)
	if err != nil || len(snapshot.Events) != 2 {
		t.Fatalf("explicit open of old file: %#v %v", snapshot, err)
	}
}
