import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CSSProperties, MouseEvent, ReactNode } from "react";
import type { TextDiff } from "../../../domain/change-review.js";
import type { ViviComment } from "../../../domain/comments.js";
import type { FilePayload } from "../../../domain/fs-node.js";
import {
  isHumanFeedback,
  type CommentActivitySummary,
} from "../../../state/comment-activity.js";
import { renderedCommentBlockAttribute } from "../../../domain/rendered-comment-blocks.js";
import {
  codeCommentThreads,
  commentAnchorThreadKey,
  draftForNewComment,
  renderedCommentDraft,
  sourceTextForLineRange,
  isDraftThreadComment,
  matchingDraftPreviewThread,
  type CodeCommentThread as CodeCommentThreadModel,
  type CommentCreateHandler,
  type CommentDraft,
} from "../../../state/comments.js";
import type { LineRange } from "../../../state/code-viewer.js";
import { resolveWorkspaceLink } from "../../../state/workspace-links.js";
import {
  applyRenderedCommentHighlights,
  closestRenderedCommentBlock,
  findBlocksForRenderedComment,
  isInteractiveRenderedCommentTarget,
  renderedCommentSummaryForComment,
  rectLikeFromElement,
  type RenderedCommentBlockTarget,
  targetForRenderedCommentBlock,
  targetForRenderedCommentBlocks,
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
import {
  commentInputSessionId,
  commentInputSessionIsCollapsed,
  unsavedCommentInputCount,
  type CommentInputSession,
} from "../../../state/comment-input-session.js";
import { SourceCommentSurface } from "../../comments/components/SourceCommentSurface.js";
import {
  DiffToggleButton,
  SourceInputReturnButton,
  ViewerToolbar,
  ViewerModeButton,
} from "../components/ViewerControlButton.js";
import {
  injectMermaidPreviewBlocks,
  renderMarkdownDocumentHtml,
} from "../rendering/markdown-rendering.js";
import { renderMermaidBlocks } from "../rendering/mermaid-rendering.js";
import { DiffViewer } from "./DiffViewer.js";
import surfaceStyles from "./ViewerSurface.module.css";
import styles from "./MarkdownViewer.module.css";
import renderedMarkdownStyles from "./RenderedMarkdown.module.css";

export {
  injectMermaidPreviewBlocks,
  renderMarkdownDocumentHtml,
} from "../rendering/markdown-rendering.js";

type MarkdownRenderedThreadTarget = {
  blockId: string;
  blockIds: string[];
  draft: CommentDraft;
  reanchorDraft?: CommentDraft;
  rect: DOMRectLike;
};

export function MarkdownViewer({
  file,
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
  expandActiveCommentThread = true,
  currentActorId,
  onOpenComment,
  onCloseComment,
  threadActivities = {},
  onOpenPath,
}: {
  file: FilePayload;
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
  expandActiveCommentThread?: boolean;
  currentActorId?: string;
  onOpenComment?: (id: string, rect: DOMRectLike) => void;
  onCloseComment?: () => void;
  threadActivities?: Record<string, CommentActivitySummary>;
  onOpenPath?: (path: string) => void;
}) {
  const commentInputs = useCommentInputSessions();
  const resumePaneId = useCommentInputResumePaneId();
  const sourceInputCount = unsavedCommentInputCount(
    commentInputs.sessions,
    file.path,
    "source",
  );
  const [localMode, setLocalMode] = useState<ViewerMode>("rendered");
  const [renderedThreadTargets, setRenderedThreadTargets] = useState<
    MarkdownRenderedThreadTarget[]
  >([]);
  const [renderedThreadPosition, setRenderedThreadPosition] =
    useState<RenderedCommentThreadPosition | null>(null);
  const [resumeFocus, setResumeFocus] = useState<{
    sessionId: string;
    revision: number;
  } | null>(null);
  const [sourceSelectedRange, setSourceSelectedRange] =
    useState<LineRange | null>(null);
  const mode =
    controlledMode === "source" || controlledMode === "rendered"
      ? controlledMode
      : localMode;
  const html = renderMarkdownDocumentHtml(file.content);
  const markdownRef = useRef<HTMLElement | null>(null);
  const viewerRef = useRef<HTMLElement | null>(null);
  const lastProcessedResumeRevisionRef = useRef(0);
  const visibleRenderedComments = useMemo(
    () =>
      comments.filter(
        (comment) => isDraftThreadComment(comment) || isHumanFeedback(comment),
      ),
    [comments],
  );
  const setMode = (nextMode: ViewerMode) => {
    setRenderedThreadTargets([]);
    setLocalMode(nextMode);
    onModeChange?.(nextMode);
  };
  const renderPendingMermaid = useCallback(() => {
    if (mode !== "rendered" || diffEnabled) return;
    const markdown = markdownRef.current;
    if (!markdown) return;
    renderMermaidBlocks(markdown, theme);
  }, [diffEnabled, mode, theme]);
  useLayoutEffect(() => {
    if (mode !== "rendered" || diffEnabled || !markdownRef.current) return;
    markdownRef.current.innerHTML = html;
    renderPendingMermaid();
  }, [diffEnabled, html, mode, renderPendingMermaid]);

  useEffect(() => {
    renderPendingMermaid();
    const timeout = window.setTimeout(renderPendingMermaid, 0);
    return () => window.clearTimeout(timeout);
  });

  useLayoutEffect(() => {
    if (mode !== "rendered" || diffEnabled) return;
    applyRenderedCommentHighlights(
      markdownRef.current,
      visibleRenderedComments,
      activeCommentId,
      renderedThreadTargets.flatMap((target) => target.blockIds),
      "markdown",
      renderedThreadTargets.map((target) => target.blockIds),
    );
  }, [
    activeCommentId,
    diffEnabled,
    html,
    mode,
    renderedThreadTargets,
    visibleRenderedComments,
  ]);

  useEffect(() => {
    setRenderedThreadTargets([]);
  }, [file.path]);

  useLayoutEffect(() => {
    if (!renderedThreadTargets.length || !markdownRef.current) {
      setRenderedThreadPosition(null);
      return;
    }
    const update = () => {
      const target = renderedThreadTargets[0]!;
      const blocks = findBlocksForTargetIds(
        markdownRef.current,
        target.blockIds,
      );
      const anchorRect = blocks.length
        ? rectLikeForElements(blocks)
        : target.rect;
      const viewerRect = viewerRef.current?.getBoundingClientRect();
      const toolbarRect = viewerRef.current
        ?.querySelector<HTMLElement>(":scope > .viewer-toolbar")
        ?.getBoundingClientRect();
      const nextPosition = positionRenderedCommentThread(
        anchorRect,
        { width: window.innerWidth, height: window.innerHeight },
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
        { width: 520, height: 430 },
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
    if (markdownRef.current) observer?.observe(markdownRef.current);
    const toolbar = viewerRef.current?.querySelector<HTMLElement>(
      ":scope > .viewer-toolbar",
    );
    if (toolbar) observer?.observe(toolbar);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [html, renderedThreadTargets]);

  useEffect(() => {
    commentInputs.markPathVersion(file.path, file.etag);
  }, [commentInputs.markPathVersion, file.etag, file.path]);

  const openRenderedDraft = (
    target: RenderedCommentBlockTarget,
    blocks: HTMLElement[],
    comment?: ViviComment,
    draftOverride?: CommentDraft,
    persistInput = true,
  ) => {
    if (!blocks.length) return;
    const draft = renderedCommentDraft(file, "markdown", {
      text: target.text,
      blockId: target.blockId,
      selector: target.selector,
      sourceLineStart: target.sourceLineStart,
      sourceLineEnd: target.sourceLineEnd,
      sourceQuote: sourceTextForLineRange(
        file.content,
        sourceRangeForTarget(target),
      ),
    });
    const existingThreadId =
      draftOverride?.threadId ?? comment?.threadId ?? comment?.id;
    const currentDraft = {
      ...draft,
      threadId: existingThreadId,
    };
    const nextTarget: MarkdownRenderedThreadTarget = {
      blockId: target.blockId,
      blockIds: target.blockIds,
      rect: target.rect,
      // Resume must keep the exact persisted draft identity. Rebuilding the
      // anchor from the latest DOM would create a second empty session when the
      // file hash changed, hiding the body the reviewer asked to resume.
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

  useLayoutEffect(() => {
    if (mode !== "rendered" || diffEnabled || !markdownRef.current) return;
    const requestedSession =
      commentInputs.resumeIntent &&
      commentInputs.resumeIntent.paneId === resumePaneId &&
      commentInputs.resumeIntent.revision >
        lastProcessedResumeRevisionRef.current
        ? commentInputs.sessions.find(
            (session) => session.id === commentInputs.resumeIntent?.sessionId,
          )
        : undefined;
    const candidates =
      requestedSession?.draft.path === file.path &&
      requestedSession.draft.anchor.surface === "rendered" &&
      requestedSession.draft.anchor.rendered?.kind === "markdown"
        ? [requestedSession]
        : commentInputs.sessions;
    for (const session of candidates) {
      const rendered = session.draft.anchor.rendered;
      if (
        session.draft.path !== file.path ||
        commentInputSessionIsCollapsed(session) ||
        session.draft.anchor.surface !== "rendered" ||
        rendered?.kind !== "markdown"
      ) {
        continue;
      }
      const key = renderedThreadTargetKey(file.path, {
        blockIds: rendered.blockId ? [rendered.blockId] : [],
        draft: session.draft,
      });
      if (
        renderedThreadTargets.some(
          (target) =>
            renderedThreadTargetKey(file.path, target) === key ||
            commentAnchorThreadKey(file.path, target.draft.anchor) ===
              commentAnchorThreadKey(file.path, session.draft.anchor),
        )
      ) {
        if (requestedSession?.id === session.id) {
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
          collapseOtherRenderedMarkdownSessions(
            commentInputs.sessions,
            session.id,
            file.path,
            commentInputs.collapse,
          );
        }
        break;
      }
      const blocks = findBlocksForRenderedComment(markdownRef.current, {
        id: session.id,
        blockId: rendered.blockId,
        selector: rendered.selector,
        textQuote: rendered.textQuote ?? session.draft.anchor.canonical.quote,
        sourceLineStart: session.draft.anchor.canonical.lineStart,
        sourceLineEnd: session.draft.anchor.canonical.lineEnd,
        status: "draft",
      });
      if (!blocks.length) continue;
      const target = targetForRenderedCommentBlocks(blocks, rendered.textQuote);
      if (!target) continue;
      if (requestedSession?.id === session.id) {
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
        collapseOtherRenderedMarkdownSessions(
          commentInputs.sessions,
          session.id,
          file.path,
          commentInputs.collapse,
        );
      }
      blocks[0]?.scrollIntoView?.({ block: "center", inline: "nearest" });
      openRenderedDraft(target, blocks, undefined, session.draft, false);
      break;
    }
  }, [
    commentInputs.sessions,
    commentInputs.resumeIntent,
    diffEnabled,
    file.path,
    html,
    mode,
    renderedThreadTargets,
  ]);

  const openRenderedComment = (block: HTMLElement | null) => {
    const id = block?.dataset.viviCommentId;
    if (!id || !block) return false;
    const comment = visibleRenderedComments.find((item) => item.id === id);
    const summary = comment
      ? renderedCommentSummaryForComment(comment, "markdown")
      : null;
    const blocks =
      summary && markdownRef.current
        ? findBlocksForRenderedComment(markdownRef.current, summary)
        : [block];
    const target = targetForRenderedCommentBlocks(
      blocks.length ? blocks : [block],
    );
    if (!target) return false;
    openRenderedDraft(target, blocks.length ? blocks : [block], comment);
    onOpenComment?.(id, target?.rect ?? rectLikeFromElement(block));
    return true;
  };

  const startRenderedComment = (block: HTMLElement) => {
    const target = targetForRenderedCommentBlock(block);
    if (!target) return;
    openRenderedDraft(target, [block]);
    onCloseComment?.();
  };

  const closeRenderedThread = () => {
    for (const target of renderedThreadTargets) {
      commentInputs.collapse(commentInputSessionId(target.draft));
    }
    setRenderedThreadTargets([]);
    onCloseComment?.();
  };

  const closeRenderedThreadTarget = (key: string) => {
    const closingTarget = renderedThreadTargets.find(
      (item) => renderedThreadTargetKey(file.path, item) === key,
    );
    if (closingTarget) {
      commentInputs.collapse(commentInputSessionId(closingTarget.draft));
    }
    setRenderedThreadTargets((items) =>
      items.filter((item) => renderedThreadTargetKey(file.path, item) !== key),
    );
    onCloseComment?.();
  };

  const startNewRenderedFeedback = (target: MarkdownRenderedThreadTarget) => {
    const draft = draftForNewComment(target.reanchorDraft ?? target.draft);
    commentInputs.start(draft, target.rect);
    setRenderedThreadTargets([{ ...target, draft, reanchorDraft: undefined }]);
    onCloseComment?.();
  };

  useEffect(() => {
    if (
      mode !== "rendered" ||
      diffEnabled ||
      !activeCommentId ||
      renderedThreadTargets.length
    )
      return;
    const markdown = markdownRef.current;
    if (!markdown) return;
    const comment = visibleRenderedComments.find(
      (item) => item.id === activeCommentId,
    );
    if (!comment) return;
    const summary = renderedCommentSummaryForComment(comment, "markdown");
    if (!summary) return;
    const blocks = findBlocksForRenderedComment(markdown, summary);
    if (!blocks.length) return;
    const target = targetForRenderedCommentBlocks(blocks);
    if (!target) return;
    openRenderedDraft(target, blocks, comment);
  }, [
    activeCommentId,
    diffEnabled,
    file.path,
    mode,
    renderedThreadTargets,
    visibleRenderedComments,
  ]);

  const onRenderedClick = (event: MouseEvent<HTMLElement>) => {
    if (
      event.target instanceof Element &&
      event.target.closest(".rendered-comment-thread")
    ) {
      return;
    }
    if (openWorkspaceLink(event, file.path, markdownRef.current, onOpenPath)) {
      return;
    }
    const block = closestRenderedCommentBlock(
      markdownRef.current,
      event.target,
    );
    if (!block) {
      return;
    }
    if (
      event.target instanceof Element &&
      event.target.closest(".rendered-comment-marker")
    ) {
      event.preventDefault();
      openRenderedComment(block);
      return;
    }
    if (isInteractiveRenderedCommentTarget(event.target)) return;
    if (block.dataset.viviCommentId) {
      openRenderedComment(block);
    }
  };

  const onRenderedDoubleClick = (event: MouseEvent<HTMLElement>) => {
    if (
      event.target instanceof Element &&
      event.target.closest(".rendered-comment-thread")
    ) {
      return;
    }
    if (isInteractiveRenderedCommentTarget(event.target)) return;
    const block = closestRenderedCommentBlock(
      markdownRef.current,
      event.target,
    );
    if (!block) return;
    startRenderedComment(block);
  };

  const renderedThreadEntries = renderedThreadTargets.map((target) => {
    const threadComments = commentsForRenderedTarget(
      file.path,
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
    return {
      key: renderedThreadTargetKey(file.path, target),
      target: { ...target, draft: feedbackDraft },
      thread,
      threadId,
    };
  });

  return (
    <section
      ref={viewerRef}
      className={`${surfaceStyles.viewer} document-viewer`}
    >
      <ViewerToolbar
        actionsOnly
        ariaLabel={`Markdown viewer controls for ${file.path}`}
      >
        <div
          className={`${surfaceStyles.segmentedControl} segmented-control`}
          aria-label="Markdown view mode"
        >
          <ViewerModeButton
            active={mode === "rendered"}
            mode="rendered"
            path={file.path}
            onClick={() => setMode("rendered")}
          >
            Rendered
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
        {mode === "rendered" ? (
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
          renderKind={mode === "source" ? "source" : "markdown"}
          theme={theme}
          onCreateComment={onCreateComment}
          file={file}
          comments={comments}
          activeCommentId={activeCommentId}
          expandActiveCommentThread={expandActiveCommentThread}
          currentActorId={currentActorId}
          onOpenComment={onOpenComment}
          threadActivities={threadActivities}
        />
      ) : mode === "rendered" ? (
        <article
          className={`${styles.document} ${renderedMarkdownStyles.renderedMarkdownStyles} markdown markdown-document`}
          ref={markdownRef}
          onClick={onRenderedClick}
          onDoubleClick={onRenderedDoubleClick}
        />
      ) : (
        <SourceCommentSurface
          file={file}
          className={`markdown-source ${surfaceStyles.markdownSource}`}
          selectedRange={sourceSelectedRange}
          focusLineNumber={focusLineNumber}
          focusRevision={focusRevision}
          comments={comments}
          activeCommentId={activeCommentId}
          expandActiveCommentThread={expandActiveCommentThread}
          currentActorId={currentActorId}
          onSelectionChange={setSourceSelectedRange}
          onCreateComment={onCreateComment}
          onOpenComment={onOpenComment}
          onCloseComment={onCloseComment}
          threadActivities={threadActivities}
        />
      )}
      {renderedThreadEntries.map((entry) =>
        renderedThreadPosition ? (
          <div
            key={entry.key}
            className={`${surfaceStyles.renderedCommentThreadHost} rendered-comment-thread-host markdown-rendered-comment-thread-host`}
            data-placement={renderedThreadPosition.placement}
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
              className="rendered-comment-thread"
              thread={entry.thread}
              draft={entry.target.draft}
              reanchorDraft={entry.target.reanchorDraft}
              activity={
                entry.threadId ? threadActivities[entry.threadId] : undefined
              }
              activeCommentId={activeCommentId}
              currentActorId={currentActorId}
              onCreateComment={onCreateComment}
              onStartNewFeedback={() => startNewRenderedFeedback(entry.target)}
              keepOpenAfterCreate
              focusRevision={
                resumeFocus?.sessionId ===
                commentInputSessionId(entry.target.draft)
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

function collapseOtherRenderedMarkdownSessions(
  sessions: readonly CommentInputSession[],
  activeSessionId: string,
  path: string,
  collapse: (id: string) => void,
): void {
  for (const candidate of sessions) {
    if (
      candidate.id !== activeSessionId &&
      candidate.draft.path === path &&
      candidate.draft.anchor.surface === "rendered" &&
      candidate.draft.anchor.rendered?.kind === "markdown" &&
      !commentInputSessionIsCollapsed(candidate)
    ) {
      collapse(candidate.id);
    }
  }
}

interface DOMRectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

function sourceRangeForTarget(target: {
  sourceLineStart?: number;
  sourceLineEnd?: number;
}): LineRange | null {
  if (!target.sourceLineStart) return null;
  return {
    start: target.sourceLineStart,
    end: target.sourceLineEnd ?? target.sourceLineStart,
  };
}

function findBlocksForTargetIds(
  root: HTMLElement | null,
  blockIds: readonly string[],
): HTMLElement[] {
  if (!root || !blockIds.length) return [];
  const byId = new Set(blockIds);
  return Array.from(
    root.querySelectorAll<HTMLElement>(`[${renderedCommentBlockAttribute}]`),
  ).filter((block) => byId.has(block.dataset.viviCommentBlockId ?? ""));
}

function rectLikeForElements(elements: readonly HTMLElement[]): DOMRectLike {
  const rects = elements.map((element) => element.getBoundingClientRect());
  const left = Math.min(...rects.map((rect) => rect.left));
  const top = Math.min(...rects.map((rect) => rect.top));
  const right = Math.max(...rects.map((rect) => rect.right));
  const bottom = Math.max(...rects.map((rect) => rect.bottom));
  return { left, top, width: right - left, height: bottom - top };
}

function openWorkspaceLink(
  event: MouseEvent<HTMLElement>,
  currentPath: string,
  root: HTMLElement | null,
  onOpenPath: ((path: string) => void) | undefined,
): boolean {
  if (!onOpenPath || !(event.target instanceof Element) || !root) return false;
  const anchor = event.target.closest<HTMLAnchorElement>("a[href]");
  if (!anchor || !root.contains(anchor)) return false;
  const path = resolveWorkspaceLink(
    currentPath,
    anchor.getAttribute("href") ?? "",
  );
  if (!path) return false;
  event.preventDefault();
  event.stopPropagation();
  onOpenPath(path);
  return true;
}

function commentsForRenderedTarget(
  path: string,
  target: { blockIds: string[]; draft: CommentDraft },
  comments: ViviComment[],
): ViviComment[] {
  const markdownComments = comments.filter(
    (comment) => comment.path === path && comment.viewerKind === "markdown",
  );
  if (target.draft.threadId) {
    return markdownComments
      .filter(
        (comment) => (comment.threadId ?? comment.id) === target.draft.threadId,
      )
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  const renderedMarkdownComments = markdownComments.filter(
    (comment) =>
      comment.anchor.surface === "rendered" &&
      comment.anchor.rendered?.kind === "markdown",
  );
  const threads = codeCommentThreads(renderedMarkdownComments);
  const draftThread = matchingDraftPreviewThread(
    threads,
    renderedThreadModel(path, target.draft, []),
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

function renderedThreadTargetKey(
  path: string,
  target: { blockIds: string[]; draft: CommentDraft },
): string {
  const lineStart = target.draft.anchor.canonical.lineStart ?? null;
  const lineEnd = target.draft.anchor.canonical.lineEnd ?? lineStart;
  return target.draft.threadId
    ? JSON.stringify(["thread", target.draft.threadId])
    : JSON.stringify([path, lineStart, lineEnd]);
}
