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
  matchingDraftPreviewThread,
  matchingOpenThreadForDraft,
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
import { useCommentInputSessions } from "../CommentInputSessionProvider.js";
import railStyles from "./LineCommentRail.module.css";
import styles from "./SourceCommentSurface.module.css";

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
  currentActorId,
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
  currentActorId?: string;
  onSelectionChange: (range: LineRange | null) => void;
  onCreateComment?: CommentCreateHandler;
  onOpenComment?: (id: string, rect: DOMRectLike) => void;
  onCloseComment?: () => void;
  onCommentStatusChange?: CommentStatusChangeHandler;
  threadActivities?: Record<string, CommentActivitySummary>;
}) {
  const commentInputs = useCommentInputSessions();
  const [anchorLine, setAnchorLine] = useState<number | null>(null);
  const [openThreads, setOpenThreads] = useState<OpenSourceThread[]>([]);
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
    pointerId: number;
    opensCommentOnClick: boolean;
  } | null>(null);
  const suppressLineClickRef = useRef(false);
  const lines = splitCodeLines(file.content);
  const selected = selectedRange
    ? normalizeLineRange(selectedRange.start, selectedRange.end, lines.length)
    : null;
  const commentThreads = codeCommentThreads(comments);
  const pathInputSessions = commentInputs.sessions.filter(
    (session) =>
      session.draft.path === file.path &&
      session.draft.anchor.surface === "source",
  );
  const draftThreads: SourceDraftThread[] = pathInputSessions
    .filter((session) => session.status !== "collapsed")
    .flatMap((session) => {
      const lineStart = session.draft.anchor.canonical.lineStart;
      if (!lineStart) return [];
      const lineEnd = session.draft.anchor.canonical.lineEnd ?? lineStart;
      return [
        {
          thread: {
            key: codeCommentThreadKey(file.path, lineStart, lineEnd),
            path: file.path,
            lineStart,
            lineEnd,
            status: "open" as const,
            comments: [],
          },
          draft: session.draft,
        },
      ];
    });
  const activeThread = activeCommentId
    ? commentThreads.find((thread) =>
        thread.comments.some((comment) => comment.id === activeCommentId),
      )
    : undefined;
  const visibleThreadKeys = new Set<string>();
  const hasDraftThreads = draftThreads.length > 0;
  for (const draftThread of draftThreads) {
    visibleThreadKeys.add(
      matchingOpenThreadForDraft(commentThreads, draftThread.draft)?.key ??
        matchingDraftPreviewThread(commentThreads, draftThread.thread)?.key ??
        draftThread.thread.key,
    );
  }
  if (!hasDraftThreads) {
    for (const openThread of openThreads) {
      visibleThreadKeys.add(
        matchingOpenSourceThread(commentThreads, openThread)?.key ??
          openThread.key,
      );
    }
  }
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
    setOpenThreads([]);
  }, [file.path]);

  useEffect(() => {
    commentInputs.markPathVersion(file.path, file.etag);
  }, [commentInputs.markPathVersion, file.etag, file.path]);

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

  function beginLineDrag(
    event: React.PointerEvent,
    lineNumber: number,
    opensCommentOnClick = false,
  ) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    window.getSelection()?.removeAllRanges();
    lineDragRef.current = {
      start: lineNumber,
      current: lineNumber,
      moved: false,
      pointerId: event.pointerId,
      opensCommentOnClick,
    };
    try {
      linesRef.current?.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture can fail in non-browser renderers; drag still works via React events.
    }
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

  function trackLineDrag(event: React.PointerEvent) {
    const drag = lineDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const row = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>(".code-line[data-line]");
    const lineNumber = Number(row?.dataset.line);
    if (Number.isInteger(lineNumber) && lineNumber > 0) {
      extendLineDrag(lineNumber);
    }
  }

  function finishLineDrag(event: React.PointerEvent) {
    const drag = lineDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    lineDragRef.current = null;
    try {
      linesRef.current?.releasePointerCapture(event.pointerId);
    } catch {
      // Capture may already be released by the browser on pointer cancel.
    }
    setLineDragging(false);
    if (!drag.moved) {
      if (!drag.opensCommentOnClick) return;
      suppressLineClickRef.current = true;
      window.setTimeout(() => {
        suppressLineClickRef.current = false;
      }, 0);
      startLineComment(drag.start);
      return;
    }
    const range = normalizeLineRange(drag.start, drag.current, lines.length);
    suppressLineClickRef.current = true;
    window.setTimeout(() => {
      suppressLineClickRef.current = false;
    }, 0);
    startRangeComment(
      range,
      lines.slice(range.start - 1, range.end).join("\n"),
    );
  }

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
    const draft = sourceCommentDraft(file, normalized, quote);
    const existingThread = matchingOpenThreadForDraft(commentThreads, draft);
    if (existingThread) {
      setOpenThreads((items) =>
        items.some((item) => item.key === existingThread.key)
          ? items
          : [
              ...items,
              {
                key: existingThread.key,
                path: existingThread.path,
                lineStart: existingThread.lineStart,
                lineEnd: existingThread.lineEnd,
              },
            ],
      );
      setAnchorLine(normalized.start);
      onSelectionChange(normalized);
      return;
    }
    const nextDraftThread: SourceDraftThread = {
      thread: {
        key,
        path: file.path,
        lineStart: normalized.start,
        lineEnd: normalized.end,
        status: "open",
        comments: [],
      },
      draft,
    };
    setOpenThreads([]);
    commentInputs.start(nextDraftThread.draft);
    setAnchorLine(normalized.start);
    onSelectionChange(normalized);
    onCloseComment?.();
  }

  function openCommentThread(
    thread: (typeof commentThreads)[number],
    target?: Element,
  ) {
    setOpenThreads((items) =>
      items.some((item) => item.key === thread.key)
        ? items
        : [
            ...items,
            {
              key: thread.key,
              path: thread.path,
              lineStart: thread.lineStart,
              lineEnd: thread.lineEnd,
            },
          ],
    );
    onSelectionChange({ start: thread.lineStart, end: thread.lineEnd });
    const firstComment = thread.comments[0];
    if (firstComment && target) {
      onOpenComment?.(firstComment.id, rectLikeFromElement(target));
    }
  }

  function closeCommentThread(
    threadKey: string,
    thread?: CodeCommentThreadModel,
  ) {
    for (const session of pathInputSessions) {
      const lineStart = session.draft.anchor.canonical.lineStart;
      if (!lineStart) continue;
      const lineEnd = session.draft.anchor.canonical.lineEnd ?? lineStart;
      const matchingPublished = matchingOpenThreadForDraft(
        commentThreads,
        session.draft,
      );
      if (
        matchingPublished?.key === threadKey ||
        codeCommentThreadKey(file.path, lineStart, lineEnd) === threadKey
      ) {
        commentInputs.collapse(session.id);
      }
    }
    setOpenThreads((items) =>
      items.filter(
        (item) =>
          item.key !== threadKey &&
          !(
            thread &&
            item.path === thread.path &&
            item.lineStart === thread.lineStart &&
            item.lineEnd === thread.lineEnd
          ),
      ),
    );
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
      className={`${styles.sourceCommentSurfaceStyles} ${railStyles.lineCommentRailStyles} code-lines source-comment-surface${lineDragging ? " is-line-dragging" : ""}${className ? ` ${className}` : ""}`}
      role="list"
      ref={linesRef}
      onMouseUp={() => scheduleSelectionCommentUpdate(updateSelectionComment)}
      onPointerMove={trackLineDrag}
      onPointerUp={finishLineDrag}
      onPointerCancel={finishLineDrag}
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
        const rowThreads = lineThreads.filter(
          (thread) => thread.lineEnd === lineNumber,
        );
        const rowThread = preferredCodeCommentThread(
          rowThreads,
          activeCommentId,
        );
        const displayedThreads = commentThreads.filter(
          (thread) =>
            visibleThreadKeys.has(thread.key) && thread.lineEnd === lineNumber,
        );
        const actionThread = displayedThreads[0] ?? rowThread;
        const actionSurface = actionThread?.comments[0]?.anchor.surface;
        const actionStackThreads = actionSurface
          ? rowThreads.filter(
              (thread) => thread.comments[0]?.anchor.surface === actionSurface,
            )
          : rowThreads;
        const actionStack =
          actionStackThreads.length > 1
            ? {
                threadCount: actionStackThreads.length,
                messageCount: actionStackThreads.reduce(
                  (count, thread) => count + thread.comments.length,
                  0,
                ),
              }
            : undefined;
        const actionLabel = lineCommentThreadActionLabel(
          lineNumber,
          actionThread,
          actionStack,
        );
        const inputAtLine = pathInputSessions.some((session) => {
          const inputStart = session.draft.anchor.canonical.lineStart;
          const inputEnd = session.draft.anchor.canonical.lineEnd ?? inputStart;
          return Boolean(
            inputStart &&
            inputEnd &&
            lineNumber >= inputStart &&
            lineNumber <= inputEnd,
          );
        });
        const draftThread = draftThreads.find(
          (candidate) =>
            !matchingDraftPreviewThread(commentThreads, candidate.thread) &&
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
        const threadOpen = Boolean(displayedThreads.length || draftingThread);
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
        const threadsForDisplay = [
          ...displayedThreads.map((thread) => {
            const threadId =
              thread.comments[0]?.threadId ?? thread.comments[0]?.id;
            return {
              thread,
              threadId,
              draft: {
                ...sourceCommentDraft(
                  file,
                  {
                    start: thread.lineStart,
                    end: thread.lineEnd,
                  },
                  lines.slice(thread.lineStart - 1, thread.lineEnd).join("\n"),
                ),
                threadId,
              },
            };
          }),
          ...(draftingThread && draftThread
            ? [
                {
                  thread: draftThread.thread,
                  threadId: undefined,
                  draft: sourceCommentDraft(
                    file,
                    {
                      start: draftThread.thread.lineStart,
                      end: draftThread.thread.lineEnd,
                    },
                    draftThread.draft.anchor.canonical.quote,
                  ),
                },
              ]
            : []),
        ];
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
                className={`code-line-comment-action${actionThread || inputAtLine ? " has-thread" : ""}`}
                type="button"
                aria-expanded={threadOpen}
                aria-label={actionLabel}
                title={actionLabel}
                data-comment-id={actionThread?.comments[0]?.id}
                data-comment-surface="source"
                data-line={lineNumber}
                data-path={file.path}
                data-testid="line-comment-action"
                onPointerDown={(event) => {
                  if (!actionThread) beginLineDrag(event, lineNumber, true);
                }}
                onClick={(event) => {
                  event.stopPropagation();
                  if (suppressLineClickRef.current) return;
                  if (threadOpen) {
                    for (const entry of threadsForDisplay) {
                      closeCommentThread(entry.thread.key, entry.thread);
                    }
                  } else if (actionStackThreads.length > 1) {
                    for (const thread of actionStackThreads) {
                      openCommentThread(thread, event.currentTarget);
                    }
                  } else if (actionThread) {
                    openCommentThread(actionThread, event.currentTarget);
                  } else {
                    startLineComment(lineNumber);
                  }
                }}
              >
                {actionThread || inputAtLine ? (
                  <span className="code-line-comment-count">
                    {actionThread
                      ? (actionStack?.threadCount ??
                        actionThread.comments.length)
                      : "•"}
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
            {threadsForDisplay.map((entry) => (
              <div
                className="code-comment-thread-row"
                role="listitem"
                key={entry.thread.key}
              >
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
                  onClose={() =>
                    closeCommentThread(entry.thread.key, entry.thread)
                  }
                />
              </div>
            ))}
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

interface OpenSourceThread {
  key: string;
  path: string;
  lineStart: number;
  lineEnd: number;
}

function matchingOpenSourceThread(
  threads: CodeCommentThreadModel[],
  openThread: OpenSourceThread,
): CodeCommentThreadModel | undefined {
  return (
    threads.find((thread) => thread.key === openThread.key) ??
    threads.find(
      (thread) =>
        thread.path === openThread.path &&
        thread.lineStart === openThread.lineStart &&
        thread.lineEnd === openThread.lineEnd,
    )
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
