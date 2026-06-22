package workspace

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestReadFileSniffsUnknownTextLikeFiles(t *testing.T) {
	root := t.TempDir()
	mustWrite(t, root, "agent-note", []byte("status=ok\nnext=review\n"))

	fsys, err := New(Options{Root: root})
	if err != nil {
		t.Fatal(err)
	}
	file, err := fsys.ReadFile("agent-note")
	if err != nil {
		t.Fatal(err)
	}

	if file.ViewerKind != "text" || file.Encoding != "utf8" {
		t.Fatalf("unexpected payload: %#v", file)
	}
	if !strings.Contains(file.Content, "next=review") {
		t.Fatalf("content = %q", file.Content)
	}
}

func TestReadFileKeepsUnknownBinaryMetadataOnly(t *testing.T) {
	root := t.TempDir()
	mustWrite(t, root, "agent-cache", []byte{0x00, 0x01, 0x02, 0x03})

	fsys, err := New(Options{Root: root})
	if err != nil {
		t.Fatal(err)
	}
	file, err := fsys.ReadFile("agent-cache")
	if err != nil {
		t.Fatal(err)
	}

	if file.ViewerKind != "binary" || file.Encoding != "none" || file.Content != "" {
		t.Fatalf("unexpected payload: %#v", file)
	}
	if file.MimeType != "application/octet-stream" {
		t.Fatalf("mime type = %q", file.MimeType)
	}
}

func TestReadFileLimitsLargeUnknownTextPreview(t *testing.T) {
	root := t.TempDir()
	mustWrite(t, root, "agent-note", []byte("status=ok\nnext=review\n"))

	fsys, err := New(Options{Root: root, MaxFileSizeBytes: 7})
	if err != nil {
		t.Fatal(err)
	}
	file, err := fsys.ReadFile("agent-note")
	if err != nil {
		t.Fatal(err)
	}

	if file.ViewerKind != "text" || file.Encoding != "utf8" || !file.Truncated {
		t.Fatalf("unexpected payload: %#v", file)
	}
	if file.Content != "status=" || file.PreviewBytes != 7 {
		t.Fatalf("content = %q previewBytes = %d", file.Content, file.PreviewBytes)
	}
}

func TestReadFileKeepsLargeKnownHTMLMetadataSafe(t *testing.T) {
	root := t.TempDir()
	mustWrite(t, root, "index.html", []byte("<h1>Hello</h1>"))

	fsys, err := New(Options{Root: root, MaxFileSizeBytes: 4})
	if err != nil {
		t.Fatal(err)
	}
	file, err := fsys.ReadFile("index.html")
	if err != nil {
		t.Fatal(err)
	}

	if file.ViewerKind != "html" || file.Encoding != "none" || file.Content != "" || !file.Truncated {
		t.Fatalf("unexpected payload: %#v", file)
	}
}

func TestWatchEntriesWithStatsCountsWorkspaceScan(t *testing.T) {
	root := t.TempDir()
	mustWrite(t, root, "docs/guide.md", []byte("# Guide\n"))
	mustWrite(t, root, "src/app.ts", []byte("export const ok = true\n"))
	mustWrite(t, root, "node_modules/ignored.js", []byte("ignored\n"))
	mustWrite(t, root, ".tmp-go-build-cache/ignored.test", []byte("ignored\n"))
	mustWrite(t, root, "storybook-static/ignored.html", []byte("ignored\n"))

	fsys, err := New(Options{Root: root})
	if err != nil {
		t.Fatal(err)
	}
	entries, stats, err := fsys.WatchEntriesWithStats()
	if err != nil {
		t.Fatal(err)
	}

	if _, ok := entries["docs/guide.md"]; !ok {
		t.Fatalf("expected docs/guide.md in watch entries: %#v", entries)
	}
	if _, ok := entries["node_modules/ignored.js"]; ok {
		t.Fatalf("ignored file should not be included: %#v", entries)
	}
	if _, ok := entries[".tmp-go-build-cache/ignored.test"]; ok {
		t.Fatalf("go build cache should not be included: %#v", entries)
	}
	if _, ok := entries["storybook-static/ignored.html"]; ok {
		t.Fatalf("storybook build output should not be included: %#v", entries)
	}
	if stats.ScannedDirectories != 3 {
		t.Fatalf("scanned directories = %d, want 3", stats.ScannedDirectories)
	}
	if stats.ScannedFiles != 2 {
		t.Fatalf("scanned files = %d, want 2", stats.ScannedFiles)
	}
	if stats.ReturnedEntries != len(entries) {
		t.Fatalf("returned entries = %d, len(entries) = %d", stats.ReturnedEntries, len(entries))
	}
}

func TestReadTreeSkipsSymlinksOutsideRoot(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	mustWrite(t, outside, "secret.md", []byte("# Secret\n"))
	if err := os.Symlink(filepath.Join(outside, "secret.md"), filepath.Join(root, "secret-link.md")); err != nil {
		t.Skipf("symlink unavailable: %v", err)
	}
	mustWrite(t, root, "README.md", []byte("# Public\n"))

	fsys, err := New(Options{Root: root})
	if err != nil {
		t.Fatal(err)
	}
	tree, err := fsys.ReadTree()
	if err != nil {
		t.Fatal(err)
	}

	serialized := ""
	for _, node := range tree.Nodes {
		serialized += node.Path + "\n"
	}
	if !strings.Contains(serialized, "README.md") {
		t.Fatalf("tree = %#v, want README.md", tree.Nodes)
	}
	if strings.Contains(serialized, "secret-link.md") {
		t.Fatalf("tree exposed outside symlink: %#v", tree.Nodes)
	}
}

func TestSearchFilesUsesReusableIndexUntilInvalidated(t *testing.T) {
	root := t.TempDir()
	mustWrite(t, root, "kernel/sched/core.c", []byte("scheduler\n"))
	mustWrite(t, root, "mm/memory.c", []byte("memory\n"))
	mustWrite(t, root, "Kconfig", []byte("config\n"))

	fsys, err := New(Options{Root: root})
	if err != nil {
		t.Fatal(err)
	}

	first, err := fsys.SearchFiles("sched", 10)
	if err != nil {
		t.Fatal(err)
	}
	if first.Stats.Cached {
		t.Fatalf("first search should build the index, stats = %#v", first.Stats)
	}
	if first.Stats.ScannedDirectories == 0 || first.Stats.ScannedFiles == 0 {
		t.Fatalf("first search did not scan workspace, stats = %#v", first.Stats)
	}
	if len(first.Results) == 0 || first.Results[0].Path != "kernel/sched/core.c" {
		t.Fatalf("first results = %#v", first.Results)
	}

	second, err := fsys.SearchFiles("mm", 10)
	if err != nil {
		t.Fatal(err)
	}
	if !second.Stats.Cached {
		t.Fatalf("second search should reuse the index, stats = %#v", second.Stats)
	}
	if second.Stats.ScannedDirectories != 0 || second.Stats.ScannedFiles != 0 {
		t.Fatalf("cached search should not rescan workspace, stats = %#v", second.Stats)
	}
	if len(second.Results) == 0 || second.Results[0].Path != "mm/memory.c" {
		t.Fatalf("second results = %#v", second.Results)
	}

	mustWrite(t, root, "drivers/new-mm-hit.c", []byte("new file\n"))
	fsys.InvalidateSearchIndex()
	refreshed, err := fsys.SearchFiles("new-mm-hit", 10)
	if err != nil {
		t.Fatal(err)
	}
	if refreshed.Stats.Cached {
		t.Fatalf("refreshed search should rebuild after invalidation, stats = %#v", refreshed.Stats)
	}
	if len(refreshed.Results) == 0 || refreshed.Results[0].Path != "drivers/new-mm-hit.c" {
		t.Fatalf("refreshed results = %#v", refreshed.Results)
	}
}

func mustWrite(t *testing.T, root, relative string, content []byte) {
	t.Helper()
	pathname := filepath.Join(root, relative)
	if err := os.MkdirAll(filepath.Dir(pathname), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(pathname, content, 0o644); err != nil {
		t.Fatal(err)
	}
}
