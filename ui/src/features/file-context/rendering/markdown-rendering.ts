import { marked } from "marked";
import { escapeAttribute } from "../../../domain/mermaid-preview.js";
import { addRenderedCommentBlockIdsToHtml } from "../../../domain/rendered-comment-blocks.js";
import {
  markdownBodyLineOffset,
  renderMarkdownHtmlWithSourceRanges,
} from "../../../state/markdown-comment-blocks.js";
import {
  parseMarkdownFrontMatter,
  type FrontMatterEntry,
  type FrontMatterValue,
} from "../../../state/markdown-frontmatter.js";
import {
  extractMarkdownOutline,
  renderMarkdownHtmlWithHeadingIds,
} from "../../../state/outline.js";

export function renderMarkdownDocumentHtml(
  markdown: string,
  options: { commentBlocks?: boolean } = {},
): string {
  const frontMatter = parseMarkdownFrontMatter(markdown);
  const body = frontMatter.status === "none" ? markdown : frontMatter.body;
  const renderedBody =
    options.commentBlocks === false
      ? (marked.parse(injectMermaidPreviewBlocks(body)) as string)
      : renderMarkdownHtmlWithSourceRanges(
          body,
          markdownBodyLineOffset(markdown),
        );
  const html = renderMarkdownHtmlWithHeadingIds(
    renderedBody,
    extractMarkdownOutline(body),
  );
  const metadataHtml =
    frontMatter.status === "none" ? "" : renderFrontMatterPanel(frontMatter);
  const bodyHtml = enhanceMarkdownHtml(html);
  return (
    metadataHtml +
    (options.commentBlocks === false
      ? bodyHtml
      : addRenderedCommentBlockIdsToHtml(bodyHtml, {
          preserveSourceRanges: true,
        }))
  );
}

export function injectMermaidPreviewBlocks(markdown: string): string {
  return markdown.replace(
    /```(?:mermaid|mmd)\s*\n([\s\S]*?)```/gi,
    (_match, diagram: string) => {
      const source = `<details class="markdown-mermaid-source"><summary>Mermaid source</summary><pre><code>${escapeHtml(diagram.trim())}</code></pre></details>`;
      const sourceAttribute = escapeAttribute(diagram.trim());
      return `<figure class="markdown-mermaid" data-mermaid-status="pending" data-mermaid-source="${sourceAttribute}"><figcaption>Mermaid preview · strict security</figcaption><div class="mermaid-render-target"></div><div class="markdown-mermaid-fallback unsupported"><p>Mermaid preview is loading. Source is shown below if rendering fails.</p>${source}</div></figure>`;
    },
  );
}

function enhanceMarkdownHtml(html: string): string {
  return wrapTables(renderGitHubAlerts(html));
}

function wrapTables(html: string): string {
  return html.replace(
    /<table>([\s\S]*?)<\/table>/g,
    '<div class="markdown-table-wrap"><table>$1</table></div>',
  );
}

function renderGitHubAlerts(html: string): string {
  return html.replace(
    /<blockquote(\s[^>]*)?>\s*<p(?:\s[^>]*)?>\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](?:\n)?([\s\S]*?)<\/blockquote>/g,
    (_match, rawAttributes = "", rawKind: string, rawBody: string) => {
      const kind = rawKind.toLowerCase();
      const label = alertLabelForKind(kind);
      const body = rawBody
        .trim()
        .replace(/^<\/p>\s*/i, "")
        .trim();
      return `<aside class="markdown-callout ${kind}"${rawAttributes}><p class="markdown-callout-title">${label}</p>${alertBodyHtml(body)}</aside>`;
    },
  );
}

function renderFrontMatterPanel(
  frontMatter: Exclude<
    ReturnType<typeof parseMarkdownFrontMatter>,
    { status: "none" }
  >,
): string {
  if (frontMatter.status === "invalid") {
    return `<aside class="markdown-frontmatter invalid" aria-label="Front matter metadata"><div class="markdown-frontmatter-heading"><span>Metadata</span><small>Could not parse</small></div><p class="markdown-frontmatter-warning">${escapeHtml(frontMatter.error)}</p><pre>${escapeHtml(frontMatter.raw.trim())}</pre></aside>`;
  }
  const rows = frontMatter.entries.length
    ? frontMatter.entries.map(renderFrontMatterEntry).join("")
    : '<div class="markdown-frontmatter-empty">No metadata values.</div>';
  return `<aside class="markdown-frontmatter" aria-label="Front matter metadata"><div class="markdown-frontmatter-heading"><span>Metadata</span></div><dl>${rows}</dl></aside>`;
}

function renderFrontMatterEntry(entry: FrontMatterEntry): string {
  return `<div class="markdown-frontmatter-row"><dt>${escapeHtml(entry.key)}</dt><dd>${renderFrontMatterValue(entry.value)}</dd></div>`;
}

function renderFrontMatterValue(value: FrontMatterValue): string {
  if (Array.isArray(value)) {
    if (!value.length) return '<span class="frontmatter-muted">[]</span>';
    return `<div class="frontmatter-list">${value.map((item) => `<span>${renderFrontMatterValue(item)}</span>`).join("")}</div>`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value);
    if (!entries.length) return '<span class="frontmatter-muted">{}</span>';
    return `<dl class="frontmatter-nested">${entries.map(([key, nestedValue]) => `<div><dt>${escapeHtml(key)}</dt><dd>${renderFrontMatterValue(nestedValue)}</dd></div>`).join("")}</dl>`;
  }
  if (typeof value === "boolean") {
    return `<code class="frontmatter-boolean">${String(value)}</code>`;
  }
  if (value === null) return '<span class="frontmatter-muted">null</span>';
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}(?:[T\s].*)?$/.test(text)) {
    return `<time>${escapeHtml(text)}</time>`;
  }
  return escapeHtml(text);
}

function alertBodyHtml(body: string): string {
  if (!body) return "";
  if (body.startsWith("<")) return body;
  return body.endsWith("</p>") ? `<p>${body}` : `<p>${body}</p>`;
}

function alertLabelForKind(kind: string): string {
  if (kind === "tip") return "Tip";
  if (kind === "important") return "Important";
  if (kind === "warning") return "Warning";
  if (kind === "caution") return "Caution";
  return "Note";
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
