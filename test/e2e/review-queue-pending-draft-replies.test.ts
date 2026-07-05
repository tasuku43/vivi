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

it("groups pending draft replies under the existing Review Queue thread", async () => {
  server = await startViviServer({
    rootDir: fixture.rootDir,
    gitReviewTimeoutMs: 1_000,
  });
  const threadId = "thread-open-readme";
  await createComment({
    threadId,
    body: "Open thread visible as one thread row.",
    lineStart: 1,
  });
  await createDraftReply({
    threadId,
    body: "First pending follow-up.",
  });
  await createDraftReply({
    threadId,
    body: "Second pending follow-up.",
  });

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(5_000);
  await page.goto(server.url);

  const readmeFileRow = page
    .locator(".review-thread-expand-file", {
      hasText: "README.md",
    })
    .first();
  const threadBadge = readmeFileRow.locator(".review-thread-count-toggle", {
    hasText: "1 open · 2 pending",
  });
  await threadBadge.waitFor({ state: "visible" });
  const rows = readmeFileRow.locator(".review-thread-hairline-row");
  await rows.first().waitFor({ state: "attached" });
  expect(await rows.count()).toBe(1);
  const rowText = (await rows.first().textContent()) ?? "";
  expect(rowText).toContain("Unread reply");
  expect(rowText).toContain("2 pending");
  expect(rowText).toContain("L1");
  expect(rowText).not.toContain("Second pending follow-up.");
  expect(
    await readmeFileRow
      .getByRole("button", {
        name: /Open pending item, README\.md/i,
      })
      .count(),
  ).toBe(0);
}, 40_000);

it("groups pending draft-only thread messages under one Review Queue row", async () => {
  server = await startViviServer({
    rootDir: fixture.rootDir,
    gitReviewTimeoutMs: 1_000,
  });
  const threadId = "draft-thread-lines-28-30";
  await createDraftReply({
    threadId,
    body: "First pending draft.",
  });
  await createDraftReply({
    threadId,
    body: "Second pending draft.",
  });
  await createDraftReply({
    threadId,
    body: "Third pending draft.",
  });
  await expectDraftThreads(threadId, 3);

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(5_000);
  await page.goto(server.url);

  const readmeFileRow = page
    .locator(".review-thread-expand-file", {
      hasText: "README.md",
    })
    .first();
  const threadBadge = readmeFileRow.locator(".review-thread-count-toggle", {
    hasText: "3 pending",
  });
  await threadBadge.waitFor({ state: "visible" });

  const rows = readmeFileRow.locator(".review-thread-hairline-row");
  await rows.first().waitFor({ state: "attached" });
  expect(await rows.count()).toBe(1);
  const rowText = (await rows.first().textContent()) ?? "";
  expect(rowText).toContain("3 pending");
  expect(rowText).toContain("L1");
  expect(rowText).not.toContain("Third pending draft.");
  expect(
    await readmeFileRow
      .locator(
        '.review-thread-hairline-row[aria-label*="Open pending thread"][aria-label*="3 pending"]',
      )
      .count(),
  ).toBe(1);
  expect(
    await readmeFileRow
      .locator('.review-thread-hairline-row[aria-label*="Open pending item"]')
      .count(),
  ).toBe(0);
}, 40_000);

it("publishes separate draft-only threads on the same file from the Review Queue", async () => {
  server = await startViviServer({
    rootDir: fixture.rootDir,
    gitReviewTimeoutMs: 1_000,
  });
  const firstRoot = await createDraftComment({
    body: "First draft-only thread root.",
    lineStart: 1,
  });
  await createDraftComment({
    threadId: `draft-thread:${firstRoot.id}:source-anchor`,
    body: "First draft-only thread reply.",
    lineStart: 1,
  });
  const secondRoot = await createDraftComment({
    body: "Second draft-only thread root.",
    lineStart: 3,
  });
  await createDraftComment({
    threadId: `draft-thread:${secondRoot.id}:source-anchor`,
    body: "Second draft-only thread reply.",
    lineStart: 3,
  });
  await expectDraftCount(4);

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(5_000);
  await page.goto(server.url);

  const readmeFileRow = page
    .locator(".review-thread-expand-file", {
      hasText: "README.md",
    })
    .first();
  await readmeFileRow
    .locator(".review-thread-count-toggle", { hasText: "4 pending" })
    .waitFor({ state: "visible" });
  const rows = readmeFileRow.locator(".review-thread-hairline-row");
  await rows.first().waitFor({ state: "attached" });
  expect(await rows.count()).toBe(2);
  const rowText = await rows.allTextContents();
  expect(rowText.join("\n")).toContain("L1");
  expect(rowText.join("\n")).toContain("L3");
  expect(rowText.join("\n")).toContain("2 pending");
  expect(rowText.join("\n")).not.toContain("First draft-only thread reply.");
  expect(rowText.join("\n")).not.toContain("Second draft-only thread reply.");

  await page.getByRole("button", { name: "Publish all 4 pending" }).click();

  await expect.poll(() => draftCount(), { timeout: 10_000 }).toBe(0);
  await expect
    .poll(() => publishedThreadMessageCounts(), { timeout: 10_000 })
    .toEqual([2, 2]);
  expect(await page.getByText("draft target thread not found").count()).toBe(0);
}, 40_000);

it("keeps an open pending source thread expanded after publishing it", async () => {
  server = await startViviServer({
    rootDir: fixture.rootDir,
    gitReviewTimeoutMs: 1_000,
  });
  const root = await createDraftComment({
    path: "src.ts",
    body: "First pending source draft.",
    lineStart: 1,
    quote: sourceQuote,
  });
  const threadId = draftReviewThreadId(
    root.id,
    sourceAnchor({ path: "src.ts", lineStart: 1, quote: sourceQuote }),
  );
  await createDraftComment({
    path: "src.ts",
    threadId,
    body: "Second pending source draft.",
    lineStart: 1,
    quote: sourceQuote,
  });
  await createDraftComment({
    path: "src.ts",
    threadId,
    body: "Third pending source draft.",
    lineStart: 1,
    quote: sourceQuote,
  });
  await expectDraftCount(3);

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(5_000);
  await page.goto(server.url);

  await page
    .getByRole("button", { name: "Review queue item, modified src.ts" })
    .click();
  await page
    .locator("label.review-thread-count-toggle", { hasText: "3 pending" })
    .click();
  const pendingRow = page.locator(".review-thread-hairline-row", {
    hasText: "export const value = 2;",
  });
  await pendingRow.waitFor({ state: "visible" });
  const pendingRowText = (await pendingRow.textContent()) ?? "";
  expect(pendingRowText).toContain("export const value = 2;");
  expect(pendingRowText).toContain("return value + 1;");
  expect(pendingRowText).toContain("console.log(value);");
  expect(pendingRowText).not.toContain("throw new Error");

  const lineAction = page.locator(
    '[data-testid="line-comment-action"][data-path="src.ts"][data-line="1"]',
  );
  await lineAction.waitFor({ state: "visible" });
  await lineAction.click();

  const openThread = page.locator(".code-comment-thread", {
    hasText: "Third pending source draft.",
  });
  await expect.poll(async () => openThread.textContent()).toContain("Pending");
  await expect
    .poll(async () => openThread.textContent())
    .toContain("Pending draft");
  await expect
    .poll(async () => openThread.textContent())
    .toContain("Third pending source draft.");
  await expect
    .poll(async () => lineAction.getAttribute("aria-expanded"))
    .toBe("true");

  await page.getByRole("button", { name: "Publish all 3 pending" }).click();

  await expect.poll(() => draftCount(), { timeout: 10_000 }).toBe(0);
  await expect
    .poll(async () => lineAction.getAttribute("aria-expanded"))
    .toBe("true");
  await expect
    .poll(async () => openThread.textContent())
    .toContain("Published");
  await expect
    .poll(async () => openThread.textContent())
    .toContain("First pending source draft.");
  await expect
    .poll(async () => openThread.textContent())
    .toContain("Second pending source draft.");
  await expect
    .poll(async () => openThread.textContent())
    .toContain("Third pending source draft.");
  await expect
    .poll(async () => openThread.textContent())
    .not.toContain("Pending draft");
}, 40_000);

async function createComment({
  threadId,
  body,
  lineStart,
}: {
  threadId: string;
  body: string;
  lineStart: number;
}): Promise<void> {
  if (!server) throw new Error("server is not running");
  const response = await fetch(`${server.url}/api/v1/comments`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      threadId,
      path: "README.md",
      body,
      status: "open",
      anchor: sourceAnchor({ lineStart }),
    }),
  });
  if (!response.ok) {
    throw new Error(`create comment failed: ${await response.text()}`);
  }
}

async function createDraftReply({
  threadId,
  body,
}: {
  threadId: string;
  body: string;
}): Promise<void> {
  await createDraftComment({ threadId, body, lineStart: 1 });
}

async function createDraftComment({
  path = "README.md",
  threadId,
  body,
  lineStart,
  quote,
}: {
  path?: string;
  threadId?: string;
  body: string;
  lineStart: number;
  quote?: string;
}): Promise<{ id: string; threadId?: string | null }> {
  if (!server) throw new Error("server is not running");
  const response = await fetch(`${server.url}/graphql`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      operationName: "CreateDraftReviewComment",
      query: `mutation CreateDraftReviewComment($input: DraftReviewCommentInput!) {
        createDraftReviewComment(input: $input) { id threadId }
      }`,
      variables: {
        input: {
          threadId,
          path,
          body,
          source: "human",
          anchor: sourceAnchor({ path, lineStart, quote }),
        },
      },
    }),
  });
  if (!response.ok) {
    throw new Error(`create draft failed: ${await response.text()}`);
  }
  const payload = (await response.json()) as {
    data?: {
      createDraftReviewComment?: { id: string; threadId?: string | null };
    };
    errors?: unknown[];
  };
  if (payload.errors?.length) {
    throw new Error(`create draft failed: ${JSON.stringify(payload.errors)}`);
  }
  if (
    threadId !== undefined &&
    payload.data?.createDraftReviewComment?.threadId !== threadId
  ) {
    throw new Error(`created draft lost threadId: ${JSON.stringify(payload)}`);
  }
  const draft = payload.data?.createDraftReviewComment;
  if (!draft)
    throw new Error(`create draft missing payload: ${JSON.stringify(payload)}`);
  return draft;
}

async function expectDraftThreads(
  threadId: string,
  count: number,
): Promise<void> {
  if (!server) throw new Error("server is not running");
  const response = await fetch(`${server.url}/graphql`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      operationName: "ViviDraftReviewComments",
      query: `query ViviDraftReviewComments($path: String) {
        draftReviewComments(path: $path) { id threadId body }
      }`,
      variables: { path: "README.md" },
    }),
  });
  if (!response.ok) {
    throw new Error(`list drafts failed: ${await response.text()}`);
  }
  const payload = (await response.json()) as {
    data?: { draftReviewComments?: Array<{ threadId?: string | null }> };
    errors?: unknown[];
  };
  if (payload.errors?.length) {
    throw new Error(`list drafts failed: ${JSON.stringify(payload.errors)}`);
  }
  const matching =
    payload.data?.draftReviewComments?.filter(
      (draft) => draft.threadId === threadId,
    ) ?? [];
  if (matching.length !== count) {
    throw new Error(`listed drafts lost threadId: ${JSON.stringify(payload)}`);
  }
}

async function expectDraftCount(count: number): Promise<void> {
  const drafts = await listDrafts();
  if (drafts.length !== count) {
    throw new Error(`draft count = ${drafts.length}, want ${count}`);
  }
}

async function draftCount(): Promise<number> {
  return (await listDrafts()).length;
}

async function listDrafts(
  path?: string,
): Promise<Array<{ id: string; threadId?: string | null }>> {
  if (!server) throw new Error("server is not running");
  const response = await fetch(`${server.url}/graphql`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      operationName: "ViviDraftReviewComments",
      query: `query ViviDraftReviewComments($path: String) {
        draftReviewComments(path: $path) { id threadId body }
      }`,
      variables: path ? { path } : {},
    }),
  });
  if (!response.ok) {
    throw new Error(`list drafts failed: ${await response.text()}`);
  }
  const payload = (await response.json()) as {
    data?: {
      draftReviewComments?: Array<{ id: string; threadId?: string | null }>;
    };
    errors?: unknown[];
  };
  if (payload.errors?.length) {
    throw new Error(`list drafts failed: ${JSON.stringify(payload.errors)}`);
  }
  return payload.data?.draftReviewComments ?? [];
}

async function publishedThreadMessageCounts(): Promise<number[]> {
  if (!server) throw new Error("server is not running");
  const response = await fetch(`${server.url}/graphql`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      operationName: "ViviCommentThreads",
      query: `query ViviCommentThreads($path: String, $status: CommentStatus) {
        commentThreads(path: $path, status: $status) {
          id
          comments { id threadId body }
        }
      }`,
      variables: { path: "README.md", status: "open" },
    }),
  });
  if (!response.ok) {
    throw new Error(`list threads failed: ${await response.text()}`);
  }
  const payload = (await response.json()) as {
    data?: { commentThreads?: Array<{ comments: unknown[] }> };
    errors?: unknown[];
  };
  if (payload.errors?.length) {
    throw new Error(`list threads failed: ${JSON.stringify(payload.errors)}`);
  }
  return (payload.data?.commentThreads ?? [])
    .map((thread) => thread.comments.length)
    .sort((a, b) => a - b);
}

function sourceAnchor({
  path = "README.md",
  lineStart,
  lineEnd = lineStart,
  quote,
}: {
  path?: string;
  lineStart: number;
  lineEnd?: number;
  quote?: string;
}) {
  return {
    surface: "source",
    canonical: {
      path,
      lineStart,
      lineEnd,
      quote,
    },
  };
}

function draftReviewThreadId(
  draftId: string,
  anchor: ReturnType<typeof sourceAnchor>,
): string {
  const canonical = anchor.canonical;
  return `draft-thread:${draftId}:${JSON.stringify([
    canonical.path,
    anchor.surface,
    canonical.lineStart ?? null,
    canonical.lineEnd ?? canonical.lineStart ?? null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
  ])}`;
}

const sourceQuote = [
  "export const value = 2;",
  "return value + 1;",
  "console.log(value);",
  "throw new Error('hidden fourth line');",
].join("\n");
