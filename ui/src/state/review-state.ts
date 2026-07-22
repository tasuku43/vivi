import type {
  AcceptedReviewEntry,
  ReviewReceiptEntry,
  ReviewReceiptReason,
} from "../domain/review-ledger.js";
import type { ReviewChangeItem } from "./git-review.js";
import type { ReviewQueueItem } from "./review-queue.js";

export type ReviewFileState = "queued" | "reviewing" | "reviewed";

export type {
  AcceptedReviewEntry,
  ReviewDecisionEntry,
  ReviewDecisionReason,
  ReviewLedgerSnapshot,
  ReviewReceiptEntry,
  ReviewReceiptReason,
} from "../domain/review-ledger.js";

export const defaultReviewReceiptVisibleMs = 10 * 60 * 1000;
export const defaultReviewReceiptRetentionMs = 24 * 60 * 60 * 1000;

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

export function reviewDecisionPathSet(
  entries: readonly AcceptedReviewEntry[],
  currentFingerprintByPath: ReadonlyMap<string, string>,
): Set<string> {
  return new Set(
    entries
      .filter(
        (entry) =>
          currentFingerprintByPath.get(entry.path) === entry.fingerprint,
      )
      .map((entry) => entry.path),
  );
}

export function compactReviewDecisions<T extends AcceptedReviewEntry>(
  entries: readonly T[],
  currentFingerprintByPath: ReadonlyMap<string, string>,
  activePaths: ReadonlySet<string> = new Set(currentFingerprintByPath.keys()),
): T[] {
  const latestByKey = new Map<string, T>();
  for (const entry of entries) {
    const currentFingerprint = currentFingerprintByPath.get(entry.path);
    if (currentFingerprint === undefined && activePaths.has(entry.path)) {
      latestByKey.set(`${entry.path}\u001f${entry.fingerprint}`, entry);
      continue;
    }
    if (currentFingerprint !== entry.fingerprint) {
      continue;
    }
    latestByKey.set(`${entry.path}\u001f${entry.fingerprint}`, entry);
  }
  return [...latestByKey.values()];
}

export function createReviewReceipt({
  path,
  reason,
  now = Date.now(),
  visibleMs = defaultReviewReceiptVisibleMs,
  fingerprint,
  threadIds,
}: {
  path: string;
  reason: ReviewReceiptReason;
  now?: number;
  visibleMs?: number;
  fingerprint?: string;
  threadIds?: string[];
}): ReviewReceiptEntry {
  const createdAt = new Date(now).toISOString();
  return {
    id: `${path}\u001f${reason}\u001f${createdAt}`,
    path,
    reason,
    createdAt,
    visibleUntil: new Date(now + visibleMs).toISOString(),
    fingerprint,
    threadIds,
  };
}

export function visibleReviewReceipts(
  receipts: readonly ReviewReceiptEntry[],
  now: number,
  activePaths: ReadonlySet<string>,
): ReviewReceiptEntry[] {
  const latestByPath = new Map<string, ReviewReceiptEntry>();
  for (const receipt of receipts) {
    if (activePaths.has(receipt.path)) continue;
    if (Date.parse(receipt.visibleUntil) <= now) continue;
    const current = latestByPath.get(receipt.path);
    if (!current || receipt.createdAt > current.createdAt) {
      latestByPath.set(receipt.path, receipt);
    }
  }
  return [...latestByPath.values()].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
}

export function compactReviewReceipts(
  receipts: readonly ReviewReceiptEntry[],
  now: number,
  retentionMs = defaultReviewReceiptRetentionMs,
): ReviewReceiptEntry[] {
  const cutoff = now - retentionMs;
  const latestByID = new Map<string, ReviewReceiptEntry>();
  for (const receipt of receipts) {
    if (Date.parse(receipt.visibleUntil) < cutoff) continue;
    latestByID.set(receipt.id, receipt);
  }
  return [...latestByID.values()].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
}

export function reviewChangeFingerprint(
  change: ReviewChangeItem,
  fileVersion?: { mtimeMs?: number; size?: number } | null,
): string {
  return [
    "v2",
    change.path,
    change.originalPath ?? "",
    change.status,
    change.kind ?? "file",
    change.source,
    fileVersion?.mtimeMs ?? "",
    fileVersion?.size ?? "",
  ].join("\u001f");
}
