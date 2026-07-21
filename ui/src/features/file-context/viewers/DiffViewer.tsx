import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { TextDiff } from "../../../domain/change-review.js";
import type { ViviComment } from "../../../domain/comments.js";
import type { FilePayload } from "../../../domain/fs-node.js";
import type { CommentActivitySummary } from "../../../state/comment-activity.js";
import {
  diffStatusLabel,
  parseUnifiedDiff,
  type ParsedDiffLine,
} from "../../../state/git-review.js";
import { extractHighlightedLines } from "../../../state/highlighted-lines.js";
import {
  codeCommentThreadKey,
  codeCommentThreads,
  commentViewerKindForFile,
  commentsForLine,
  diffCommentDraft,
  lineCommentThreadActionLabel,
  matchingDraftPreviewThread,
  matchingOpenThreadForDraft,
  preferredCodeCommentThread,
  rectLikeFromElement,
  scheduleSelectionCommentUpdate,
  type CommentCreateHandler,
  type CommentDraft,
  type CommentStatusChangeHandler,
  type CodeCommentThread as CodeCommentThreadModel,
} from "../../../state/comments.js";
import { languageForPath } from "../../../state/file-icons.js";
import type { ResolvedTheme } from "../../../state/theme.js";
import { CodeCommentThread } from "../../comments/components/CodeCommentThread.js";
import railStyles from "../../comments/components/LineCommentRail.module.css";
import { SelectionCommentComposer } from "../../comments/components/SelectionCommentComposer.js";
import sharedUiStyles from "../../../shared/styles/SharedUi.module.css";
import { renderMarkdownDocumentHtml } from "../rendering/markdown-rendering.js";
import styles from "./DiffViewer.module.css";
import renderedMarkdownStyles from "./RenderedMarkdown.module.css";

type RenderKind = "source" | "markdown" | "html";
type VisibleDiffLine = ParsedDiffLine & {
  kind: "context" | "add" | "remove";
};
type SourceDiffRow = VisibleDiffLine | DiffGapRow;
type DiffDraftThread = {
  thread: CodeCommentThreadModel;
  draft: CommentDraft;
};
interface DiffGapRow {
  kind: "gap";
  text: string;
}

export function DiffViewer({
  path,
  diff,
  loading,
  renderKind,
  theme = "dark",
  file,
  onCreateComment,
  comments = [],
  activeCommentId,
  expandActiveCommentThread = true,
  currentActorId,
  onOpenComment,
  onCommentStatusChange,
  threadActivities = {},
}: {
  path: string;
  diff: TextDiff | null;
  loading?: boolean;
  renderKind: RenderKind;
  theme?: ResolvedTheme;
  file?: FilePayload;
  onCreateComment?: CommentCreateHandler;
  comments?: ViviComment[];
  activeCommentId?: string | null;
  expandActiveCommentThread?: boolean;
  currentActorId?: string;
  onOpenComment?: (id: string, rect: DOMRectLike) => void;
  onCommentStatusChange?: CommentStatusChangeHandler;
  threadActivities?: Record<string, CommentActivitySummary>;
}) {
  return (
    <section
      className={`${styles.diffViewer} ${railStyles.lineCommentRailStyles} diff-viewer`}
      aria-label={`Diff from HEAD for ${path}`}
    >
      <div className="diff-viewer-status">
        <div className="diff-viewer-status-main">
          <span>Status</span>
          <strong>{loading ? "Loading diff..." : diffStatusLabel(diff)}</strong>
        </div>
      </div>
      {diff?.reason ? (
        <p className={`${sharedUiStyles.muted} muted`}>{diff.reason}</p>
      ) : null}
      {diff?.status === "available" ? (
        renderKind === "source" ? (
          <SourceDiff
            diff={diff}
            theme={theme}
            file={file}
            onCreateComment={onCreateComment}
            comments={comments}
            activeCommentId={activeCommentId}
            expandActiveCommentThread={expandActiveCommentThread}
            currentActorId={currentActorId}
            onCommentStatusChange={onCommentStatusChange}
            threadActivities={threadActivities}
          />
        ) : (
          <RenderedDiff
            diff={diff}
            renderKind={renderKind}
            file={file}
            onCreateComment={onCreateComment}
            comments={comments}
            activeCommentId={activeCommentId}
            currentActorId={currentActorId}
            onOpenComment={onOpenComment}
            onCommentStatusChange={onCommentStatusChange}
            threadActivities={threadActivities}
          />
        )
      ) : null}
    </section>
  );
}

function SourceDiff({
  diff,
  theme,
  file,
  onCreateComment,
  comments,
  activeCommentId,
  expandActiveCommentThread,
  currentActorId,
  onCommentStatusChange,
  threadActivities,
}: {
  diff: TextDiff;
  theme: ResolvedTheme;
  file?: FilePayload;
  onCreateComment?: CommentCreateHandler;
  comments: ViviComment[];
  activeCommentId?: string | null;
  expandActiveCommentThread: boolean;
  currentActorId?: string;
  onCommentStatusChange?: CommentStatusChangeHandler;
  threadActivities: Record<string, CommentActivitySummary>;
}) {
  const diffRef = useRef<HTMLDivElement | null>(null);
  const [draftThreads, setDraftThreads] = useState<DiffDraftThread[]>([]);
  const [openThreadKeys, setOpenThreadKeys] = useState<string[]>([]);
  const language = languageForPath(diff.path, "code");
  const lines = useMemo(
    () => visibleDiffLinesForContent(diff.content),
    [diff.content],
  );
  const displayLines = useMemo(
    () => buildFocusedSourceDiffRows(lines),
    [lines],
  );
  const [highlightedLines, setHighlightedLines] = useState<string[] | null>(
    null,
  );
  const diffComments = useMemo(
    () => comments.filter((comment) => comment.anchor.surface === "diff"),
    [comments],
  );
  const commentThreads = useMemo(
    () => codeCommentThreads(diffComments),
    [diffComments],
  );
  const activeThread = activeCommentId
    ? commentThreads.find((thread) =>
        thread.comments.some((comment) => comment.id === activeCommentId),
      )
    : undefined;
  const visibleThreadKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const draftThread of draftThreads) {
      keys.add(
        matchingDraftPreviewThread(commentThreads, draftThread.thread)?.key ??
          draftThread.thread.key,
      );
    }
    for (const key of openThreadKeys) keys.add(key);
    if (expandActiveCommentThread && activeThread) keys.add(activeThread.key);
    return keys;
  }, [
    activeThread,
    commentThreads,
    draftThreads,
    expandActiveCommentThread,
    openThreadKeys,
  ]);

  useEffect(() => {
    let cancelled = false;
    setHighlightedLines(null);
    import("../../../state/highlighter.js")
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
  }, [activeCommentId]);

  useEffect(() => {
    setDraftThreads([]);
    setOpenThreadKeys([]);
  }, [diff.path, diff.content]);

  const updateSelectionComment = () => {
    if (!file || !diffRef.current) return;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return;
    }
    const text = selection.toString().trim();
    if (!text) {
      return;
    }
    const range = selection.getRangeAt(0);
    if (!diffRef.current.contains(range.commonAncestorContainer)) {
      return;
    }
    const selectedRows = Array.from(
      diffRef.current.querySelectorAll<HTMLElement>("[data-current-line]"),
    ).filter((row) => range.intersectsNode(row));
    if (!selectedRows.length) {
      return;
    }
    const lineNumbers = selectedRows
      .map((row) => Number(row.dataset.currentLine))
      .filter((line) => Number.isSafeInteger(line));
    if (!lineNumbers.length) {
      return;
    }
    const changeKind = selectedRows.some(
      (row) => row.dataset.changeKind === "added",
    )
      ? "added"
      : "context";
    startDiffComment(Math.min(...lineNumbers), Math.max(...lineNumbers), text, {
      changeKind,
    });
    window.getSelection()?.removeAllRanges();
  };

  function startDiffComment(
    lineStart: number,
    lineEnd = lineStart,
    quote?: string,
    options: { changeKind?: "context" | "added" } = {},
  ) {
    if (!file) return;
    const changeKind =
      options.changeKind ??
      (lines.some((line) => line.newLine === lineStart && line.kind === "add")
        ? "added"
        : "context");
    const key = codeCommentThreadKey(diff.path, lineStart, lineEnd);
    const draft = diffCommentDraft(
      file,
      lineStart,
      lineEnd,
      changeKind,
      quote,
      diffCommentContextForRange(diff, lineStart, lineEnd),
    );
    const existingThread = matchingOpenThreadForDraft(commentThreads, draft);
    if (existingThread) {
      setDraftThreads((items) =>
        items.filter((item) => item.thread.key !== existingThread.key),
      );
      setOpenThreadKeys((keys) =>
        keys.includes(existingThread.key)
          ? keys
          : [...keys, existingThread.key],
      );
      return;
    }
    const nextDraftThread: DiffDraftThread = {
      thread: {
        key,
        path: diff.path,
        lineStart,
        lineEnd,
        status: "open",
        comments: [],
      },
      draft,
    };
    setDraftThreads((items) => [
      ...items.filter((item) => item.thread.key !== key),
      nextDraftThread,
    ]);
  }

  function openCommentThread(thread: CodeCommentThreadModel) {
    setOpenThreadKeys((keys) =>
      keys.includes(thread.key) ? keys : [...keys, thread.key],
    );
  }

  function closeCommentThread(threadKey: string) {
    setDraftThreads((items) =>
      items.filter((item) => item.thread.key !== threadKey),
    );
    setOpenThreadKeys((keys) => keys.filter((key) => key !== threadKey));
  }

  return (
    <div
      ref={diffRef}
      className="diff-preview diff-inline"
      aria-label={`Diff for ${diff.path}`}
      onMouseUp={() => scheduleSelectionCommentUpdate(updateSelectionComment)}
      onKeyUp={updateSelectionComment}
    >
      {displayLines.map((line, index) => {
        const currentLine =
          "newLine" in line && line.kind !== "remove" ? line.newLine : null;
        const lineThreads = currentLine
          ? commentThreads.filter(
              (thread) =>
                currentLine >= thread.lineStart &&
                currentLine <= thread.lineEnd,
            )
          : [];
        const rowThread = currentLine
          ? preferredCodeCommentThread(
              lineThreads.filter((thread) => thread.lineEnd === currentLine),
              activeCommentId,
            )
          : undefined;
        const displayedThreads = currentLine
          ? commentThreads.filter(
              (thread) =>
                visibleThreadKeys.has(thread.key) &&
                thread.lineEnd === currentLine,
            )
          : [];
        const draftThread = currentLine
          ? draftThreads.find(
              (candidate) =>
                !matchingDraftPreviewThread(commentThreads, candidate.thread) &&
                currentLine >= candidate.thread.lineStart &&
                currentLine <= candidate.thread.lineEnd,
            )
          : undefined;
        const draftingRangeLine = Boolean(
          currentLine &&
          draftThread &&
          currentLine >= draftThread.thread.lineStart &&
          currentLine <= draftThread.thread.lineEnd,
        );
        const draftingThread = Boolean(
          currentLine &&
          draftingRangeLine &&
          draftThread?.thread.lineEnd === currentLine,
        );
        const threadsForDisplay = [
          ...displayedThreads.flatMap((thread) => {
            const firstComment = thread.comments[0];
            if (!firstComment) return [];
            const threadId = firstComment.threadId ?? firstComment.id;
            return [
              {
                thread,
                threadId,
                draft: {
                  threadId,
                  path: firstComment.path,
                  viewerKind: firstComment.viewerKind,
                  anchor: firstComment.anchor,
                },
              },
            ];
          }),
          ...(draftingThread && draftThread
            ? [
                {
                  thread: draftThread.thread,
                  threadId: undefined,
                  draft: draftThread.draft,
                },
              ]
            : []),
        ];
        return (
          <Fragment
            key={`${line.kind}-${index}-${"oldLine" in line ? (line.oldLine ?? "") : ""}-${"newLine" in line ? (line.newLine ?? "") : ""}-${line.text}`}
          >
            <SourceDiffLine
              path={diff.path}
              line={line}
              html={highlightedLines?.[index] ?? escapeHtml(line.text || " ")}
              comments={diffComments}
              activeCommentId={activeCommentId}
              rowThread={rowThread}
              threadOpen={threadsForDisplay.length > 0}
              threadKeys={threadsForDisplay.map((entry) => entry.thread.key)}
              drafting={draftingRangeLine}
              onOpenThread={openCommentThread}
              onCloseThread={closeCommentThread}
              onStartLineComment={
                currentLine ? () => startDiffComment(currentLine) : undefined
              }
            />
            {threadsForDisplay.map((entry) => (
              <div className="code-comment-thread-row" key={entry.thread.key}>
                <CodeCommentThread
                  thread={entry.thread}
                  draft={entry.draft}
                  activity={
                    entry.threadId
                      ? threadActivities[entry.threadId]
                      : undefined
                  }
                  activeCommentId={activeCommentId}
                  currentActorId={currentActorId}
                  onCreateComment={onCreateComment}
                  onStatusChange={onCommentStatusChange}
                  onClose={() => closeCommentThread(entry.thread.key)}
                />
              </div>
            ))}
          </Fragment>
        );
      })}
    </div>
  );
}

function SourceDiffLine({
  path,
  line,
  html,
  comments,
  activeCommentId,
  rowThread,
  threadOpen,
  threadKeys = [],
  drafting,
  onOpenThread,
  onCloseThread,
  onStartLineComment,
}: {
  path: string;
  line: SourceDiffRow;
  html: string;
  comments: ViviComment[];
  activeCommentId?: string | null;
  rowThread?: CodeCommentThreadModel;
  threadOpen?: boolean;
  threadKeys?: string[];
  drafting?: boolean;
  onOpenThread?: (thread: CodeCommentThreadModel) => void;
  onCloseThread?: (threadKey: string) => void;
  onStartLineComment?: () => void;
}) {
  const currentLine =
    "newLine" in line && line.kind !== "remove" ? line.newLine : null;
  const lineComments = currentLine
    ? commentsForLine(comments, currentLine)
    : [];
  const activeCommentLine = lineComments.some(
    (comment) => comment.id === activeCommentId,
  );
  return (
    <div
      className={`diff-inline-row ${line.kind}${lineComments.length ? " has-comment" : ""}${activeCommentLine ? " active-comment" : ""}${drafting ? " drafting-comment" : ""}`}
      data-current-line={currentLine ?? undefined}
      data-change-kind={
        currentLine ? (line.kind === "add" ? "added" : "context") : undefined
      }
      onClick={(event) => {
        if (!rowThread) return;
        if (threadOpen && threadKeys.length) {
          for (const key of threadKeys) onCloseThread?.(key);
        } else onOpenThread?.(rowThread);
      }}
    >
      {currentLine ? (
        <button
          className={`code-line-comment-action${rowThread ? " has-thread" : ""}`}
          type="button"
          aria-expanded={threadOpen}
          aria-label={lineCommentThreadActionLabel(currentLine, rowThread)}
          title={lineCommentThreadActionLabel(currentLine, rowThread)}
          data-change-kind={line.kind === "add" ? "added" : "context"}
          data-comment-id={rowThread?.comments[0]?.id}
          data-comment-surface="diff"
          data-line={currentLine}
          data-path={path}
          data-testid="line-comment-action"
          onClick={(event) => {
            event.stopPropagation();
            if (threadOpen && threadKeys.length) {
              for (const key of threadKeys) onCloseThread?.(key);
            } else if (rowThread) onOpenThread?.(rowThread);
            else onStartLineComment?.();
          }}
        >
          {rowThread ? (
            <span className="code-line-comment-count">
              {rowThread.comments.length}
            </span>
          ) : null}
        </button>
      ) : null}
      <span className="diff-line-no">
        {line.kind === "gap"
          ? ""
          : line.kind === "add"
            ? (line.newLine ?? "")
            : line.kind === "context"
              ? (line.newLine ?? "")
              : (line.oldLine ?? "")}
      </span>
      <code dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}

function RenderedDiff({
  diff,
  renderKind,
  file,
  onCreateComment,
  comments,
  activeCommentId,
  currentActorId,
  onOpenComment,
  onCommentStatusChange,
  threadActivities,
}: {
  diff: TextDiff;
  renderKind: Exclude<RenderKind, "source">;
  file?: FilePayload;
  onCreateComment?: CommentCreateHandler;
  comments: ViviComment[];
  activeCommentId?: string | null;
  currentActorId?: string;
  onOpenComment?: (id: string, rect: DOMRectLike) => void;
  onCommentStatusChange?: CommentStatusChangeHandler;
  threadActivities: Record<string, CommentActivitySummary>;
}) {
  const rows = buildRenderedDiffRows(
    parseUnifiedDiff(diff.content),
    renderKind,
  );
  const displayRows = buildFocusedRenderedDiffRows(rows);
  const cards = buildRenderedChangeCards(
    renderKind === "html" ? buildRenderedHtmlRows(displayRows) : displayRows,
  );
  if (!rows.some((line) => line.kind === "add" || line.kind === "remove")) {
    return (
      <p className={`${sharedUiStyles.muted} muted`}>
        No rendered changes are available.
      </p>
    );
  }

  return (
    <RenderedChangeCards
      diff={diff}
      renderKind={renderKind}
      cards={cards}
      file={file}
      onCreateComment={onCreateComment}
      comments={comments}
      activeCommentId={activeCommentId}
      currentActorId={currentActorId}
      onOpenComment={onOpenComment}
      onCommentStatusChange={onCommentStatusChange}
      threadActivities={threadActivities}
    />
  );
}

function RenderedChangeCards({
  diff,
  renderKind,
  cards,
  file,
  onCreateComment,
  comments,
  activeCommentId,
  currentActorId,
  onOpenComment,
  onCommentStatusChange,
  threadActivities,
}: {
  diff: TextDiff;
  renderKind: Exclude<RenderKind, "source">;
  cards: RenderedChangeCard[];
  file?: FilePayload;
  onCreateComment?: CommentCreateHandler;
  comments: ViviComment[];
  activeCommentId?: string | null;
  currentActorId?: string;
  onOpenComment?: (id: string, rect: DOMRectLike) => void;
  onCommentStatusChange?: CommentStatusChangeHandler;
  threadActivities: Record<string, CommentActivitySummary>;
}) {
  const cardListRef = useRef<HTMLDivElement | null>(null);
  const [selectionComment, setSelectionComment] = useState<{
    draft: CommentDraft;
    rect: DOMRectLike;
  } | null>(null);
  const [openThreadKeys, setOpenThreadKeys] = useState<string[]>([]);

  function toggleCommentThread(thread: CodeCommentThreadModel) {
    setOpenThreadKeys((keys) =>
      keys.includes(thread.key)
        ? keys.filter((key) => key !== thread.key)
        : [...keys, thread.key],
    );
  }

  function closeCommentThread(threadKey: string) {
    setOpenThreadKeys((keys) => keys.filter((key) => key !== threadKey));
  }

  function startCardComment(card: RenderedChangeCard, target: HTMLElement) {
    if (!file) return;
    const draft = renderedChangeCardCommentDraft(file, diff, card);
    if (!draft) return;
    setSelectionComment({
      draft,
      rect: rectLikeFromElement(target),
    });
  }

  useEffect(() => {
    if (!activeCommentId) return;
    const marker = cardListRef.current?.querySelector<HTMLElement>(
      `[data-comment-id="${CSS.escape(activeCommentId)}"]`,
    );
    if (!marker) return;
    marker.scrollIntoView({ block: "center", behavior: "smooth" });
    window.requestAnimationFrame(() =>
      onOpenComment?.(activeCommentId, rectLikeFromElement(marker)),
    );
  }, [activeCommentId, comments, onOpenComment]);

  const summary = renderedChangeCardsSummary(cards);

  const updateSelectionComment = () => {
    if (!file || !cardListRef.current || renderKind !== "markdown") return;
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
    if (!cardListRef.current.contains(range.commonAncestorContainer)) {
      setSelectionComment(null);
      return;
    }
    const blocks = Array.from(
      cardListRef.current.querySelectorAll<HTMLElement>("[data-current-line]"),
    ).filter((block) => range.intersectsNode(block));
    const selectedLineRange = renderedDiffSelectionLineRange(blocks);
    if (!selectedLineRange) {
      setSelectionComment(null);
      return;
    }
    const { start: lineStart, end: lineEnd } = selectedLineRange;
    setSelectionComment({
      draft: diffCommentDraft(
        file,
        lineStart,
        lineEnd,
        blocks.some((block) => block.dataset.changeKind === "added")
          ? "added"
          : "context",
        text,
        diffCommentContextForRange(diff, lineStart, lineEnd),
      ),
      rect: rectFromRange(range),
    });
  };

  return (
    <div
      ref={cardListRef}
      role="region"
      className="rendered-change-cards"
      aria-label={`Rendered ${renderKind === "html" ? "HTML" : "Markdown"} change cards for ${diff.path}`}
      onMouseUp={() => scheduleSelectionCommentUpdate(updateSelectionComment)}
      onKeyUp={updateSelectionComment}
    >
      <div
        className="rendered-change-card-summary"
        aria-label={`Rendered change summary: ${summary.accessibleLabel}`}
      >
        <strong>{summary.total}</strong>
        <span className="rendered-change-card-summary-copy">
          <span>{summary.totalLabel}</span>
          <span className="rendered-change-card-summary-breakdown">
            {summary.parts.map((part) => (
              <span
                key={part.kind}
                className={`rendered-change-summary-pill ${part.kind}`}
              >
                {part.label}
              </span>
            ))}
          </span>
          <span>source diff remains canonical</span>
        </span>
      </div>
      <div className="rendered-change-card-stack">
        {cards.map((card) => (
          <RenderedChangeCardView
            key={card.id}
            card={card}
            renderKind={renderKind}
            comments={comments}
            activeCommentId={activeCommentId}
            openThreadKeys={openThreadKeys}
            canStartCardComment={Boolean(file && onCreateComment)}
            currentActorId={currentActorId}
            onOpenComment={onOpenComment}
            onStartCardComment={startCardComment}
            onToggleCommentThread={toggleCommentThread}
            onCloseCommentThread={closeCommentThread}
            onCreateComment={onCreateComment}
            onCommentStatusChange={onCommentStatusChange}
            threadActivities={threadActivities}
          />
        ))}
      </div>
      <SelectionCommentComposer
        draft={selectionComment?.draft ?? null}
        rect={selectionComment?.rect ?? null}
        onSave={onCreateComment}
        onDismiss={() => setSelectionComment(null)}
        restorePath={file?.path}
        currentFileHash={file?.etag}
      />
    </div>
  );
}

function visibleDiffLinesForContent(content: string): VisibleDiffLine[] {
  return parseUnifiedDiff(content).filter(
    (line) => line.kind !== "meta" && line.kind !== "hunk",
  ) as VisibleDiffLine[];
}

function renderedChangeCardsSummary(cards: RenderedChangeCard[]): {
  total: number;
  totalLabel: string;
  parts: Array<{ kind: RenderedChangeKind; label: string }>;
  accessibleLabel: string;
} {
  const counts = cards.reduce(
    (acc, card) => {
      acc[card.kind] += 1;
      return acc;
    },
    { changed: 0, added: 0, removed: 0 } satisfies Record<
      RenderedChangeKind,
      number
    >,
  );
  const parts = (["changed", "added", "removed"] as const).flatMap((kind) => {
    const count = counts[kind];
    return count > 0 ? [{ kind, label: `${count} ${kind}` }] : [];
  });
  const totalLabel = `${cards.length} rendered ${cards.length === 1 ? "change card" : "change cards"}`;
  const breakdownLabel = parts.map((part) => part.label).join(", ");
  return {
    total: cards.length,
    totalLabel,
    parts,
    accessibleLabel: `${totalLabel}${breakdownLabel ? `, ${breakdownLabel}` : ""}, source diff remains canonical`,
  };
}

export function diffCommentContextForRange(
  diff: TextDiff,
  lineStart: number,
  lineEnd = lineStart,
  side: "old" | "new" = "new",
): { base?: string; ref?: string; hunkId?: string; diffHash?: string } {
  return {
    base: diff.baseRef ?? diff.baseLabel,
    ref: diff.compareLabel,
    hunkId: hunkIdForDiffRange(diff.content, lineStart, lineEnd, side),
    diffHash: diff.diffHash,
  };
}

function hunkIdForDiffRange(
  content: string,
  lineStart: number,
  lineEnd: number,
  side: "old" | "new" = "new",
): string {
  let currentHunk: string | undefined;
  for (const line of parseUnifiedDiff(content)) {
    if (line.kind === "hunk") {
      currentHunk = line.text;
      continue;
    }
    const lineNumber = side === "old" ? line.oldLine : line.newLine;
    if (line.kind !== (side === "old" ? "add" : "remove") && lineNumber) {
      if (lineNumber < lineStart || lineNumber > lineEnd) continue;
      return currentHunk ?? fallbackHunkIdForRange(lineStart, lineEnd);
    }
  }
  return fallbackHunkIdForRange(lineStart, lineEnd);
}

function fallbackHunkIdForRange(start: number, end: number): string {
  return `@@ -0 +${start},${end - start + 1} @@`;
}

type RenderedDiffSelectionBlock = {
  dataset: {
    currentLine?: string;
    currentLineEnd?: string;
  };
};

export function renderedDiffSelectionLineRange(
  blocks: RenderedDiffSelectionBlock[],
): { start: number; end: number } | null {
  const ranges = blocks.flatMap((block) => {
    const start = Number(block.dataset.currentLine);
    const end = Number(
      block.dataset.currentLineEnd ?? block.dataset.currentLine,
    );
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return [];
    return [{ start, end }];
  });
  if (!ranges.length) return null;
  return {
    start: Math.min(...ranges.map((range) => range.start)),
    end: Math.max(...ranges.map((range) => range.end)),
  };
}

function RenderedChangeCardView({
  card,
  renderKind,
  comments,
  activeCommentId,
  openThreadKeys,
  canStartCardComment,
  currentActorId,
  onOpenComment,
  onStartCardComment,
  onToggleCommentThread,
  onCloseCommentThread,
  onCreateComment,
  onCommentStatusChange,
  threadActivities,
}: {
  card: RenderedChangeCard;
  renderKind: Exclude<RenderKind, "source">;
  comments: ViviComment[];
  activeCommentId?: string | null;
  openThreadKeys: string[];
  canStartCardComment: boolean;
  currentActorId?: string;
  onOpenComment?: (id: string, rect: DOMRectLike) => void;
  onStartCardComment: (card: RenderedChangeCard, target: HTMLElement) => void;
  onToggleCommentThread: (thread: CodeCommentThreadModel) => void;
  onCloseCommentThread: (threadKey: string) => void;
  onCreateComment?: CommentCreateHandler;
  onCommentStatusChange?: CommentStatusChangeHandler;
  threadActivities: Record<string, CommentActivitySummary>;
}) {
  if (!card.before && !card.after) return <DiffGap label="Changed block" />;
  const anchorRow = card.after ?? card.before;
  const commentRange = renderedCommentLineRangeForCard(card);
  const commentThread = commentRange
    ? preferredCodeCommentThread(
        codeCommentThreads(
          commentsForRenderedDiffLineRange(
            comments,
            commentRange.start,
            commentRange.end,
            commentRange.side,
          ),
        ),
        activeCommentId,
      )
    : undefined;
  const markerComment =
    (activeCommentId
      ? commentThread?.comments.find(
          (comment) => comment.id === activeCommentId,
        )
      : undefined) ?? commentThread?.comments[0];
  const activeThreadOpen = Boolean(
    activeCommentId &&
    commentThread?.comments.some((comment) => comment.id === activeCommentId),
  );
  const threadOpen = Boolean(
    commentThread &&
    (activeThreadOpen || openThreadKeys.includes(commentThread.key)),
  );
  const cardTitle =
    card.kind === "changed"
      ? "Changed rendered block"
      : card.kind === "added"
        ? "Added rendered block"
        : "Removed rendered block";
  const threadPanelId = commentThread
    ? renderedChangeThreadPanelId(commentThread.key)
    : undefined;
  const addCommentLabel = `Add comment to ${cardTitle}${
    anchorRow?.lineLabel ? ` line ${anchorRow.lineLabel}` : ""
  }`;
  const sourceHunkLabel = `${cardTitle}${
    anchorRow?.lineLabel ? ` line ${anchorRow.lineLabel}` : ""
  }`;
  const sourceHunkId = renderedChangeSourceHunkId(card.id);
  return (
    <article
      className={`rendered-change-card ${card.kind}${commentThread ? " has-comment" : ""}`}
      aria-label={`${cardTitle} ${anchorRow?.lineLabel ?? ""}`.trim()}
    >
      <div className="rendered-change-card-rail" />
      <div className="rendered-change-card-body">
        <header className="rendered-change-card-head">
          <span className={`rendered-change-badge ${card.kind}`}>
            {card.kind}
          </span>
          <span className="rendered-change-card-meta">
            {cardTitle}
            {anchorRow?.lineLabel ? ` · line ${anchorRow.lineLabel}` : ""}
          </span>
          <span className="rendered-change-card-actions">
            {canStartCardComment ? (
              <button
                className="rendered-change-card-comment-action"
                type="button"
                aria-label={addCommentLabel}
                title={addCommentLabel}
                onMouseUp={(event) => event.stopPropagation()}
                onClick={(event) =>
                  onStartCardComment(card, event.currentTarget)
                }
              >
                +
              </button>
            ) : null}
            {markerComment && commentThread ? (
              <button
                className="comment-gutter-marker rendered-diff-comment-marker"
                type="button"
                data-comment-id={markerComment.id}
                aria-expanded={threadOpen}
                aria-controls={threadPanelId}
                aria-label={lineCommentThreadActionLabel(
                  commentThread.lineStart,
                  commentThread,
                )}
                title={lineCommentThreadActionLabel(
                  commentThread.lineStart,
                  commentThread,
                )}
                onClick={(event) => {
                  onToggleCommentThread(commentThread);
                  onOpenComment?.(
                    markerComment.id,
                    rectLikeFromElement(event.currentTarget),
                  );
                }}
              />
            ) : null}
          </span>
        </header>
        <div
          className={`rendered-change-card-content ${
            card.before && card.after ? "before-after" : "single"
          }`}
        >
          {card.before ? (
            <RenderedChangePane
              label={
                card.kind === "removed" ? "Removed · HEAD" : "Before · HEAD"
              }
              row={card.before}
              tone="old"
              renderKind={renderKind}
            />
          ) : null}
          {card.after ? (
            <RenderedChangePane
              label={
                card.kind === "added"
                  ? "Added · working tree"
                  : "After · working tree"
              }
              row={card.after}
              tone="new"
              renderKind={renderKind}
            />
          ) : null}
        </div>
        <SourceHunkPreview
          rows={card.sourceRows}
          label={sourceHunkLabel}
          previewId={sourceHunkId}
        />
        {commentThread && threadOpen ? (
          <div className="rendered-change-comment-thread" id={threadPanelId}>
            <CodeCommentThread
              thread={commentThread}
              draft={draftForExistingThread(commentThread)}
              activity={threadActivityForCommentThread(
                commentThread,
                threadActivities,
              )}
              activeCommentId={activeCommentId}
              currentActorId={currentActorId}
              onCreateComment={onCreateComment}
              onStatusChange={onCommentStatusChange}
              onClose={() => onCloseCommentThread(commentThread.key)}
            />
          </div>
        ) : null}
      </div>
    </article>
  );
}

function renderedChangeThreadPanelId(threadKey: string): string {
  return `rendered-change-thread-${encodeURIComponent(threadKey)}`;
}

function renderedChangeSourceHunkId(cardId: string): string {
  return `rendered-change-source-${encodeURIComponent(cardId)}`;
}

function draftForExistingThread(thread: CodeCommentThreadModel): CommentDraft {
  const firstComment = thread.comments[0];
  const threadId = firstComment?.threadId ?? firstComment?.id;
  return {
    threadId,
    path: firstComment?.path ?? "",
    viewerKind: firstComment?.viewerKind ?? "code",
    anchor: firstComment?.anchor,
  };
}

function threadActivityForCommentThread(
  thread: CodeCommentThreadModel,
  threadActivities: Record<string, CommentActivitySummary>,
): CommentActivitySummary | undefined {
  const firstComment = thread.comments[0];
  const threadId = firstComment?.threadId ?? firstComment?.id;
  return threadId ? threadActivities[threadId] : undefined;
}

function commentsForRenderedDiffLineRange(
  comments: ViviComment[],
  start: number,
  end: number,
  side: "old" | "new",
): ViviComment[] {
  return comments.flatMap((comment) => {
    if (comment.anchor.surface === "source") return [];
    if (comment.anchor.diff && comment.anchor.diff.side !== side) return [];
    if (!comment.anchor.diff && side === "old") return [];
    const commentRange = renderedDiffCommentLineRange(comment, side);
    if (!commentRange) return [];
    if (commentRange.start > end || commentRange.end < start) return [];
    return [
      {
        ...comment,
        anchor: {
          ...comment.anchor,
          canonical: {
            ...comment.anchor.canonical,
            lineStart: commentRange.start,
            lineEnd: commentRange.end,
          },
        },
      },
    ];
  });
}

function renderedDiffCommentLineRange(
  comment: ViviComment,
  side: "old" | "new",
): { start: number; end: number } | null {
  const diff = comment.anchor.diff;
  if (diff) {
    const start = side === "old" ? diff.oldLineStart : diff.newLineStart;
    if (!start) return null;
    return {
      start,
      end: (side === "old" ? diff.oldLineEnd : diff.newLineEnd) ?? start,
    };
  }
  const start = comment.anchor.canonical.lineStart;
  if (!start) return null;
  return { start, end: comment.anchor.canonical.lineEnd ?? start };
}

function RenderedChangePane({
  label,
  row,
  tone,
  renderKind,
}: {
  label: string;
  row: RenderedDiffRow;
  tone: "old" | "new";
  renderKind: Exclude<RenderKind, "source">;
}) {
  const range = selectableRenderedLineRangeForRow(row);
  return (
    <section className="rendered-change-pane">
      <p className="rendered-change-pane-label">{label}</p>
      <div
        className={`rendered-change-preview ${tone}`}
        data-current-line={range?.start}
        data-current-line-end={range?.end}
        data-change-kind={tone === "new" ? "added" : "context"}
      >
        <RenderedDiffLine renderKind={renderKind} source={row.source} />
      </div>
    </section>
  );
}

function SourceHunkPreview({
  rows,
  label,
  previewId,
}: {
  rows: RenderedDiffRow[];
  label: string;
  previewId: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <section className="rendered-change-source">
      <button
        type="button"
        aria-label={`${visible ? "Hide" : "Show"} source hunk for ${label}`}
        aria-controls={previewId}
        aria-expanded={visible}
        onClick={() => setVisible((value) => !value)}
      >
        {visible ? "Hide source hunk" : "Show source hunk"}
      </button>
      <div
        id={previewId}
        className="rendered-change-source-rows"
        role="region"
        aria-label="Source hunk preview"
        hidden={!visible}
      >
        {visible
          ? rows.map((row, index) => (
              <div
                key={`${row.kind}-${row.lineLabel}-${index}-${row.source}`}
                className={`rendered-change-source-row ${row.kind}`}
              >
                <span>
                  {row.kind === "remove"
                    ? `-${row.lineLabel}`
                    : `+${row.lineLabel}`}
                </span>
                <code>{row.source || " "}</code>
              </div>
            ))
          : null}
      </div>
    </section>
  );
}

function DiffGap({ label }: { label: string }) {
  return (
    <div className="diff-gap" role="separator">
      {label}
    </div>
  );
}

function renderedCommentLineRangeForCard(
  card: RenderedChangeCard,
): { start: number; end: number; side: "old" | "new" } | null {
  const row = card.after ?? card.before;
  if (!row) return null;
  const range = lineRangeForRenderedRow(row);
  if (!range) return null;
  return { ...range, side: card.after ? "new" : "old" };
}

export function renderedChangeCardCommentDraft(
  file: FilePayload,
  diff: TextDiff,
  card: RenderedChangeCard,
): CommentDraft | null {
  const range = renderedCommentLineRangeForCard(card);
  if (!range) return null;
  const quote = (range.side === "old" ? card.before : card.after)?.source;
  const context = diffCommentContextForRange(
    diff,
    range.start,
    range.end,
    range.side,
  );
  if (range.side === "new") {
    return diffCommentDraft(
      file,
      range.start,
      range.end,
      card.kind === "added" ? "added" : "context",
      quote,
      context,
    );
  }
  return {
    path: file.path,
    viewerKind: commentViewerKindForFile(file),
    anchor: {
      surface: "diff",
      canonical: {
        path: file.path,
        lineStart: range.start,
        lineEnd: range.end,
        quote: quote?.trim() || undefined,
        fileHash: file.etag,
      },
      diff: {
        path: file.path,
        base: context.base ?? "HEAD",
        ref: context.ref ?? "working-tree",
        hunkId: context.hunkId ?? `old:${range.start}-${range.end}`,
        side: "old",
        oldLineStart: range.start,
        oldLineEnd: range.end,
        diffHash: context.diffHash,
        fileHash: file.etag,
      },
    },
  };
}

function selectableRenderedLineRangeForRow(
  row: RenderedDiffRow,
): { start: number; end: number } | null {
  if (row.kind !== "context" && row.kind !== "add") return null;
  return lineRangeForRenderedRow(row);
}

function lineRangeForRenderedRow(
  row: RenderedDiffRow,
): { start: number; end: number } | null {
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
        className={`${renderedMarkdownStyles.renderedMarkdownStyles} markdown markdown-document rendered-diff-line`}
        dangerouslySetInnerHTML={{
          __html: renderMarkdownDocumentHtml(source, { commentBlocks: false }),
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

type RenderedChangeKind = "changed" | "added" | "removed";

export interface RenderedChangeCard {
  id: string;
  kind: RenderedChangeKind;
  before?: RenderedDiffRow;
  after?: RenderedDiffRow;
  sourceRows: RenderedDiffRow[];
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
      rows.push(...renderedFencedCodeRows(block.lines));
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
      previous.lineLabel = mergeRenderedLineLabels(
        previous.lineLabel,
        row.lineLabel,
      );
      continue;
    }
    grouped.push({ ...row });
  }
  return grouped.filter((row) => row.source.trim().length > 0);
}

function mergeRenderedLineLabels(first: string, second: string): string {
  const firstRange = renderedLineLabelRange(first);
  const secondRange = renderedLineLabelRange(second);
  if (!firstRange || !secondRange) return first;
  const start = Math.min(firstRange.start, secondRange.start);
  const end = Math.max(firstRange.end, secondRange.end);
  return start === end ? String(start) : `${start}-${end}`;
}

function renderedLineLabelRange(
  label: string,
): { start: number; end: number } | null {
  const match = /^(\d+)(?:-(\d+))?$/.exec(label);
  if (!match) return null;
  const start = Number(match[1]);
  const end = Number(match[2] ?? match[1]);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return null;
  return { start, end };
}

export function buildRenderedChangeCards(
  rows: RenderedDiffRow[],
): RenderedChangeCard[] {
  const cards: RenderedChangeCard[] = [];
  let index = 0;
  while (index < rows.length) {
    const row = rows[index];
    if (!row) break;
    if (row.kind === "gap" || row.kind === "context") {
      index += 1;
      continue;
    }
    const next = rows[index + 1];
    if (row.kind === "remove" && next?.kind === "add") {
      cards.push({
        id: renderedChangeCardId(cards.length, "changed", row, next),
        kind: "changed",
        before: row,
        after: next,
        sourceRows: [row, next],
      });
      index += 2;
      continue;
    }
    if (row.kind === "add") {
      cards.push({
        id: renderedChangeCardId(cards.length, "added", row),
        kind: "added",
        after: row,
        sourceRows: [row],
      });
      index += 1;
      continue;
    }
    if (row.kind === "remove") {
      cards.push({
        id: renderedChangeCardId(cards.length, "removed", row),
        kind: "removed",
        before: row,
        sourceRows: [row],
      });
      index += 1;
      continue;
    }
    cards.push({
      id: renderedChangeCardId(cards.length, "changed", row),
      kind: "changed",
      after: row,
      sourceRows: [row],
    });
    index += 1;
  }
  return cards;
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

function renderedFencedCodeRows(
  lines: Array<ParsedDiffLine & { kind: "context" | "add" | "remove" }>,
): RenderedDiffRow[] {
  const kind = diffKindForLines(lines);
  if (kind !== "mixed") return [renderedFencedCodeRow(kind, lines)];
  return [
    renderedFencedCodeRow(
      "remove",
      lines.filter((line) => line.kind !== "add"),
    ),
    renderedFencedCodeRow(
      "add",
      lines.filter((line) => line.kind !== "remove"),
    ),
  ];
}

function renderedFencedCodeRow(
  kind: RenderedDiffRow["kind"],
  lines: Array<ParsedDiffLine & { kind: "context" | "add" | "remove" }>,
): RenderedDiffRow {
  const source = lines.map((line) => line.text).join("\n");
  const opening = lines[0]?.text.trim() ?? "```";
  const closingIndex = lastFenceIndex(lines, opening.slice(0, 3));
  const contentLines =
    closingIndex > 0 ? lines.slice(1, closingIndex) : lines.slice(1);
  const language = opening.replace(/^(```+|~~~+)/, "").trim() || "text";
  return {
    kind,
    lineLabel: lineLabelForRenderedKind(kind, lines),
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

function renderedChangeCardId(
  index: number,
  kind: RenderedChangeKind,
  row: RenderedDiffRow,
  pairedRow?: RenderedDiffRow,
): string {
  const label = pairedRow
    ? `${row.lineLabel}-${pairedRow.lineLabel}`
    : row.lineLabel;
  return `${kind}-${index}-${label || "block"}`;
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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeHtmlAttribute(value: string): string {
  return escapeHtml(value).replace(/"/g, "&quot;");
}
