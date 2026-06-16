import { useEffect, useMemo, useRef, useState } from "react";
import type { TextDiff } from "../../domain/change-review.js";
import type { PathlensComment } from "../../domain/comments.js";
import type { FilePayload } from "../../domain/fs-node.js";
import {
  diffStatusLabel,
  parseUnifiedDiff,
  type ParsedDiffLine,
} from "../state/git-review.js";
import {
  commentsForLine,
  diffCommentDraft,
  rectLikeFromElement,
  scheduleSelectionCommentUpdate,
  type CommentCreateHandler,
  type CommentDraft,
} from "../state/comments.js";
import { languageForPath } from "../state/file-icons.js";
import type { ResolvedTheme } from "../state/theme.js";
import { SelectionCommentComposer } from "../components/SelectionCommentComposer.js";
import { renderMarkdownDocumentHtml } from "./MarkdownViewer.js";

type RenderKind = "source" | "markdown" | "html";
type VisibleDiffLine = ParsedDiffLine & {
  kind: "context" | "add" | "remove";
};
type SourceDiffRow = VisibleDiffLine | DiffGapRow;
interface DiffGapRow {
  kind: "gap";
  text: string;
}

export function DiffViewer({
  path,
  diff,
  loading,
  focusChanges: controlledFocusChanges,
  renderKind,
  theme = "dark",
  file,
  onFocusChangesChange,
  onCreateComment,
  comments = [],
  activeCommentId,
  onOpenComment,
}: {
  path: string;
  diff: TextDiff | null;
  loading?: boolean;
  focusChanges?: boolean;
  renderKind: RenderKind;
  theme?: ResolvedTheme;
  file?: FilePayload;
  onFocusChangesChange?: (focusChanges: boolean) => void;
  onCreateComment?: CommentCreateHandler;
  comments?: PathlensComment[];
  activeCommentId?: string | null;
  onOpenComment?: (id: string, rect: DOMRectLike) => void;
}) {
  const [localFocusChanges, setLocalFocusChanges] = useState(false);
  const focusChanges = controlledFocusChanges ?? localFocusChanges;
  const setFocusChanges = (nextFocusChanges: boolean) => {
    setLocalFocusChanges(nextFocusChanges);
    onFocusChangesChange?.(nextFocusChanges);
  };
  return (
    <section className="diff-viewer" aria-label={`Diff from HEAD for ${path}`}>
      <div className="diff-viewer-status">
        <div className="diff-viewer-status-main">
          <span>Status</span>
          <strong>{loading ? "Loading diff..." : diffStatusLabel(diff)}</strong>
        </div>
        {diff?.status === "available" ? (
          <label className="diff-focus-toggle">
            <input
              checked={focusChanges}
              type="checkbox"
              onChange={(event) => setFocusChanges(event.currentTarget.checked)}
            />
            <span>Focus changes</span>
          </label>
        ) : null}
      </div>
      {diff?.reason ? <p className="muted">{diff.reason}</p> : null}
      {diff?.status === "available" ? (
        renderKind === "source" ? (
          <SourceDiff
            diff={diff}
            focusChanges={focusChanges}
            theme={theme}
            file={file}
            onCreateComment={onCreateComment}
            comments={comments}
            activeCommentId={activeCommentId}
            onOpenComment={onOpenComment}
          />
        ) : (
          <RenderedDiff
            diff={diff}
            focusChanges={focusChanges}
            renderKind={renderKind}
            file={file}
            onCreateComment={onCreateComment}
            comments={comments}
            activeCommentId={activeCommentId}
            onOpenComment={onOpenComment}
          />
        )
      ) : null}
    </section>
  );
}

function SourceDiff({
  diff,
  focusChanges,
  theme,
  file,
  onCreateComment,
  comments,
  activeCommentId,
  onOpenComment,
}: {
  diff: TextDiff;
  focusChanges: boolean;
  theme: ResolvedTheme;
  file?: FilePayload;
  onCreateComment?: CommentCreateHandler;
  comments: PathlensComment[];
  activeCommentId?: string | null;
  onOpenComment?: (id: string, rect: DOMRectLike) => void;
}) {
  const diffRef = useRef<HTMLDivElement | null>(null);
  const [selectionComment, setSelectionComment] = useState<{
    draft: CommentDraft;
    rect: DOMRectLike;
  } | null>(null);
  const language = languageForPath(diff.path, "code");
  const lines = useMemo(
    () =>
      parseUnifiedDiff(diff.content).filter(
        (line) => line.kind !== "meta" && line.kind !== "hunk",
      ) as VisibleDiffLine[],
    [diff.content],
  );
  const displayLines = useMemo(
    () => (focusChanges ? buildFocusedSourceDiffRows(lines) : lines),
    [focusChanges, lines],
  );
  const [highlightedLines, setHighlightedLines] = useState<string[] | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;
    setHighlightedLines(null);
    import("../state/highlighter.js")
      .then(({ highlightCode }) =>
        highlightCode(
          displayLines.map((line) => line.text || " ").join("\n"),
          language,
          theme,
        ),
      )
      .then((html) => {
        if (!cancelled) setHighlightedLines(extractHighlightedLines(html));
      })
      .catch(() => {
        if (!cancelled) setHighlightedLines(null);
      });
    return () => {
      cancelled = true;
    };
  }, [diff.content, displayLines, language, theme]);

  useEffect(() => {
    if (!activeCommentId) return;
    const marker = diffRef.current?.querySelector<HTMLElement>(
      `[data-comment-id="${CSS.escape(activeCommentId)}"]`,
    );
    if (!marker) return;
    marker.scrollIntoView({ block: "center", behavior: "smooth" });
    window.requestAnimationFrame(() => {
      onOpenComment?.(activeCommentId, rectLikeFromElement(marker));
    });
  }, [activeCommentId, comments, onOpenComment]);

  const updateSelectionComment = () => {
    if (!file || !diffRef.current) return;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      setSelectionComment(null);
      return;
    }
    const text = selection.toString().trim();
    if (!text) {
      setSelectionComment(null);
      return;
    }
    const range = selection.getRangeAt(0);
    if (!diffRef.current.contains(range.commonAncestorContainer)) {
      setSelectionComment(null);
      return;
    }
    const selectedRows = Array.from(
      diffRef.current.querySelectorAll<HTMLElement>("[data-current-line]"),
    ).filter((row) => range.intersectsNode(row));
    if (!selectedRows.length) {
      setSelectionComment(null);
      return;
    }
    const lineNumbers = selectedRows
      .map((row) => Number(row.dataset.currentLine))
      .filter((line) => Number.isSafeInteger(line));
    if (!lineNumbers.length) {
      setSelectionComment(null);
      return;
    }
    const changeKind = selectedRows.some(
      (row) => row.dataset.changeKind === "added",
    )
      ? "added"
      : "context";
    setSelectionComment({
      draft: diffCommentDraft(
        file,
        Math.min(...lineNumbers),
        Math.max(...lineNumbers),
        changeKind,
        text,
      ),
      rect: rectFromRange(range),
    });
  };

  return (
    <div
      ref={diffRef}
      className="diff-preview diff-inline"
      aria-label={`Diff for ${diff.path}`}
      onMouseUp={() => scheduleSelectionCommentUpdate(updateSelectionComment)}
      onKeyUp={updateSelectionComment}
    >
      {displayLines.map((line, index) => (
        <SourceDiffLine
          key={`${line.kind}-${index}-${"oldLine" in line ? (line.oldLine ?? "") : ""}-${"newLine" in line ? (line.newLine ?? "") : ""}-${line.text}`}
          line={line}
          html={highlightedLines?.[index] ?? escapeHtml(line.text || " ")}
          comments={comments}
          onOpenComment={onOpenComment}
        />
      ))}
      <SelectionCommentComposer
        draft={selectionComment?.draft ?? null}
        rect={selectionComment?.rect ?? null}
        onSave={onCreateComment}
        onDismiss={() => setSelectionComment(null)}
      />
    </div>
  );
}

function SourceDiffLine({
  line,
  html,
  comments,
  onOpenComment,
}: {
  line: SourceDiffRow;
  html: string;
  comments: PathlensComment[];
  onOpenComment?: (id: string, rect: DOMRectLike) => void;
}) {
  const currentLine =
    "newLine" in line && line.kind !== "remove" ? line.newLine : null;
  const lineComments = currentLine
    ? commentsForLine(comments, currentLine)
    : [];
  const firstComment = lineComments[0];
  return (
    <div
      className={`diff-inline-row ${line.kind}${lineComments.length ? " has-comment" : ""}`}
      data-current-line={currentLine ?? undefined}
      data-change-kind={
        currentLine ? (line.kind === "add" ? "added" : "context") : undefined
      }
      onClick={(event) => {
        if (!firstComment) return;
        onOpenComment?.(
          firstComment.id,
          rectLikeFromElement(event.currentTarget),
        );
      }}
    >
      <span className="diff-line-no">
        {line.kind === "gap"
          ? ""
          : line.kind === "add"
            ? (line.newLine ?? "")
            : line.kind === "context"
              ? (line.newLine ?? "")
              : (line.oldLine ?? "")}
      </span>
      {firstComment ? (
        <button
          className="comment-gutter-marker diff-comment-marker"
          type="button"
          data-comment-id={firstComment.id}
          aria-label={`Open comment on line ${currentLine}`}
          onClick={(event) => {
            event.stopPropagation();
            onOpenComment?.(
              firstComment.id,
              rectLikeFromElement(event.currentTarget),
            );
          }}
        />
      ) : null}
      <code dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}

function RenderedDiff({
  diff,
  focusChanges,
  renderKind,
  file,
  onCreateComment,
  comments,
  activeCommentId,
  onOpenComment,
}: {
  diff: TextDiff;
  focusChanges: boolean;
  renderKind: Exclude<RenderKind, "source">;
  file?: FilePayload;
  onCreateComment?: CommentCreateHandler;
  comments: PathlensComment[];
  activeCommentId?: string | null;
  onOpenComment?: (id: string, rect: DOMRectLike) => void;
}) {
  const rows = buildRenderedDiffRows(
    parseUnifiedDiff(diff.content),
    renderKind,
  );
  const displayRows = focusChanges ? buildFocusedRenderedDiffRows(rows) : rows;
  if (!rows.some((line) => line.kind === "add" || line.kind === "remove")) {
    return <p className="muted">No rendered changes are available.</p>;
  }

  if (renderKind === "markdown") {
    return (
      <RenderedMarkdownDiff
        diff={diff}
        rows={displayRows}
        file={file}
        onCreateComment={onCreateComment}
        comments={comments}
        activeCommentId={activeCommentId}
        onOpenComment={onOpenComment}
      />
    );
  }

  if (renderKind === "html") {
    return (
      <RenderedHtmlDiff
        diff={diff}
        rows={buildRenderedHtmlRows(displayRows)}
        comments={comments}
        onOpenComment={onOpenComment}
      />
    );
  }

  return (
    <div
      className="diff-preview diff-inline rendered-inline-diff"
      aria-label={`Rendered diff for ${diff.path}`}
    >
      {displayRows.map((line, index) => (
        <div
          className={`diff-inline-row ${line.kind}`}
          key={`${line.kind}-${index}-${line.lineLabel}-${line.source}`}
        >
          <span className="diff-line-no">{line.lineLabel}</span>
          <RenderedDiffLine renderKind={renderKind} source={line.source} />
        </div>
      ))}
    </div>
  );
}

function RenderedHtmlDiff({
  diff,
  rows,
  comments,
  onOpenComment,
}: {
  diff: TextDiff;
  rows: RenderedDiffRow[];
  comments: PathlensComment[];
  onOpenComment?: (id: string, rect: DOMRectLike) => void;
}) {
  return (
    <div
      className="rendered-html-diff"
      aria-label={`Rendered HTML diff for ${diff.path}`}
    >
      {rows.map((row, index) => (
        <RenderedHtmlDiffBlock
          key={`${row.kind}-${index}-${row.source}`}
          row={row}
          comments={comments}
          onOpenComment={onOpenComment}
        />
      ))}
    </div>
  );
}

function RenderedHtmlDiffBlock({
  row,
  comments,
  onOpenComment,
}: {
  row: RenderedDiffRow;
  comments: PathlensComment[];
  onOpenComment?: (id: string, rect: DOMRectLike) => void;
}) {
  if (row.kind === "gap") return <DiffGap label={row.source} />;
  const range = currentLineRangeForRenderedRow(row);
  const firstComment = range
    ? commentsForLine(comments, range.start)[0]
    : undefined;
  return (
    <div
      className={`rendered-html-diff-block ${row.kind}${firstComment ? " has-comment" : ""}`}
      data-current-line={range?.start}
      data-change-kind={
        range ? (row.kind === "add" ? "added" : "context") : undefined
      }
    >
      {firstComment ? (
        <button
          className="comment-gutter-marker rendered-diff-comment-marker"
          type="button"
          data-comment-id={firstComment.id}
          aria-label={`Open comment on line ${range?.start}`}
          onClick={(event) =>
            onOpenComment?.(
              firstComment.id,
              rectLikeFromElement(event.currentTarget),
            )
          }
        />
      ) : null}
      <iframe
        className="rendered-html-diff-frame"
        sandbox=""
        srcDoc={htmlSnippetDocument(row.source)}
        title="HTML diff preview"
      />
    </div>
  );
}

function RenderedMarkdownDiff({
  diff,
  rows,
  file,
  onCreateComment,
  comments,
  activeCommentId,
  onOpenComment,
}: {
  diff: TextDiff;
  rows: RenderedDiffRow[];
  file?: FilePayload;
  onCreateComment?: CommentCreateHandler;
  comments: PathlensComment[];
  activeCommentId?: string | null;
  onOpenComment?: (id: string, rect: DOMRectLike) => void;
}) {
  const articleRef = useRef<HTMLElement | null>(null);
  const [selectionComment, setSelectionComment] = useState<{
    draft: CommentDraft;
    rect: DOMRectLike;
  } | null>(null);

  useEffect(() => {
    if (!activeCommentId) return;
    const marker = articleRef.current?.querySelector<HTMLElement>(
      `[data-comment-id="${CSS.escape(activeCommentId)}"]`,
    );
    if (!marker) return;
    marker.scrollIntoView({ block: "center", behavior: "smooth" });
    window.requestAnimationFrame(() =>
      onOpenComment?.(activeCommentId, rectLikeFromElement(marker)),
    );
  }, [activeCommentId, comments, onOpenComment]);

  const updateSelectionComment = () => {
    if (!file || !articleRef.current) return;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      setSelectionComment(null);
      return;
    }
    const text = selection.toString().trim();
    if (!text) {
      setSelectionComment(null);
      return;
    }
    const range = selection.getRangeAt(0);
    if (!articleRef.current.contains(range.commonAncestorContainer)) {
      setSelectionComment(null);
      return;
    }
    const blocks = Array.from(
      articleRef.current.querySelectorAll<HTMLElement>("[data-current-line]"),
    ).filter((block) => range.intersectsNode(block));
    const lines = blocks
      .map((block) => Number(block.dataset.currentLine))
      .filter((line) => Number.isSafeInteger(line));
    if (!lines.length) {
      setSelectionComment(null);
      return;
    }
    setSelectionComment({
      draft: diffCommentDraft(
        file,
        Math.min(...lines),
        Math.max(...lines),
        blocks.some((block) => block.dataset.changeKind === "added")
          ? "added"
          : "context",
        text,
      ),
      rect: rectFromRange(range),
    });
  };

  return (
    <article
      ref={articleRef}
      className="markdown markdown-document rendered-markdown-diff"
      aria-label={`Rendered Markdown diff for ${diff.path}`}
      onMouseUp={() => scheduleSelectionCommentUpdate(updateSelectionComment)}
      onKeyUp={updateSelectionComment}
    >
      {rows.map((row, index) => (
        <RenderedMarkdownDiffBlock
          key={`${row.kind}-${index}-${row.source}`}
          row={row}
          comments={comments}
          onOpenComment={onOpenComment}
        />
      ))}
      <SelectionCommentComposer
        draft={selectionComment?.draft ?? null}
        rect={selectionComment?.rect ?? null}
        onSave={onCreateComment}
        onDismiss={() => setSelectionComment(null)}
      />
    </article>
  );
}

function RenderedMarkdownDiffBlock({
  row,
  comments,
  onOpenComment,
}: {
  row: RenderedDiffRow;
  comments: PathlensComment[];
  onOpenComment?: (id: string, rect: DOMRectLike) => void;
}) {
  if (row.kind === "gap") return <DiffGap label={row.source} />;
  const range = currentLineRangeForRenderedRow(row);
  const firstComment = range
    ? commentsForLine(comments, range.start)[0]
    : undefined;
  return (
    <div
      className={`rendered-markdown-diff-block ${row.kind}${firstComment ? " has-comment" : ""}`}
      data-current-line={range?.start}
      data-change-kind={
        range ? (row.kind === "add" ? "added" : "context") : undefined
      }
    >
      {firstComment ? (
        <button
          className="comment-gutter-marker rendered-diff-comment-marker"
          type="button"
          data-comment-id={firstComment.id}
          aria-label={`Open comment on line ${range?.start}`}
          onClick={(event) =>
            onOpenComment?.(
              firstComment.id,
              rectLikeFromElement(event.currentTarget),
            )
          }
        />
      ) : null}
      <div
        className={markdownBlockClass(row.source)}
        data-comment-line={range?.start}
        dangerouslySetInnerHTML={{
          __html: row.html ?? renderMarkdownDocumentHtml(row.source),
        }}
      />
    </div>
  );
}

function DiffGap({ label }: { label: string }) {
  return (
    <div className="diff-gap" role="separator">
      {label}
    </div>
  );
}

function currentLineRangeForRenderedRow(
  row: RenderedDiffRow,
): { start: number; end: number } | null {
  if (row.kind !== "context" && row.kind !== "add") return null;
  const match = /^(\d+)(?:-(\d+))?$/.exec(row.lineLabel);
  if (!match) return null;
  const start = Number(match[1]);
  const end = Number(match[2] ?? match[1]);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return null;
  return { start, end };
}

function rectFromRange(range: Range): DOMRectLike {
  const rect = range.getBoundingClientRect();
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

interface DOMRectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

function markdownBlockClass(source: string): string {
  const trimmed = source.trimStart();
  if (/^#{1,6}\s/.test(trimmed)) return "markdown-block-heading";
  if (/^([-*+]|\d+\.)\s/m.test(trimmed)) return "markdown-block-list";
  if (/^(```|~~~)/.test(trimmed)) return "markdown-block-code";
  if (/^>/.test(trimmed)) return "markdown-block-quote";
  return "markdown-block-flow";
}

function RenderedDiffLine({
  renderKind,
  source,
}: {
  renderKind: Exclude<RenderKind, "source">;
  source: string;
}) {
  if (!source.trim()) {
    return <div className="rendered-diff-line empty"> </div>;
  }

  if (renderKind === "markdown") {
    return (
      <article
        className="markdown markdown-document rendered-diff-line"
        dangerouslySetInnerHTML={{
          __html: renderMarkdownDocumentHtml(source),
        }}
      />
    );
  }

  return (
    <iframe
      className="rendered-diff-frame rendered-diff-line"
      sandbox=""
      srcDoc={htmlSnippetDocument(source)}
      title="HTML diff line preview"
    />
  );
}

interface RenderedDiffBlock {
  hunk: string;
  removed: string;
  added: string;
}

interface RenderedDiffRow {
  kind: "context" | "add" | "remove" | "mixed" | "gap";
  lineLabel: string;
  source: string;
  html?: string;
}

export function buildRenderedDiffRows(
  lines: ParsedDiffLine[],
  renderKind: Exclude<RenderKind, "source"> = "markdown",
): RenderedDiffRow[] {
  const visible = lines.filter(
    (line) =>
      line.kind === "context" || line.kind === "add" || line.kind === "remove",
  ) as Array<ParsedDiffLine & { kind: "context" | "add" | "remove" }>;
  if (renderKind !== "markdown") {
    return visible.map((line) => ({
      kind: line.kind,
      lineLabel: lineLabelForLines(line.kind, [line]),
      source: line.text,
    }));
  }

  const rows: RenderedDiffRow[] = [];
  let index = 0;
  while (index < visible.length) {
    const line = visible[index];
    if (!line) break;

    if (isFenceStart(line.text)) {
      const block = collectFencedDiffBlock(visible, index);
      rows.push(renderedFencedCodeRow(block.lines));
      index = block.nextIndex;
      continue;
    }

    if (line.kind === "context") {
      const block = collectMarkdownBlock(visible, index, "context");
      rows.push(renderedDiffRowFromLines("context", block.lines));
      index = block.nextIndex;
      continue;
    }

    const changed: typeof visible = [];
    while (visible[index] && visible[index]?.kind !== "context") {
      changed.push(visible[index]);
      index += 1;
    }
    const removed = changed.filter((item) => item.kind === "remove");
    const added = changed.filter((item) => item.kind === "add");
    rows.push(...markdownRowsForChangedLines("remove", removed));
    rows.push(...markdownRowsForChangedLines("add", added));
  }

  return rows.filter((row) => row.source.trim().length > 0);
}

export function buildRenderedHtmlRows(
  rows: RenderedDiffRow[],
): RenderedDiffRow[] {
  const grouped: RenderedDiffRow[] = [];
  for (const row of rows) {
    const previous = grouped[grouped.length - 1];
    if (row.kind !== "gap" && previous?.kind === row.kind) {
      previous.source = `${previous.source}\n${row.source}`;
      continue;
    }
    grouped.push({ ...row });
  }
  return grouped.filter((row) => row.source.trim().length > 0);
}

export function buildFocusedSourceDiffRows(
  lines: VisibleDiffLine[],
  contextRadius = 3,
): SourceDiffRow[] {
  const included = focusedIndexes(
    lines.map((line) => line.kind !== "context"),
    contextRadius,
  );
  if (included.length === lines.length) return lines;
  return rowsWithGaps(
    lines,
    included,
    (hidden) => `${hidden} unchanged ${hidden === 1 ? "line" : "lines"} hidden`,
  );
}

export function buildFocusedRenderedDiffRows(
  rows: RenderedDiffRow[],
  contextRadius = 1,
): RenderedDiffRow[] {
  const included = focusedIndexes(
    rows.map((row) => row.kind !== "context" && row.kind !== "gap"),
    contextRadius,
  );
  if (included.length === rows.length) return rows;
  return rowsWithGaps(rows, included, (hidden) =>
    hidden === 1
      ? "1 unchanged block hidden"
      : `${hidden} unchanged blocks hidden`,
  );
}

function focusedIndexes(changed: boolean[], contextRadius: number): number[] {
  if (!changed.some(Boolean)) return changed.map((_, index) => index);
  const included = new Set<number>();
  for (let index = 0; index < changed.length; index += 1) {
    if (!changed[index]) continue;
    const first = Math.max(0, index - contextRadius);
    const last = Math.min(changed.length - 1, index + contextRadius);
    for (let include = first; include <= last; include += 1) {
      included.add(include);
    }
  }
  return [...included].sort((a, b) => a - b);
}

function rowsWithGaps<T extends SourceDiffRow | RenderedDiffRow>(
  rows: T[],
  included: number[],
  labelForHiddenCount: (hidden: number) => string,
): T[] {
  const focused: T[] = [];
  const first = included[0];
  if (first === undefined) return [];
  if (first > 0) {
    focused.push(gapRow(labelForHiddenCount(first)) as T);
  }
  let previous = -1;
  for (const index of included) {
    if (previous >= 0 && index > previous + 1) {
      focused.push(gapRow(labelForHiddenCount(index - previous - 1)) as T);
    }
    focused.push(rows[index]);
    previous = index;
  }
  const hiddenAfterLast = rows.length - previous - 1;
  if (hiddenAfterLast > 0) {
    focused.push(gapRow(labelForHiddenCount(hiddenAfterLast)) as T);
  }
  return focused;
}

function gapRow(label: string): DiffGapRow & RenderedDiffRow {
  return {
    kind: "gap",
    text: label,
    lineLabel: "",
    source: label,
  };
}

function collectFencedDiffBlock(
  lines: Array<ParsedDiffLine & { kind: "context" | "add" | "remove" }>,
  startIndex: number,
): {
  lines: Array<ParsedDiffLine & { kind: "context" | "add" | "remove" }>;
  nextIndex: number;
} {
  const opening = lines[startIndex]?.text.trim() ?? "";
  const fence = /^(```+|~~~+)/.exec(opening)?.[1] ?? "```";
  const block: Array<ParsedDiffLine & { kind: "context" | "add" | "remove" }> =
    [];
  let index = startIndex;
  while (index < lines.length) {
    const line = lines[index];
    if (!line) break;
    block.push(line);
    index += 1;
    if (index > startIndex + 1 && line.text.trim().startsWith(fence)) break;
  }
  return { lines: block, nextIndex: index };
}

function renderedFencedCodeRow(
  lines: Array<ParsedDiffLine & { kind: "context" | "add" | "remove" }>,
): RenderedDiffRow {
  const source = lines.map((line) => line.text).join("\n");
  const opening = lines[0]?.text.trim() ?? "```";
  const closingIndex = lastFenceIndex(lines, opening.slice(0, 3));
  const contentLines =
    closingIndex > 0 ? lines.slice(1, closingIndex) : lines.slice(1);
  const language = opening.replace(/^(```+|~~~+)/, "").trim() || "text";
  return {
    kind: diffKindForLines(lines),
    lineLabel: lineLabelForRenderedKind(diffKindForLines(lines), lines),
    source,
    html: `<pre><code class="language-${escapeHtmlAttribute(language)}">${contentLines
      .map(
        (line) =>
          `<span class="rendered-markdown-code-line ${line.kind}">${escapeHtml(
            line.text || " ",
          )}</span>`,
      )
      .join("\n")}</code></pre>`,
  };
}

function lineLabelForRenderedKind(
  kind: RenderedDiffRow["kind"],
  lines: Array<ParsedDiffLine & { kind: "context" | "add" | "remove" }>,
): string {
  if (kind === "add") return lineLabelForLines("add", lines);
  if (kind === "remove") return lineLabelForLines("remove", lines);
  return lineLabelForLines("context", lines);
}

function lastFenceIndex(
  lines: Array<ParsedDiffLine & { kind: "context" | "add" | "remove" }>,
  fence: string,
): number {
  for (let index = lines.length - 1; index > 0; index -= 1) {
    if (lines[index]?.text.trim().startsWith(fence)) return index;
  }
  return -1;
}

function markdownRowsForChangedLines(
  kind: "add" | "remove",
  lines: Array<ParsedDiffLine & { kind: "add" | "remove" | "context" }>,
): RenderedDiffRow[] {
  const rows: RenderedDiffRow[] = [];
  let index = 0;
  while (index < lines.length) {
    const block = collectMarkdownBlock(lines, index, kind);
    rows.push(renderedDiffRowFromLines(kind, block.lines));
    index = block.nextIndex;
  }
  return rows;
}

function isFenceStart(source: string): boolean {
  return /^(```+|~~~+)/.test(source.trim());
}

function diffKindForLines(
  lines: Array<ParsedDiffLine & { kind: "context" | "add" | "remove" }>,
): RenderedDiffRow["kind"] {
  const hasAdd = lines.some((line) => line.kind === "add");
  const hasRemove = lines.some((line) => line.kind === "remove");
  if (hasAdd && hasRemove) return "mixed";
  if (hasAdd) return "add";
  if (hasRemove) return "remove";
  return "context";
}

function collectMarkdownBlock<T extends ParsedDiffLine & { kind: string }>(
  lines: T[],
  startIndex: number,
  kind: T["kind"],
): { lines: T[]; nextIndex: number } {
  const block: T[] = [];
  let index = startIndex;
  let inFence = false;
  while (index < lines.length) {
    const line = lines[index];
    if (!line || line.kind !== kind) break;
    block.push(line);
    const trimmed = line.text.trim();
    if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
      inFence = !inFence;
    }
    index += 1;
    if (!inFence && trimmed === "") break;
  }
  return { lines: block, nextIndex: index };
}

function renderedDiffRowFromLines(
  kind: "context" | "add" | "remove",
  lines: Array<ParsedDiffLine & { kind: string }>,
): RenderedDiffRow {
  return {
    kind,
    lineLabel: lineLabelForLines(kind, lines),
    source: lines.map((line) => line.text).join("\n"),
  };
}

function lineLabelForLines(
  kind: "context" | "add" | "remove",
  lines: Array<Pick<ParsedDiffLine, "oldLine" | "newLine">>,
): string {
  const numbers = lines
    .map((line) => (kind === "remove" ? line.oldLine : line.newLine))
    .filter((line): line is number => typeof line === "number");
  if (!numbers.length) return "";
  const first = numbers[0];
  const last = numbers[numbers.length - 1];
  return first === last ? String(first) : `${first}-${last}`;
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

function extractHighlightedLines(html: string): string[] {
  if (typeof DOMParser !== "undefined") {
    const document = new DOMParser().parseFromString(html, "text/html");
    const lineNodes = [...document.querySelectorAll("span.line")];
    if (lineNodes.length) return lineNodes.map((line) => line.innerHTML || " ");
  }
  const code = /<code[^>]*>([\s\S]*?)<\/code>/i.exec(html)?.[1] ?? html;
  const lineMatches = extractLineSpanContents(code);
  if (lineMatches.length) return lineMatches.map((line) => line || " ");
  return code.split(/\r?\n/).map((line) => line || " ");
}

function extractLineSpanContents(code: string): string[] {
  const lines: string[] = [];
  const openMarker = '<span class="line">';
  let index = 0;
  while (index < code.length) {
    const start = code.indexOf(openMarker, index);
    if (start < 0) break;
    let cursor = start + openMarker.length;
    let depth = 1;
    while (cursor < code.length && depth > 0) {
      const nextOpen = code.indexOf("<span", cursor);
      const nextClose = code.indexOf("</span>", cursor);
      if (nextClose < 0) break;
      if (nextOpen >= 0 && nextOpen < nextClose) {
        depth += 1;
        cursor = nextOpen + 5;
      } else {
        depth -= 1;
        if (depth === 0) {
          lines.push(code.slice(start + openMarker.length, nextClose));
          cursor = nextClose + "</span>".length;
          break;
        }
        cursor = nextClose + "</span>".length;
      }
    }
    index = cursor;
  }
  return lines;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeHtmlAttribute(value: string): string {
  return escapeHtml(value).replace(/"/g, "&quot;");
}
