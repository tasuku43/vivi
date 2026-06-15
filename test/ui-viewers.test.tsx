import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import type { FilePayload } from "../src/domain/fs-node.js";
import { FileViewer } from "../src/ui/components/FileViewer.js";
import { Inspector } from "../src/ui/components/Inspector.js";
import { TreeSidebar } from "../src/ui/components/TreeSidebar.js";
import {
  CodeViewer,
  extractHighlightedLines,
} from "../src/ui/viewers/CodeViewer.js";
import { CsvViewer, parseDelimitedText } from "../src/ui/viewers/CsvViewer.js";
import {
  buildRenderedDiffBlocks,
  buildFocusedRenderedDiffRows,
  buildFocusedSourceDiffRows,
  buildRenderedDiffRows,
  buildRenderedHtmlRows,
  DiffViewer,
} from "../src/ui/viewers/DiffViewer.js";
import { HtmlViewer } from "../src/ui/viewers/HtmlViewer.js";
import { JsonViewer } from "../src/ui/viewers/JsonViewer.js";
import {
  MermaidViewer,
  parseMermaidEdges,
  renderMermaidPreviewHtml,
} from "../src/ui/viewers/MermaidViewer.js";

const codeFile: FilePayload = {
  path: "src/app.ts",
  viewerKind: "code",
  encoding: "utf8",
  content: "export function start() {\n  return true;\n}\n",
  etag: "sha256:test",
  size: 42,
  mtimeMs: 1,
};

it("renders code with stable line numbers and selected ranges", () => {
  const html = renderToStaticMarkup(
    <CodeViewer
      file={codeFile}
      theme="dark"
      selectedRange={{ start: 1, end: 2 }}
      onSelectionChange={() => undefined}
    />,
  );

  expect(html).toContain('aria-label="Code viewer for src/app.ts"');
  expect(html).toContain('class="code-line selected"');
  expect(html).toContain('aria-label="Select line 1"');
  expect(html).toContain("Copy ref");
  expect(html).toContain("Copy range");
});

it("extracts shiki line spans without losing nested syntax spans", () => {
  expect(
    extractHighlightedLines(
      '<pre><code><span class="line"><span style="color:red">const</span> x</span>\n<span class="line">y</span></code></pre>',
    ),
  ).toEqual(['<span style="color:red">const</span> x', "y"]);
});

it("renders large text files as explicit partial previews", () => {
  const html = renderToStaticMarkup(
    <FileViewer
      file={{
        ...codeFile,
        path: "logs/build.log",
        viewerKind: "text",
        encoding: "utf8",
        content: "first chunk",
        size: 10_000,
        truncated: true,
        maxSizeBytes: 10,
        previewBytes: 10,
      }}
      allowHtmlScripts={false}
      theme="dark"
      selectedCodeRange={null}
      onCodeSelectionChange={() => undefined}
    />,
  );

  expect(html).toContain("partial preview");
  expect(html).toContain("first chunk");
  expect(html).toContain("larger than the 10 B rich preview limit");
});

it("keeps non-text large files in the safe unsupported state", () => {
  const html = renderToStaticMarkup(
    <FileViewer
      file={{
        ...codeFile,
        path: "index.html",
        viewerKind: "html",
        encoding: "none",
        content: "",
        size: 10_000,
        truncated: true,
        maxSizeBytes: 10,
      }}
      allowHtmlScripts={false}
      theme="dark"
      selectedCodeRange={null}
      onCodeSelectionChange={() => undefined}
    />,
  );

  expect(html).toContain("larger than the");
  expect(html).not.toContain("partial preview");
});

it("keeps the HTML viewer sandboxed and exposes source mode controls", () => {
  const html = renderToStaticMarkup(
    <HtmlViewer
      file={{ ...codeFile, path: "index.html", viewerKind: "html" }}
      allowHtmlScripts={false}
    />,
  );

  expect(html).toContain("sandboxed · scripts off");
  expect(html).toContain("Preview");
  expect(html).toContain("Source");
  expect(html).toContain('sandbox=""');
  expect(html).toContain("/preview/html?path=index.html");
});

it("dispatches JSON files through a tree view with source fallback", () => {
  const html = renderToStaticMarkup(
    <JsonViewer
      file={{
        ...codeFile,
        path: "data/sample.json",
        viewerKind: "json",
        content: '{"ok":true,"items":[1]}',
      }}
    />,
  );

  expect(html).toContain("data/sample.json");
  expect(html).toContain("JSON tree");
  expect(html).toContain("items");
});

it("renders the Review Queue before secondary file helpers in the inspector", () => {
  const html = renderToStaticMarkup(
    <Inspector
      file={codeFile}
      outline={[]}
      reviewChanges={[
        { path: "src/app.ts", status: "modified", source: "git" },
        {
          path: "docs/new.md",
          originalPath: "docs/old.md",
          status: "renamed",
          source: "watcher",
        },
      ]}
      selectedCodeRange={{ start: 2, end: 2 }}
      activePaneId="main"
      onOutlineSelect={() => undefined}
      onOpenEventPath={() => undefined}
      onOpenNextChanged={() => undefined}
      onOpenPreviousChanged={() => undefined}
      onOpenAllChanged={() => undefined}
      onTargetHoverChange={() => undefined}
      onRevealTarget={() => undefined}
    />,
  );

  expect(html).toContain("Review Queue");
  expect(html.indexOf("Review Queue")).toBeLessThan(
    html.indexOf("In this file"),
  );
  expect(html).toContain("Open next");
  expect(html).toContain("Open previous");
  expect(html).toContain("src/app.ts:2");
  expect(html).toContain("export");
  expect(html).toContain("start");
  expect(html).toContain("HEAD diff");
  expect(html).toContain("local change");
  expect(html).toContain("docs/old.md → docs/new.md");
  expect(html).toContain("modified");
  expect(html).toContain("renamed");
  expect(html).toContain("Details");
  expect(html.indexOf("Review Queue")).toBeLessThan(html.indexOf("Details"));
  expect(html).toContain("Open all changed files as tabs");
  expect(html).not.toContain("Recent events");
  expect(html).not.toContain("Diff</button>");
  expect(html).not.toContain("Review targets");
  expect(html).not.toContain("Changed files");
  expect(html).not.toContain("Diff preview");
});

it("keeps Markdown and HTML outline available as In this file", () => {
  const html = renderToStaticMarkup(
    <Inspector
      file={{ ...codeFile, path: "README.md", viewerKind: "markdown" }}
      outline={[
        { id: "title", level: 1, text: "Title" },
        { id: "setup", level: 2, text: "Setup" },
      ]}
      reviewChanges={[]}
      selectedCodeRange={null}
      activePaneId="main"
      onOutlineSelect={() => undefined}
      onOpenEventPath={() => undefined}
      onOpenNextChanged={() => undefined}
      onOpenPreviousChanged={() => undefined}
      onOpenAllChanged={() => undefined}
      onTargetHoverChange={() => undefined}
      onRevealTarget={() => undefined}
    />,
  );

  expect(html).toContain("No files to review.");
  expect(html).toContain("In this file");
  expect(html).toContain("Title");
  expect(html).toContain("Setup");
  expect(html).not.toContain("Document outline");
});

it("renders HEAD diffs inside the file viewer surface", () => {
  const html = renderToStaticMarkup(
    <DiffViewer
      path="README.md"
      renderKind="markdown"
      diff={{
        path: "README.md",
        status: "available",
        baseLabel: "HEAD",
        compareLabel: "working tree",
        content: "@@ -1,2 +1,2 @@\n-# Old title\n+# New title\n body",
      }}
    />,
  );

  expect(html).toContain('aria-label="Diff from HEAD for README.md"');
  expect(html).toContain("Diff from HEAD");
  expect(html).toContain('<h1 id="old-title">Old title</h1>');
  expect(html).toContain('<h1 id="new-title">New title</h1>');
  expect(html).toContain("rendered-markdown-diff");
  expect(html).toContain("rendered-markdown-diff-block remove");
  expect(html).toContain("rendered-markdown-diff-block add");
  expect(html).toContain("Focus changes");
  expect(html).not.toContain("diff-line-no");
  expect(html).not.toContain("rendered-diff-pane");
  expect(html).not.toContain("@@ -1,2 +1,2 @@");
});

it("renders Markdown diffs as intact rendered blocks", () => {
  const html = renderToStaticMarkup(
    <DiffViewer
      path="README.md"
      renderKind="markdown"
      diff={{
        path: "README.md",
        status: "available",
        baseLabel: "HEAD",
        compareLabel: "working tree",
        content: [
          "@@ -1,3 +1,3 @@",
          "-```ts",
          "-console.log('old')",
          "-```",
          "+```ts",
          "+console.log('new')",
          "+```",
        ].join("\n"),
      }}
    />,
  );

  expect(html).toContain("rendered-markdown-diff-block remove");
  expect(html).toContain("rendered-markdown-diff-block add");
  expect(html).toContain("<pre><code");
  expect(html).toContain("console.log('old')");
  expect(html).toContain("console.log('new')");
});

it("keeps additions inside surrounding Markdown code fences", () => {
  const html = renderToStaticMarkup(
    <DiffViewer
      path="README.md"
      renderKind="markdown"
      diff={{
        path: "README.md",
        status: "available",
        baseLabel: "HEAD",
        compareLabel: "working tree",
        content: [
          "@@ -1,4 +1,5 @@",
          " ```text",
          " src/cli -> process args",
          "+fuga",
          " src/ui -> React SPA",
          " ```",
        ].join("\n"),
      }}
    />,
  );

  expect(html).toContain("<pre><code");
  expect(html).toContain("src/cli -&gt; process args");
  expect(html).toContain("rendered-markdown-code-line add");
  expect(html).toContain(">fuga</span>");
  expect(html).toContain("src/ui -&gt; React SPA");
  expect(html).toContain("</span>\n<span");
  expect(html).not.toContain("<p>fuga</p>");
});

it("keeps inline Markdown code inline in rendered diffs", () => {
  const html = renderToStaticMarkup(
    <DiffViewer
      path="README.md"
      renderKind="markdown"
      diff={{
        path: "README.md",
        status: "available",
        baseLabel: "HEAD",
        compareLabel: "working tree",
        content:
          "@@ -1,1 +1,1 @@\n-This uses `old-code` inline.\n+This uses `new-code` inline.",
      }}
    />,
  );

  expect(html).toContain("<p>This uses <code>old-code</code> inline.</p>");
  expect(html).toContain("<p>This uses <code>new-code</code> inline.</p>");
  expect(html).not.toContain("diff-line-no");
});

it("renders HTML diffs as rendered snippets without line numbers", () => {
  const html = renderToStaticMarkup(
    <DiffViewer
      path="index.html"
      renderKind="html"
      diff={{
        path: "index.html",
        status: "available",
        baseLabel: "HEAD",
        compareLabel: "working tree",
        content:
          "@@ -1,2 +1,2 @@\n-<h1>Old</h1>\n-<p>Before</p>\n+<h1>New</h1>\n+<p>After</p>",
      }}
    />,
  );

  expect(html).toContain("rendered-html-diff-block remove");
  expect(html).toContain("rendered-html-diff-block add");
  expect(html).toContain("HTML diff preview");
  expect(html).not.toContain("diff-line-no");
  expect(html).not.toContain("diff-inline-row");
});

it("groups consecutive rendered HTML diff rows", () => {
  expect(
    buildRenderedHtmlRows([
      { kind: "remove", lineLabel: "1", source: "<h1>Old</h1>" },
      { kind: "remove", lineLabel: "2", source: "<p>Before</p>" },
      { kind: "add", lineLabel: "1", source: "<h1>New</h1>" },
    ]),
  ).toEqual([
    { kind: "remove", lineLabel: "1", source: "<h1>Old</h1>\n<p>Before</p>" },
    { kind: "add", lineLabel: "1", source: "<h1>New</h1>" },
  ]);
});

it("groups rendered Markdown diff rows by block", () => {
  expect(
    buildRenderedDiffRows([
      { kind: "remove", text: "```ts", oldLine: 1 },
      { kind: "remove", text: "const before = true;", oldLine: 2 },
      { kind: "remove", text: "```", oldLine: 3 },
      { kind: "add", text: "```ts", newLine: 1 },
      { kind: "add", text: "const after = true;", newLine: 2 },
      { kind: "add", text: "```", newLine: 3 },
    ]),
  ).toMatchObject([
    {
      kind: "remove",
      lineLabel: "1-3",
      source: "```ts\nconst before = true;\n```",
    },
    {
      kind: "add",
      lineLabel: "1-3",
      source: "```ts\nconst after = true;\n```",
    },
  ]);
});

it("focuses source diffs around changed lines", () => {
  expect(
    buildFocusedSourceDiffRows(
      [
        { kind: "context", text: "far before", oldLine: 1, newLine: 1 },
        { kind: "context", text: "near before", oldLine: 2, newLine: 2 },
        { kind: "remove", text: "old", oldLine: 3 },
        { kind: "add", text: "new", newLine: 3 },
        { kind: "context", text: "near after", oldLine: 4, newLine: 4 },
        { kind: "context", text: "far after", oldLine: 5, newLine: 5 },
      ],
      1,
    ),
  ).toMatchObject([
    { kind: "gap", text: "1 unchanged line hidden" },
    { kind: "context", text: "near before" },
    { kind: "remove", text: "old" },
    { kind: "add", text: "new" },
    { kind: "context", text: "near after" },
    { kind: "gap", text: "1 unchanged line hidden" },
  ]);
});

it("focuses rendered diffs by surrounding block", () => {
  expect(
    buildFocusedRenderedDiffRows(
      [
        { kind: "context", lineLabel: "1", source: "# Far before" },
        { kind: "context", lineLabel: "2", source: "Near before" },
        { kind: "add", lineLabel: "3", source: "Changed" },
        { kind: "context", lineLabel: "4", source: "Near after" },
        { kind: "context", lineLabel: "5", source: "Far after" },
      ],
      1,
    ),
  ).toMatchObject([
    { kind: "gap", source: "1 unchanged block hidden" },
    { kind: "context", source: "Near before" },
    { kind: "add", source: "Changed" },
    { kind: "context", source: "Near after" },
    { kind: "gap", source: "1 unchanged block hidden" },
  ]);
});

it("renders source diffs as inline line rows", () => {
  const html = renderToStaticMarkup(
    <DiffViewer
      path="src/app.ts"
      renderKind="source"
      diff={{
        path: "src/app.ts",
        status: "available",
        baseLabel: "HEAD",
        compareLabel: "working tree",
        content:
          "diff --git a/src/app.ts b/src/app.ts\nindex 0000000..0000000\n--- a/src/app.ts\n+++ b/src/app.ts\n@@ -62,2 +62,2 @@\n-old line\n+new line",
      }}
    />,
  );

  expect(html).toContain("diff-inline-row remove");
  expect(html).toContain("diff-inline-row add");
  expect(html).toContain(">62</span><code>old line</code>");
  expect(html).toContain(">62</span><code>new line</code>");
  expect(html).not.toContain("diff --git");
  expect(html).not.toContain("index 0000000");
  expect(html).not.toContain("--- a/src/app.ts");
  expect(html).not.toContain("@@ -62,2 +62,2 @@");
});

it("groups unified diff lines into rendered change blocks", () => {
  expect(
    buildRenderedDiffBlocks([
      { kind: "hunk", text: "@@ -1 +1 @@" },
      { kind: "remove", text: "# Old", oldLine: 1 },
      { kind: "add", text: "# New", newLine: 1 },
    ]),
  ).toEqual([{ hunk: "@@ -1 +1 @@", removed: "# Old\n", added: "# New\n" }]);
});

it("renders CSV files as a bounded review table", () => {
  expect(parseDelimitedText('name,value\n"hello, world",2\n').rows).toEqual([
    ["hello, world", "2"],
  ]);

  const html = renderToStaticMarkup(
    <CsvViewer
      file={{
        ...codeFile,
        path: "reports/results.csv",
        viewerKind: "text",
        content: "name,value\nok,true\n",
      }}
    />,
  );

  expect(html).toContain("reports/results.csv");
  expect(html).toContain("<th>name</th>");
  expect(html).toContain("<td>true</td>");
});

it("renders a bounded tree with a large-workspace hint", () => {
  const largeChildren = Array.from({ length: 1000 }, (_, index) => ({
    id: `src/file-${index}.ts`,
    path: `src/file-${index}.ts`,
    name: `file-${index}.ts`,
    kind: "file" as const,
    parentPath: "src",
    viewerKind: "code" as const,
  }));
  const html = renderToStaticMarkup(
    <TreeSidebar
      nodes={[
        {
          id: "src",
          path: "src",
          name: "src",
          kind: "directory",
          parentPath: null,
          children: largeChildren,
        },
      ]}
      selectedPath="src/file-999.ts"
      onSelect={() => undefined}
      onOpen={() => undefined}
    />,
  );

  expect(html).toContain("Rendering 801 of 1001 visible rows");
  expect(html).toContain("file-999.ts");
  expect(html).not.toContain("file-998.ts");
});

it("renders simple Mermaid flowcharts without script execution", () => {
  expect(parseMermaidEdges("graph TD\nA[Start] -->|ok| B[Done]")).toEqual([
    { from: "Start", label: "ok", to: "Done" },
  ]);
  expect(
    renderMermaidPreviewHtml('graph TD\nA["<Start>"] -->|<ok>| B[Done]', {
      idPrefix: "test",
    }),
  ).toContain("&lt;Start&gt;");

  const html = renderToStaticMarkup(
    <MermaidViewer
      file={{
        ...codeFile,
        path: "docs/flow.mmd",
        viewerKind: "mermaid",
        content: "graph TD\nA[Start] --> B[Done]\n",
      }}
    />,
  );

  expect(html).toContain("Safe Mermaid preview");
  expect(html).toContain("Start");
  expect(html).toContain("Done");
});
