import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { TextDiff } from "../../../domain/change-review.js";
import type { ViviComment } from "../../../domain/comments.js";
import type { FilePayload } from "../../../domain/fs-node.js";
import { renderedCommentBlocksForHtml } from "../../../domain/rendered-comment-blocks.js";
import type { CommentActivitySummary } from "../../../state/comment-activity.js";
import {
  lineRangeForQuote,
  renderedCommentDraft,
  scheduleSelectionCommentUpdate,
  selectionCommentTargetInElement,
  sourceCommentDraft,
  sourceTextForLineRange,
  type CodeCommentThread as CodeCommentThreadModel,
  type CommentCreateHandler,
  type CommentDraft,
  type CommentStatusChangeHandler,
} from "../../../state/comments.js";
import type { LineRange } from "../../../state/code-viewer.js";
import {
  renderedCommentSummaryForComment,
  type RenderedCommentBlockTarget,
} from "../../../state/rendered-comment-blocks.js";
import type { ResolvedTheme } from "../../../state/theme.js";
import type { ViewerMode } from "../../../state/viewer-mode.js";
import { CodeCommentThread } from "../../comments/components/CodeCommentThread.js";
import { CommentedSourceLines } from "../../comments/components/CommentedSourceLines.js";
import { SelectionCommentComposer } from "../../comments/components/SelectionCommentComposer.js";
import { DiffViewer } from "./DiffViewer.js";

export function HtmlViewer({
  file,
  allowHtmlScripts,
  mode: controlledMode,
  toolbarAction,
  diff,
  diffLoading,
  diffEnabled,
  diffFocusChanges,
  theme = "dark",
  onModeChange,
  onDiffToggle,
  onDiffFocusChange,
  onCreateComment,
  comments = [],
  activeCommentId,
  onOpenComment,
  onCloseComment,
  onCommentStatusChange,
  threadActivities = {},
  previewSrcDoc,
}: {
  file: FilePayload;
  allowHtmlScripts: boolean;
  mode?: ViewerMode;
  toolbarAction?: ReactNode;
  diff?: TextDiff | null;
  diffLoading?: boolean;
  diffEnabled?: boolean;
  diffFocusChanges?: boolean;
  theme?: ResolvedTheme;
  onModeChange?: (mode: ViewerMode) => void;
  onDiffToggle?: () => void;
  onDiffFocusChange?: (focusChanges: boolean) => void;
  onCreateComment?: CommentCreateHandler;
  comments?: ViviComment[];
  activeCommentId?: string | null;
  onOpenComment?: (id: string, rect: DOMRectLike) => void;
  onCloseComment?: () => void;
  onCommentStatusChange?: CommentStatusChangeHandler;
  threadActivities?: Record<string, CommentActivitySummary>;
  previewSrcDoc?: string;
}) {
  const [localMode, setLocalMode] = useState<ViewerMode>("preview");
  const [sourceSelectionComment, setSourceSelectionComment] = useState<{
    draft: CommentDraft;
    rect: DOMRectLike;
  } | null>(null);
  const [renderedThreadTarget, setRenderedThreadTarget] = useState<{
    blockId: string;
    blockIds: string[];
    draft: CommentDraft;
    rect: DOMRectLike;
  } | null>(null);
  const [renderedThreadPosition, setRenderedThreadPosition] =
    useState<HtmlRenderedThreadPosition | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const sourceRef = useRef<HTMLDivElement | null>(null);
  const mode =
    controlledMode === "source" || controlledMode === "preview"
      ? controlledMode
      : localMode;
  const htmlSourceBlocks = renderedCommentBlocksForHtml(file.content);
  const setMode = (nextMode: ViewerMode) => {
    setSourceSelectionComment(null);
    setRenderedThreadTarget(null);
    setLocalMode(nextMode);
    onModeChange?.(nextMode);
  };

  useEffect(() => {
    setSourceSelectionComment(null);
    setRenderedThreadTarget(null);
  }, [file.content, file.path]);

  const postRenderedCommentState = () => {
    const frame = iframeRef.current?.contentWindow;
    if (!frame) return;
    frame.postMessage(
      {
        type: "vivi-html-comments",
        path: file.path,
        activeCommentId,
        draftingBlockIds: renderedThreadTarget?.blockIds ?? [],
        openBlockIds: renderedThreadTarget?.blockIds ?? [],
        comments: comments
          .map((comment) => renderedCommentSummaryForComment(comment, "html"))
          .filter(Boolean),
      },
      "*",
    );
  };

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data as {
        type?: string;
        path?: string;
        id?: string;
        blockId?: string;
        blockIds?: string[];
        text?: string;
        selector?: string;
        sourceLineStart?: number;
        sourceLineEnd?: number;
        rect?: { left: number; top: number; width: number; height: number };
      } | null;
      if (data?.path !== file.path) return;
      if (data.type === "vivi-html-thread-layout") {
        const rect = rectFromIframe(data.rect, iframeRef.current);
        if (rect) {
          setRenderedThreadTarget((current) =>
            current && !sameRect(current.rect, rect)
              ? { ...current, rect }
              : current,
          );
        }
        return;
      }
      if (data.type === "vivi-html-comment-open") {
        if (!data.id) return;
        const comment = comments.find((item) => item.id === data.id);
        const target = renderedTargetFromMessage(data, iframeRef.current);
        if (!comment || !target) return;
        openRenderedDraft(target, comment);
        onOpenComment?.(data.id, target.rect);
        return;
      }
      if (data.type === "vivi-html-comment-clear") {
        setRenderedThreadTarget(null);
        onCloseComment?.();
        return;
      }
      if (
        data?.type !== "vivi-html-block-target" ||
        typeof data.text !== "string"
      ) {
        return;
      }
      const target = renderedTargetFromMessage(data, iframeRef.current);
      if (!target) {
        setRenderedThreadTarget(null);
        return;
      }
      openRenderedDraft(target);
      onCloseComment?.();
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [comments, file.content, file.path, onCloseComment, onOpenComment]);

  useEffect(() => {
    postRenderedCommentState();
    const timeout = window.setTimeout(postRenderedCommentState, 0);
    return () => window.clearTimeout(timeout);
  }, [activeCommentId, comments, file.path, mode, renderedThreadTarget]);

  useLayoutEffect(() => {
    if (!renderedThreadTarget) {
      setRenderedThreadPosition(null);
      return;
    }
    const update = () =>
      setRenderedThreadPosition(
        positionHtmlRenderedThread(renderedThreadTarget.rect),
      );
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [renderedThreadTarget]);

  const openRenderedDraft = (
    target: RenderedCommentBlockTarget,
    comment?: ViviComment,
  ) => {
    const mappedRange = sourceRangeForHtmlTarget(
      file.content,
      htmlSourceBlocks,
      target,
    );
    setRenderedThreadTarget({
      blockId: target.blockId,
      blockIds: target.blockIds,
      rect: target.rect,
      draft: {
        ...renderedCommentDraft(file, "html", {
          text: target.text,
          blockId: target.blockId,
          selector: target.selector,
          sourceLineStart: mappedRange?.start,
          sourceLineEnd: mappedRange?.end,
          sourceQuote: sourceTextForLineRange(file.content, mappedRange),
        }),
        threadId: comment?.threadId ?? comment?.id,
      },
    });
  };

  const closeRenderedThread = () => {
    setRenderedThreadTarget(null);
    onCloseComment?.();
  };

  const updateSourceSelectionComment = () => {
    const selection = selectionCommentTargetInElement(sourceRef.current);
    if (!selection) {
      setSourceSelectionComment(null);
      return;
    }
    setSourceSelectionComment({
      draft: sourceCommentDraft(
        file,
        lineRangeForQuote(file.content, selection.text),
        selection.text,
      ),
      rect: selection.rect,
    });
  };

  const renderedThreadComments = renderedThreadTarget
    ? commentsForRenderedHtmlTarget(renderedThreadTarget, comments)
    : [];
  const renderedThread = renderedThreadTarget
    ? renderedThreadModel(
        file.path,
        renderedThreadTarget.draft,
        renderedThreadComments,
      )
    : null;
  const renderedThreadId =
    renderedThread?.comments[0]?.threadId ??
    renderedThread?.comments[0]?.id ??
    renderedThreadTarget?.draft.threadId;

  return (
    <section className="html-viewer">
      <div className="viewer-toolbar">
        <strong>{file.path}</strong>
        <span className="sandbox-status">
          sandboxed · scripts {allowHtmlScripts ? "on" : "off"}
        </span>
        <div className="viewer-toolbar-actions">
          <div className="segmented-control" aria-label="HTML view mode">
            <button
              className={mode === "preview" ? "active" : ""}
              type="button"
              onClick={() => setMode("preview")}
            >
              Preview
            </button>
            <button
              className={mode === "source" ? "active" : ""}
              type="button"
              onClick={() => setMode("source")}
            >
              Source
            </button>
          </div>
          {toolbarAction}
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
          renderKind={mode === "source" ? "source" : "html"}
          theme={theme}
          onFocusChangesChange={onDiffFocusChange}
          onCreateComment={onCreateComment}
          file={file}
          comments={comments}
          activeCommentId={activeCommentId}
          onOpenComment={onOpenComment}
          onCommentStatusChange={onCommentStatusChange}
          threadActivities={threadActivities}
        />
      ) : mode === "preview" ? (
        <div className="html-preview-stage">
          <iframe
            ref={iframeRef}
            className="html-frame"
            key={file.etag}
            title={file.path}
            sandbox="allow-scripts"
            onLoad={postRenderedCommentState}
            srcDoc={previewSrcDoc}
            src={
              previewSrcDoc
                ? undefined
                : `/preview/html?path=${encodeURIComponent(file.path)}&theme=${theme}&v=${encodeURIComponent(file.etag)}`
            }
          />
        </div>
      ) : (
        <CommentedSourceLines
          content={file.content}
          className="markdown-source"
          containerRef={sourceRef}
          comments={comments}
          activeCommentId={activeCommentId}
          onOpenComment={onOpenComment}
          onMouseUp={() =>
            scheduleSelectionCommentUpdate(updateSourceSelectionComment)
          }
          onKeyUp={updateSourceSelectionComment}
        />
      )}
      <SelectionCommentComposer
        draft={sourceSelectionComment?.draft ?? null}
        rect={sourceSelectionComment?.rect ?? null}
        onSave={onCreateComment}
        onDismiss={() => setSourceSelectionComment(null)}
      />
      {renderedThread && renderedThreadTarget && renderedThreadPosition ? (
        <div
          className="html-rendered-comment-thread-host"
          style={
            {
              left: renderedThreadPosition.left,
              top: renderedThreadPosition.top,
              width: renderedThreadPosition.width,
              maxHeight: renderedThreadPosition.maxHeight,
            } as CSSProperties
          }
        >
          <CodeCommentThread
            className="rendered-comment-thread html-rendered-comment-thread"
            thread={renderedThread}
            draft={renderedThreadTarget.draft}
            activity={
              renderedThreadId ? threadActivities[renderedThreadId] : undefined
            }
            onCreateComment={onCreateComment}
            onStatusChange={onCommentStatusChange}
            onClose={closeRenderedThread}
          />
        </div>
      ) : null}
    </section>
  );
}

interface DOMRectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface HtmlRenderedThreadPosition {
  left: number;
  top: number;
  width: number;
  maxHeight?: number;
}

function renderedTargetFromMessage(
  data: {
    blockId?: string;
    blockIds?: string[];
    text?: string;
    selector?: string;
    sourceLineStart?: number;
    sourceLineEnd?: number;
    rect?: { left: number; top: number; width: number; height: number };
  },
  iframe: HTMLIFrameElement | null,
): RenderedCommentBlockTarget | null {
  const text = data.text?.trim();
  const rect = rectFromIframe(data.rect, iframe);
  const blockId = data.blockId?.trim();
  if (!text || !rect || !blockId) return null;
  const blockIds = (data.blockIds?.length ? data.blockIds : [blockId]).filter(
    Boolean,
  );
  return {
    blockId,
    blockIds,
    text,
    selector: data.selector,
    sourceLineStart: positiveNumber(data.sourceLineStart),
    sourceLineEnd: positiveNumber(data.sourceLineEnd),
    rect,
  };
}

function rectFromIframe(
  rect: { left: number; top: number; width: number; height: number } | undefined,
  iframe: HTMLIFrameElement | null,
): DOMRectLike | null {
  const iframeRect = iframe?.getBoundingClientRect();
  if (!rect || !iframeRect) return null;
  return {
    left: iframeRect.left + rect.left,
    top: iframeRect.top + rect.top,
    width: rect.width,
    height: rect.height,
  };
}

function sameRect(left: DOMRectLike, right: DOMRectLike): boolean {
  return (
    left.left === right.left &&
    left.top === right.top &&
    left.width === right.width &&
    left.height === right.height
  );
}

function sourceRangeForHtmlTarget(
  content: string,
  blocks: ReturnType<typeof renderedCommentBlocksForHtml>,
  target: RenderedCommentBlockTarget,
): LineRange | null {
  if (target.sourceLineStart) {
    return {
      start: target.sourceLineStart,
      end: target.sourceLineEnd ?? target.sourceLineStart,
    };
  }
  const mappedBlocks = target.blockIds
    .map((blockId) => blocks.find((block) => block.blockId === blockId))
    .filter((block): block is NonNullable<typeof block> => Boolean(block));
  if (mappedBlocks.length) {
    return {
      start: mappedBlocks[0].sourceLineStart,
      end: mappedBlocks.at(-1)?.sourceLineEnd ?? mappedBlocks[0].sourceLineEnd,
    };
  }
  return lineRangeForQuote(content, target.text);
}

function commentsForRenderedHtmlTarget(
  target: { blockIds: string[]; draft: CommentDraft },
  comments: ViviComment[],
): ViviComment[] {
  const targetStart = target.draft.anchor.canonical.lineStart;
  const targetEnd =
    target.draft.anchor.canonical.lineEnd ??
    target.draft.anchor.canonical.lineStart;
  const targetBlockIds = new Set(target.blockIds);
  return comments
    .filter((comment) => {
      const summary = renderedCommentSummaryForComment(comment, "html");
      const lineStart = comment.anchor.canonical.lineStart;
      const lineEnd =
        comment.anchor.canonical.lineEnd ?? comment.anchor.canonical.lineStart;
      if (
        targetStart !== undefined &&
        targetEnd !== undefined &&
        lineStart !== undefined &&
        lineEnd !== undefined
      ) {
        return lineStart === targetStart && lineEnd === targetEnd;
      }
      return Boolean(summary?.blockId && targetBlockIds.has(summary.blockId));
    })
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function renderedThreadModel(
  path: string,
  draft: CommentDraft,
  comments: ViviComment[],
): CodeCommentThreadModel {
  const lineStart = draft.anchor.canonical.lineStart ?? 1;
  const lineEnd = draft.anchor.canonical.lineEnd ?? lineStart;
  return {
    key: draft.threadId
      ? JSON.stringify(["thread", draft.threadId])
      : JSON.stringify([path, lineStart, lineEnd]),
    path,
    lineStart,
    lineEnd,
    comments,
  };
}

function positionHtmlRenderedThread(
  rect: DOMRectLike,
): HtmlRenderedThreadPosition {
  const width = Math.min(680, Math.max(340, window.innerWidth - 24));
  const margin = 12;
  const gap = 12;
  const sideLeft = rect.left + rect.width + gap;
  const sideFits = sideLeft + width + margin <= window.innerWidth;
  const left = sideFits
    ? sideLeft
    : Math.min(Math.max(rect.left, margin), window.innerWidth - width - margin);
  const belowTop = rect.top + rect.height + 8;
  const maxHeight = Math.max(180, window.innerHeight - belowTop - margin);
  return {
    left,
    top: Math.min(Math.max(belowTop, margin), window.innerHeight - margin - 180),
    width,
    maxHeight,
  };
}

function positiveNumber(value: number | undefined): number | undefined {
  return Number.isInteger(value) && value !== undefined && value > 0
    ? value
    : undefined;
}
