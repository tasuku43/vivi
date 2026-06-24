import { Fragment, useEffect, useRef, useState } from "react";
import type { ViviComment } from "../../../domain/comments.js";
import type { FilePayload } from "../../../domain/fs-node.js";
import type { CommentActivitySummary } from "../../../state/comment-activity.js";
import {
  lineInRange,
  normalizeLineRange,
  splitCodeLines,
  type LineRange,
} from "../../../state/code-viewer.js";
import {
  codeCommentThreadKey,
  codeCommentThreads,
  commentsForLine,
  flushDeferredSourceHighlightState,
  hasTextSelectionInElement,
  lineCommentThreadActionLabel,
  lineRangeForQuote,
  matchingCodeCommentThread,
  nextDeferredSourceHighlightState,
  preferredCodeCommentThread,
  rectLikeFromElement,
  scheduleSelectionCommentUpdate,
  selectedLineRangeInElement,
  selectionCommentTargetInElement,
  sourceCommentDraft,
  sourceLineCommentDraft,
  type CodeCommentThread as CodeCommentThreadModel,
  type CommentCreateHandler,
  type CommentDraft,
  type CommentStatusChangeHandler,
} from "../../../state/comments.js";
import { CodeCommentThread } from "./CodeCommentThread.js";

type SourceDraftThread = {
  thread: CodeCommentThreadModel;
  draft: CommentDraft;
};

export function SourceCommentSurface({
  file,
  highlightedLines,
  selectedRange,
  focusLineNumber,
  focusRevision = 0,
  className,
  comments = [],
  activeCommentId,
  expandActiveCommentThread = true,
  onSelectionChange,
  onCreateComment,
  onOpenComment,
  onCloseComment,
  onCommentStatusChange,
  threadActivities = {},
}: {
  file: FilePayload;
  highlightedLines?: string[] | null;
  selectedRange: LineRange | null;
  focusLineNumber?: number | null;
  focusRevision?: number;
  className?: string;
  comments?: ViviComment[];
  activeCommentId?: string | null;
  expandActiveCommentThread?: boolean;
  onSelectionChange: (range: LineRange | null) => void;
  onCreateComment?: CommentCreateHandler;
  onOpenComment?: (id: string, rect: DOMRectLike) => void;
  onCloseComment?: () => void;
  onCommentStatusChange?: CommentStatusChangeHandler;
  threadActivities?: Record<string, CommentActivitySummary>;
}) {
  const [anchorLine, setAnchorLine] = useState<number | null>(null);
  const [draftThreads, setDraftThreads] = useState<SourceDraftThread[]>([]);
  const [openThreadKeys, setOpenThreadKeys] = useState<string[]>([]);
  const [lineDragging, setLineDragging] = useState(false);
  const [highlightState, setHighlightState] = useState(() => ({
    visible: highlightedLines ?? null,
    pending: highlightedLines ?? null,
  }));
  const linesRef = useRef<HTMLDivElement | null>(null);
  const lineDragRef = useRef<{
    start: number;
    current: number;
    moved: boolean;
  } | null>(null);
  const suppressLineClickRef = useRef(false);
  const lines = splitCodeLines(file.content);
  const selected = selectedRange
    ? normalizeLineRange(selectedRange.start, selectedRange.end, lines.length)
    : null;
  const commentThreads = codeCommentThreads(comments);
  const activeThread = activeCommentId
    ? commentThreads.find((thread) =>
        thread.comments.some((comment) => comment.id === activeCommentId),
      )
    : undefined;
  const visibleThreadKeys = new Set<string>();
  for (const draftThread of draftThreads) {
    visibleThreadKeys.add(
      matchingCodeCommentThread(commentThreads, draftThread.thread)?.key ??
        draftThread.thread.key,
    );
  }
  for (const key of openThreadKeys) visibleThreadKeys.add(key);
  if (expandActiveCommentThread && activeThread) {
    visibleThreadKeys.add(activeThread.key);
  }

  useEffect(() => {
    setHighlightState((state) =>
      nextDeferredSourceHighlightState(
        state,
        highlightedLines,
        hasTextSelectionInElement(linesRef.current),
      ),
    );
  }, [highlightedLines]);

  useEffect(() => {
    setAnchorLine(null);
    setOpenThreadKeys([]);
    setDraftThreads([]);
  }, [file.path]);

  useEffect(() => {
    if (!focusLineNumber) return;
    const line = linesRef.current?.querySelector<HTMLElement>(
      `.code-line[data-line="${focusLineNumber}"]`,
    );
    if (!line) return;
    const frame = window.requestAnimationFrame(() => {
      line.scrollIntoView({ block: "center", behavior: "smooth" });
      if (!line.hasAttribute("tabindex")) line.tabIndex = -1;
      line.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [file.path, focusLineNumber, focusRevision]);

  function selectLine(lineNumber: number, shiftKey: boolean) {
    const next =
      shiftKey && anchorLine
        ? normalizeLineRange(anchorLine, lineNumber, lines.length)
        : normalizeLineRange(lineNumber, lineNumber, lines.length);
    setAnchorLine(shiftKey && anchorLine ? anchorLine : lineNumber);
    onSelectionChange(next);
  }

  function beginLineDrag(event: React.PointerEvent, lineNumber: number) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    window.getSelection()?.removeAllRanges();
    lineDragRef.current = {
      start: lineNumber,
      current: lineNumber,
      moved: false,
    };
    setLineDragging(true);
    setAnchorLine(lineNumber);
    onSelectionChange({ start: lineNumber, end: lineNumber });
  }

  function extendLineDrag(lineNumber: number) {
    const drag = lineDragRef.current;
    if (!drag || drag.current === lineNumber) return;
    drag.current = lineNumber;
    drag.moved = true;
    onSelectionChange(normalizeLineRange(drag.start, lineNumber, lines.length));
  }

  useEffect(() => {
    const trackLineDrag = (event: PointerEvent) => {
      if (!lineDragRef.current) return;
      const row = document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest<HTMLElement>(".code-line[data-line]");
      const lineNumber = Number(row?.dataset.line);
      if (Number.isInteger(lineNumber) && lineNumber > 0) {
        extendLineDrag(lineNumber);
      }
    };
    const finishLineDrag = () => {
      const drag = lineDragRef.current;
      lineDragRef.current = null;
      setLineDragging(false);
      if (!drag?.moved) return;
      const range = normalizeLineRange(drag.start, drag.current, lines.length);
      suppressLineClickRef.current = true;
      window.setTimeout(() => {
        suppressLineClickRef.current = false;
      }, 0);
      startRangeComment(
        range,
        lines.slice(range.start - 1, range.end).join("\n"),
      );
    };
    window.addEventListener("pointermove", trackLineDrag);
    window.addEventListener("pointerup", finishLineDrag);
    window.addEventListener("pointercancel", finishLineDrag);
    return () => {
      window.removeEventListener("pointermove", trackLineDrag);
      window.removeEventListener("pointerup", finishLineDrag);
      window.removeEventListener("pointercancel", finishLineDrag);
    };
  }, [file.path, file.content]);

  function updateSelectionComment() {
    const selection = selectionCommentTargetInElement(linesRef.current);
    if (!selection) {
      flushDeferredHighlights();
      return;
    }
    const range =
      selectedLineRangeInElement(linesRef.current) ??
      lineRangeForQuote(file.content, selection.text);
    if (!range) {
      flushDeferredHighlights();
      return;
    }
    startRangeComment(range, selection.text);
    window.getSelection()?.removeAllRanges();
    flushDeferredHighlights();
  }

  function flushDeferredHighlights() {
    setHighlightState(flushDeferredSourceHighlightState);
  }

  function startLineComment(lineNumber: number) {
    const range =
      selected && selected.end === lineNumber
        ? selected
        : { start: lineNumber, end: lineNumber };
    startRangeComment(
      range,
      lines.slice(range.start - 1, range.end).join("\n"),
    );
  }

  function startRangeComment(range: LineRange, quote?: string) {
    const normalized = normalizeLineRange(range.start, range.end, lines.length);
    const key = codeCommentThreadKey(
      file.path,
      normalized.start,
      normalized.end,
    );
    const nextDraftThread: SourceDraftThread = {
      thread: {
        key,
        path: file.path,
        lineStart: normalized.start,
        lineEnd: normalized.end,
        status: "open",
        comments: [],
      },
      draft: sourceCommentDraft(file, normalized, quote),
    };
    setDraftThreads((items) => [
      ...items.filter((item) => item.thread.key !== key),
      nextDraftThread,
    ]);
    setAnchorLine(normalized.start);
    onSelectionChange(normalized);
  }

  function openCommentThread(
    thread: (typeof commentThreads)[number],
    target?: Element,
  ) {
    setOpenThreadKeys((keys) =>
      keys.includes(thread.key) ? keys : [...keys, thread.key],
    );
    onSelectionChange({ start: thread.lineStart, end: thread.lineEnd });
    const firstComment = thread.comments[0];
    if (firstComment && target) {
      onOpenComment?.(firstComment.id, rectLikeFromElement(target));
    }
  }

  function closeCommentThread(threadKey: string) {
    setDraftThreads((items) =>
      items.filter((item) => item.thread.key !== threadKey),
    );
    setOpenThreadKeys((keys) => keys.filter((key) => key !== threadKey));
    onSelectionChange(null);
    onCloseComment?.();
  }

  useEffect(() => {
    if (!activeCommentId) return;
    if (activeThread) {
      onSelectionChange({
        start: activeThread.lineStart,
        end: activeThread.lineEnd,
      });
    }
    const comment = linesRef.current?.querySelector<HTMLElement>(
      `[data-comment-id="${CSS.escape(activeCommentId)}"]`,
    );
    if (!comment) return;
    const frame = window.requestAnimationFrame(() => {
      comment.scrollIntoView({ block: "center", behavior: "smooth" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeCommentId]);

  return (
    <div
      className={`code-lines source-comment-surface${lineDragging ? " is-line-dragging" : ""}${className ? ` ${className}` : ""}`}
      role="list"
      ref={linesRef}
      onMouseUp={() => scheduleSelectionCommentUpdate(updateSelectionComment)}
      onKeyUp={updateSelectionComment}
    >
      {lines.map((line, index) => {
        const lineNumber = index + 1;
        const selectedLine = lineInRange(lineNumber, selected);
        const searchFocusLine = focusLineNumber === lineNumber;
        const selectionStart = selected?.start === lineNumber;
        const selectionEnd = selected?.end === lineNumber;
        const highlighted = highlightState.visible?.[index];
        const lineComments = commentsForLine(comments, lineNumber);
        const lineThreads = commentThreads.filter(
          (thread) =>
            lineNumber >= thread.lineStart && lineNumber <= thread.lineEnd,
        );
        const containingThread = preferredCodeCommentThread(
          lineThreads,
          activeCommentId,
        );
        const rowThread = preferredCodeCommentThread(
          lineThreads.filter((thread) => thread.lineEnd === lineNumber),
          activeCommentId,
        );
        const displayedThread = commentThreads.find(
          (thread) =>
            visibleThreadKeys.has(thread.key) && thread.lineEnd === lineNumber,
        );
        const actionThread = displayedThread ?? rowThread;
        const draftThread = draftThreads.find(
          (candidate) =>
            !matchingCodeCommentThread(commentThreads, candidate.thread) &&
            lineNumber >= candidate.thread.lineStart &&
            lineNumber <= candidate.thread.lineEnd,
        );
        const draftingRangeLine = Boolean(
          draftThread &&
          lineNumber >= draftThread.thread.lineStart &&
          lineNumber <= draftThread.thread.lineEnd,
        );
        const draftingThread = Boolean(
          draftingRangeLine && draftThread?.thread.lineEnd === lineNumber,
        );
        const threadOpen = Boolean(displayedThread || draftingThread);
        const activeCommentLine = lineComments.some(
          (comment) => comment.id === activeCommentId,
        );
        const classNames = [
          "code-line",
          searchFocusLine ? "search-focus" : "",
          selectedLine ? "selected" : "",
          selectionStart ? "selection-start" : "",
          selectionEnd ? "selection-end" : "",
          lineComments.length ? "has-comment" : "",
          activeCommentLine ? "active-comment" : "",
          draftingRangeLine ? "drafting-comment" : "",
        ]
          .filter(Boolean)
          .join(" ");
        const threadForDisplay =
          displayedThread ??
          (draftingThread && draftThread ? draftThread.thread : null);
        const threadDraft = displayedThread
          ? {
              ...sourceCommentDraft(
                file,
                {
                  start: displayedThread.lineStart,
                  end: displayedThread.lineEnd,
                },
                lines
                  .slice(displayedThread.lineStart - 1, displayedThread.lineEnd)
                  .join("\n"),
              ),
              threadId:
                displayedThread.comments[0]?.threadId ??
                displayedThread.comments[0]?.id,
            }
          : (draftThread?.draft ?? sourceLineCommentDraft(file, lineNumber));
        const threadId =
          threadForDisplay?.comments[0]?.threadId ??
          threadForDisplay?.comments[0]?.id;
        return (
          <Fragment key={lineNumber}>
            <div
              className={classNames}
              data-line={lineNumber}
              role="listitem"
              onPointerEnter={() => extendLineDrag(lineNumber)}
              onClick={(event) => {
                if (containingThread) {
                  event.stopPropagation();
                  openCommentThread(containingThread, event.currentTarget);
                  return;
                }
                selectLine(lineNumber, event.shiftKey);
              }}
            >
              <button
                className={`code-line-comment-action${actionThread ? " has-thread" : ""}`}
                type="button"
                aria-expanded={threadOpen}
                aria-label={lineCommentThreadActionLabel(
                  lineNumber,
                  actionThread,
                )}
                title={lineCommentThreadActionLabel(lineNumber, actionThread)}
                data-comment-id={actionThread?.comments[0]?.id}
                data-comment-surface="source"
                data-line={lineNumber}
                data-path={file.path}
                data-testid="line-comment-action"
                onClick={(event) => {
                  event.stopPropagation();
                  if (threadOpen) {
                    closeCommentThread(threadForDisplay?.key ?? "");
                  } else if (actionThread) {
                    openCommentThread(actionThread, event.currentTarget);
                  } else {
                    startLineComment(lineNumber);
                  }
                }}
              >
                {actionThread ? (
                  <span className="code-line-comment-count">
                    {actionThread.comments.length}
                  </span>
                ) : null}
              </button>
              <button
                className="line-number"
                type="button"
                aria-label={`Select line ${lineNumber}`}
                onPointerDown={(event) => beginLineDrag(event, lineNumber)}
                onClick={(event) => {
                  event.stopPropagation();
                  if (suppressLineClickRef.current) return;
                  selectLine(lineNumber, event.shiftKey);
                }}
              >
                {lineNumber}
              </button>
              <code
                className="line-code"
                dangerouslySetInnerHTML={{
                  __html: highlighted ?? escapeHtml(line || " "),
                }}
              />
            </div>
            {threadForDisplay ? (
              <div className="code-comment-thread-row" role="listitem">
                <CodeCommentThread
                  thread={threadForDisplay}
                  draft={threadDraft}
                  activity={threadId ? threadActivities[threadId] : undefined}
                  activeCommentId={activeCommentId}
                  onCreateComment={onCreateComment}
                  onStatusChange={onCommentStatusChange}
                  onClose={() => closeCommentThread(threadForDisplay.key)}
                />
              </div>
            ) : null}
          </Fragment>
        );
      })}
    </div>
  );
}

interface DOMRectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
