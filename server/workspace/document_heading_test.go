package workspace

import (
	"os"
	"strings"
	"testing"
)

func TestDocumentHeadingExtraction(t *testing.T) {
	for _, tc := range []struct{ name, kind, source, want string }{
		{"markdown", "markdown", "# Hello **world** &amp; `code`\n# Second", "Hello world & code"},
		{"fences", "markdown", "```md\n# Wrong\n```\n    # Indented\n\n# Right", "Right"},
		{"setext", "markdown", "A [linked](https://example.test) title\n===\n", "A linked title"},
		{"image alt", "markdown", "# ![Vivi](logo.svg) guide", "Vivi guide"},
		{"raw html", "markdown", "<h1>A raw heading</h1>\n", "A raw heading"},
		{"no h1", "markdown", "## Heading two\n", ""},
		{"frontmatter", "markdown", "---\ntitle: Metadata\n---\n# Actual", "Actual"},
		{"html", "html", "<title>Wrong</title><!-- <h1>Wrong</h1> --><script>'<h1>Wrong</h1>'</script><h1>Hello <em>world</em> &amp; friends</h1><h1>Second</h1>", "Hello world & friends"},
		{"html hidden code", "html", "<template><h1>Wrong</h1></template><h1>Hello<script>bad</script><style>bad</style> world</h1>", "Hello world"},
		{"html void tags", "html", "<h1>One<br/>two <img alt=\"logo\" /></h1>", "One two logo"},
		{"no html h1", "html", "<title>Not an H1</title><h2>Second level</h2>", ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := extractDocumentHeading([]byte(tc.source), tc.kind, false)
			if got == nil || *got != tc.want {
				t.Fatalf("heading = %v, want %q", got, tc.want)
			}
		})
	}
	partial := append([]byte("<h1>日本語</h1>"), 0xe3, 0x81)
	if got := extractDocumentHeading(partial, "html", true); got == nil || *got != "日本語" {
		t.Fatal("trailing partial UTF-8 must not hide a complete H1")
	}
	if got := extractDocumentHeading([]byte("text"), "markdown", true); got != nil {
		t.Fatal("truncated absence must remain unavailable")
	}
	if got := extractDocumentHeading([]byte("<h1>unfinished"), "html", true); got != nil {
		t.Fatal("partial HTML heading must remain unavailable")
	}
}

func TestTreeHeadingsAreBoundedCachedAndRefreshWithoutRenaming(t *testing.T) {
	root := t.TempDir()
	mustWrite(t, root, "a.md", []byte("# First\n"))
	mustWrite(t, root, "nested/b.html", []byte("<h1>Nested</h1>"))
	mustWrite(t, root, "z.md", []byte(strings.Repeat("x", documentHeadingReadLimit+1)))
	fsys, err := New(Options{Root: root})
	if err != nil {
		t.Fatal(err)
	}
	tree, err := fsys.ReadDirectory("", 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(fsys.headingCache) != 2 {
		t.Fatalf("only returned files should be read: %d", len(fsys.headingCache))
	}
	if tree.Nodes[0].Name != "a.md" || *tree.Nodes[0].DocumentHeading != "First" {
		t.Fatalf("node = %+v", tree.Nodes[0])
	}
	if tree.Nodes[2].DocumentHeading != nil {
		t.Fatal("bounded read must not claim no H1")
	}
	info, _ := os.Stat(root + "/a.md")
	mustWrite(t, root, "a.md", []byte("# Other\n"))
	if err := os.Chtimes(root+"/a.md", info.ModTime(), info.ModTime()); err != nil {
		t.Fatal(err)
	}
	fsys.InvalidateDocumentHeading("a.md")
	next, err := fsys.ReadDirectory("", 1)
	if err != nil {
		t.Fatal(err)
	}
	if next.Nodes[0].Path != tree.Nodes[0].Path || next.Nodes[0].Name != "a.md" || *next.Nodes[0].DocumentHeading != "Other" {
		t.Fatalf("updated node = %+v", next.Nodes[0])
	}
	nested, err := fsys.ReadDirectory("nested", 1)
	if err != nil {
		t.Fatal(err)
	}
	if *nested.Nodes[0].DocumentHeading != "Nested" {
		t.Fatal("lazy directory heading missing")
	}
}

func TestAttentionHeadingDoesNotInterpretSourceCodeAsMarkdown(t *testing.T) {
	root := t.TempDir()
	mustWrite(t, root, "script.py", []byte("# A Python comment\n"))
	fs, err := New(Options{Root: root})
	if err != nil {
		t.Fatal(err)
	}
	if heading := fs.DocumentHeading("script.py"); heading != nil {
		t.Fatalf("code acquired a Markdown title: %v", *heading)
	}
}
