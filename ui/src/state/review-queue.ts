import type {
  CommentStatus,
  CommentThreadActivityEvent,
  DraftReviewComment,
  ViviComment,
} from "../domain/comments.js";
import type { CommentActivitySummary } from "./comment-activity.js";
import { isReviewChangeOpenable, type ReviewChangeItem } from "./git-review.js";

export interface ReviewQueueItem {
  path: string;
  change: ReviewChangeItem | null;
  threadCounts: Record<CommentStatus, number>;
  commentCount: number;
  pendingDraftCount?: number;
  pendingDraftIds?: string[];
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

export interface ReviewQueuePosition {
  activePath: string | null;
  activeIndex: number;
  reviewableTotal: number;
  activeItem: ReviewQueueItem | null;
}

export interface ReviewQueueBuildOptions {
  acceptedPaths?: ReadonlySet<string>;
  completedThreadPaths?: ReadonlySet<string>;
  draftComments?: readonly DraftReviewComment[];
  knownMissingPaths?: ReadonlySet<string>;
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
  options: ReviewQueueBuildOptions = {},
): ReviewQueueItem[] {
  const threads = collectThreads(comments);
  const paths = new Set(
    changes
      .filter(
        (change) =>
          !options.acceptedPaths?.has(change.path) &&
          !options.completedThreadPaths?.has(change.path),
      )
      .map((change) => change.path),
  );
  for (const thread of threads.values()) {
    if (
      thread.status === "open" &&
      !options.knownMissingPaths?.has(thread.path)
    ) {
      paths.add(thread.path);
    }
  }
  const draftsByPath = collectDraftsByPath(options.draftComments ?? []);
  for (const path of draftsByPath.keys()) {
    if (!options.acceptedPaths?.has(path)) paths.add(path);
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
      const pathDrafts = draftsByPath.get(path) ?? [];

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

      const item: ReviewQueueItem = {
        path,
        change: changeByPath.get(path) ?? null,
        threadCounts,
        commentCount,
        latestActivity,
        unread: unreadPaths.has(path),
      };
      if (pathDrafts.length) {
        item.pendingDraftCount = pathDrafts.length;
        item.pendingDraftIds = pathDrafts.map((draft) => draft.id);
      }
      return item;
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

export function reviewQueuePosition(
  items: ReviewQueueItem[],
  currentPath: string | null,
): ReviewQueuePosition {
  const reviewable = items.filter(isReviewQueueItemOpenable);
  const activeIndex = currentPath
    ? reviewable.findIndex((item) => item.path === currentPath)
    : -1;
  return {
    activePath: activeIndex >= 0 ? reviewable[activeIndex]!.path : null,
    activeIndex,
    reviewableTotal: reviewable.length,
    activeItem: activeIndex >= 0 ? reviewable[activeIndex]! : null,
  };
}

export function syncUnreadReviewPaths(
  paths: string[],
  items: readonly Pick<ReviewQueueItem, "path">[],
  knownPaths: Set<string>,
): string[] {
  const currentPaths = new Set(items.map((item) => item.path));
  const newPaths = items
    .map((item) => item.path)
    .filter((path) => !knownPaths.has(path));

  for (const path of [...knownPaths]) {
    if (!currentPaths.has(path)) knownPaths.delete(path);
  }
  for (const path of newPaths) knownPaths.add(path);

  const nextPaths = [
    ...newPaths.reverse(),
    ...paths.filter(
      (path) => currentPaths.has(path) && !newPaths.includes(path),
    ),
  ];
  if (
    nextPaths.length === paths.length &&
    nextPaths.every((path, index) => path === paths[index])
  ) {
    return paths;
  }
  return nextPaths;
}

export function pinActiveReviewQueueItem(
  items: ReviewQueueItem[],
  currentPath: string | null,
): ReviewQueueItem[] {
  if (!currentPath) return items;
  const activeIndex = items.findIndex(
    (item) => item.path === currentPath && isReviewQueueItemOpenable(item),
  );
  if (activeIndex <= 0) return items;
  const active = items[activeIndex]!;
  return [
    active,
    ...items.slice(0, activeIndex),
    ...items.slice(activeIndex + 1),
  ];
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

export function reviewQueueItemHasAgentReply(item: ReviewQueueItem): boolean {
  return (
    item.threadCounts.open > 0 &&
    item.latestActivity?.type === "comment_added" &&
    item.latestActivity.actor.kind !== "human"
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

function collectDraftsByPath(drafts: readonly DraftReviewComment[]) {
  const byPath = new Map<string, DraftReviewComment[]>();
  for (const draft of drafts) {
    byPath.set(draft.path, [...(byPath.get(draft.path) ?? []), draft]);
  }
  return byPath;
}

function compareReviewQueueItems(
  a: ReviewQueueItem,
  b: ReviewQueueItem,
  changeOrder: Map<string, number>,
) {
  const openCompare =
    Number(b.threadCounts.open > 0) - Number(a.threadCounts.open > 0);
  if (openCompare) return openCompare;
  const pendingCompare =
    Number((b.pendingDraftCount ?? 0) > 0) -
    Number((a.pendingDraftCount ?? 0) > 0);
  if (pendingCompare) return pendingCompare;
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
