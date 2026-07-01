export type ReviewDecisionReason = "accepted_change" | "threads_resolved";
export type ReviewReceiptReason =
  | ReviewDecisionReason
  | "drafts_cleared"
  | "change_disappeared";

export interface AcceptedReviewEntry {
  path: string;
  fingerprint: string;
}

export interface ReviewDecisionEntry extends AcceptedReviewEntry {
  createdAt: string;
  reason: ReviewDecisionReason;
}

export interface ReviewReceiptEntry {
  id: string;
  path: string;
  reason: ReviewReceiptReason;
  createdAt: string;
  visibleUntil: string;
  fingerprint?: string;
  threadIds?: string[];
}

export interface ReviewLedgerSnapshot {
  decisions: ReviewDecisionEntry[];
  receipts: ReviewReceiptEntry[];
}
