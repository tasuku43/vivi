import type { TextDiff } from "../../domain/change-review.js";
import {
  buildSideBySideDiffRows,
  diffStatusLabel,
  parseUnifiedDiff,
  type ParsedDiffLine,
  type SideBySideDiffRow,
} from "../state/git-review.js";
import type { ViewerMode } from "../state/viewer-mode.js";
import { renderMarkdownDocumentHtml } from "./MarkdownViewer.js";

type RenderKind = "source" | "markdown" | "html";

export function DiffViewer({
  path,
  diff,
  loading,
  renderKind,
  sourceMode,
  onModeChange,
  onReload,
}: {
  path: string;
  diff: TextDiff | null;
  loading?: boolean;
  renderKind: RenderKind;
  sourceMode: ViewerMode;
  onModeChange?: (mode: ViewerMode) => void;
  onReload?: () => void;
}) {
  return (
    <section className="diff-viewer" aria-label={`Diff from HEAD for ${path}`}>
      <div className="viewer-toolbar">
        <strong>{path}</strong>
        <div className="viewer-toolbar-actions">
          <button type="button" onClick={onReload} disabled={loading}>
            Refresh diff
          </button>
          <div className="segmented-control" aria-label="Viewer mode">
            <button type="button" onClick={() => onModeChange?.(sourceMode)}>
              {sourceMode === "preview"
                ? "Preview"
                : sourceMode === "rendered"
                  ? "Rendered"
                  : "Source"}
            </button>
            <button className="active" type="button">
              Diff from HEAD
            </button>
          </div>
        </div>
      </div>
      <div className="diff-viewer-status">
        <span>Status</span>
        <strong>{loading ? "Loading diff..." : diffStatusLabel(diff)}</strong>
      </div>
      {diff?.reason ? <p className="muted">{diff.reason}</p> : null}
      {diff?.status === "available" ? (
        renderKind === "source" ? (
          <SourceDiff diff={diff} />
        ) : (
          <RenderedDiff diff={diff} renderKind={renderKind} />
        )
      ) : null}
    </section>
  );
}

function SourceDiff({ diff }: { diff: TextDiff }) {
  const splitDiffRows = buildSideBySideDiffRows(parseUnifiedDiff(diff.content));
  return (
    <div
      className="diff-preview diff-split"
      aria-label={`Diff for ${diff.path}`}
    >
      <div className="diff-split-head" aria-hidden="true">
        <span>{diff.baseLabel}</span>
        <span>{diff.compareLabel}</span>
      </div>
      {splitDiffRows.map((line, index) =>
        isFullWidthDiffRow(line) ? (
          <div
            className={`diff-split-full ${line.kind}`}
            key={`${line.kind}-${index}-${line.text}`}
          >
            <code>{line.text}</code>
          </div>
        ) : (
          <div
            className={`diff-split-row ${line.kind}`}
            key={`${line.kind}-${index}-${line.oldLine ?? ""}-${line.newLine ?? ""}`}
          >
            <span className="diff-line-no old">{line.oldLine ?? ""}</span>
            <code className="old">{line.oldText ?? ""}</code>
            <span className="diff-line-no new">{line.newLine ?? ""}</span>
            <code className="new">{line.newText ?? ""}</code>
          </div>
        ),
      )}
    </div>
  );
}

function RenderedDiff({
  diff,
  renderKind,
}: {
  diff: TextDiff;
  renderKind: Exclude<RenderKind, "source">;
}) {
  const blocks = buildRenderedDiffBlocks(parseUnifiedDiff(diff.content));
  if (!blocks.length) {
    return <p className="muted">No rendered changes are available.</p>;
  }

  return (
    <div
      className="rendered-diff"
      aria-label={`Rendered diff for ${diff.path}`}
    >
      <div className="rendered-diff-head" aria-hidden="true">
        <span>{diff.baseLabel}</span>
        <span>{diff.compareLabel}</span>
      </div>
      {blocks.map((block, index) => (
        <div className="rendered-diff-block" key={`${block.hunk}-${index}`}>
          <div className="rendered-diff-hunk">{block.hunk}</div>
          <RenderedDiffPane
            className="removed"
            emptyLabel="No removed rendered content"
            renderKind={renderKind}
            source={block.removed}
          />
          <RenderedDiffPane
            className="added"
            emptyLabel="No added rendered content"
            renderKind={renderKind}
            source={block.added}
          />
        </div>
      ))}
    </div>
  );
}

function RenderedDiffPane({
  className,
  emptyLabel,
  renderKind,
  source,
}: {
  className: "added" | "removed";
  emptyLabel: string;
  renderKind: Exclude<RenderKind, "source">;
  source: string;
}) {
  if (!source.trim()) {
    return (
      <div className={`rendered-diff-pane ${className} empty`}>
        {emptyLabel}
      </div>
    );
  }

  if (renderKind === "markdown") {
    return (
      <article
        className={`markdown markdown-document rendered-diff-pane ${className}`}
        dangerouslySetInnerHTML={{
          __html: renderMarkdownDocumentHtml(source),
        }}
      />
    );
  }

  return (
    <iframe
      className={`rendered-diff-frame rendered-diff-pane ${className}`}
      sandbox=""
      srcDoc={htmlSnippetDocument(source)}
      title={`${className} HTML diff preview`}
    />
  );
}

interface RenderedDiffBlock {
  hunk: string;
  removed: string;
  added: string;
}

export function buildRenderedDiffBlocks(
  lines: ParsedDiffLine[],
): RenderedDiffBlock[] {
  const blocks: RenderedDiffBlock[] = [];
  let current: RenderedDiffBlock | null = null;

  for (const line of lines) {
    if (line.kind === "hunk") {
      current = { hunk: line.text, removed: "", added: "" };
      blocks.push(current);
      continue;
    }
    if (line.kind === "meta") continue;
    current ??= { hunk: "Changed content", removed: "", added: "" };
    if (!blocks.includes(current)) blocks.push(current);
    if (line.kind === "remove") current.removed += `${line.text}\n`;
    if (line.kind === "add") current.added += `${line.text}\n`;
  }

  return blocks.filter((block) => block.removed.trim() || block.added.trim());
}

function htmlSnippetDocument(source: string): string {
  return `<!doctype html><html><head><base target="_blank"><style>body{margin:0;padding:12px;font:14px system-ui,sans-serif;line-height:1.55;color:#1f2937;background:white}img,video{max-width:100%;height:auto}pre{white-space:pre-wrap}</style></head><body>${source}</body></html>`;
}

function isFullWidthDiffRow(
  line: SideBySideDiffRow,
): line is Extract<SideBySideDiffRow, { kind: "meta" | "hunk" }> {
  return line.kind === "meta" || line.kind === "hunk";
}
