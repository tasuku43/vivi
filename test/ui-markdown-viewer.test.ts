import { describe, expect, it } from "vitest";
import { renderMarkdownDocumentHtml } from "../src/ui/viewers/MarkdownViewer.js";

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
});
