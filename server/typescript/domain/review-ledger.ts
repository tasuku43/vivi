export type ReviewDecisionReason = "accepted_change" | "threads_resolved";
export type ReviewReceiptReason =
  | ReviewDecisionReason
  | "drafts_cleared"
  | "change_disappeared";

export interface ReviewDecision {
  path: string;
  fingerprint: string;
  reason: ReviewDecisionReason;
  createdAt: string;
}

export interface ReviewReceipt {
  id: string;
  path: string;
  reason: ReviewReceiptReason;
  createdAt: string;
  visibleUntil: string;
  fingerprint?: string;
  threadIds?: string[];
}

export interface ReviewLedgerSnapshot {
  decisions: ReviewDecision[];
  receipts: ReviewReceipt[];
}
