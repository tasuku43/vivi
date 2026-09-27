package workspace

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func nodePaths(nodes []Node) []string {
	paths := []string{}
	for _, node := range nodes {
		paths = append(paths, node.Path)
		paths = append(paths, nodePaths(node.Children)...)
	}
	return paths
}

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

func TestWatchEntryAppliesIgnoreAndInclusionPolicy(t *testing.T) {
	root := t.TempDir()
	mustWrite(t, root, "README.md", []byte("# Ready\n"))
	mustWrite(t, root, "node_modules/ignored.js", []byte("ignored\n"))

	fsys, err := New(Options{Root: root})
	if err != nil {
		t.Fatal(err)
	}
	entry, ok, err := fsys.WatchEntry("README.md")
	if err != nil {
		t.Fatal(err)
	}
	if !ok || entry.Path != "README.md" || entry.Kind != "file" || entry.Size == 0 {
		t.Fatalf("entry = %#v, ok = %v", entry, ok)
	}
	if _, ok, err := fsys.WatchEntry("node_modules/ignored.js"); err != nil || ok {
		t.Fatalf("ignored entry ok = %v err = %v", ok, err)
	}
}

func TestExcludeGlobWinsOverIncludeAcrossTreeReadAndWatch(t *testing.T) {
	root := t.TempDir()
	mustWrite(t, root, "README.md", []byte("# Visible\n"))
	mustWrite(t, root, "package-lock.json", []byte("{}\n"))
	mustWrite(t, root, "src/generated/client.md", []byte("# Generated\n"))
	mustWrite(t, root, "src/guide.md", []byte("# Guide\n"))
	mustWrite(t, root, "node_modules/private.md", []byte("# Guide\n"))

	fsys, err := New(Options{
		Root:    root,
		Include: []string{"md", "json"},
		Exclude: []string{"package-lock.json", "**/generated/**"},
	})
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
		for _, child := range node.Children {
			serialized += child.Path + "\n"
			for _, grandchild := range child.Children {
				serialized += grandchild.Path + "\n"
			}
		}
	}
	if !strings.Contains(serialized, "README.md") || !strings.Contains(serialized, "src/guide.md") {
		t.Fatalf("tree lost included files: %s", serialized)
	}
	if strings.Contains(serialized, "package-lock.json") || strings.Contains(serialized, "generated") {
		t.Fatalf("tree included excluded paths: %s", serialized)
	}
	if _, err := fsys.ReadFile("package-lock.json"); err == nil || !strings.Contains(err.Error(), "path is excluded") {
		t.Fatalf("excluded file read error = %v", err)
	}
	entries, err := fsys.WatchEntries()
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := entries["package-lock.json"]; ok {
		t.Fatalf("watch entries included excluded file: %#v", entries)
	}
	if _, ok := entries["src/generated/client.md"]; ok {
		t.Fatalf("watch entries included excluded subtree: %#v", entries)
	}
	text, err := fsys.SearchText("Guide", 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(text.Results) != 1 || text.Results[0].Path != "src/guide.md" {
		t.Fatalf("text search results = %#v, want only src/guide.md", text.Results)
	}
	if text.Stats.ScannedFiles != 2 || text.Stats.ReadFiles != 2 {
		t.Fatalf("text search stats = %#v, want 2 visible files scanned and read", text.Stats)
	}
}

func TestDocumentTreePrunesDirectoriesWithoutIncludedDocuments(t *testing.T) {
	root := t.TempDir()
	mustWrite(t, root, "README.md", []byte("# Visible\n"))
	mustWrite(t, root, "docs/guide.md", []byte("# Guide\n"))
	mustWrite(t, root, "docs/nested/deep.markdown", []byte("# Deep\n"))
	mustWrite(t, root, "docs/assets/logo.png", []byte("not a document\n"))
	mustWrite(t, root, "src/app.ts", []byte("export const hidden = true\n"))
	if err := os.MkdirAll(filepath.Join(root, "empty"), 0o755); err != nil {
		t.Fatal(err)
	}

	fsys, err := New(Options{
		Root:    root,
		Include: []string{"md", "markdown", "mdown"},
	})
	if err != nil {
		t.Fatal(err)
	}

	shallow, err := fsys.ReadDirectory("", 1)
	if err != nil {
		t.Fatal(err)
	}
	if got := nodePaths(shallow.Nodes); strings.Join(got, ",") != "README.md,docs" {
		t.Fatalf("shallow paths = %#v, want only root document and document directory", got)
	}
	docs := shallow.Nodes[1]
	if docs.ChildrenLoaded == nil || *docs.ChildrenLoaded {
		t.Fatalf("docs childrenLoaded = %#v, want false", docs.ChildrenLoaded)
	}
	if shallow.Stats.ReturnedNodes != 2 {
		t.Fatalf("returned nodes = %d, want 2", shallow.Stats.ReturnedNodes)
	}

	full, err := fsys.ReadTree()
	if err != nil {
		t.Fatal(err)
	}
	serialized := strings.Join(nodePaths(full.Nodes), "\n")
	for _, want := range []string{"README.md", "docs", "docs/guide.md", "docs/nested", "docs/nested/deep.markdown"} {
		if !strings.Contains(serialized, want) {
			t.Fatalf("full tree lost %q:\n%s", want, serialized)
		}
	}
	for _, hidden := range []string{"docs/assets", "logo.png", "src", "app.ts", "empty"} {
		if strings.Contains(serialized, hidden) {
			t.Fatalf("full tree included %q:\n%s", hidden, serialized)
		}
	}
}

func TestWatchEntriesUnderScansOnlyRequestedSubtree(t *testing.T) {
	root := t.TempDir()
	mustWrite(t, root, "docs/guide.md", []byte("# Guide\n"))
	mustWrite(t, root, "docs/nested/deep.md", []byte("# Deep\n"))
	mustWrite(t, root, "src/app.ts", []byte("export const ok = true\n"))

	fsys, err := New(Options{Root: root})
	if err != nil {
		t.Fatal(err)
	}
	entries, stats, err := fsys.WatchEntriesUnder("docs")
	if err != nil {
		t.Fatal(err)
	}

	for _, want := range []string{"docs", "docs/guide.md", "docs/nested", "docs/nested/deep.md"} {
		if _, ok := entries[want]; !ok {
			t.Fatalf("expected %q in entries: %#v", want, entries)
		}
	}
	if _, ok := entries["src/app.ts"]; ok {
		t.Fatalf("focused scan included sibling subtree: %#v", entries)
	}
	if stats.ScannedDirectories != 2 {
		t.Fatalf("scanned directories = %d, want 2", stats.ScannedDirectories)
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

func TestWatchEntriesPreserveSymlinkContainmentAndDirectoryPolicy(t *testing.T) {
	root := t.TempDir()
	insideTarget := filepath.Join(root, "target.md")
	if err := os.WriteFile(insideTarget, []byte("inside\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	mustWrite(t, root, "nested/visible.md", []byte("visible\n"))
	outside := t.TempDir()
	if err := os.WriteFile(filepath.Join(outside, "secret.md"), []byte("secret\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	links := []struct{ target, name string }{
		{insideTarget, filepath.Join(root, "inside-link.md")},
		{filepath.Join(outside, "secret.md"), filepath.Join(root, "outside-link.md")},
		{filepath.Join(root, "nested"), filepath.Join(root, "inside-dir-link")},
		{outside, filepath.Join(root, "outside-dir-link")},
	}
	for _, link := range links {
		if err := os.Symlink(link.target, link.name); err != nil {
			t.Skipf("symlink unavailable: %v", err)
		}
	}

	fsys, err := New(Options{Root: root})
	if err != nil {
		t.Fatal(err)
	}
	entries, _, err := fsys.WatchEntriesWithStats()
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"target.md", "inside-link.md", "nested", "nested/visible.md"} {
		if _, ok := entries[want]; !ok {
			t.Errorf("watch entries missing %q: %#v", want, entries)
		}
	}
	for _, hidden := range []string{"outside-link.md", "inside-dir-link", "outside-dir-link"} {
		if _, ok := entries[hidden]; ok {
			t.Errorf("watch entries included protected symlink %q: %#v", hidden, entries)
		}
	}
}

func TestSearchTextStreamsAndPreservesLineMatchingSemantics(t *testing.T) {
	root := t.TempDir()
	mustWrite(t, root, "00-binary.md", []byte("needle first\n\x00"))
	mustWrite(t, root, "01-hits.md", []byte("\xEF\xBB\xBFfirst NEEDLE\r\nsecond needle\nStraße NEEDLE\r\nfourth needle\n"))
	mustWrite(t, root, "02-invalid.md", []byte("needle before invalid UTF-8\n\xff"))
	mustWrite(t, root, "03-next.md", []byte("another needle\n"))

	fsys, err := New(Options{Root: root, Include: []string{"md"}})
	if err != nil {
		t.Fatal(err)
	}
	response, err := fsys.SearchText(" needle ", 4)
	if err != nil {
		t.Fatal(err)
	}
	if len(response.Results) != 4 {
		t.Fatalf("results = %#v", response.Results)
	}
	want := []TextSearchResult{
		{Path: "01-hits.md", ViewerKind: "markdown", LineNumber: 1, LineText: "\xEF\xBB\xBFfirst NEEDLE", MatchStart: 9, MatchLength: 6},
		{Path: "01-hits.md", ViewerKind: "markdown", LineNumber: 2, LineText: "second needle", MatchStart: 7, MatchLength: 6},
		{Path: "01-hits.md", ViewerKind: "markdown", LineNumber: 3, LineText: "Straße NEEDLE", MatchStart: 8, MatchLength: 6},
		{Path: "03-next.md", ViewerKind: "markdown", LineNumber: 1, LineText: "another needle", MatchStart: 8, MatchLength: 6},
	}
	for index := range want {
		if got := response.Results[index]; got != want[index] {
			t.Errorf("result[%d] = %#v, want %#v", index, got, want[index])
		}
	}
	if response.Stats.ReadFiles != 2 || response.Stats.SkippedFiles != 2 {
		t.Fatalf("search stats = %#v, want 2 readable and 2 skipped files", response.Stats)
	}
}

func TestSearchTextHandlesLongLinesAcrossReaderBuffers(t *testing.T) {
	root := t.TempDir()
	line := append(bytes.Repeat([]byte("X"), 70*1024), []byte("NeEdLe at end")...)
	if err := os.WriteFile(filepath.Join(root, "long.md"), line, 0o644); err != nil {
		t.Fatal(err)
	}
	fsys, err := New(Options{Root: root, Include: []string{"md"}, MaxFileSizeBytes: 128 * 1024})
	if err != nil {
		t.Fatal(err)
	}
	response, err := fsys.SearchText("needle", 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(response.Results) != 1 {
		t.Fatalf("results = %#v", response.Results)
	}
	result := response.Results[0]
	if result.LineNumber != 1 || result.MatchStart != 70*1024 || len(result.LineText) != len(line) {
		t.Fatalf("long-line result = %#v (line bytes %d)", result, len(line))
	}
}

func TestSearchTextReusesOnlyExistingFilenameIndexAndReadsCurrentContent(t *testing.T) {
	root := t.TempDir()
	mustWrite(t, root, "note.md", []byte("needle\n"))
	fsys, err := New(Options{Root: root, Include: []string{"md"}})
	if err != nil {
		t.Fatal(err)
	}

	cold, err := fsys.SearchText("needle", 10)
	if err != nil {
		t.Fatal(err)
	}
	if cold.Stats.Cached || cold.Stats.ScannedFiles != 1 || fsys.searchIndex != nil {
		t.Fatalf("cold search should scan without retaining a new index: %#v", cold.Stats)
	}

	if _, err := fsys.SearchFiles("note", 10); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "note.md"), []byte("change\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	warm, err := fsys.SearchText("change", 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(warm.Results) != 1 || warm.Results[0].Path != "note.md" {
		t.Fatalf("warm search results = %#v, want updated note.md content", warm.Results)
	}
	if !warm.Stats.Cached || warm.Stats.ScannedFiles != 0 || warm.Stats.ReadFiles != 1 {
		t.Fatalf("warm search stats = %#v, want metadata cache hit and fresh content read", warm.Stats)
	}

	mustWrite(t, root, "new.md", []byte("change\n"))
	fsys.InvalidateSearchIndex()
	refreshed, err := fsys.SearchText("change", 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(refreshed.Results) != 2 || refreshed.Stats.Cached || refreshed.Stats.ScannedFiles != 2 || refreshed.Stats.ReadFiles != 2 || fsys.searchIndex != nil {
		t.Fatalf("refreshed search = %#v, want fresh scan of both files", refreshed)
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

func TestPreviewImagesPreserveWorkspaceGuards(t *testing.T) {
	root := t.TempDir()
	for _, name := range []string{"diagram.svg", "private.svg", "node_modules/hidden.svg", "script.js", "README.md"} {
		mustWrite(t, root, name, []byte("fixture"))
	}
	outside := filepath.Join(t.TempDir(), "outside.svg")
	if err := os.WriteFile(outside, []byte("outside"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(root, "escape.svg")); err != nil {
		t.Fatal(err)
	}
	fsys, err := New(Options{Root: root, Include: []string{"md"}, Exclude: []string{"private.svg"}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := fsys.ReadFile("diagram.svg"); err == nil {
		t.Fatal("ordinary read bypassed include filter")
	}
	file, err := fsys.ReadPreviewResource("diagram.svg")
	if err != nil || file.MimeType != "image/svg+xml" {
		t.Fatalf("image resource: %#v, %v", file, err)
	}
	for _, name := range []string{"private.svg", "node_modules/hidden.svg", "script.js", "../outside.svg", "escape.svg"} {
		if _, err := fsys.ReadPreviewResource(name); err == nil {
			t.Errorf("allowed protected resource %s", name)
		}
	}
	limited, err := New(Options{Root: root, Include: []string{"md"}, MaxFileSizeBytes: 2})
	if err != nil {
		t.Fatal(err)
	}
	file, err = limited.ReadPreviewResource("diagram.svg")
	if err != nil || !file.Truncated || file.Content != "" {
		t.Fatalf("size guard: %#v, %v", file, err)
	}
}
