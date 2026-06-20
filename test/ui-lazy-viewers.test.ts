import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const fileViewerSource = readFileSync(
  new URL(
    "../ui/src/features/file-context/components/FileViewer.tsx",
    import.meta.url,
  ),
  "utf8",
);

it("keeps heavyweight file viewers out of the initial UI bundle", () => {
  expect(fileViewerSource).not.toMatch(
    /import\s+\{\s*(MarkdownViewer|HtmlViewer|CodeViewer|MermaidViewer)\s*\}\s+from\s+["']\.\.\/viewers\//,
  );
  expect(fileViewerSource).toContain('import("../viewers/MarkdownViewer.js")');
  expect(fileViewerSource).toContain('import("../viewers/HtmlViewer.js")');
  expect(fileViewerSource).toContain('import("../viewers/CodeViewer.js")');
  expect(fileViewerSource).toContain('import("../viewers/MermaidViewer.js")');
});
