import {
  buildCommentThreads,
  type CommentThread,
  type CommentThreadActivityEvent,
  type DraftReviewComment,
  type ViviComment,
} from "../domain/comments.js";
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

export function openThreadNavigationTargets(
  comments: ViviComment[],
  options: { path?: string | null; reviewBatchId?: string | null } = {},
): ReviewNavigationTarget[] {
  return buildCommentThreads(comments)
    .filter((thread) => thread.status === "open")
    .filter((thread) => !options.path || thread.path === options.path)
    .filter(
      (thread) =>
        !options.reviewBatchId ||
        thread.reviewBatchId === options.reviewBatchId,
    )
    .map(threadTarget)
    .sort(compareTargets);
}

export function unresolvedThreadNavigationTargets(
  comments: ViviComment[],
): ReviewNavigationTarget[] {
  return openThreadNavigationTargets(comments);
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

export function agentReplyNavigationTargets(
  comments: ViviComment[],
): ReviewNavigationTarget[] {
  return comments
    .filter(
      (comment) =>
        comment.source === "codex" || comment.source === "claude-code",
    )
    .map((comment) => ({
      id: `agent-reply:${comment.id}`,
      path: comment.path,
      threadId: comment.threadId ?? comment.id,
      commentId: comment.id,
      surface: comment.anchor.surface,
      label: `Agent reply in ${basenameForPath(comment.path)}`,
      detail: anchorDetail(comment.anchor.canonical.lineStart, comment.body),
      sortKey: comment.updatedAt,
    }))
    .sort((a, b) => b.sortKey.localeCompare(a.sortKey) || compareTargets(a, b));
}

export function latestUnreadActivityTarget(
  reviewItems: ReviewQueueItem[],
): ReviewNavigationTarget | null {
  const item = reviewItems.find((candidate) => candidate.unread);
  if (!item) return null;
  return {
    id: `unread:${item.path}`,
    path: item.path,
    threadId: item.latestActivity?.threadId,
    activityId: item.latestActivity?.id,
    surface: "source",
    label: `Latest unread activity in ${basenameForPath(item.path)}`,
    detail: item.latestActivity
      ? activityDetail(item.latestActivity)
      : item.change
        ? "Changed file"
        : "Review item",
    sortKey: item.latestActivity?.createdAt ?? item.path,
  };
}

export function firstRelevantThreadForReviewItem(
  item: ReviewQueueItem,
  comments: ViviComment[],
): ReviewNavigationTarget | null {
  const pathThreads = buildCommentThreads(comments).filter(
    (thread) => thread.path === item.path,
  );
  const open = pathThreads
    .filter((thread) => thread.status === "open")
    .sort(compareThreads)[0];
  if (open) return threadTarget(open);
  return pathThreads.sort(compareThreads)[0]
    ? threadTarget(pathThreads.sort(compareThreads)[0]!)
    : null;
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
    label: `Open thread in ${basenameForPath(thread.path)}`,
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

function activityDetail(event: CommentThreadActivityEvent): string {
  if (event.type === "comment_added") return "Agent or reviewer reply";
  if (event.type === "thread_status_changed") return "Status changed";
  if (event.type === "thread_created") return "New thread";
  if (event.type === "comment_updated") return "Comment updated";
  return "Thread read";
}

function basenameForPath(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}
