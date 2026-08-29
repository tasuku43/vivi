import type {
  CommentThreadActivityEvent,
  DraftReviewComment,
  ViviComment,
} from "../domain/comments.js";
import {
  isHumanFeedback,
  type CommentActivitySummary,
} from "./comment-activity.js";
import { isReviewChangeOpenable, type ReviewChangeItem } from "./git-review.js";

export interface ReviewQueueItem {
  path: string;
  change: ReviewChangeItem | null;
  commentCount: number;
  lastActivityAt?: number;
  pendingDraftCount?: number;
  pendingDraftIds?: string[];
  latestActivity?: CommentThreadActivityEvent;
  unread: boolean;
}

export interface ReviewQueueProgress {
  total: number;
  seen: number;
  unread: number;
}

export interface ReviewQueueSignalCounts {
  all: number;
  unread: number;
  drafts: number;
  changed: number;
}

export interface ReviewQueuePosition {
  activePath: string | null;
  activeIndex: number;
  reviewableTotal: number;
  activeItem: ReviewQueueItem | null;
}

export interface ReviewQueueBuildOptions {
  draftComments?: readonly DraftReviewComment[];
  knownMissingPaths?: ReadonlySet<string>;
  unseenFeedbackPaths?: ReadonlySet<string>;
  recentActivityByPath?: Readonly<Record<string, number>>;
}

export interface UnavailableFeedbackItem {
  path: string;
  publishedCount: number;
  draftCount: number;
}

export function buildUnavailableFeedbackItems(
  comments: readonly ViviComment[],
  drafts: readonly DraftReviewComment[],
  missingPaths: ReadonlySet<string>,
): UnavailableFeedbackItem[] {
  const counts = new Map<string, UnavailableFeedbackItem>();
  for (const comment of comments) {
    if (!isHumanFeedback(comment) || !missingPaths.has(comment.path)) continue;
    const item = counts.get(comment.path) ?? {
      path: comment.path,
      publishedCount: 0,
      draftCount: 0,
    };
    item.publishedCount += 1;
    counts.set(comment.path, item);
  }
  for (const draft of drafts) {
    if (!missingPaths.has(draft.path)) continue;
    const item = counts.get(draft.path) ?? {
      path: draft.path,
      publishedCount: 0,
      draftCount: 0,
    };
    item.draftCount += 1;
    counts.set(draft.path, item);
  }
  return [...counts.values()].sort((left, right) =>
    left.path.localeCompare(right.path),
  );
}

/**
 * Builds a file-level attention queue from recent activity plus explicit pins.
 * Pending drafts and published feedback that no agent has seen are pins;
 * terminal thread status is not a browser attention state.
 */
export function buildReviewQueueItems(
  changes: ReviewChangeItem[],
  comments: ViviComment[],
  activities: Record<string, CommentActivitySummary>,
  unreadPaths: ReadonlySet<string>,
  options: ReviewQueueBuildOptions = {},
): ReviewQueueItem[] {
  const threads = collectThreads(comments.filter(isHumanFeedback));
  const paths = new Set(
    changes
      .map((change) => change.path)
      .filter((path) => !options.knownMissingPaths?.has(path)),
  );
  for (const path of Object.keys(options.recentActivityByPath ?? {})) {
    if (!options.knownMissingPaths?.has(path)) paths.add(path);
  }
  for (const path of options.unseenFeedbackPaths ?? []) {
    if (!options.knownMissingPaths?.has(path)) {
      paths.add(path);
    }
  }
  const draftsByPath = collectDraftsByPath(options.draftComments ?? []);
  for (const path of draftsByPath.keys()) {
    if (!options.knownMissingPaths?.has(path)) paths.add(path);
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
      let commentCount = 0;
      let latestActivity: CommentThreadActivityEvent | undefined;
      const pathDrafts = draftsByPath.get(path) ?? [];

      for (const thread of pathThreads) {
        commentCount += thread.comments.length;
        const candidate = activities[thread.id]?.timeline.find(
          (event) =>
            event.type === "thread_read" && event.actor.kind !== "human",
        );
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
        commentCount,
        lastActivityAt: options.recentActivityByPath?.[path],
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
  };
}

export function reviewQueueSignalCounts(
  items: readonly ReviewQueueItem[],
): ReviewQueueSignalCounts {
  return {
    all: items.length,
    unread: items.filter((item) => item.unread).length,
    drafts: items.filter((item) => (item.pendingDraftCount ?? 0) > 0).length,
    changed: items.filter((item) => item.change !== null).length,
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

export function nextReviewQueueItemPathAfterCompletion(
  items: ReviewQueueItem[],
  completedPath: string,
  direction: "next" | "previous" = "next",
): string | null {
  const reviewable = items.filter(isReviewQueueItemOpenable);
  if (reviewable.length <= 1) return null;
  const currentIndex = reviewable.findIndex(
    (item) => item.path === completedPath,
  );
  const remaining = reviewable.filter((item) => item.path !== completedPath);
  if (!remaining.length) return null;
  if (currentIndex < 0) {
    return direction === "previous"
      ? remaining[remaining.length - 1]!.path
      : remaining[0]!.path;
  }
  const targetIndex =
    direction === "previous"
      ? (currentIndex - 1 + reviewable.length) % reviewable.length
      : (currentIndex + 1) % reviewable.length;
  const target = reviewable[targetIndex];
  if (target && target.path !== completedPath) return target.path;
  return direction === "previous"
    ? remaining[remaining.length - 1]!.path
    : remaining[0]!.path;
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

function collectThreads(comments: ViviComment[]) {
  const threads = new Map<
    string,
    {
      id: string;
      path: string;
      comments: ViviComment[];
    }
  >();
  for (const comment of comments) {
    const id = comment.threadId ?? comment.id;
    const current = threads.get(id);
    if (current) {
      current.comments.push(comment);
    } else {
      threads.set(id, {
        id,
        path: comment.path,
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
  const unseenCompare = Number(b.unread) - Number(a.unread);
  if (unseenCompare) return unseenCompare;
  const pendingCompare =
    Number((b.pendingDraftCount ?? 0) > 0) -
    Number((a.pendingDraftCount ?? 0) > 0);
  if (pendingCompare) return pendingCompare;
  const activityCompare = (b.latestActivity?.createdAt ?? "").localeCompare(
    a.latestActivity?.createdAt ?? "",
  );
  const clockCompare = (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0);
  if (clockCompare) return clockCompare;
  if (activityCompare) return activityCompare;
  return (
    (changeOrder.get(a.path) ?? Number.MAX_SAFE_INTEGER) -
      (changeOrder.get(b.path) ?? Number.MAX_SAFE_INTEGER) ||
    a.path.localeCompare(b.path)
  );
}
