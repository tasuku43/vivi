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

it("renders code metadata and actionable review events in the inspector", () => {
  const html = renderToStaticMarkup(
    <Inspector
      file={codeFile}
      outline={[]}
      events={[
        {
          id: "2:change:src/app.ts:10",
          event: { type: "change", path: "src/app.ts", version: 2 },
          receivedAt: 10,
        },
      ]}
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
      onOpenAllChanged={() => undefined}
      onShowDiff={() => undefined}
      onTargetHoverChange={() => undefined}
      onRevealTarget={() => undefined}
    />,
  );

  expect(html).toContain("Code inspector");
  expect(html).toContain("src/app.ts:2");
  expect(html).toContain("export");
  expect(html).toContain("start");
  expect(html).toContain("Changed files");
  expect(html).toContain("Git working tree");
  expect(html).toContain("docs/old.md -&gt; docs/new.md");
  expect(html).toContain("Recent events");
  expect(html).toContain("Changed");
  expect(html).not.toContain("Review targets");
  expect(html).not.toContain("Diff preview");
});

it("renders HEAD diffs inside the file viewer surface", () => {
  const html = renderToStaticMarkup(
    <DiffViewer
      path="README.md"
      renderKind="markdown"
      sourceMode="rendered"
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
  expect(html).toContain("rendered-diff-pane removed");
  expect(html).toContain("rendered-diff-pane added");
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
