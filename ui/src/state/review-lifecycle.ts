import type { ReviewQueueItem } from "./review-queue.js";
import { isReviewQueueItemOpenable } from "./review-queue.js";

export interface ReviewLifecycleSummary {
  detected: number;
  hidden: number;
  reviewing: number;
  seen: number;
  visible: number;
}

export function summarizeReviewLifecycle(
  items: ReviewQueueItem[],
  hidden = 0,
): ReviewLifecycleSummary {
  const openable = items.filter(isReviewQueueItemOpenable);
  return {
    detected: openable.filter(
      (item) => item.unread && item.threadCounts.open === 0,
    ).length,
    hidden,
    reviewing: openable.filter((item) => item.threadCounts.open > 0).length,
    seen: openable.filter(
      (item) => !item.unread && item.threadCounts.open === 0,
    ).length,
    visible: openable.length,
  };
}
