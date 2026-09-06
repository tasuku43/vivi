package server

import (
	"context"
	"github.com/fsnotify/fsnotify"
	"github.com/tasuku43/vivi/server/application"
	"os"
	"path/filepath"
	"time"
)

// One watcher per workspace server, shared by all browser clients. Both activity
// and comment files are observed so other servers' receipts are re-synchronized.
func (server *Server) watchAttention(ctx context.Context) {
	if server.app.Attention == nil {
		return
	}
	dir := server.app.Attention.Store.Dir
	if os.MkdirAll(dir, 0700) != nil {
		return
	}
	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		return
	}
	defer watcher.Close()
	if watcher.Add(dir) != nil {
		return
	}
	_ = watcher.Add(filepath.Dir(dir))
	timer := time.NewTimer(time.Hour)
	if !timer.Stop() {
		<-timer.C
	}
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case _, ok := <-watcher.Events:
			if !ok {
				return
			}
			timer.Reset(80 * time.Millisecond)
		case <-timer.C:
			server.app.PublishWorkspaceEvent(application.WorkspaceEvent{Type: "attention", Path: ""})
		case _, ok := <-watcher.Errors:
			if !ok {
				return
			}
		}
	}
}
