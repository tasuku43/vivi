package gitreview

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

func TestRecentDocumentsUsesGitWithoutCleanCheckoutNoise(t *testing.T) {
	root := t.TempDir()
	git := func(at time.Time, args ...string) {
		t.Helper()
		cmd := exec.Command("git", append([]string{"-C", root}, args...)...)
		cmd.Env = append(os.Environ(), "GIT_AUTHOR_NAME=Test", "GIT_AUTHOR_EMAIL=test@example.com", "GIT_COMMITTER_NAME=Test", "GIT_COMMITTER_EMAIL=test@example.com", "GIT_AUTHOR_DATE="+at.Format(time.RFC3339), "GIT_COMMITTER_DATE="+at.Format(time.RFC3339))
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %s %v", args, out, err)
		}
	}
	now := time.Now().Truncate(time.Second)
	old := now.Add(-time.Hour)
	write := func(p, body string) {
		t.Helper()
		if err := os.WriteFile(filepath.Join(root, p), []byte(body), 0600); err != nil {
			t.Fatal(err)
		}
	}
	git(old, "init")
	for _, p := range []string{"clean.md", "dirty-old.md", "dirty-new.md", "committed.md"} {
		write(p, "old")
	}
	git(old, "add", ".")
	git(old, "commit", "-m", "old baseline")
	write("committed.md", "new commit")
	git(now.Add(-10*time.Minute), "add", "committed.md")
	git(now.Add(-10*time.Minute), "commit", "-m", "recent document")
	write("dirty-old.md", "old uncommitted")
	if err := os.Chtimes(filepath.Join(root, "dirty-old.md"), old, old); err != nil {
		t.Fatal(err)
	}
	write("dirty-new.md", "new uncommitted")
	write("untracked.md", "new document")
	r, err := New(root, 3*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	recent, ok := r.RecentDocuments(context.Background(), time.Now())
	if !ok || len(recent) != 3 || recent["committed.md"] == 0 || recent["dirty-new.md"] == 0 || recent["untracked.md"] == 0 || recent["clean.md"] != 0 || recent["dirty-old.md"] != 0 {
		t.Fatalf("recent: %v available=%v", recent, ok)
	}
}
