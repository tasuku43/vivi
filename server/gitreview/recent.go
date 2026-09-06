package gitreview

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// RecentDocuments includes dirty document mtimes and bounded recent HEAD commits.
// A checkout touching otherwise clean files does not make those files recent.
func (r *Reviewer) RecentDocuments(ctx context.Context, now time.Time) (map[string]int64, bool) {
	result := map[string]int64{}
	summary := r.ReadChanges(ctx)
	if !summary.Available {
		return result, !strings.Contains(summary.Reason, "not a Git repository")
	}
	cutoff := now.Add(-30 * time.Minute).UnixMilli()
	add := func(path string, at int64) {
		if at > cutoff && at <= now.UnixMilli() && at > result[path] {
			result[path] = at
		}
	}
	for _, c := range summary.Changes {
		if c.Status == "deleted" {
			continue
		}
		if info, err := os.Stat(filepath.Join(r.root, c.Path)); err == nil && !info.IsDir() {
			add(c.Path, info.ModTime().UnixMilli())
		}
	}
	root, prefix, _, ok := r.workspace(ctx)
	if !ok {
		return result, true
	}
	ctx, cancel := context.WithTimeout(ctx, r.timeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, "git", "-C", root, "log", "-64", "--since="+now.Add(-30*time.Minute).UTC().Format(time.RFC3339), "--format=%ct%x00%H", "HEAD")
	log, _, ok := r.runGit(ctx, cmd)
	if !ok {
		return result, true
	}
	for _, line := range strings.Split(strings.TrimSpace(log), "\n") {
		fields := strings.Split(line, "\x00")
		if len(fields) != 2 {
			continue
		}
		seconds, err := strconv.ParseInt(fields[0], 10, 64)
		if err != nil {
			continue
		}
		cmd := exec.CommandContext(ctx, "git", "-C", root, "diff-tree", "--root", "--no-commit-id", "--name-only", "--diff-filter=AMR", "-m", "-r", "-z", fields[1], "--")
		names, _, ok := r.runGit(ctx, cmd)
		if !ok {
			break
		}
		for _, name := range strings.Split(names, "\x00") {
			p, ok := gitPathToWorkspace(name, prefix)
			if ok && p != "" && !r.isIgnored(p) && r.isIncluded(p) {
				add(p, seconds*1000)
			}
		}
	}
	return result, true
}
