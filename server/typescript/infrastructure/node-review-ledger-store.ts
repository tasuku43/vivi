import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ReviewLedgerPort } from "../application/contracts.js";
import type {
  ReviewDecision,
  ReviewLedgerSnapshot,
  ReviewReceipt,
} from "../domain/review-ledger.js";
import { defaultViviDataDir } from "./node-comment-store.js";

const receiptRetentionMs = 24 * 60 * 60 * 1000;

export class NodeReviewLedgerStore implements ReviewLedgerPort {
  private readonly filePath: string;

  constructor(options: { dataDir?: string } = {}) {
    this.filePath = path.join(
      path.resolve(options.dataDir ?? defaultViviDataDir()),
      "review-ledger.jsonl",
    );
  }

  async readReviewLedger(now = new Date()): Promise<ReviewLedgerSnapshot> {
    const snapshot = compactSnapshot(await this.readAll(), now);
    await this.writeAll(snapshot);
    return snapshot;
  }

  async saveReviewLedger(
    snapshot: ReviewLedgerSnapshot,
    now = new Date(),
  ): Promise<ReviewLedgerSnapshot> {
    const compacted = compactSnapshot(snapshot, now);
    await this.writeAll(compacted);
    return compacted;
  }

  private async readAll(): Promise<ReviewLedgerSnapshot> {
    let raw = "";
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch (error) {
      if (isMissingFileError(error)) return { decisions: [], receipts: [] };
      throw error;
    }
    const snapshot: ReviewLedgerSnapshot = { decisions: [], receipts: [] };
    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line) as Partial<LedgerEvent>;
        if (event.type === "review_decision" && isDecision(event.decision)) {
          snapshot.decisions.push(event.decision);
        }
        if (event.type === "review_receipt" && isReceipt(event.receipt)) {
          snapshot.receipts.push(event.receipt);
        }
      } catch {
        // Ignore corrupt ledger rows; compaction will rewrite valid rows.
      }
    }
    return snapshot;
  }

  private async writeAll(snapshot: ReviewLedgerSnapshot): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const body = [
      ...snapshot.decisions.map((decision) =>
        JSON.stringify({ type: "review_decision", decision }),
      ),
      ...snapshot.receipts.map((receipt) =>
        JSON.stringify({ type: "review_receipt", receipt }),
      ),
    ].join("\n");
    const tempPath = `${this.filePath}.tmp`;
    await writeFile(tempPath, body ? `${body}\n` : "");
    await rename(tempPath, this.filePath);
  }
}

interface LedgerEvent {
  type: "review_decision" | "review_receipt";
  decision?: ReviewDecision;
  receipt?: ReviewReceipt;
}

function compactSnapshot(
  snapshot: ReviewLedgerSnapshot,
  now: Date,
): ReviewLedgerSnapshot {
  const decisions = new Map<string, ReviewDecision>();
  for (const decision of snapshot.decisions) {
    if (isDecision(decision)) {
      decisions.set(`${decision.path}\u001f${decision.fingerprint}`, decision);
    }
  }

  const receipts = new Map<string, ReviewReceipt>();
  const cutoff = now.getTime() - receiptRetentionMs;
  for (const receipt of snapshot.receipts) {
    if (!isReceipt(receipt)) continue;
    if (Date.parse(receipt.visibleUntil) < cutoff) continue;
    receipts.set(receipt.id, receipt);
  }

  return {
    decisions: [...decisions.values()],
    receipts: [...receipts.values()],
  };
}

function isDecision(value: unknown): value is ReviewDecision {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ReviewDecision>;
  return (
    typeof candidate.path === "string" &&
    typeof candidate.fingerprint === "string" &&
    typeof candidate.createdAt === "string" &&
    (candidate.reason === "accepted_change" ||
      candidate.reason === "threads_resolved")
  );
}

function isReceipt(value: unknown): value is ReviewReceipt {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ReviewReceipt>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.path === "string" &&
    typeof candidate.createdAt === "string" &&
    typeof candidate.visibleUntil === "string" &&
    (candidate.reason === "accepted_change" ||
      candidate.reason === "threads_resolved" ||
      candidate.reason === "drafts_cleared" ||
      candidate.reason === "change_disappeared")
  );
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
