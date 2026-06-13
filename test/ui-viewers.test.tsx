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
      gitReview={{
        available: true,
        changes: [{ path: "src/app.ts", status: "modified" }],
      }}
      diffBases={{
        available: true,
        options: [
          { ref: "HEAD", label: "HEAD", subject: "current" },
          { ref: "abc123", label: "HEAD~1", subject: "previous" },
        ],
      }}
      activeDiffBase="HEAD"
      reviewChanges={[
        { path: "src/app.ts", status: "modified", source: "git" },
      ]}
      activeDiff={{
        path: "src/app.ts",
        status: "available",
        baseLabel: "HEAD",
        compareLabel: "working tree",
        content: "@@ -1 +1 @@\n-old\n+new",
      }}
      selectedCodeRange={{ start: 2, end: 2 }}
      activePaneId="main"
      reviewTargets={[
        {
          id: "reports/index.html",
          path: "reports/index.html",
          name: "index.html",
          kind: "file",
          parentPath: null,
          viewerKind: "html",
        },
      ]}
      onOutlineSelect={() => undefined}
      onOpenEventPath={() => undefined}
      onOpenAllChanged={() => undefined}
      onShowDiff={() => undefined}
      onSelectDiffBase={() => undefined}
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
  expect(html).toContain("diff-line remove");
  expect(html).toContain(">old</code>");
  expect(html).toContain("diff-line add");
  expect(html).toContain("Compare from");
  expect(html).toContain("HEAD~1");
  expect(html).toContain("Recent events");
  expect(html).toContain("Changed");
  expect(html).toContain("Review targets");
  expect(html).toContain("reports/index.html");
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
  const html = renderToStaticMarkup(
    <TreeSidebar
      nodes={[
        {
          id: "src",
          path: "src",
          name: "src",
          kind: "directory",
          parentPath: null,
          children: Array.from({ length: 400 }, (_, index) => ({
            id: `src/file-${index}.ts`,
            path: `src/file-${index}.ts`,
            name: `file-${index}.ts`,
            kind: "file" as const,
            parentPath: "src",
            viewerKind: "code" as const,
          })),
        },
      ]}
      selectedPath={null}
      onSelect={() => undefined}
    />,
  );

  expect(html).toContain("Showing 1 of 401 rows");
  expect(html).toContain("Expand folders as needed");
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
