package server

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/tasuku43/vivi/server/application"
	"github.com/tasuku43/vivi/server/workspace"
)

func TestWatchIntervalBacksOffAfterIdleScans(t *testing.T) {
	cases := []struct {
		idleScans int
		want      time.Duration
	}{
		{idleScans: 0, want: 750 * time.Millisecond},
		{idleScans: 1, want: 1500 * time.Millisecond},
		{idleScans: 2, want: 2 * time.Second},
		{idleScans: 8, want: 2 * time.Second},
	}

	for _, tt := range cases {
		if got := watchInterval(tt.idleScans); got != tt.want {
			t.Fatalf("watchInterval(%d) = %s, want %s", tt.idleScans, got, tt.want)
		}
	}
}

func TestPublishWatchDiffEmitsSemanticEvents(t *testing.T) {
	service := application.NewService(application.Options{})
	server := &Server{app: service}
	events, unsubscribe := service.SubscribeWorkspaceEvents()
	defer unsubscribe()

	previous := map[string]workspace.WatchEntry{
		"README.md": {Path: "README.md", Kind: "file", Size: 4, MtimeNs: 10},
		"old.md":    {Path: "old.md", Kind: "file", Size: 3, MtimeNs: 10},
	}
	current := map[string]workspace.WatchEntry{
		"README.md": {Path: "README.md", Kind: "file", Size: 7, MtimeNs: 20},
		"docs":      {Path: "docs", Kind: "directory", MtimeNs: 30},
	}

	if emitted := server.publishWatchDiff(previous, current); emitted != 3 {
		t.Fatalf("emitted = %d, want 3", emitted)
	}

	got := []application.WorkspaceEvent{
		receiveWorkspaceEvent(t, events),
		receiveWorkspaceEvent(t, events),
		receiveWorkspaceEvent(t, events),
	}
	want := []application.WorkspaceEvent{
		{Type: "change", Path: "README.md", Version: 2},
		{Type: "add", Path: "docs", Kind: "directory", Version: 3},
		{Type: "unlink", Path: "old.md", Kind: "file", Version: 4},
	}
	for index := range want {
		if got[index] != want[index] {
			t.Fatalf("event %d = %#v, want %#v", index, got[index], want[index])
		}
	}
}

func TestPlatformWatcherPublishesFileEventBeforePollingInterval(t *testing.T) {
	root := t.TempDir()
	fsys, err := workspace.New(workspace.Options{Root: root})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	server, err := Start(ctx, Options{Host: "127.0.0.1", Port: 0, Workspace: fsys})
	if err != nil {
		t.Fatal(err)
	}
	defer server.Close(context.Background())
	if !server.waitForWorkspaceWatcher(ctx) {
		t.Fatal("watcher did not become ready")
	}
	events, unsubscribe := server.app.SubscribeWorkspaceEvents()
	defer unsubscribe()

	started := time.Now()
	if err := os.WriteFile(filepath.Join(root, "README.md"), []byte("# Ready\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	event := receiveWorkspaceEvent(t, events)
	if event.Type != "add" || event.Path != "README.md" || event.Kind != "file" {
		t.Fatalf("event = %#v, want add README.md file", event)
	}
	if elapsed := time.Since(started); elapsed >= watchBaseInterval {
		t.Fatalf("event arrived after %s, want faster than polling interval %s", elapsed, watchBaseInterval)
	}
}

func receiveWorkspaceEvent(t *testing.T, events <-chan application.WorkspaceEvent) application.WorkspaceEvent {
	t.Helper()
	select {
	case event := <-events:
		return event
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for workspace event")
		return application.WorkspaceEvent{}
	}
}
