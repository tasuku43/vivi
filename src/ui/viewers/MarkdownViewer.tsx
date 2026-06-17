import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { marked } from "marked";
import type { TextDiff } from "../../domain/change-review.js";
import type { FilePayload } from "../../domain/fs-node.js";
import { escapeAttribute } from "../../domain/mermaid-preview.js";
import {
  extractMarkdownOutline,
  renderMarkdownHtmlWithHeadingIds,
} from "../state/outline.js";
import {
  parseMarkdownFrontMatter,
  type FrontMatterEntry,
  type FrontMatterValue,
} from "../state/markdown-frontmatter.js";
import {
  lineRangeForQuote,
  renderedCommentDraft,
  scheduleSelectionCommentUpdate,
  selectionCommentTargetInElement,
  sourceCommentDraft,
  type CommentDraft,
} from "../state/comments.js";
import type { ResolvedTheme } from "../state/theme.js";
import type { ViewerMode } from "../state/viewer-mode.js";
import { SelectionCommentPopover } from "../components/SelectionCommentPopover.js";
import { DiffViewer } from "./DiffViewer.js";
import { renderMermaidBlocks } from "./MermaidViewer.js";

export function MarkdownViewer({
  file,
  mode: controlledMode,
  diff,
  diffLoading,
  diffEnabled,
  diffFocusChanges,
  theme = "dark",
  onModeChange,
  onDiffToggle,
  onDiffFocusChange,
  onCreateComment,
}: {
  file: FilePayload;
  mode?: ViewerMode;
  diff?: TextDiff | null;
  diffLoading?: boolean;
  diffEnabled?: boolean;
  diffFocusChanges?: boolean;
  theme?: ResolvedTheme;
  onModeChange?: (mode: ViewerMode) => void;
  onDiffToggle?: () => void;
  onDiffFocusChange?: (focusChanges: boolean) => void;
  onCreateComment?: (draft: CommentDraft) => void;
}) {
  const [localMode, setLocalMode] = useState<ViewerMode>("rendered");
  const [selectionComment, setSelectionComment] = useState<{
    draft: CommentDraft;
    left: number;
    top: number;
  } | null>(null);
  const mode =
    controlledMode === "source" || controlledMode === "rendered"
      ? controlledMode
      : localMode;
  const html = renderMarkdownDocumentHtml(file.content);
  const markdownRef = useRef<HTMLElement | null>(null);
  const sourceRef = useRef<HTMLPreElement | null>(null);
  const setMode = (nextMode: ViewerMode) => {
    setSelectionComment(null);
    setLocalMode(nextMode);
    onModeChange?.(nextMode);
  };
  const renderPendingMermaid = useCallback(() => {
    if (mode !== "rendered" || diffEnabled) return;
    const markdown = markdownRef.current;
    if (!markdown) return;
    renderMermaidBlocks(markdown, theme);
  }, [diffEnabled, mode, theme]);
  const attachMarkdownRef = useCallback(
    (node: HTMLElement | null) => {
      markdownRef.current = node;
      if (!node) return;
      window.requestAnimationFrame(() => {
        if (markdownRef.current === node) renderPendingMermaid();
      });
    },
    [html, renderPendingMermaid],
  );
  const updateRenderedSelectionComment = () => {
    const selection = selectionCommentTargetInElement(markdownRef.current);
    if (!selection) {
      setSelectionComment(null);
      return;
    }
    const range = lineRangeForQuote(file.content, selection.text);
    setSelectionComment({
      draft: renderedCommentDraft(file, "markdown", {
        text: selection.text,
        sourceLineStart: range?.start,
        sourceLineEnd: range?.end,
      }),
      left: selection.rect.left + selection.rect.width / 2,
      top: selection.rect.top,
    });
  };
  const updateSourceSelectionComment = () => {
    const selection = selectionCommentTargetInElement(sourceRef.current);
    if (!selection) {
      setSelectionComment(null);
      return;
    }
    setSelectionComment({
      draft: sourceCommentDraft(
        file,
        lineRangeForQuote(file.content, selection.text),
        selection.text,
      ),
      left: selection.rect.left + selection.rect.width / 2,
      top: selection.rect.top,
    });
  };

  useLayoutEffect(() => {
    renderPendingMermaid();
  });

  useEffect(() => {
    renderPendingMermaid();
    const timeout = window.setTimeout(renderPendingMermaid, 0);
    return () => window.clearTimeout(timeout);
  });

  return (
    <section className="document-viewer">
      <div className="viewer-toolbar">
        <strong>{file.path}</strong>
        <div className="viewer-toolbar-actions">
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
          <button
            aria-pressed={Boolean(diffEnabled)}
            className={`diff-toggle${diffEnabled ? " active" : ""}`}
            type="button"
            onClick={onDiffToggle}
          >
            Diff from HEAD
          </button>
        </div>
      </div>
      {diffEnabled ? (
        <DiffViewer
          path={file.path}
          diff={diff ?? null}
          loading={diffLoading}
          focusChanges={diffFocusChanges}
          renderKind={mode === "source" ? "source" : "markdown"}
          theme={theme}
          onFocusChangesChange={onDiffFocusChange}
          onCreateComment={onCreateComment}
          file={file}
        />
      ) : mode === "rendered" ? (
        <article
          className="markdown markdown-document"
          ref={attachMarkdownRef}
          onMouseUp={() =>
            scheduleSelectionCommentUpdate(updateRenderedSelectionComment)
          }
          onKeyUp={updateRenderedSelectionComment}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <pre
          className="markdown-source"
          ref={sourceRef}
          onMouseUp={() =>
            scheduleSelectionCommentUpdate(updateSourceSelectionComment)
          }
          onKeyUp={updateSourceSelectionComment}
        >
          {file.content}
        </pre>
      )}
      <SelectionCommentPopover
        draft={selectionComment?.draft ?? null}
        left={selectionComment?.left ?? 0}
        top={selectionComment?.top ?? 0}
        onCreateComment={onCreateComment}
        onDismiss={() => setSelectionComment(null)}
      />
    </section>
  );
}

export function renderMarkdownDocumentHtml(markdown: string): string {
  const frontMatter = parseMarkdownFrontMatter(markdown);
  const body = frontMatter.status === "none" ? markdown : frontMatter.body;
  const markdownWithSafeDiagrams = injectMermaidPreviewBlocks(body);
  const html = renderMarkdownHtmlWithHeadingIds(
    marked.parse(markdownWithSafeDiagrams) as string,
    extractMarkdownOutline(body),
  );
  const metadataHtml =
    frontMatter.status === "none" ? "" : renderFrontMatterPanel(frontMatter);
  return metadataHtml + enhanceMarkdownHtml(html);
}

export function injectMermaidPreviewBlocks(markdown: string): string {
  let index = 0;
  return markdown.replace(
    /```(?:mermaid|mmd)\s*\n([\s\S]*?)```/gi,
    (_match, diagram: string) => {
      const source = `<details class="markdown-mermaid-source"><summary>Mermaid source</summary><pre><code>${escapeHtml(diagram.trim())}</code></pre></details>`;
      const sourceAttribute = escapeAttribute(diagram.trim());
      index += 1;
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

function renderFrontMatterPanel(
  frontMatter: Exclude<
    ReturnType<typeof parseMarkdownFrontMatter>,
    { status: "none" }
  >,
): string {
  if (frontMatter.status === "invalid") {
    return `<aside class="markdown-frontmatter invalid" aria-label="Front matter metadata"><div class="markdown-frontmatter-heading"><span>Metadata</span><small>Could not parse</small></div><p class="markdown-frontmatter-warning">${escapeHtml(frontMatter.error)}</p><pre>${escapeHtml(frontMatter.raw.trim())}</pre></aside>`;
  }

  const rows =
    frontMatter.entries.length > 0
      ? frontMatter.entries.map(renderFrontMatterEntry).join("")
      : '<div class="markdown-frontmatter-empty">No metadata values.</div>';
  return `<aside class="markdown-frontmatter" aria-label="Front matter metadata"><div class="markdown-frontmatter-heading"><span>Metadata</span></div><dl>${rows}</dl></aside>`;
}

function renderFrontMatterEntry(entry: FrontMatterEntry): string {
  return `<div class="markdown-frontmatter-row"><dt>${escapeHtml(entry.key)}</dt><dd>${renderFrontMatterValue(entry.value)}</dd></div>`;
}

function renderFrontMatterValue(value: FrontMatterValue): string {
  if (Array.isArray(value)) {
    if (value.length === 0) return '<span class="frontmatter-muted">[]</span>';
    return `<div class="frontmatter-list">${value
      .map((item) => `<span>${renderFrontMatterValue(item)}</span>`)
      .join("")}</div>`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value);
    if (entries.length === 0)
      return '<span class="frontmatter-muted">{}</span>';
    return `<dl class="frontmatter-nested">${entries
      .map(
        ([key, nestedValue]) =>
          `<div><dt>${escapeHtml(key)}</dt><dd>${renderFrontMatterValue(nestedValue)}</dd></div>`,
      )
      .join("")}</dl>`;
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
