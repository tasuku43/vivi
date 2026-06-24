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
import {
  DiffToggleButton,
  ViewerToolbar,
  ViewerModeButton,
} from "../components/ViewerControlButton.js";
import { DiffViewer } from "./DiffViewer.js";

type HtmlRenderedThreadTarget = {
  blockId: string;
  blockIds: string[];
  draft: CommentDraft;
  rect: DOMRectLike;
};

export function HtmlViewer({
  file,
  allowHtmlScripts,
  mode: controlledMode,
  focusLineNumber,
  focusRevision,
  toolbarAction,
  diff,
  diffLoading,
  diffEnabled,
  theme = "dark",
  onModeChange,
  onDiffToggle,
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
  focusLineNumber?: number | null;
  focusRevision?: number;
  toolbarAction?: ReactNode;
  diff?: TextDiff | null;
  diffLoading?: boolean;
  diffEnabled?: boolean;
  theme?: ResolvedTheme;
  onModeChange?: (mode: ViewerMode) => void;
  onDiffToggle?: () => void;
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
  const [renderedThreadTargets, setRenderedThreadTargets] = useState<
    HtmlRenderedThreadTarget[]
  >([]);
  const [renderedThreadPositions, setRenderedThreadPositions] = useState<
    Record<string, HtmlRenderedThreadPosition>
  >({});
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const sourceRef = useRef<HTMLDivElement | null>(null);
  const mode =
    controlledMode === "source" || controlledMode === "preview"
      ? controlledMode
      : localMode;
  const htmlSourceBlocks = renderedCommentBlocksForHtml(file.content);
  const setMode = (nextMode: ViewerMode) => {
    setSourceSelectionComment(null);
    setRenderedThreadTargets([]);
    setLocalMode(nextMode);
    onModeChange?.(nextMode);
  };

  useEffect(() => {
    setSourceSelectionComment(null);
    setRenderedThreadTargets([]);
  }, [file.content, file.path]);

  const postRenderedCommentState = () => {
    const frame = iframeRef.current?.contentWindow;
    if (!frame) return;
    frame.postMessage(
      {
        type: "vivi-html-comments",
        path: file.path,
        activeCommentId,
        draftingBlockIds: renderedThreadTargets.flatMap(
          (target) => target.blockIds,
        ),
        openBlockIds: renderedThreadTargets.flatMap(
          (target) => target.blockIds,
        ),
        openBlockIdGroups: renderedThreadTargets.map(
          (target) => target.blockIds,
        ),
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
          setRenderedThreadTargets((items) =>
            items.map((item) =>
              sameBlockIds(item.blockIds, data.blockIds ?? []) &&
              !sameRect(item.rect, rect)
                ? { ...item, rect }
                : item,
            ),
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
        setRenderedThreadTargets([]);
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
        return;
      }
      openRenderedDraft(target);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [comments, file.content, file.path, onCloseComment, onOpenComment]);

  useEffect(() => {
    postRenderedCommentState();
    const timeout = window.setTimeout(postRenderedCommentState, 0);
    return () => window.clearTimeout(timeout);
  }, [activeCommentId, comments, file.path, mode, renderedThreadTargets]);

  useLayoutEffect(() => {
    if (!renderedThreadTargets.length) {
      setRenderedThreadPositions({});
      return;
    }
    const update = () =>
      setRenderedThreadPositions(
        Object.fromEntries(
          renderedThreadTargets.map((target) => [
            renderedHtmlThreadTargetKey(file.path, target),
            positionHtmlRenderedThread(target.rect),
          ]),
        ),
      );
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [file.path, renderedThreadTargets]);

  const openRenderedDraft = (
    target: RenderedCommentBlockTarget,
    comment?: ViviComment,
  ) => {
    const mappedRange = sourceRangeForHtmlTarget(
      file.content,
      htmlSourceBlocks,
      target,
    );
    const nextTarget: HtmlRenderedThreadTarget = {
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
    };
    const key = renderedHtmlThreadTargetKey(file.path, nextTarget);
    setRenderedThreadTargets((items) => [
      ...items.filter(
        (item) => renderedHtmlThreadTargetKey(file.path, item) !== key,
      ),
      nextTarget,
    ]);
  };

  const closeRenderedThread = () => {
    setRenderedThreadTargets([]);
    onCloseComment?.();
  };

  const closeRenderedThreadTarget = (key: string) => {
    setRenderedThreadTargets((items) =>
      items.filter(
        (item) => renderedHtmlThreadTargetKey(file.path, item) !== key,
      ),
    );
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

  const renderedThreadEntries = renderedThreadTargets.map((target) => {
    const threadComments = commentsForRenderedHtmlTarget(target, comments);
    const thread = renderedThreadModel(file.path, target.draft, threadComments);
    const threadId =
      thread.comments[0]?.threadId ??
      thread.comments[0]?.id ??
      target.draft.threadId;
    const key = renderedHtmlThreadTargetKey(file.path, target);
    return {
      key,
      position: renderedThreadPositions[key],
      target,
      thread,
      threadId,
    };
  });

  return (
    <section className="html-viewer">
      <ViewerToolbar
        status={`sandboxed · scripts ${allowHtmlScripts ? "on" : "off"}`}
      >
        <div className="segmented-control" aria-label="HTML view mode">
          <ViewerModeButton
            active={mode === "preview"}
            mode="preview"
            path={file.path}
            onClick={() => setMode("preview")}
          >
            Preview
          </ViewerModeButton>
          <ViewerModeButton
            active={mode === "source"}
            mode="source"
            path={file.path}
            onClick={() => setMode("source")}
          >
            Source
          </ViewerModeButton>
        </div>
        {toolbarAction}
        <DiffToggleButton
          enabled={diffEnabled}
          path={file.path}
          onToggle={onDiffToggle}
        />
      </ViewerToolbar>
      {diffEnabled ? (
        <DiffViewer
          path={file.path}
          diff={diff ?? null}
          loading={diffLoading}
          renderKind={mode === "source" ? "source" : "html"}
          theme={theme}
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
          focusLineNumber={focusLineNumber}
          focusRevision={focusRevision}
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
      {renderedThreadEntries.map((entry) =>
        entry.position ? (
          <div
            key={entry.key}
            className="html-rendered-comment-thread-host"
            style={
              {
                left: entry.position.left,
                top: entry.position.top,
                width: entry.position.width,
                maxHeight: entry.position.maxHeight,
              } as CSSProperties
            }
          >
            <CodeCommentThread
              className="rendered-comment-thread html-rendered-comment-thread"
              thread={entry.thread}
              draft={entry.target.draft}
              activity={
                entry.threadId ? threadActivities[entry.threadId] : undefined
              }
              onCreateComment={onCreateComment}
              onStatusChange={onCommentStatusChange}
              onClose={() => closeRenderedThreadTarget(entry.key)}
            />
          </div>
        ) : null,
      )}
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
  rect:
    | { left: number; top: number; width: number; height: number }
    | undefined,
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

function sameBlockIds(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    left.every((id, index) => id === right[index])
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
    status: "open",
    comments,
  };
}

function renderedHtmlThreadTargetKey(
  path: string,
  target: { blockIds: string[]; draft: CommentDraft },
): string {
  const lineStart = target.draft.anchor.canonical.lineStart ?? null;
  const lineEnd = target.draft.anchor.canonical.lineEnd ?? lineStart;
  return target.draft.threadId
    ? JSON.stringify(["thread", target.draft.threadId])
    : JSON.stringify([path, lineStart, lineEnd, target.blockIds.join("|")]);
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
    top: Math.min(
      Math.max(belowTop, margin),
      window.innerHeight - margin - 180,
    ),
    width,
    maxHeight,
  };
}

function positiveNumber(value: number | undefined): number | undefined {
  return Number.isInteger(value) && value !== undefined && value > 0
    ? value
    : undefined;
}
