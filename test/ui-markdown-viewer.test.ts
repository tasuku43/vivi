import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  injectMermaidPreviewBlocks,
  renderMarkdownDocumentHtml,
} from "../src/ui/viewers/MarkdownViewer.js";

describe("renderMarkdownDocumentHtml", () => {
  const fixture = (name: string) =>
    readFileSync(
      new URL(`./fixtures/markdown-frontmatter/${name}`, import.meta.url),
      "utf8",
    );

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

  it("renders front matter as a quiet metadata panel and removes it from the body", () => {
    const html = renderMarkdownDocumentHtml(fixture("basic.md"));

    expect(html).toContain('class="markdown-frontmatter"');
    expect(html).toContain("<span>Metadata</span>");
    expect(html).toContain("<dt>title</dt>");
    expect(html).toContain("<dd>Example</dd>");
    expect(html).toContain("<time>2026-06-17</time>");
    expect(html).toContain('<code class="frontmatter-boolean">false</code>');
    expect(html).toContain("note");
    expect(html).toContain("draft");
    expect(html).toContain('<h1 id="body-heading">Body Heading</h1>');
    expect(html).toContain("The Markdown body starts here.");
    expect(html).not.toContain("<hr");
    expect(html).not.toContain(">---<");
  });

  it("leaves Markdown without front matter on the existing render path", () => {
    const html = renderMarkdownDocumentHtml(fixture("no-frontmatter.md"));

    expect(html).toContain('<h1 id="plain-markdown">Plain Markdown</h1>');
    expect(html).toContain("This document has no front matter");
    expect(html).not.toContain("markdown-frontmatter");
  });

  it("keeps array, nested, and long values inside readable metadata markup", () => {
    const arrayHtml = renderMarkdownDocumentHtml(fixture("array.md"));
    const nestedHtml = renderMarkdownDocumentHtml(fixture("nested.md"));
    const longHtml = renderMarkdownDocumentHtml(fixture("long-string.md"));

    expect(arrayHtml).toContain('class="frontmatter-list"');
    expect(arrayHtml).toContain("release-candidate");
    expect(nestedHtml).toContain('class="frontmatter-nested"');
    expect(nestedHtml).toContain("<dt>owner</dt>");
    expect(nestedHtml).toContain("<dt>active</dt>");
    expect(longHtml).toContain("deliberately long metadata value");
    expect(longHtml).toContain('<h1 id="long-values">Long Values</h1>');
  });

  it("shows malformed front matter as a warning panel without crashing the viewer", () => {
    const html = renderMarkdownDocumentHtml(fixture("broken.md"));

    expect(html).toContain('class="markdown-frontmatter invalid"');
    expect(html).toContain("Could not parse");
    expect(html).toContain("Missing closing front matter delimiter.");
    expect(html).toContain("Broken Example");
    expect(html).not.toContain("<hr");
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

    expect(html).toContain("Mermaid preview · strict security");
    expect(html).toContain("data-mermaid-source=");
    expect(html).toContain('class="mermaid-render-target"');
    expect(html).toContain("Start");
    expect(html).toContain("Done");
    expect(html).toContain("<summary>Mermaid source</summary>");
  });

  it("escapes unsupported Mermaid source in Markdown fallback blocks", () => {
    const html = injectMermaidPreviewBlocks(`\`\`\`mermaid
sequenceDiagram
Alice->>Bob: <script>alert(1)</script>
\`\`\``);

    expect(html).toContain("Mermaid preview is loading");
    expect(html).toContain("data-mermaid-source=");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
  });
});
