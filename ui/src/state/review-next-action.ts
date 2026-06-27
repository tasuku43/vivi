import type { ReviewQueueItem } from "./review-queue.js";
import { isReviewQueueItemOpenable } from "./review-queue.js";

export type ReviewNextActionKind = "open-comments" | "open-path" | "clear";

export interface ReviewNextAction {
  description: string;
  emphasis: "attention" | "normal" | "clear";
  kind: ReviewNextActionKind;
  primaryLabel: string;
  targetPath: string | null;
  title: string;
}

export interface ReviewNextActionInput {
  activePath: string | null;
  items: ReviewQueueItem[];
  reviewLoading?: boolean;
}

export function buildReviewNextAction({
  activePath,
  items,
  reviewLoading = false,
}: ReviewNextActionInput): ReviewNextAction {
  const openable = items.filter(isReviewQueueItemOpenable);
  const activeItem = activePath
    ? openable.find((item) => item.path === activePath)
    : undefined;
  const target =
    importantActiveItem(activeItem) ??
    openable.find((item) => item.unread && item.threadCounts.open > 0) ??
    openable.find((item) => item.unread) ??
    openable.find((item) => item.threadCounts.open > 0) ??
    openable[0];

  if (!target) {
    return {
      description: reviewLoading
        ? "Open comment threads will appear here while changed files finish loading."
        : "No Git changes or open comment threads need attention right now.",
      emphasis: "clear",
      kind: "clear",
      primaryLabel: reviewLoading ? "Loading review files" : "Queue clear",
      targetPath: null,
      title: reviewLoading ? "Loading review files" : "Nothing needs review",
    };
  }

  const current = activePath === target.path;
  const openThreads = target.threadCounts.open;
  const messagePart = target.commentCount
    ? `${target.commentCount} ${target.commentCount === 1 ? "message" : "messages"}`
    : "";
  const threadPart = openThreads
    ? `${openThreads} open ${openThreads === 1 ? "thread" : "threads"}`
    : "";
  const reason = [threadPart, messagePart, target.unread ? "unseen" : ""]
    .filter(Boolean)
    .join(" · ");

  if (target.unread && openThreads) {
    return {
      description: `${target.path} has ${reason}; verify the latest review work before moving on.`,
      emphasis: "attention",
      kind: current ? "open-comments" : "open-path",
      primaryLabel: current ? "Open comments" : "Open review stop",
      targetPath: target.path,
      title: current
        ? "Verify the current open thread"
        : "Open the next unseen thread",
    };
  }

  if (target.unread) {
    return {
      description: `${target.path} has an unseen change from the review queue.`,
      emphasis: "attention",
      kind: "open-path",
      primaryLabel: current ? "Review current file" : "Open unseen change",
      targetPath: target.path,
      title: current ? "Review the current change" : "Inspect an unseen change",
    };
  }

  if (openThreads) {
    return {
      description: `${target.path} has ${reason}; keep the thread visible until it is resolved or archived.`,
      emphasis: "attention",
      kind: current ? "open-comments" : "open-path",
      primaryLabel: current ? "Open comments" : "Open review stop",
      targetPath: target.path,
      title: current ? "Resolve current thread" : "Continue open thread",
    };
  }

  return {
    description: `${target.path} is a changed file candidate with no open comments yet.`,
    emphasis: "normal",
    kind: "open-path",
    primaryLabel: current ? "Review current file" : "Open changed file",
    targetPath: target.path,
    title: current ? "Review the current file" : "Review changed file",
  };
}

function importantActiveItem(
  item: ReviewQueueItem | undefined,
): ReviewQueueItem | undefined {
  if (!item) return undefined;
  if (
    item.change ||
    item.unread ||
    item.threadCounts.open > 0 ||
    item.latestActivity
  ) {
    return item;
  }
  return undefined;
}
