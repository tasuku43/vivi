package gitreview

import (
	"context"
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
