import { useState } from "react";
import { marked } from "marked";
import type { FilePayload } from "../../domain/fs-node.js";
import {
  extractMarkdownOutline,
  renderMarkdownHtmlWithHeadingIds,
} from "../state/outline.js";
import type { ViewerMode } from "../state/viewer-mode.js";
import { renderMermaidPreviewHtml } from "./MermaidViewer.js";

export function MarkdownViewer({
  file,
  mode: controlledMode,
  onModeChange,
}: {
  file: FilePayload;
  mode?: ViewerMode;
  onModeChange?: (mode: ViewerMode) => void;
}) {
  const [localMode, setLocalMode] = useState<"rendered" | "source">("rendered");
  const mode =
    controlledMode === "source" || controlledMode === "rendered"
      ? controlledMode
      : localMode;
  const html = renderMarkdownDocumentHtml(file.content);
  const setMode = (nextMode: "rendered" | "source") => {
    setLocalMode(nextMode);
    onModeChange?.(nextMode);
  };
  return (
    <section className="document-viewer">
      <div className="viewer-toolbar">
        <strong>{file.path}</strong>
        <div className="segmented-control" aria-label="Markdown view mode">
          <button
            className={mode === "rendered" ? "active" : ""}
            type="button"
            onClick={() => setMode("rendered")}
          >
            Rendered
          </button>
          <button
            className={mode === "source" ? "active" : ""}
            type="button"
            onClick={() => setMode("source")}
          >
            Source
          </button>
        </div>
      </div>
      {mode === "rendered" ? (
        <article
          className="markdown markdown-document"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <pre className="markdown-source">{file.content}</pre>
      )}
    </section>
  );
}

export function renderMarkdownDocumentHtml(markdown: string): string {
  const markdownWithSafeDiagrams = injectMermaidPreviewBlocks(markdown);
  const html = renderMarkdownHtmlWithHeadingIds(
    marked.parse(markdownWithSafeDiagrams) as string,
    extractMarkdownOutline(markdown),
  );
  return enhanceMarkdownHtml(html);
}

export function injectMermaidPreviewBlocks(markdown: string): string {
  let index = 0;
  return markdown.replace(
    /```(?:mermaid|mmd)\s*\n([\s\S]*?)```/gi,
    (_match, diagram: string) => {
      const preview = renderMermaidPreviewHtml(diagram, {
        idPrefix: `pathlens-md-mermaid-${index}`,
        title: `Mermaid diagram ${index + 1}`,
      });
      const source = `<details class="markdown-mermaid-source"><summary>Mermaid source</summary><pre><code>${escapeHtml(diagram.trim())}</code></pre></details>`;
      index += 1;
      if (!preview) {
        return `<div class="markdown-mermaid unsupported"><p>Mermaid preview supports simple flowchart arrows. Source is shown below.</p>${source}</div>`;
      }
      return `<figure class="markdown-mermaid"><figcaption>Safe Mermaid preview · scripts inactive</figcaption>${preview}${source}</figure>`;
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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
