import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  injectMermaidPreviewBlocks,
  renderMarkdownDocumentHtml,
} from "../ui/src/features/file-context/viewers/MarkdownViewer.js";
import { isSafeSvgReference } from "../ui/src/features/file-context/rendering/mermaid-rendering.js";

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

    expect(html).toContain('<h1 id="title"');
    expect(html).toContain('data-vivi-comment-block-id="vivi-block-1"');
    expect(html).toContain('<div class="markdown-table-wrap"><table>');
    expect(html).toContain('data-vivi-source-line-start="3"');
    expect(html).toContain('data-vivi-source-line-start="5"');
    expect(html).toContain("<td>stable</td>");
  });

  it("maps formatted document blocks back to canonical source lines", () => {
    const html = renderMarkdownDocumentHtml(`# **Title**

Paragraph with **bold text**
continued on another line.

- first item
- second item

\`\`\`ts
const value = 1;
\`\`\`
`);

    expect(html).toMatch(
      /<h1[^>]*data-vivi-source-line-start="1"[^>]*data-vivi-source-line-end="1"/,
    );
    expect(html).toMatch(
      /<p[^>]*data-vivi-source-line-start="3"[^>]*data-vivi-source-line-end="4"/,
    );
    expect(html).toMatch(
      /<li[^>]*data-vivi-source-line-start="6"[^>]*data-vivi-source-line-end="6"/,
    );
    expect(html).toMatch(
      /<li[^>]*data-vivi-source-line-start="7"[^>]*data-vivi-source-line-end="7"/,
    );
    expect(html).toMatch(
      /<pre[^>]*data-vivi-source-line-start="9"[^>]*data-vivi-source-line-end="11"/,
    );
  });

  it("keeps source ranges on raw HTML blocks inside Markdown", () => {
    const html = renderMarkdownDocumentHtml(`# Title

<section>
  <p>Embedded HTML</p>
</section>
`);

    expect(html).toMatch(
      /<p[^>]*data-vivi-source-line-start="4"[^>]*data-vivi-source-line-end="4"/,
    );
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
    expect(html).toContain('<h1 id="body-heading"');
    expect(html).toContain("The Markdown body starts here.");
    expect(html).not.toContain("<hr");
    expect(html).not.toContain(">---<");
  });

  it("leaves Markdown without front matter on the existing render path", () => {
    const html = renderMarkdownDocumentHtml(fixture("no-frontmatter.md"));

    expect(html).toContain('<h1 id="plain-markdown"');
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
    expect(longHtml).toContain('<h1 id="long-values"');
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

    expect(html).toContain('<aside class="markdown-callout warning"');
    expect(html).toContain('<p class="markdown-callout-title"');
    expect(html).toContain(">Warning</p>");
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

  it("rejects unsafe URL schemes in rendered Mermaid SVG links", () => {
    expect(isSafeSvgReference("https://example.test/diagram")).toBe(true);
    expect(isSafeSvgReference("#node-id")).toBe(true);
    expect(isSafeSvgReference("relative/path.svg")).toBe(true);
    expect(isSafeSvgReference("javascript:alert(1)")).toBe(false);
    expect(isSafeSvgReference("data:text/html,<script>x</script>")).toBe(false);
    expect(isSafeSvgReference("vbscript:msgbox(1)")).toBe(false);
  });
});
