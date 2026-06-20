import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { MouseEvent } from "react";
import { createPortal } from "react-dom";
import type { TextDiff } from "../../../domain/change-review.js";
import type { ViviComment } from "../../../domain/comments.js";
import type { FilePayload } from "../../../domain/fs-node.js";
import type { CommentActivitySummary } from "../../../state/comment-activity.js";
import { renderedCommentBlockAttribute } from "../../../domain/rendered-comment-blocks.js";
import {
  renderedCommentDraft,
  scheduleSelectionCommentUpdate,
  sourceTextForLineRange,
  type CodeCommentThread as CodeCommentThreadModel,
  type CommentCreateHandler,
  type CommentDraft,
  type CommentStatusChangeHandler,
} from "../../../state/comments.js";
import type { LineRange } from "../../../state/code-viewer.js";
import {
  applyRenderedCommentHighlights,
  closestRenderedCommentBlock,
  findBlocksForRenderedComment,
  isInteractiveRenderedCommentTarget,
  renderedCommentBlocksForSelection,
  renderedCommentSummaryForComment,
  rectLikeFromElement,
  type RenderedCommentBlockTarget,
  targetForRenderedCommentBlock,
  targetForRenderedCommentBlocks,
} from "../../../state/rendered-comment-blocks.js";
import type { ResolvedTheme } from "../../../state/theme.js";
import type { ViewerMode } from "../../../state/viewer-mode.js";
import { CodeCommentThread } from "../../comments/components/CodeCommentThread.js";
import { SourceCommentSurface } from "../../comments/components/SourceCommentSurface.js";
import {
  injectMermaidPreviewBlocks,
  renderMarkdownDocumentHtml,
} from "../rendering/markdown-rendering.js";
import { renderMermaidBlocks } from "../rendering/mermaid-rendering.js";
import { DiffViewer } from "./DiffViewer.js";

export {
  injectMermaidPreviewBlocks,
  renderMarkdownDocumentHtml,
} from "../rendering/markdown-rendering.js";

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
  comments = [],
  activeCommentId,
  onOpenComment,
  onCloseComment,
  onCommentStatusChange,
  threadActivities = {},
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
  onCreateComment?: CommentCreateHandler;
  comments?: ViviComment[];
  activeCommentId?: string | null;
  onOpenComment?: (id: string, rect: DOMRectLike) => void;
  onCloseComment?: () => void;
  onCommentStatusChange?: CommentStatusChangeHandler;
  threadActivities?: Record<string, CommentActivitySummary>;
}) {
  const [localMode, setLocalMode] = useState<ViewerMode>("rendered");
  const [renderedThreadTarget, setRenderedThreadTarget] = useState<{
    blockId: string;
    blockIds: string[];
    draft: CommentDraft;
    host: HTMLElement;
    mount: HTMLElement;
  } | null>(null);
  const [sourceSelectedRange, setSourceSelectedRange] =
    useState<LineRange | null>(null);
  const mode =
    controlledMode === "source" || controlledMode === "rendered"
      ? controlledMode
      : localMode;
  const html = renderMarkdownDocumentHtml(file.content);
  const markdownRef = useRef<HTMLElement | null>(null);
  const setMode = (nextMode: ViewerMode) => {
    setRenderedThreadTarget(null);
    setLocalMode(nextMode);
    onModeChange?.(nextMode);
  };
  const renderPendingMermaid = useCallback(() => {
    if (mode !== "rendered" || diffEnabled) return;
    const markdown = markdownRef.current;
    if (!markdown) return;
    renderMermaidBlocks(markdown, theme);
  }, [diffEnabled, mode, theme]);
  const updateRenderedSelectionComment = () => {
    const blocks = renderedCommentBlocksForSelection(markdownRef.current);
    const target = targetForRenderedCommentBlocks(
      blocks,
      window.getSelection()?.toString(),
    );
    if (!target) return;
    openRenderedDraft(target, blocks);
    window.getSelection()?.removeAllRanges();
  };

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
      comments,
      activeCommentId,
      renderedThreadTarget?.blockIds,
    );
  }, [
    activeCommentId,
    comments,
    diffEnabled,
    html,
    mode,
    renderedThreadTarget,
  ]);

  useLayoutEffect(() => {
    if (
      mode !== "rendered" ||
      diffEnabled ||
      !renderedThreadTarget ||
      !markdownRef.current
    ) {
      return;
    }
    const hostBlockId = renderedThreadTarget.blockIds.at(-1);
    const block = Array.from(
      markdownRef.current.querySelectorAll<HTMLElement>(
        `[${renderedCommentBlockAttribute}]`,
      ),
    ).find((candidate) => candidate.dataset.viviCommentBlockId === hostBlockId);
    if (!block) return;
    placeRenderedThreadHost(block, renderedThreadTarget.host);
  });

  useLayoutEffect(
    () => () => {
      renderedThreadTarget?.host.remove();
    },
    [renderedThreadTarget],
  );

  useEffect(() => {
    setRenderedThreadTarget(null);
  }, [file.path]);

  const openRenderedDraft = (
    target: RenderedCommentBlockTarget,
    blocks: HTMLElement[],
    comment?: ViviComment,
  ) => {
    const hostBlock = blocks.at(-1);
    if (!hostBlock) return;
    const { host, mount } = createRenderedThreadHost(hostBlock);
    setRenderedThreadTarget({
      blockId: target.blockId,
      blockIds: target.blockIds,
      host,
      mount,
      draft: {
        ...renderedCommentDraft(file, "markdown", {
          text: target.text,
          blockId: target.blockId,
          selector: target.selector,
          sourceLineStart: target.sourceLineStart,
          sourceLineEnd: target.sourceLineEnd,
          sourceQuote: sourceTextForLineRange(
            file.content,
            sourceRangeForTarget(target),
          ),
        }),
        threadId: comment?.threadId ?? comment?.id,
      },
    });
  };

  const openRenderedComment = (block: HTMLElement | null) => {
    const id = block?.dataset.viviCommentId;
    if (!id || !block) return false;
    const comment = comments.find((item) => item.id === id);
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
    setRenderedThreadTarget(null);
    onCloseComment?.();
  };

  const onRenderedClick = (event: MouseEvent<HTMLElement>) => {
    if (
      event.target instanceof Element &&
      event.target.closest(".rendered-comment-thread")
    ) {
      return;
    }
    const block = closestRenderedCommentBlock(
      markdownRef.current,
      event.target,
    );
    if (!block) {
      closeRenderedThread();
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
    if (window.getSelection()?.toString().trim()) return;
    if (openRenderedComment(block)) return;

    startRenderedComment(block);
  };

  const renderedThreadComments = renderedThreadTarget
    ? commentsForRenderedTarget(
        markdownRef.current,
        renderedThreadTarget,
        comments,
      )
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
          comments={comments}
          activeCommentId={activeCommentId}
          onOpenComment={onOpenComment}
          threadActivities={threadActivities}
        />
      ) : mode === "rendered" ? (
        <article
          className="markdown markdown-document"
          ref={markdownRef}
          onMouseUp={() =>
            scheduleSelectionCommentUpdate(updateRenderedSelectionComment)
          }
          onKeyUp={updateRenderedSelectionComment}
          onClick={onRenderedClick}
        />
      ) : (
        <SourceCommentSurface
          file={file}
          className="markdown-source"
          selectedRange={sourceSelectedRange}
          comments={comments}
          activeCommentId={activeCommentId}
          onSelectionChange={setSourceSelectedRange}
          onCreateComment={onCreateComment}
          onOpenComment={onOpenComment}
          onCloseComment={onCloseComment}
          onCommentStatusChange={onCommentStatusChange}
          threadActivities={threadActivities}
        />
      )}
      {renderedThread && renderedThreadTarget
        ? createPortal(
            <CodeCommentThread
              className="rendered-comment-thread"
              thread={renderedThread}
              draft={renderedThreadTarget.draft}
              activity={
                renderedThreadId
                  ? threadActivities[renderedThreadId]
                  : undefined
              }
              onCreateComment={onCreateComment}
              onStatusChange={onCommentStatusChange}
              onClose={closeRenderedThread}
            />,
            renderedThreadTarget.mount,
          )
        : null}
    </section>
  );
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

function createRenderedThreadHost(block: HTMLElement): {
  host: HTMLElement;
  mount: HTMLElement;
} {
  if (block.localName === "tr") {
    const host = document.createElement("tr");
    host.className = "rendered-comment-thread-table-row";
    const mount = document.createElement("td");
    mount.className = "rendered-comment-thread-host";
    mount.colSpan = Math.max(1, block.children.length);
    host.append(mount);
    return { host, mount };
  }

  const host = document.createElement("div");
  host.className = "rendered-comment-thread-host";
  return { host, mount: host };
}

function placeRenderedThreadHost(block: HTMLElement, host: HTMLElement): void {
  if (block.localName === "li") {
    if (host.parentElement !== block) block.append(host);
    return;
  }
  if (block.nextElementSibling !== host) block.after(host);
}

function commentsForRenderedTarget(
  root: HTMLElement | null,
  target: { blockIds: string[]; draft: CommentDraft },
  comments: ViviComment[],
): ViviComment[] {
  if (!root) return [];
  const targetStart = target.draft.anchor.canonical.lineStart;
  const targetEnd =
    target.draft.anchor.canonical.lineEnd ??
    target.draft.anchor.canonical.lineStart;
  const targetBlockIds = new Set(target.blockIds);
  return comments
    .filter((comment) => {
      const summary = renderedCommentSummaryForComment(comment, "markdown");
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
      return Boolean(
        summary &&
        findBlocksForRenderedComment(root, summary).some((block) =>
          targetBlockIds.has(block.dataset.viviCommentBlockId ?? ""),
        ),
      );
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
