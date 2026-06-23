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

func TestDiffForPathExtractsOnlyRequestedFile(t *testing.T) {
	fullDiff := strings.Join([]string{
		"diff --git a/README.md b/README.md",
		"index 1111111..2222222 100644",
		"--- a/README.md",
		"+++ b/README.md",
		"@@ -1 +1 @@",
		"-old",
		"+new",
		"diff --git a/src/app.ts b/src/app.ts",
		"index 3333333..4444444 100644",
		"--- a/src/app.ts",
		"+++ b/src/app.ts",
		"@@ -1 +1 @@",
		"-before",
		"+after",
	}, "\n")

	diff := diffForPath(fullDiff, "src/app.ts")
	if !strings.Contains(diff, "diff --git a/src/app.ts b/src/app.ts") {
		t.Fatalf("diff = %q, want src/app.ts block", diff)
	}
	if strings.Contains(diff, "README.md") {
		t.Fatalf("diff = %q, should not include README block", diff)
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
