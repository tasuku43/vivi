import { describe, expect, it } from "vitest";
import {
  injectMermaidPreviewBlocks,
  renderMarkdownDocumentHtml,
} from "../src/ui/viewers/MarkdownViewer.js";

describe("renderMarkdownDocumentHtml", () => {
  it("keeps heading ids and wraps tables for the reader view", () => {
    const html = renderMarkdownDocumentHtml(`# Title

| Key | Value |
| --- | ----- |
| API | stable |
`);

    expect(html).toContain('<h1 id="title">Title</h1>');
    expect(html).toContain('<div class="markdown-table-wrap"><table>');
    expect(html).toContain("<td>stable</td>");
  });

  it("renders GitHub alert blockquotes as document callouts", () => {
    const html = renderMarkdownDocumentHtml(`> [!WARNING]
> Check paths before serving files.`);

    expect(html).toContain('<aside class="markdown-callout warning">');
    expect(html).toContain('<p class="markdown-callout-title">Warning</p>');
    expect(html).toContain("Check paths before serving files.");
  });

  it("renders Mermaid fences as safe inline previews with source fallback", () => {
    const html = renderMarkdownDocumentHtml(`# Report

\`\`\`mermaid
graph TD
A[Start] -->|ok| B[Done]
\`\`\`
`);

    expect(html).toContain("Safe Mermaid preview · scripts inactive");
    expect(html).toContain('class="mermaid-svg"');
    expect(html).toContain("Start");
    expect(html).toContain("Done");
    expect(html).toContain("<summary>Mermaid source</summary>");
  });

  it("escapes unsupported Mermaid source in Markdown fallback blocks", () => {
    const html = injectMermaidPreviewBlocks(`\`\`\`mermaid
sequenceDiagram
Alice->>Bob: <script>alert(1)</script>
\`\`\``);

    expect(html).toContain("Mermaid preview supports simple flowchart arrows");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
  });
});
