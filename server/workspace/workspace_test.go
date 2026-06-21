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
