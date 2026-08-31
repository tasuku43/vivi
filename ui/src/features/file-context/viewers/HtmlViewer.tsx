import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { TextDiff } from "../../../domain/change-review.js";
import type { ViviComment } from "../../../domain/comments.js";
import type { FilePayload } from "../../../domain/fs-node.js";
import { renderedCommentBlocksForHtml } from "../../../domain/rendered-comment-blocks.js";
import {
  isHumanFeedback,
  type CommentActivitySummary,
} from "../../../state/comment-activity.js";
import {
  commentAnchorThreadKey,
  codeCommentThreads,
  lineRangeForQuote,
  isDraftThreadComment,
  matchingDraftPreviewThread,
  renderedCommentDraft,
  sourceTextForLineRange,
  type CodeCommentThread as CodeCommentThreadModel,
  type CommentCreateHandler,
  type CommentDraft,
} from "../../../state/comments.js";
import {
  commentInputSessionId,
  commentInputSessionIsCollapsed,
  unsavedCommentInputCount,
} from "../../../state/comment-input-session.js";
import type { LineRange } from "../../../state/code-viewer.js";
import { extractHighlightedLines } from "../../../state/highlighted-lines.js";
import {
  renderedCommentSummaryForComment,
  type RenderedCommentBlockTarget,
} from "../../../state/rendered-comment-blocks.js";
import type { ResolvedTheme } from "../../../state/theme.js";
import type { ViewerMode } from "../../../state/viewer-mode.js";
import {
  positionRenderedCommentThread,
  renderedCommentContentBounds,
  sameRenderedCommentThreadPosition,
  type RenderedCommentThreadPosition,
} from "../../../state/rendered-comment-position.js";
import { CodeCommentThread } from "../../comments/components/CodeCommentThread.js";
import {
  useCommentInputResumePaneId,
  useCommentInputSessions,
} from "../../comments/CommentInputSessionProvider.js";
import { SourceCommentSurface } from "../../comments/components/SourceCommentSurface.js";
import {
  DiffToggleButton,
  SourceInputReturnButton,
  ViewerToolbar,
  ViewerModeButton,
} from "../components/ViewerControlButton.js";
import { DiffViewer } from "./DiffViewer.js";
import surfaceStyles from "./ViewerSurface.module.css";

type HtmlRenderedThreadTarget = {
  blockId: string;
  blockIds: string[];
  draft: CommentDraft;
  reanchorDraft?: CommentDraft;
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
  currentActorId,
  onOpenComment,
  onCloseComment,
  threadActivities = {},
  previewSrcDoc,
  onOpenPath,
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
  currentActorId?: string;
  onOpenComment?: (id: string, rect: DOMRectLike) => void;
  onCloseComment?: () => void;
  threadActivities?: Record<string, CommentActivitySummary>;
  previewSrcDoc?: string;
  onOpenPath?: (path: string) => void;
}) {
  const commentInputs = useCommentInputSessions();
  const resumePaneId = useCommentInputResumePaneId();
  const sourceInputCount = unsavedCommentInputCount(
    commentInputs.sessions,
    file.path,
    "source",
  );
  const [localMode, setLocalMode] = useState<ViewerMode>("preview");
  const [sourceSelectedRange, setSourceSelectedRange] =
    useState<LineRange | null>(null);
  const [renderedThreadTargets, setRenderedThreadTargets] = useState<
    HtmlRenderedThreadTarget[]
  >([]);
  const [renderedThreadPosition, setRenderedThreadPosition] =
    useState<RenderedCommentThreadPosition | null>(null);
  const [resumeFocus, setResumeFocus] = useState<{
    sessionId: string;
    revision: number;
  } | null>(null);
  const [highlightedSourceHtml, setHighlightedSourceHtml] = useState<{
    content: string;
    theme: ResolvedTheme;
    html: string;
  } | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const viewerRef = useRef<HTMLElement | null>(null);
  const lastProcessedResumeRevisionRef = useRef(0);
  const renderedThreadTargetsRef = useRef(renderedThreadTargets);
  renderedThreadTargetsRef.current = renderedThreadTargets;
  const renderedThreadStateKey = htmlRenderedThreadStateKey(
    renderedThreadTargets,
  );
  const mode =
    controlledMode === "source" || controlledMode === "preview"
      ? controlledMode
      : localMode;
  const highlightedSourceLines = useMemo(
    () =>
      highlightedSourceHtml?.content === file.content &&
      highlightedSourceHtml.theme === theme
        ? extractHighlightedLines(highlightedSourceHtml.html)
        : null,
    [file.content, highlightedSourceHtml, theme],
  );
  const htmlSourceBlocks = renderedCommentBlocksForHtml(file.content);
  const visibleRenderedComments = useMemo(
    () =>
      comments.filter(
        (comment) => isDraftThreadComment(comment) || isHumanFeedback(comment),
      ),
    [comments],
  );
  const setMode = (nextMode: ViewerMode) => {
    setSourceSelectedRange(null);
    setRenderedThreadTargets([]);
    setLocalMode(nextMode);
    onModeChange?.(nextMode);
  };

  useEffect(() => {
    setSourceSelectedRange(null);
    setRenderedThreadTargets([]);
    setHighlightedSourceHtml(null);
  }, [file.content, file.path]);

  useEffect(() => {
    commentInputs.markPathVersion(file.path, file.etag);
  }, [commentInputs.markPathVersion, file.etag, file.path]);

  useEffect(() => {
    if (mode !== "source" || diffEnabled) return;
    let cancelled = false;
    import("../../../state/highlighter.js")
      .then(({ highlightCode }) => highlightCode(file.content, "html", theme))
      .then((highlighted) => {
        if (!cancelled) {
          setHighlightedSourceHtml({
            content: file.content,
            theme,
            html: highlighted,
          });
        }
      })
      .catch(() => {
        if (!cancelled) setHighlightedSourceHtml(null);
      });
    return () => {
      cancelled = true;
    };
  }, [diffEnabled, file.content, mode, theme]);

  const postRenderedCommentState = () => {
    const frame = iframeRef.current?.contentWindow;
    if (!frame) return;
    frame.postMessage(
      {
        type: "vivi-html-comments",
        path: file.path,
        activeCommentId,
        draftingBlockIds: renderedThreadTargetsRef.current.flatMap(
          (target) => target.blockIds,
        ),
        openBlockIds: renderedThreadTargetsRef.current.flatMap(
          (target) => target.blockIds,
        ),
        openBlockIdGroups: renderedThreadTargetsRef.current.map(
          (target) => target.blockIds,
        ),
        comments: visibleRenderedComments
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
        targetPath?: string;
      } | null;
      if (data?.path !== file.path) return;
      if (data.type === "vivi-html-open-path") {
        if (typeof data.targetPath === "string") onOpenPath?.(data.targetPath);
        return;
      }
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
        const comment = visibleRenderedComments.find(
          (item) => item.id === data.id,
        );
        const target = renderedTargetFromMessage(data, iframeRef.current);
        if (!comment || !target) return;
        openRenderedDraft(target, comment);
        onOpenComment?.(data.id, target.rect);
        return;
      }
      if (data.type === "vivi-html-comment-clear") {
        const hasUnsentInput = renderedThreadTargets.some((target) =>
          commentInputs.sessions.some(
            (session) =>
              session.id === commentInputSessionId(target.draft) &&
              !commentInputSessionIsCollapsed(session),
          ),
        );
        if (hasUnsentInput) return;
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
  }, [
    file.content,
    file.path,
    onCloseComment,
    onOpenComment,
    onOpenPath,
    commentInputs.sessions,
    renderedThreadTargets,
    visibleRenderedComments,
  ]);

  useEffect(() => {
    postRenderedCommentState();
  }, [
    activeCommentId,
    file.path,
    mode,
    renderedThreadStateKey,
    visibleRenderedComments,
  ]);

  useLayoutEffect(() => {
    if (!renderedThreadTargets.length) {
      setRenderedThreadPosition(null);
      return;
    }
    const update = () => {
      const viewerRect = viewerRef.current?.getBoundingClientRect();
      const toolbarRect = viewerRef.current
        ?.querySelector<HTMLElement>(":scope > .viewer-toolbar")
        ?.getBoundingClientRect();
      const nextPosition = positionRenderedCommentThread(
        renderedThreadTargets[0]!.rect,
        {
          width: window.innerWidth,
          height: window.innerHeight,
        },
        viewerRect
          ? renderedCommentContentBounds(
              {
                left: viewerRect.left,
                top: viewerRect.top,
                width: viewerRect.width,
                height: viewerRect.height,
              },
              toolbarRect
                ? {
                    left: toolbarRect.left,
                    top: toolbarRect.top,
                    width: toolbarRect.width,
                    height: toolbarRect.height,
                  }
                : undefined,
            )
          : undefined,
        {
          width: 520,
          height: 430,
        },
      );
      setRenderedThreadPosition((current) =>
        sameRenderedCommentThreadPosition(current, nextPosition)
          ? current
          : nextPosition,
      );
    };
    update();
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => update());
    if (viewerRef.current) observer?.observe(viewerRef.current);
    const toolbar = viewerRef.current?.querySelector<HTMLElement>(
      ":scope > .viewer-toolbar",
    );
    if (toolbar) observer?.observe(toolbar);
    window.addEventListener("resize", update);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [renderedThreadTargets]);

  const openRenderedDraft = (
    target: RenderedCommentBlockTarget,
    comment?: ViviComment,
    draftOverride?: CommentDraft,
    persistInput = true,
  ) => {
    const mappedRange = sourceRangeForHtmlTarget(
      file.content,
      htmlSourceBlocks,
      target,
    );
    const currentDraft: CommentDraft = {
      ...renderedCommentDraft(file, "html", {
        text: target.text,
        blockId: target.blockId,
        selector: target.selector,
        sourceLineStart: mappedRange?.start,
        sourceLineEnd: mappedRange?.end,
        sourceQuote: sourceTextForLineRange(file.content, mappedRange),
      }),
      threadId: draftOverride?.threadId ?? comment?.threadId ?? comment?.id,
    };
    const nextTarget: HtmlRenderedThreadTarget = {
      blockId: target.blockId,
      blockIds: target.blockIds,
      rect: target.rect,
      draft: draftOverride ?? currentDraft,
      reanchorDraft: draftOverride ? currentDraft : undefined,
    };
    if (!comment && persistInput) {
      for (const existingTarget of renderedThreadTargets) {
        const existingId = commentInputSessionId(existingTarget.draft);
        if (existingId !== commentInputSessionId(nextTarget.draft)) {
          commentInputs.collapse(existingId);
        }
      }
      commentInputs.start(nextTarget.draft, target.rect);
    }
    setRenderedThreadTargets([nextTarget]);
  };

  useEffect(() => {
    if (mode !== "preview" || diffEnabled) return;
    const requestedSession =
      commentInputs.resumeIntent &&
      commentInputs.resumeIntent.paneId === resumePaneId &&
      commentInputs.resumeIntent.revision >
        lastProcessedResumeRevisionRef.current
        ? commentInputs.sessions.find(
            (candidate) =>
              candidate.id === commentInputs.resumeIntent?.sessionId,
          )
        : undefined;
    const requestedForViewer =
      requestedSession?.draft.path === file.path &&
      requestedSession.draft.anchor.surface === "rendered" &&
      requestedSession.draft.anchor.rendered?.kind === "html"
        ? requestedSession
        : undefined;
    if (renderedThreadTargets.length && !requestedForViewer) return;
    const session =
      requestedForViewer ??
      [...commentInputs.sessions]
        .reverse()
        .find(
          (candidate) =>
            candidate.draft.path === file.path &&
            !commentInputSessionIsCollapsed(candidate) &&
            candidate.rect &&
            candidate.draft.anchor.surface === "rendered" &&
            candidate.draft.anchor.rendered?.kind === "html",
        );
    const rendered = session?.draft.anchor.rendered;
    if (!session?.rect || !rendered) return;
    if (requestedForViewer) {
      lastProcessedResumeRevisionRef.current =
        commentInputs.resumeIntent?.revision ?? 0;
      setResumeFocus({
        sessionId: session.id,
        revision: lastProcessedResumeRevisionRef.current,
      });
      commentInputs.acknowledgeResume(
        lastProcessedResumeRevisionRef.current,
        resumePaneId,
      );
      for (const candidate of commentInputs.sessions) {
        if (
          candidate.id !== session.id &&
          candidate.draft.path === file.path &&
          candidate.draft.anchor.surface === "rendered" &&
          candidate.draft.anchor.rendered?.kind === "html" &&
          !commentInputSessionIsCollapsed(candidate)
        ) {
          commentInputs.collapse(candidate.id);
        }
      }
    }
    openRenderedDraft(
      {
        blockId: rendered.blockId ?? "restored-html-block",
        blockIds: rendered.blockId ? [rendered.blockId] : [],
        selector: rendered.selector,
        text: rendered.textQuote ?? session.draft.anchor.canonical.quote ?? "",
        rect: session.rect,
        sourceLineStart: session.draft.anchor.canonical.lineStart,
        sourceLineEnd: session.draft.anchor.canonical.lineEnd,
      },
      undefined,
      session.draft,
      false,
    );
  }, [
    commentInputs.sessions,
    commentInputs.resumeIntent,
    diffEnabled,
    file.path,
    mode,
    renderedThreadTargets.length,
  ]);

  const closeRenderedThreadTarget = (key: string) => {
    const closingTarget = renderedThreadTargets.find(
      (target) => renderedHtmlThreadTargetKey(file.path, target) === key,
    );
    if (closingTarget) {
      const closingAnchorKey = commentAnchorThreadKey(
        file.path,
        closingTarget.draft.anchor,
      );
      for (const session of commentInputs.sessions) {
        if (
          commentAnchorThreadKey(session.draft.path, session.draft.anchor) ===
          closingAnchorKey
        ) {
          commentInputs.collapse(session.id);
        }
      }
    }
    setRenderedThreadTargets((items) =>
      items.filter(
        (item) => renderedHtmlThreadTargetKey(file.path, item) !== key,
      ),
    );
    onCloseComment?.();
  };

  const renderedThreadEntries = renderedThreadTargets.map((target) => {
    const threadComments = commentsForRenderedHtmlTarget(
      target,
      visibleRenderedComments,
    );
    const threadId =
      threadComments[0]?.threadId ??
      threadComments[0]?.id ??
      target.draft.threadId;
    const feedbackDraft = threadId
      ? { ...target.draft, threadId }
      : target.draft;
    const thread = renderedThreadModel(
      file.path,
      feedbackDraft,
      threadComments,
    );
    const key = renderedHtmlThreadTargetKey(file.path, target);
    return {
      draft: feedbackDraft,
      key,
      position: renderedThreadPosition,
      target,
      thread,
      threadId,
    };
  });

  return (
    <section ref={viewerRef} className={`${surfaceStyles.viewer} html-viewer`}>
      <ViewerToolbar
        status={`sandboxed · scripts ${allowHtmlScripts ? "on" : "off"}`}
      >
        <div
          className={`${surfaceStyles.segmentedControl} segmented-control`}
          aria-label="HTML view mode"
        >
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
        {mode === "preview" ? (
          <SourceInputReturnButton
            count={sourceInputCount}
            onReturn={() => setMode("source")}
          />
        ) : null}
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
          currentActorId={currentActorId}
          onOpenComment={onOpenComment}
          threadActivities={threadActivities}
        />
      ) : mode === "preview" ? (
        <div className={`${surfaceStyles.htmlPreviewStage} html-preview-stage`}>
          <iframe
            ref={iframeRef}
            className={`${surfaceStyles.htmlFrame} html-frame`}
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
        <SourceCommentSurface
          file={file}
          highlightedLines={highlightedSourceLines}
          className={`markdown-source ${surfaceStyles.markdownSource}`}
          selectedRange={sourceSelectedRange}
          focusLineNumber={focusLineNumber}
          focusRevision={focusRevision}
          comments={comments}
          activeCommentId={activeCommentId}
          currentActorId={currentActorId}
          onSelectionChange={setSourceSelectedRange}
          onCreateComment={onCreateComment}
          onOpenComment={onOpenComment}
          onCloseComment={onCloseComment}
          threadActivities={threadActivities}
        />
      )}
      {renderedThreadEntries.map((entry) =>
        entry.position ? (
          <div
            key={entry.key}
            className={`${surfaceStyles.renderedCommentThreadHost} rendered-comment-thread-host html-rendered-comment-thread-host`}
            data-placement={entry.position.placement}
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
              draft={entry.draft}
              reanchorDraft={entry.target.reanchorDraft}
              activity={
                entry.threadId ? threadActivities[entry.threadId] : undefined
              }
              activeCommentId={activeCommentId}
              currentActorId={currentActorId}
              onCreateComment={onCreateComment}
              keepOpenAfterCreate
              focusRevision={
                resumeFocus?.sessionId === commentInputSessionId(entry.draft)
                  ? resumeFocus.revision
                  : 0
              }
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

export function htmlRenderedThreadStateKey(
  targets: readonly { blockIds: readonly string[] }[],
): string {
  return JSON.stringify(targets.map((target) => target.blockIds));
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
    { left: number; top: number; width: number; height: number } | undefined,
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
  if (target.draft.threadId) {
    return comments
      .filter(
        (comment) =>
          comment.path === target.draft.path &&
          (comment.threadId ?? comment.id) === target.draft.threadId,
      )
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  const renderedHtmlComments = comments.filter(
    (comment) =>
      comment.path === target.draft.path &&
      comment.anchor.surface === "rendered" &&
      comment.anchor.rendered?.kind === "html",
  );
  const draftThread = matchingDraftPreviewThread(
    codeCommentThreads(renderedHtmlComments),
    renderedThreadModel(target.draft.path, target.draft, []),
  );
  return draftThread?.comments ?? [];
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

function positiveNumber(value: number | undefined): number | undefined {
  return Number.isInteger(value) && value !== undefined && value > 0
    ? value
    : undefined;
}
