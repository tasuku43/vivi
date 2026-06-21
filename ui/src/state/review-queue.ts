import type {
  CommentStatus,
  CommentThreadActivityEvent,
  ViviComment,
} from "../domain/comments.js";
import type { CommentActivitySummary } from "./comment-activity.js";
import { isReviewChangeOpenable, type ReviewChangeItem } from "./git-review.js";

export interface ReviewQueueItem {
  path: string;
  change: ReviewChangeItem | null;
  threadCounts: Record<CommentStatus, number>;
  commentCount: number;
  latestActivity?: CommentThreadActivityEvent;
  unread: boolean;
}

export interface ReviewQueueProgress {
  total: number;
  seen: number;
  unread: number;
  openThreads: number;
  filesWithOpenThreads: number;
}

/**
 * Builds a file-level work queue without inventing lifecycle state from
 * activity. Comment status is the authoritative projection; activity only
 * supplies attribution and recency.
 */
export function buildReviewQueueItems(
  changes: ReviewChangeItem[],
  comments: ViviComment[],
  activities: Record<string, CommentActivitySummary>,
  unreadPaths: ReadonlySet<string>,
): ReviewQueueItem[] {
  const threads = collectThreads(comments);
  const paths = new Set(changes.map((change) => change.path));
  for (const thread of threads.values()) {
    if (thread.status === "open") paths.add(thread.path);
  }

  const changeByPath = new Map(changes.map((change) => [change.path, change]));
  const changeOrder = new Map(
    changes.map((change, index) => [change.path, index]),
  );

  return [...paths]
    .map((path): ReviewQueueItem => {
      const pathThreads = [...threads.values()].filter(
        (thread) => thread.path === path,
      );
      const threadCounts: Record<CommentStatus, number> = {
        open: 0,
        resolved: 0,
        archived: 0,
      };
      let commentCount = 0;
      let latestActivity: CommentThreadActivityEvent | undefined;

      for (const thread of pathThreads) {
        threadCounts[thread.status] += 1;
        commentCount += thread.comments.length;
        const candidate = activities[thread.id]?.timeline[0];
        if (
          candidate &&
          (!latestActivity || candidate.createdAt > latestActivity.createdAt)
        ) {
          latestActivity = candidate;
        }
      }

      return {
        path,
        change: changeByPath.get(path) ?? null,
        threadCounts,
        commentCount,
        latestActivity,
        unread: unreadPaths.has(path),
      };
    })
    .sort((a, b) => compareReviewQueueItems(a, b, changeOrder));
}

export function summarizeReviewQueue(
  items: ReviewQueueItem[],
): ReviewQueueProgress {
  const unread = items.filter((item) => item.unread).length;
  return {
    total: items.length,
    seen: items.length - unread,
    unread,
    openThreads: items.reduce(
      (total, item) => total + item.threadCounts.open,
      0,
    ),
    filesWithOpenThreads: items.filter((item) => item.threadCounts.open > 0)
      .length,
  };
}

export function isReviewQueueItemOpenable(item: ReviewQueueItem): boolean {
  return item.change ? isReviewChangeOpenable(item.change) : true;
}

export function nextReviewQueueItemPath(
  items: ReviewQueueItem[],
  currentPath: string | null,
  direction: "next" | "previous",
): string | null {
  const reviewable = items
    .filter(isReviewQueueItemOpenable)
    .map((item) => item.path);
  if (!reviewable.length) return null;
  const currentIndex = currentPath ? reviewable.indexOf(currentPath) : -1;
  if (currentIndex < 0) {
    return direction === "previous"
      ? reviewable[reviewable.length - 1]!
      : reviewable[0]!;
  }
  const offset = direction === "previous" ? -1 : 1;
  return reviewable[
    (currentIndex + offset + reviewable.length) % reviewable.length
  ]!;
}

export function latestUnreadReviewItemPath(
  items: ReviewQueueItem[],
): string | null {
  return (
    items.find((item) => item.unread && isReviewQueueItemOpenable(item))
      ?.path ?? null
  );
}

export function activityNeedsHumanAttention(
  event: CommentThreadActivityEvent,
): boolean {
  return (
    event.type === "thread_created" ||
    event.type === "comment_added" ||
    event.type === "thread_status_changed"
  );
}

function collectThreads(comments: ViviComment[]) {
  const threads = new Map<
    string,
    {
      id: string;
      path: string;
      status: CommentStatus;
      updatedAt: string;
      comments: ViviComment[];
    }
  >();
  for (const comment of comments) {
    const id = comment.threadId ?? comment.id;
    const current = threads.get(id);
    if (current) {
      current.comments.push(comment);
      if (comment.updatedAt > current.updatedAt) {
        current.status = comment.status;
        current.updatedAt = comment.updatedAt;
      }
    } else {
      threads.set(id, {
        id,
        path: comment.path,
        status: comment.status,
        updatedAt: comment.updatedAt,
        comments: [comment],
      });
    }
  }
  return threads;
}

function compareReviewQueueItems(
  a: ReviewQueueItem,
  b: ReviewQueueItem,
  changeOrder: Map<string, number>,
) {
  const openCompare =
    Number(b.threadCounts.open > 0) - Number(a.threadCounts.open > 0);
  if (openCompare) return openCompare;
  const unreadCompare = Number(b.unread) - Number(a.unread);
  if (unreadCompare) return unreadCompare;
  const activityCompare = (b.latestActivity?.createdAt ?? "").localeCompare(
    a.latestActivity?.createdAt ?? "",
  );
  if (activityCompare) return activityCompare;
  return (
    (changeOrder.get(a.path) ?? Number.MAX_SAFE_INTEGER) -
      (changeOrder.get(b.path) ?? Number.MAX_SAFE_INTEGER) ||
    a.path.localeCompare(b.path)
  );
}
