import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { NodeReviewLedgerStore } from "../../server/typescript/infrastructure/node-review-ledger-store.js";

it("compacts stale reviewed receipts while keeping decisions", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "vivi-review-ledger-"));
  const store = new NodeReviewLedgerStore({ dataDir });
  const now = new Date("2026-07-01T12:00:00.000Z");

  const snapshot = await store.saveReviewLedger(
    {
      decisions: [
        {
          path: "src/app.ts",
          fingerprint: "fingerprint-current",
          reason: "accepted_change",
          createdAt: now.toISOString(),
        },
      ],
      receipts: [
        {
          id: "old",
          path: "src/old.ts",
          reason: "threads_resolved",
          createdAt: "2026-06-28T00:00:00.000Z",
          visibleUntil: "2026-06-28T00:10:00.000Z",
        },
        {
          id: "recent",
          path: "src/app.ts",
          reason: "accepted_change",
          createdAt: now.toISOString(),
          visibleUntil: "2026-07-01T12:10:00.000Z",
          fingerprint: "fingerprint-current",
        },
      ],
    },
    now,
  );

  expect(snapshot.decisions).toHaveLength(1);
  expect(snapshot.receipts.map((receipt) => receipt.id)).toEqual(["recent"]);
  await expect(
    readFile(path.join(dataDir, "review-ledger.jsonl"), "utf8"),
  ).resolves.not.toContain('"old"');
});
