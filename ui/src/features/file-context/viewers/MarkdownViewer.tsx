import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { MouseEvent, ReactNode } from "react";
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
  latestPublishedStatus,
  matchingOpenThreadForDraft,
  visibleThreadComments,
  type CodeCommentThread as CodeCommentThreadModel,
  type CommentCreateHandler,
  type CommentDraft,
  type CommentStatusChangeHandler,
} from "../../../state/comments.js";
import type { LineRange } from "../../../state/code-viewer.js";
import { resolveWorkspaceLink } from "../../../state/workspace-links.js";
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
  DiffToggleButton,
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
import "./RenderedMarkdown.module.css";

export {
  injectMermaidPreviewBlocks,
  renderMarkdownDocumentHtml,
} from "../rendering/markdown-rendering.js";

type MarkdownRenderedThreadTarget = {
  blockId: string;
  blockIds: string[];
  draft: CommentDraft;
  host: HTMLElement;
  mount: HTMLElement;
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
  onCommentStatusChange,
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
  onCommentStatusChange?: CommentStatusChangeHandler;
  threadActivities?: Record<string, CommentActivitySummary>;
  onOpenPath?: (path: string) => void;
}) {
  const [localMode, setLocalMode] = useState<ViewerMode>("rendered");
  const [renderedThreadTargets, setRenderedThreadTargets] = useState<
    MarkdownRenderedThreadTarget[]
  >([]);
  const [sourceSelectedRange, setSourceSelectedRange] =
    useState<LineRange | null>(null);
  const mode =
    controlledMode === "source" || controlledMode === "rendered"
      ? controlledMode
      : localMode;
  const html = renderMarkdownDocumentHtml(file.content);
  const markdownRef = useRef<HTMLElement | null>(null);
  const renderedThreadTargetsRef = useRef<MarkdownRenderedThreadTarget[]>([]);
  const visibleRenderedComments = useMemo(
    () => visibleThreadComments(comments),
    [comments],
  );
  const setMode = (nextMode: ViewerMode) => {
    setRenderedThreadTargets((items) => {
      for (const item of items) item.host.remove();
      return [];
    });
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

  useLayoutEffect(() => {
    if (
      mode !== "rendered" ||
      diffEnabled ||
      !renderedThreadTargets.length ||
      !markdownRef.current
    ) {
      return;
    }
    const blocks = Array.from(
      markdownRef.current.querySelectorAll<HTMLElement>(
        `[${renderedCommentBlockAttribute}]`,
      ),
    );
    for (const target of renderedThreadTargets) {
      const hostBlockId = target.blockIds.at(-1);
      const block = blocks.find(
        (candidate) => candidate.dataset.viviCommentBlockId === hostBlockId,
      );
      if (block) placeRenderedThreadHost(block, target.host);
    }
  });

  useEffect(() => {
    renderedThreadTargetsRef.current = renderedThreadTargets;
  }, [renderedThreadTargets]);

  useEffect(
    () => () => {
      for (const target of renderedThreadTargetsRef.current) {
        target.host.remove();
      }
    },
    [],
  );

  useEffect(() => {
    setRenderedThreadTargets((items) => {
      for (const item of items) item.host.remove();
      return [];
    });
  }, [file.path]);

  const openRenderedDraft = (
    target: RenderedCommentBlockTarget,
    blocks: HTMLElement[],
    comment?: ViviComment,
  ) => {
    const hostBlock = blocks.at(-1);
    if (!hostBlock) return;
    const { host, mount } = createRenderedThreadHost(hostBlock);
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
      comment?.threadId ??
      comment?.id ??
      matchingOpenRenderedThreadId(file.path, draft, visibleRenderedComments);
    const nextTarget: MarkdownRenderedThreadTarget = {
      blockId: target.blockId,
      blockIds: target.blockIds,
      host,
      mount,
      draft: {
        ...draft,
        threadId: existingThreadId,
      },
    };
    const key = renderedThreadTargetKey(file.path, nextTarget);
    setRenderedThreadTargets((items) => {
      for (const item of items) {
        if (renderedThreadTargetKey(file.path, item) === key) {
          item.host.remove();
        }
      }
      return [
        ...items.filter(
          (item) => renderedThreadTargetKey(file.path, item) !== key,
        ),
        nextTarget,
      ];
    });
  };

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
    setRenderedThreadTargets((items) => {
      for (const item of items) item.host.remove();
      return [];
    });
    onCloseComment?.();
  };

  const closeRenderedThreadTarget = (key: string) => {
    setRenderedThreadTargets((items) => {
      for (const item of items) {
        if (renderedThreadTargetKey(file.path, item) === key) {
          item.host.remove();
        }
      }
      return items.filter(
        (item) => renderedThreadTargetKey(file.path, item) !== key,
      );
    });
    onCloseComment?.();
  };

  useEffect(() => {
    if (mode !== "rendered" || diffEnabled || !activeCommentId) return;
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
    const threadId = comment.threadId ?? comment.id;
    const key = JSON.stringify(["thread", threadId]);
    if (
      renderedThreadTargets.some(
        (item) => renderedThreadTargetKey(file.path, item) === key,
      )
    ) {
      return;
    }
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
    if (hasRenderedCommentModifier(event)) {
      startRenderedComment(block);
      return;
    }
    if (block.dataset.viviCommentId) {
      openRenderedComment(block);
    }
  };

  const renderedThreadEntries = renderedThreadTargets.map((target) => {
    const threadComments = commentsForRenderedTarget(
      target,
      visibleRenderedComments,
    );
    const thread = renderedThreadModel(file.path, target.draft, threadComments);
    const threadId =
      thread.comments[0]?.threadId ??
      thread.comments[0]?.id ??
      target.draft.threadId;
    return {
      key: renderedThreadTargetKey(file.path, target),
      target,
      thread,
      threadId,
    };
  });

  return (
    <section className={`${surfaceStyles.viewer} document-viewer`}>
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
          className={`${styles.document} markdown markdown-document`}
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
          onCommentStatusChange={onCommentStatusChange}
          threadActivities={threadActivities}
        />
      )}
      {renderedThreadEntries.map((entry) =>
        createPortal(
          <CodeCommentThread
            className="rendered-comment-thread"
            thread={entry.thread}
            draft={entry.target.draft}
            activity={
              entry.threadId ? threadActivities[entry.threadId] : undefined
            }
            activeCommentId={activeCommentId}
            currentActorId={currentActorId}
            onCreateComment={onCreateComment}
            onStatusChange={onCommentStatusChange}
            onClose={() => closeRenderedThreadTarget(entry.key)}
          />,
          entry.target.mount,
          entry.key,
        ),
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
    scheduleListItemThreadHostInset(block, host);
    return;
  }
  if (block.nextElementSibling !== host) block.after(host);
}

function scheduleListItemThreadHostInset(
  block: HTMLElement,
  host: HTMLElement,
): void {
  const update = () => {
    const style = window.getComputedStyle(host);
    const inset =
      host.getBoundingClientRect().height +
      cssPixelValue(style.marginTop) +
      cssPixelValue(style.marginBottom);
    block.style.setProperty(
      "--rendered-comment-block-bottom",
      `${Math.max(0, Math.ceil(inset))}px`,
    );
  };
  update();
  window.requestAnimationFrame(update);
}

function cssPixelValue(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function hasRenderedCommentModifier(
  event: Pick<MouseEvent<HTMLElement>, "altKey" | "ctrlKey" | "metaKey">,
): boolean {
  return event.altKey || event.ctrlKey || event.metaKey;
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
  target: { blockIds: string[]; draft: CommentDraft },
  comments: ViviComment[],
): ViviComment[] {
  if (target.draft.threadId) {
    return comments
      .filter(
        (comment) => (comment.threadId ?? comment.id) === target.draft.threadId,
      )
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  return [];
}

function matchingOpenRenderedThreadId(
  path: string,
  draft: CommentDraft,
  comments: ViviComment[],
): string | undefined {
  const thread = matchingOpenThreadForDraft(
    renderedThreadModelsForComments(path, comments),
    draft,
  );
  return thread?.comments[0]?.threadId ?? thread?.comments[0]?.id;
}

function renderedThreadModelsForComments(
  path: string,
  comments: ViviComment[],
): CodeCommentThreadModel[] {
  const byThread = new Map<string, ViviComment[]>();
  for (const comment of comments) {
    if (comment.path !== path || comment.anchor.surface !== "rendered") {
      continue;
    }
    const threadId = comment.threadId ?? comment.id;
    byThread.set(threadId, [...(byThread.get(threadId) ?? []), comment]);
  }
  return [...byThread.entries()].map(([threadId, threadComments]) =>
    renderedThreadModel(
      path,
      {
        path,
        viewerKind: "markdown",
        threadId,
        anchor: threadComments[0]!.anchor,
      },
      threadComments,
    ),
  );
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
    status: latestPublishedStatus(comments),
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
