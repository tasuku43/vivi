package gitreview

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestReadDiffRejectsEscapingPathBeforeGit(t *testing.T) {
	reviewer, err := New(t.TempDir(), time.Second)
	if err != nil {
		t.Fatal(err)
	}

	diff := reviewer.ReadDiff(context.Background(), "../secret.txt", "HEAD")
	if diff.Status != "unavailable" || diff.Reason != "path escapes root" {
		t.Fatalf("diff = %#v", diff)
	}
}

func TestReadDiffLimitsGitDiffToRequestedPath(t *testing.T) {
	root := t.TempDir()
	binDir := t.TempDir()
	logPath := filepath.Join(t.TempDir(), "git-args.log")
	if err := os.MkdirAll(filepath.Join(root, "docs"), 0o755); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{"docs/target.md", "other.md"} {
		if err := os.WriteFile(filepath.Join(root, filepath.FromSlash(path)), []byte("changed\n"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	fakeGit := filepath.Join(binDir, "git")
	script := strings.Join([]string{
		"#!/bin/sh",
		`printf '%s\n' "$*" >> ` + shellQuote(logPath),
		`if [ "$1" = "rev-parse" ]; then`,
		`  printf "%s\n" "$PWD"`,
		"  exit 0",
		"fi",
		`if [ "$1" = "status" ]; then`,
		`  printf ' M docs/target.md\000 M other.md\000'`,
		"  exit 0",
		"fi",
		`if [ "$1" = "diff" ]; then`,
		`  if [ "$5" != "docs/target.md" ]; then`,
		`    printf "unexpected diff path: %s\n" "$*" >&2`,
		"    exit 1",
		"  fi",
		`  printf 'diff --git a/docs/target.md b/docs/target.md\n'`,
		`  printf 'index 1111111..2222222 100644\n'`,
		`  printf '--- a/docs/target.md\n'`,
		`  printf '+++ b/docs/target.md\n'`,
		`  printf '@@ -1 +1 @@\n'`,
		`  printf -- '-old\n'`,
		`  printf '+changed\n'`,
		"  exit 0",
		"fi",
		`printf "unexpected git args: %s\n" "$*" >&2`,
		"exit 1",
		"",
	}, "\n")
	if err := os.WriteFile(fakeGit, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", binDir+string(os.PathListSeparator)+os.Getenv("PATH"))
	reviewer, err := New(root, 5*time.Second)
	if err != nil {
		t.Fatal(err)
	}

	diff := reviewer.ReadDiff(context.Background(), "docs/target.md", "HEAD")

	if diff.Status != "available" {
		t.Fatalf("diff = %#v", diff)
	}
	if strings.Contains(diff.Content, "other.md") {
		t.Fatalf("diff included unrelated file: %s", diff.Content)
	}
	logBytes, err := os.ReadFile(logPath)
	if err != nil {
		t.Fatal(err)
	}
	log := string(logBytes)
	if !strings.Contains(log, "diff --unified=1000000 HEAD -- docs/target.md") {
		t.Fatalf("git diff was not path-limited:\n%s", log)
	}
	if strings.Contains(log, "diff --unified=1000000 HEAD -- .") {
		t.Fatalf("git diff still read the whole workspace:\n%s", log)
	}
}

func TestReadChangesFallsBackToTrackedStatusWhenUntrackedScanTimesOut(t *testing.T) {
	root := t.TempDir()
	binDir := t.TempDir()
	fakeGit := filepath.Join(binDir, "git")
	script := strings.Join([]string{
		"#!/bin/sh",
		`if [ "$1" = "rev-parse" ]; then`,
		`  printf "%s\n" "$PWD"`,
		"  exit 0",
		"fi",
		`if [ "$1" = "status" ] && [ "$3" = "--untracked-files=all" ]; then`,
		"  sleep 2",
		"  exit 0",
		"fi",
		`if [ "$1" = "status" ] && [ "$3" = "--untracked-files=no" ]; then`,
		`  printf ' M README.md\000'`,
		"  exit 0",
		"fi",
		`printf "unexpected git args: %s %s %s\n" "$1" "$2" "$3" >&2`,
		"exit 1",
		"",
	}, "\n")
	if err := os.WriteFile(fakeGit, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", binDir+string(os.PathListSeparator)+os.Getenv("PATH"))
	reviewer, err := New(root, 750*time.Millisecond)
	if err != nil {
		t.Fatal(err)
	}

	summary := reviewer.ReadChanges(context.Background())

	if !summary.Available {
		t.Fatalf("summary.Available = false, reason = %q", summary.Reason)
	}
	if summary.Reason != partialTimeoutReason {
		t.Fatalf("summary.Reason = %q, want %q", summary.Reason, partialTimeoutReason)
	}
	if len(summary.Changes) != 1 {
		t.Fatalf("summary.Changes = %#v, want one tracked change", summary.Changes)
	}
	if summary.Changes[0] != (Change{Path: "README.md", Status: "modified", Kind: "file"}) {
		t.Fatalf("summary.Changes[0] = %#v", summary.Changes[0])
	}
}

func shellQuote(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "'\\''") + "'"
}
