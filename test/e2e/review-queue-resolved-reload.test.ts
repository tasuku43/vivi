import { writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type Browser } from "playwright";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  createContractFixture,
  type ContractFixture,
} from "./support/fixture-workspace.js";
import { startViviServer, type StartedServer } from "./support/vivi-server.js";

let fixture: ContractFixture;
let server: StartedServer | null = null;
let browser: Browser | null = null;

beforeEach(async () => {
  fixture = await createContractFixture();
});

afterEach(async () => {
  await browser?.close();
  browser = null;
  await server?.close();
  server = null;
  await fixture.cleanup();
});

it("keeps an externally resolved review out of Queued after reload until the file changes again", async () => {
  server = await startViviServer({
    rootDir: fixture.rootDir,
    gitReviewTimeoutMs: 1_000,
  });
  const threadId = await createComment();

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(10_000);
  const activitySubscription = page.waitForResponse((response) =>
    response.url().includes("operationName=CommentThreadActivity"),
  );
  const initialLedgerLoad = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/v1/review-ledger") &&
      response.request().method() === "GET",
  );
  await page.goto(server.url);
  await Promise.all([activitySubscription, initialLedgerLoad]);

  const allReadmeQueueItems = page.locator('[data-review-path="README.md"]');
  const readmeQueueItem = page.locator(
    '.review-state-section.reviewing [data-review-path="README.md"]',
  );
  await readmeQueueItem.waitFor({ state: "visible" });

  await resolveThread(threadId);

  await expect
    .poll(readReviewLedger, { timeout: 10_000, interval: 100 })
    .toMatchObject({
      decisions: expect.arrayContaining([
        expect.objectContaining({
          path: "README.md",
          reason: "threads_resolved",
        }),
      ]),
      receipts: expect.arrayContaining([
        expect.objectContaining({
          path: "README.md",
          reason: "threads_resolved",
        }),
      ]),
    });
  await readmeQueueItem.waitFor({ state: "detached" });

  await page.reload();

  await page.getByRole("complementary", { name: "Review inspector" }).waitFor();
  await expect
    .poll(() => allReadmeQueueItems.count(), { timeout: 10_000, interval: 100 })
    .toBe(0);

  await writeFile(
    path.join(fixture.rootDir, "README.md"),
    `# Vivi Fixture\n\n## Overview\n\nChanged after resolution\n\n${"new evidence ".repeat(40)}\n`,
  );

  await page
    .locator('.review-state-section.queued [data-review-path="README.md"]')
    .waitFor({ state: "visible" });
}, 50_000);

async function createComment(): Promise<string> {
  if (!server) throw new Error("server is not running");
  const response = await fetch(`${server.url}/graphql`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      operationName: "CreateThread",
      query: `
        mutation CreateThread($input: CommentInput!) {
          createThread(input: $input) { id }
        }
      `,
      variables: {
        input: {
          path: "README.md",
          body: "Resolve this feedback without reviving the queue after reload.",
          anchor: {
            surface: "source",
            canonical: { path: "README.md", lineStart: 1, lineEnd: 1 },
          },
        },
      },
    }),
  });
  if (!response.ok) {
    throw new Error(`create comment failed: ${await response.text()}`);
  }
  const payload = (await response.json()) as {
    data?: { createThread?: { id?: string } };
    errors?: unknown[];
  };
  const threadId = payload.data?.createThread?.id;
  if (payload.errors?.length || !threadId) {
    throw new Error(`unexpected create response: ${JSON.stringify(payload)}`);
  }
  return threadId;
}

async function resolveThread(threadId: string): Promise<void> {
  if (!server) throw new Error("server is not running");
  const response = await fetch(`${server.url}/graphql`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      operationName: "ResolveThread",
      query: `
        mutation ResolveThread($id: ID!) {
          resolveThread(id: $id) { id status }
        }
      `,
      variables: { id: threadId },
    }),
  });
  if (!response.ok) {
    throw new Error(`resolve thread failed: ${await response.text()}`);
  }
  const payload = (await response.json()) as {
    data?: { resolveThread?: { status?: string } };
    errors?: unknown[];
  };
  if (
    payload.errors?.length ||
    payload.data?.resolveThread?.status !== "resolved"
  ) {
    throw new Error(`unexpected resolve response: ${JSON.stringify(payload)}`);
  }
}

async function readReviewLedger(): Promise<{
  decisions: Array<{ path: string; reason: string }>;
  receipts: Array<{ path: string; reason: string }>;
}> {
  if (!server) throw new Error("server is not running");
  const response = await fetch(`${server.url}/api/v1/review-ledger`);
  if (!response.ok) {
    throw new Error(`read review ledger failed: ${await response.text()}`);
  }
  return (await response.json()) as {
    decisions: Array<{ path: string; reason: string }>;
    receipts: Array<{ path: string; reason: string }>;
  };
}
