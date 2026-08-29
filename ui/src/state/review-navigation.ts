import {
  buildCommentThreads,
  type CommentThread,
  type DraftReviewComment,
  type ViviComment,
} from "../domain/comments.js";
import { setPaneActivePath, type EditorLayout } from "./editor-layout.js";
import type { ReviewQueueItem } from "./review-queue.js";

export type ReviewNavigationDirection = "next" | "previous";

export interface ReviewNavigationTarget {
  id: string;
  path: string;
  threadId?: string;
  commentId?: string;
  draftId?: string;
  activityId?: string;
  surface: "source" | "rendered" | "diff";
  label: string;
  detail: string;
  sortKey: string;
}

export interface ReviewQueueOpenTransition {
  activeCommentId: null;
  activeCommentRect: null;
  error: null;
  layout: EditorLayout;
  paletteOpen: false;
  shortcutHelpOpen: false;
}

export function reviewQueueOpenTransition({
  layout,
  paneId,
  path,
}: {
  layout: EditorLayout;
  paneId: string;
  path: string;
}): ReviewQueueOpenTransition {
  return {
    activeCommentId: null,
    activeCommentRect: null,
    error: null,
    layout: setPaneActivePath(layout, paneId, path),
    paletteOpen: false,
    shortcutHelpOpen: false,
  };
}

export function feedbackNavigationTargets(
  comments: ViviComment[],
  options: { path?: string | null; reviewBatchId?: string | null } = {},
): ReviewNavigationTarget[] {
  return buildCommentThreads(comments)
    .filter((thread) => thread.comments.some(isHumanFeedback))
    .filter((thread) => !options.path || thread.path === options.path)
    .filter(
      (thread) =>
        !options.reviewBatchId ||
        thread.reviewBatchId === options.reviewBatchId,
    )
    .map(threadTarget)
    .sort(compareTargets);
}

export function draftCommentNavigationTargets(
  drafts: DraftReviewComment[],
  options: { path?: string | null } = {},
): ReviewNavigationTarget[] {
  return drafts
    .filter((draft) => !options.path || draft.path === options.path)
    .map((draft) => ({
      id: `draft:${draft.id}`,
      path: draft.path,
      draftId: draft.id,
      commentId: `draft:${draft.id}`,
      surface: draft.anchor.surface,
      label: `Draft comment in ${basenameForPath(draft.path)}`,
      detail: anchorDetail(draft.anchor.canonical.lineStart, draft.body),
      sortKey: targetSortKey(draft.path, draft.anchor.canonical.lineStart),
    }))
    .sort(compareTargets);
}

export function commentNavigationTarget(
  comment: ViviComment,
): ReviewNavigationTarget {
  return {
    id: `comment:${comment.id}`,
    path: comment.path,
    threadId: comment.threadId ?? comment.id,
    commentId: comment.id,
    surface: comment.anchor.surface,
    label: `${surfaceLabel(comment.anchor.surface)} comment in ${basenameForPath(comment.path)}`,
    detail: anchorDetail(comment.anchor.canonical.lineStart, comment.body),
    sortKey: targetSortKey(comment.path, comment.anchor.canonical.lineStart),
  };
}

export function inlineThreadFocusCommentId(
  activeCommentId: string | null,
  scheduledCommentId: string | null = null,
): string | null {
  return scheduledCommentId ?? activeCommentId;
}

export function countAttentionCommentThreads(
  comments: ViviComment[],
  unreadReviewPaths: ReadonlySet<string>,
): number {
  return buildCommentThreads(comments).filter(
    (thread) =>
      thread.comments.some(isHumanFeedback) &&
      unreadReviewPaths.has(thread.path),
  ).length;
}

export function firstRelevantThreadForReviewItem(
  item: ReviewQueueItem,
  comments: ViviComment[],
): ReviewNavigationTarget | null {
  const pathThreads = buildCommentThreads(comments).filter(
    (thread) =>
      thread.path === item.path && thread.comments.some(isHumanFeedback),
  );
  return pathThreads.sort(compareThreads)[0]
    ? threadTarget(pathThreads.sort(compareThreads)[0]!)
    : null;
}

export function commentActivityThreadTargets({
  comments,
  selectedPath,
  reviewPaths,
}: {
  comments: ViviComment[];
  selectedPath: string | null;
  reviewPaths: string[];
}): string[] {
  const reviewPathSet = new Set(reviewPaths);
  const targets: string[] = [];
  const threads = buildCommentThreads(comments).sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );
  for (const thread of threads) {
    const selectedTarget =
      selectedPath !== null && thread.path === selectedPath;
    const reviewTarget = reviewPathSet.has(thread.path);
    if (selectedTarget || reviewTarget) targets.push(thread.id);
  }
  return targets;
}

export function moveReviewNavigationTarget(
  targets: ReviewNavigationTarget[],
  current: {
    path?: string | null;
    commentId?: string | null;
    draftId?: string | null;
  },
  direction: ReviewNavigationDirection,
): ReviewNavigationTarget | null {
  if (!targets.length) return null;
  const currentIndex = targets.findIndex(
    (target) =>
      (current.commentId && target.commentId === current.commentId) ||
      (current.draftId && target.draftId === current.draftId) ||
      (!current.commentId && !current.draftId && target.path === current.path),
  );
  if (currentIndex < 0) {
    return direction === "previous"
      ? targets[targets.length - 1]!
      : targets[0]!;
  }
  const offset = direction === "previous" ? -1 : 1;
  return targets[(currentIndex + offset + targets.length) % targets.length]!;
}

function threadTarget(thread: CommentThread): ReviewNavigationTarget {
  const first = [...thread.comments].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  )[0];
  return {
    id: `thread:${thread.id}`,
    path: thread.path,
    threadId: thread.id,
    commentId: first?.id,
    surface: thread.anchor.surface,
    label: `Feedback in ${basenameForPath(thread.path)}`,
    detail: anchorDetail(thread.anchor.canonical.lineStart, first?.body ?? ""),
    sortKey: targetSortKey(thread.path, thread.anchor.canonical.lineStart),
  };
}

function compareThreads(a: CommentThread, b: CommentThread): number {
  return (
    targetSortKey(a.path, a.anchor.canonical.lineStart).localeCompare(
      targetSortKey(b.path, b.anchor.canonical.lineStart),
    ) || a.id.localeCompare(b.id)
  );
}

function compareTargets(a: ReviewNavigationTarget, b: ReviewNavigationTarget) {
  return a.sortKey.localeCompare(b.sortKey) || a.id.localeCompare(b.id);
}

function targetSortKey(path: string, line?: number): string {
  return `${path}\0${String(line ?? 0).padStart(8, "0")}`;
}

function anchorDetail(line: number | undefined, body: string): string {
  const preview = body.trim().replace(/\s+/g, " ").slice(0, 72);
  return `${line ? `Line ${line}` : "File"}${preview ? ` - ${preview}` : ""}`;
}

function surfaceLabel(surface: "source" | "rendered" | "diff"): string {
  if (surface === "rendered") return "Rendered";
  if (surface === "diff") return "Diff";
  return "Source";
}

function isHumanFeedback(comment: ViviComment): boolean {
  if (comment.createdBy) return comment.createdBy.kind === "human";
  if (comment.source) return comment.source === "human";
  return true;
}

function basenameForPath(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}
