import {
  buildCommentThreads,
  type CommentThread,
  type CommentThreadActivityEvent,
  type CommentStatus,
  type DraftReviewComment,
  type ViviComment,
} from "../domain/comments.js";
import { setPaneActivePath, type EditorLayout } from "./editor-layout.js";
import type { ReviewQueueItem } from "./review-queue.js";

export type ReviewNavigationDirection = "next" | "previous";
export type CommentActivityStatusFilter =
  | Exclude<CommentStatus, "archived">
  | "all"
  | "attention"
  | "drafts";

export interface CommentInboxEntryState {
  query: string;
  status: CommentActivityStatusFilter;
}

export interface CommentInboxOpenState extends CommentInboxEntryState {
  activeCommentId: string | null;
}

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
  commentsPanelOpen: false;
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
    commentsPanelOpen: false,
    error: null,
    layout: setPaneActivePath(layout, paneId, path),
    paletteOpen: false,
    shortcutHelpOpen: false,
  };
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
    (thread) => thread.status === "open" && unreadReviewPaths.has(thread.path),
  ).length;
}

export function commentInboxEntryStatus(
  attentionThreadCount: number,
  draftCount = 0,
): CommentActivityStatusFilter {
  if (attentionThreadCount > 0) return "attention";
  if (draftCount > 0) return "drafts";
  return "open";
}

export function commentInboxEntryState(
  attentionThreadCount: number,
  draftCount = 0,
): CommentInboxEntryState {
  return {
    query: "",
    status: commentInboxEntryStatus(attentionThreadCount, draftCount),
  };
}

export function commentInboxOpenState({
  activeComment,
  activeCommentId,
  attentionThreadCount,
  draftCount = 0,
  preferAttention = false,
  query,
}: {
  activeComment?: ViviComment | null;
  activeCommentId: string | null;
  attentionThreadCount: number;
  draftCount?: number;
  preferAttention?: boolean;
  query?: string;
}): CommentInboxOpenState {
  if (preferAttention && attentionThreadCount > 0) {
    return {
      activeCommentId: null,
      query: "",
      status: "attention",
    };
  }

  if (activeComment) {
    return {
      activeCommentId: activeComment.id,
      query: query ?? activeComment.path,
      status: "all",
    };
  }

  const entry = commentInboxEntryState(attentionThreadCount, draftCount);
  const scopedQuery = query?.trim();
  return {
    ...entry,
    activeCommentId,
    query: query ?? entry.query,
    status: scopedQuery ? "all" : entry.status,
  };
}

export function latestUnreadActivityTarget(
  reviewItems: ReviewQueueItem[],
  comments: ViviComment[] = [],
): ReviewNavigationTarget | null {
  const item = reviewItems.find(
    (candidate) => candidate.unread && candidate.change?.status !== "deleted",
  );
  if (!item) return null;
  const activity = item.latestActivity;
  if (activity?.threadId) {
    const threadComments = comments.filter(
      (comment) => (comment.threadId ?? comment.id) === activity.threadId,
    );
    const activityComment = activity.commentId
      ? threadComments.find((comment) => comment.id === activity.commentId)
      : null;
    if (activityComment) {
      return {
        ...commentNavigationTarget(activityComment),
        id: `unread:${item.path}`,
        activityId: activity.id,
        label: `Latest unread activity in ${basenameForPath(item.path)}`,
        sortKey: activity.createdAt,
      };
    }
    const thread = buildCommentThreads(threadComments)[0];
    if (thread) {
      return {
        ...threadTarget(thread),
        id: `unread:${item.path}`,
        activityId: activity.id,
        label: `Latest unread activity in ${basenameForPath(item.path)}`,
        sortKey: activity.createdAt,
      };
    }
  }
  return {
    id: `unread:${item.path}`,
    path: item.path,
    threadId: activity?.threadId,
    activityId: activity?.id,
    surface: "source",
    label: `Latest unread activity in ${basenameForPath(item.path)}`,
    detail: activity
      ? activityDetail(activity)
      : item.change
        ? "Changed file"
        : "Review item",
    sortKey: activity?.createdAt ?? item.path,
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

export function commentActivityThreadTargets({
  comments,
  selectedPath,
  commentsPanelOpen,
  commentsPanelQuery,
  commentsPanelStatus,
  unreadReviewPaths = new Set<string>(),
  reviewPaths,
}: {
  comments: ViviComment[];
  selectedPath: string | null;
  commentsPanelOpen: boolean;
  commentsPanelQuery: string;
  commentsPanelStatus: CommentActivityStatusFilter;
  unreadReviewPaths?: ReadonlySet<string>;
  reviewPaths: string[];
}): string[] {
  const reviewPathSet = new Set(reviewPaths);
  const query = commentsPanelQuery.trim().toLowerCase();
  const targets: string[] = [];
  const threads = buildCommentThreads(comments).sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );
  for (const thread of threads) {
    const selectedTarget =
      selectedPath !== null && thread.path === selectedPath;
    const reviewTarget = reviewPathSet.has(thread.path);
    const attentionTarget =
      thread.status === "open" && unreadReviewPaths.has(thread.path);
    const panelTarget =
      commentsPanelOpen &&
      (commentsPanelStatus === "attention"
        ? attentionTarget
        : commentsPanelStatus === "all" ||
          thread.status === commentsPanelStatus) &&
      (!query ||
        thread.comments.some((comment) =>
          [comment.path, comment.body, comment.anchor.canonical.quote ?? ""]
            .join(" ")
            .toLowerCase()
            .includes(query),
        ));
    if (selectedTarget || reviewTarget || panelTarget) targets.push(thread.id);
    if (targets.length >= 40) break;
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
    label: `${statusLabel(thread.status)} thread in ${basenameForPath(thread.path)}`,
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
  if (event.type === "thread_claimed") return "Agent claimed thread";
  if (event.type === "thread_claim_released") return "Agent released thread";
  if (event.type === "thread_created") return "New thread";
  if (event.type === "comment_updated") return "Comment updated";
  return "Thread read";
}

function surfaceLabel(surface: "source" | "rendered" | "diff"): string {
  if (surface === "rendered") return "Rendered";
  if (surface === "diff") return "Diff";
  return "Source";
}

function statusLabel(status: CommentStatus): string {
  if (status === "resolved") return "Resolved";
  if (status === "archived") return "Archived";
  return "Open";
}

function basenameForPath(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}
