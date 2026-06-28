import type { FilePayload } from "../domain/fs-node.js";
import type { DiffStat, ReviewChangeItem } from "./git-review.js";
import type { ReviewQueueItem } from "./review-queue.js";

export type ReviewFileState = "queued" | "reviewing" | "reviewed";

export interface AcceptedReviewEntry {
  path: string;
  fingerprint: string;
}

export function reviewFileStateLabel(state: ReviewFileState): string {
  if (state === "reviewing") return "In Review";
  if (state === "reviewed") return "Reviewed";
  return "Queued";
}

export function reviewFileStateTone(state: ReviewFileState): string {
  if (state === "reviewing") return "reviewing";
  if (state === "reviewed") return "reviewed";
  return "queued";
}

export function reviewQueueItemState(item: ReviewQueueItem): ReviewFileState {
  return item.threadCounts.open > 0 || (item.pendingDraftCount ?? 0) > 0
    ? "reviewing"
    : "queued";
}

export function reviewChangeFingerprint(
  change: ReviewChangeItem,
  diffStat: DiffStat | null | undefined,
  file?: FilePayload | null,
): string {
  return [
    change.path,
    change.originalPath ?? "",
    change.status,
    change.kind ?? "file",
    change.source,
    diffStat?.additions ?? "",
    diffStat?.deletions ?? "",
    diffStat?.metadataOnly ? "metadata" : "",
    file?.etag ?? "",
    file?.mtimeMs ?? "",
    file?.size ?? "",
  ].join("\u001f");
}
