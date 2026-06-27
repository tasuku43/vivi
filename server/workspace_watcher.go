package server

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/fsnotify/fsnotify"
	"github.com/tasuku43/vivi/internal/telemetry"
	"github.com/tasuku43/vivi/server/application"
	"github.com/tasuku43/vivi/server/workspace"
)

const (
	watchBaseInterval          = 750 * time.Millisecond
	watchMaxIdleInterval       = 2 * time.Second
	watchReconcileErrorBackoff = 1500 * time.Millisecond
)

type platformWatcher interface {
	Add(string) error
	Remove(string) error
	Close() error
	Events() <-chan fsnotify.Event
	Errors() <-chan error
}

type fsnotifyPlatformWatcher struct {
	watcher *fsnotify.Watcher
}

func newPlatformWatcher() (platformWatcher, error) {
	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, err
	}
	return fsnotifyPlatformWatcher{watcher: watcher}, nil
}

func (watcher fsnotifyPlatformWatcher) Add(pathname string) error {
	return watcher.watcher.Add(pathname)
}

func (watcher fsnotifyPlatformWatcher) Remove(pathname string) error {
	return watcher.watcher.Remove(pathname)
}

func (watcher fsnotifyPlatformWatcher) Close() error {
	return watcher.watcher.Close()
}

func (watcher fsnotifyPlatformWatcher) Events() <-chan fsnotify.Event {
	return watcher.watcher.Events
}

func (watcher fsnotifyPlatformWatcher) Errors() <-chan error {
	return watcher.watcher.Errors
}

func (server *Server) watchWorkspace(ctx context.Context) {
	watcher, err := newPlatformWatcher()
	if err != nil {
		fmt.Fprintf(os.Stderr, "[vivi] platform watcher unavailable, falling back to polling: %v\n", err)
		server.watchWorkspaceByPolling(ctx)
		return
	}
	defer watcher.Close()

	watchedDirs := map[string]struct{}{}
	if err := addDirectoryWatch(server.options.Workspace, watcher, watchedDirs, ""); err != nil {
		fmt.Fprintf(os.Stderr, "[vivi] root watcher failed, falling back to polling: %v\n", err)
		_ = watcher.Close()
		server.watchWorkspaceByPolling(ctx)
		return
	}

	previous := server.reconcileWorkspace(ctx, nil, "startup")
	for _, relativeDir := range watchDirectories(previous) {
		if err := addDirectoryWatch(server.options.Workspace, watcher, watchedDirs, relativeDir); err != nil {
			fmt.Fprintf(os.Stderr, "[vivi] watcher skipped %q: %v\n", relativeDir, err)
		}
	}
	previous = server.drainStartupWatchEvents(ctx, watcher, watchedDirs, previous)
	server.signalWorkspaceWatcherReady()

	reconcileTimer := time.NewTimer(time.Hour)
	if !reconcileTimer.Stop() {
		<-reconcileTimer.C
	}
	reconcileScheduled := false
	for {
		select {
		case <-ctx.Done():
			return
		case <-reconcileTimer.C:
			reconcileScheduled = false
			previous = server.reconcileWorkspace(ctx, previous, "watcher_error")
			for _, relativeDir := range watchDirectories(previous) {
				if _, ok := watchedDirs[relativeDir]; ok {
					continue
				}
				if err := addDirectoryWatch(server.options.Workspace, watcher, watchedDirs, relativeDir); err != nil {
					fmt.Fprintf(os.Stderr, "[vivi] watcher skipped %q: %v\n", relativeDir, err)
				}
			}
		case err, ok := <-watcher.Errors():
			if !ok {
				server.watchWorkspaceByPolling(ctx)
				return
			}
			if err != nil {
				fmt.Fprintf(os.Stderr, "[vivi] watcher event error: %v\n", err)
			}
			if !reconcileScheduled {
				reconcileTimer.Reset(watchReconcileErrorBackoff)
				reconcileScheduled = true
			}
		case event, ok := <-watcher.Events():
			if !ok {
				server.watchWorkspaceByPolling(ctx)
				return
			}
			previous = server.handlePlatformWatchEvent(ctx, watcher, watchedDirs, previous, event)
		}
	}
}

func (server *Server) drainStartupWatchEvents(ctx context.Context, watcher platformWatcher, watchedDirs map[string]struct{}, previous map[string]workspace.WatchEntry) map[string]workspace.WatchEntry {
	for {
		select {
		case event, ok := <-watcher.Events():
			if !ok {
				return previous
			}
			previous = server.handlePlatformWatchEvent(ctx, watcher, watchedDirs, previous, event)
		case err, ok := <-watcher.Errors():
			if !ok {
				return previous
			}
			if err != nil {
				fmt.Fprintf(os.Stderr, "[vivi] watcher startup event error: %v\n", err)
			}
			previous = server.reconcileWorkspace(ctx, previous, "startup_error")
			for _, relativeDir := range watchDirectories(previous) {
				if watchErr := addDirectoryWatch(server.options.Workspace, watcher, watchedDirs, relativeDir); watchErr != nil {
					fmt.Fprintf(os.Stderr, "[vivi] watcher skipped %q: %v\n", relativeDir, watchErr)
				}
			}
		default:
			return previous
		}
	}
}

func (server *Server) handlePlatformWatchEvent(ctx context.Context, watcher platformWatcher, watchedDirs map[string]struct{}, previous map[string]workspace.WatchEntry, event fsnotify.Event) map[string]workspace.WatchEntry {
	if event.Op == fsnotify.Chmod {
		return previous
	}
	started := time.Now()
	operation := telemetry.StartOperation()
	relative, ok := server.options.Workspace.RelativePathForAbsolute(event.Name)
	if !ok || relative == "" {
		operation.Record(ctx, "server.watch_event", telemetry.OperationStats{
			DurationMs: time.Since(started).Milliseconds(),
		})
		return previous
	}

	emittedEvents := 0
	if event.Op&(fsnotify.Remove|fsnotify.Rename) != 0 {
		updated, emitted := server.removeWatchPath(watcher, watchedDirs, previous, relative)
		previous = updated
		emittedEvents += emitted
	}
	if event.Op&(fsnotify.Create|fsnotify.Write) != 0 {
		entry, exists, err := server.options.Workspace.WatchEntry(relative)
		if err != nil {
			fmt.Fprintf(os.Stderr, "[vivi] watcher stat failed for %q: %v\n", relative, err)
		} else if exists && entry.Kind == "directory" {
			if err := addDirectoryWatch(server.options.Workspace, watcher, watchedDirs, relative); err != nil {
				fmt.Fprintf(os.Stderr, "[vivi] watcher skipped %q: %v\n", relative, err)
			}
			updated, emitted := server.reconcileWatchSubtree(ctx, watcher, watchedDirs, previous, relative)
			previous = updated
			emittedEvents += emitted
		} else if exists {
			updated, emitted := server.upsertWatchEntry(previous, entry)
			previous = updated
			emittedEvents += emitted
		}
	}
	if emittedEvents > 0 {
		server.options.Workspace.InvalidateSearchIndex()
	}
	operation.Record(ctx, "server.watch_event", telemetry.OperationStats{
		DurationMs:    time.Since(started).Milliseconds(),
		EmittedEvents: emittedEvents,
		ResultCount:   len(previous),
	})
	return previous
}

func (server *Server) reconcileWorkspace(ctx context.Context, previous map[string]workspace.WatchEntry, reason string) map[string]workspace.WatchEntry {
	operation := telemetry.StartOperation()
	started := time.Now()
	current, stats, err := server.options.Workspace.WatchEntriesWithStats()
	if err != nil {
		operation.Record(ctx, "server.watch_loop", telemetry.OperationStats{
			DurationMs:         time.Since(started).Milliseconds(),
			ScannedDirectories: stats.ScannedDirectories,
			ScannedFiles:       stats.ScannedFiles,
			Error:              true,
		})
		fmt.Fprintf(os.Stderr, "[vivi] watcher reconciliation failed (%s): %v\n", reason, err)
		if previous != nil {
			return previous
		}
		return map[string]workspace.WatchEntry{}
	}
	emittedEvents := server.publishWatchDiff(previous, current)
	operation.Record(ctx, "server.watch_loop", telemetry.OperationStats{
		DurationMs:         time.Since(started).Milliseconds(),
		ScannedDirectories: stats.ScannedDirectories,
		ScannedFiles:       stats.ScannedFiles,
		EmittedEvents:      emittedEvents,
		ResultCount:        len(current),
	})
	if emittedEvents > 0 {
		server.options.Workspace.InvalidateSearchIndex()
	}
	return current
}

func (server *Server) reconcileWatchSubtree(ctx context.Context, watcher platformWatcher, watchedDirs map[string]struct{}, previous map[string]workspace.WatchEntry, relativeDir string) (map[string]workspace.WatchEntry, int) {
	operation := telemetry.StartOperation()
	started := time.Now()
	current, stats, err := server.options.Workspace.WatchEntriesUnder(relativeDir)
	if err != nil {
		operation.Record(ctx, "server.watch_loop", telemetry.OperationStats{
			DurationMs:         time.Since(started).Milliseconds(),
			ScannedDirectories: stats.ScannedDirectories,
			ScannedFiles:       stats.ScannedFiles,
			Error:              true,
		})
		fmt.Fprintf(os.Stderr, "[vivi] watcher subtree reconciliation failed for %q: %v\n", relativeDir, err)
		return previous, 0
	}
	oldSubtree := filterWatchSubtree(previous, relativeDir)
	emittedEvents := server.publishWatchDiff(oldSubtree, current)
	for _, relativeWatchDir := range watchDirectories(current) {
		if err := addDirectoryWatch(server.options.Workspace, watcher, watchedDirs, relativeWatchDir); err != nil {
			fmt.Fprintf(os.Stderr, "[vivi] watcher skipped %q: %v\n", relativeWatchDir, err)
		}
	}
	updated := mergeWatchSubtree(previous, current, relativeDir)
	operation.Record(ctx, "server.watch_loop", telemetry.OperationStats{
		DurationMs:         time.Since(started).Milliseconds(),
		ScannedDirectories: stats.ScannedDirectories,
		ScannedFiles:       stats.ScannedFiles,
		EmittedEvents:      emittedEvents,
		ResultCount:        len(current),
	})
	return updated, emittedEvents
}

func (server *Server) upsertWatchEntry(previous map[string]workspace.WatchEntry, entry workspace.WatchEntry) (map[string]workspace.WatchEntry, int) {
	old, ok := previous[entry.Path]
	if !ok {
		previous[entry.Path] = entry
		server.publish(application.WorkspaceEvent{Type: "add", Path: entry.Path, Kind: entry.Kind})
		return previous, 1
	}
	if entry.Kind == "file" && (entry.Size != old.Size || entry.MtimeNs != old.MtimeNs) {
		previous[entry.Path] = entry
		server.publish(application.WorkspaceEvent{Type: "change", Path: entry.Path})
		return previous, 1
	}
	return previous, 0
}

func (server *Server) removeWatchPath(watcher platformWatcher, watchedDirs map[string]struct{}, previous map[string]workspace.WatchEntry, relative string) (map[string]workspace.WatchEntry, int) {
	old, ok := previous[relative]
	if !ok {
		return previous, 0
	}
	emittedEvents := 0
	for _, pathname := range sortedWatchPaths(previous) {
		entry := previous[pathname]
		if pathname != relative && !watchPathHasPrefix(pathname, relative) {
			continue
		}
		delete(previous, pathname)
		if entry.Kind == "directory" {
			removeDirectoryWatch(server.options.Workspace, watcher, watchedDirs, pathname)
		}
		server.publish(application.WorkspaceEvent{Type: "unlink", Path: pathname, Kind: entry.Kind})
		emittedEvents++
	}
	if old.Kind == "directory" {
		removeDirectoryWatch(server.options.Workspace, watcher, watchedDirs, relative)
	}
	return previous, emittedEvents
}

func (server *Server) publishWatchDiff(previous, current map[string]workspace.WatchEntry) int {
	if previous == nil {
		return 0
	}
	emittedEvents := 0
	for _, pathname := range sortedWatchPaths(current) {
		entry := current[pathname]
		old, ok := previous[pathname]
		if !ok {
			server.publish(application.WorkspaceEvent{Type: "add", Path: pathname, Kind: entry.Kind})
			emittedEvents++
			continue
		}
		if entry.Kind == "file" && (entry.Size != old.Size || entry.MtimeNs != old.MtimeNs) {
			server.publish(application.WorkspaceEvent{Type: "change", Path: pathname})
			emittedEvents++
		}
	}
	for _, pathname := range sortedWatchPaths(previous) {
		old := previous[pathname]
		if _, ok := current[pathname]; !ok {
			server.publish(application.WorkspaceEvent{Type: "unlink", Path: pathname, Kind: old.Kind})
			emittedEvents++
		}
	}
	return emittedEvents
}

func (server *Server) watchWorkspaceByPolling(ctx context.Context) {
	previous, err := server.options.Workspace.WatchEntries()
	if err != nil {
		fmt.Fprintf(os.Stderr, "[vivi] watcher initial scan failed: %v\n", err)
		previous = map[string]workspace.WatchEntry{}
	}
	server.signalWorkspaceWatcherReady()
	idleScans := 0
	for {
		timer := time.NewTimer(watchInterval(idleScans))
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
			operation := telemetry.StartOperation()
			started := time.Now()
			current, stats, err := server.options.Workspace.WatchEntriesWithStats()
			if err != nil {
				operation.Record(ctx, "server.watch_loop", telemetry.OperationStats{
					DurationMs:         time.Since(started).Milliseconds(),
					ScannedDirectories: stats.ScannedDirectories,
					ScannedFiles:       stats.ScannedFiles,
					Error:              true,
				})
				fmt.Fprintf(os.Stderr, "[vivi] watcher scan failed: %v\n", err)
				idleScans = 0
				continue
			}
			emittedEvents := server.publishWatchDiff(previous, current)
			operation.Record(ctx, "server.watch_loop", telemetry.OperationStats{
				DurationMs:         time.Since(started).Milliseconds(),
				ScannedDirectories: stats.ScannedDirectories,
				ScannedFiles:       stats.ScannedFiles,
				EmittedEvents:      emittedEvents,
				ResultCount:        len(current),
			})
			if emittedEvents > 0 {
				server.options.Workspace.InvalidateSearchIndex()
			}
			previous = current
			if emittedEvents == 0 {
				idleScans++
			} else {
				idleScans = 0
			}
		}
	}
}

func (server *Server) signalWorkspaceWatcherReady() {
	server.watchOnce.Do(func() {
		close(server.watchReady)
	})
}

func (server *Server) waitForWorkspaceWatcher(ctx context.Context) bool {
	select {
	case <-server.watchReady:
		return true
	case <-ctx.Done():
		return false
	}
}

func addDirectoryWatch(fsys *workspace.FS, watcher platformWatcher, watchedDirs map[string]struct{}, relativeDir string) error {
	if _, ok := watchedDirs[relativeDir]; ok {
		return nil
	}
	absolute := filepath.Join(fsys.RootPath(), filepath.FromSlash(relativeDir))
	if err := watcher.Add(absolute); err != nil {
		return err
	}
	watchedDirs[relativeDir] = struct{}{}
	return nil
}

func removeDirectoryWatch(fsys *workspace.FS, watcher platformWatcher, watchedDirs map[string]struct{}, relativeDir string) {
	if _, ok := watchedDirs[relativeDir]; !ok {
		return
	}
	absolute := filepath.Join(fsys.RootPath(), filepath.FromSlash(relativeDir))
	_ = watcher.Remove(absolute)
	delete(watchedDirs, relativeDir)
}

func watchDirectories(entries map[string]workspace.WatchEntry) []string {
	dirs := []string{}
	for pathname, entry := range entries {
		if entry.Kind == "directory" {
			dirs = append(dirs, pathname)
		}
	}
	sort.Strings(dirs)
	return dirs
}

func filterWatchSubtree(entries map[string]workspace.WatchEntry, relativeRoot string) map[string]workspace.WatchEntry {
	filtered := map[string]workspace.WatchEntry{}
	for pathname, entry := range entries {
		if pathname == relativeRoot || watchPathHasPrefix(pathname, relativeRoot) {
			filtered[pathname] = entry
		}
	}
	return filtered
}

func mergeWatchSubtree(previous, current map[string]workspace.WatchEntry, relativeRoot string) map[string]workspace.WatchEntry {
	for pathname := range previous {
		if pathname == relativeRoot || watchPathHasPrefix(pathname, relativeRoot) {
			delete(previous, pathname)
		}
	}
	for pathname, entry := range current {
		previous[pathname] = entry
	}
	return previous
}

func sortedWatchPaths(entries map[string]workspace.WatchEntry) []string {
	paths := make([]string, 0, len(entries))
	for pathname := range entries {
		paths = append(paths, pathname)
	}
	sort.Strings(paths)
	return paths
}

func watchPathHasPrefix(pathname, prefix string) bool {
	return prefix != "" && strings.HasPrefix(pathname, prefix+"/")
}

func watchInterval(idleScans int) time.Duration {
	if idleScans <= 0 {
		return watchBaseInterval
	}
	interval := watchBaseInterval
	for range idleScans {
		interval *= 2
		if interval >= watchMaxIdleInterval {
			return watchMaxIdleInterval
		}
	}
	return interval
}
