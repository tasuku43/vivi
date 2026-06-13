import { marked } from "marked";
import type { FilePayload } from "../../domain/fs-node.js";
import {
  extractMarkdownOutline,
  renderMarkdownHtmlWithHeadingIds,
} from "../state/outline.js";

export function MarkdownViewer({ file }: { file: FilePayload }) {
  const html = renderMarkdownDocumentHtml(file.content);
  return (
    <article
      className="markdown markdown-document"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export function renderMarkdownDocumentHtml(markdown: string): string {
  const html = renderMarkdownHtmlWithHeadingIds(
    marked.parse(markdown) as string,
    extractMarkdownOutline(markdown),
  );
  return enhanceMarkdownHtml(html);
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
    /<blockquote>\s*<p>\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](?:\n)?([\s\S]*?)<\/blockquote>/g,
    (_match, rawKind: string, rawBody: string) => {
      const kind = rawKind.toLowerCase();
      const label = alertLabelForKind(kind);
      const body = rawBody
        .trim()
        .replace(/^<\/p>\s*/i, "")
        .trim();
      const bodyHtml = alertBodyHtml(body);
      return `<aside class="markdown-callout ${kind}"><p class="markdown-callout-title">${label}</p>${bodyHtml}</aside>`;
    },
  );
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
