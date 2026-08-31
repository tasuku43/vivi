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

it("converges after restoring duplicate empty stale Markdown inputs for one block", async () => {
  server = await startViviServer({
    rootDir: fixture.rootDir,
    gitReviewTimeoutMs: 1_000,
  });
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.setDefaultTimeout(8_000);

  const root = fixture.rootDir;
  const path = "README.md";
  const baseAnchor = {
    surface: "rendered",
    canonical: {
      path,
      lineStart: 3,
      lineEnd: 3,
      quote: "## Overview",
      fileHash: "sha256:stale",
    },
    rendered: {
      kind: "markdown",
      blockId: "vivi-block-2",
      textQuote: "Overview",
      sourceLineStart: 3,
      sourceLineEnd: 3,
    },
  };
  const sessions = [
    {
      threadId: "restored-thread",
      selector: "div:nth-of-type(1)>article>h2:nth-of-type(1)",
    },
    {
      threadId: null,
      selector: "div>article>h2:nth-of-type(1)",
    },
  ].map(({ threadId, selector }) => {
    const draft = {
      path,
      viewerKind: "markdown",
      ...(threadId ? { threadId } : {}),
      anchor: {
        ...baseAnchor,
        rendered: { ...baseAnchor.rendered, selector },
      },
    };
    return {
      id: JSON.stringify([
        threadId,
        JSON.stringify([
          path,
          "rendered",
          3,
          3,
          "vivi-block-2",
          selector,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
        ]),
      ]),
      draft,
      body: "",
      status: "stale",
    };
  });

  await page.addInitScript(
    ({ storageKey, stored }) => {
      window.localStorage.setItem(storageKey, JSON.stringify(stored));
    },
    {
      storageKey: `vivi.commentInputSessions.v1:${encodeURIComponent(root)}`,
      stored: {
        version: 1,
        root,
        updatedAt: Date.now(),
        sessions,
      },
    },
  );

  await page.goto(server.url);
  await page.locator('[data-tree-path="README.md"]').click();
  await page.getByRole("tab", { name: "Document" }).click();

  await expect
    .poll(() => page.getByRole("heading", { name: "Vivi Fixture" }).count())
    .toBe(1);
  await expect
    .poll(() =>
      page.locator("#root").evaluate((rootNode) => rootNode.childElementCount),
    )
    .toBeGreaterThan(0);
  await expect
    .poll(() =>
      page.evaluate(
        (storageKey) => localStorage.getItem(storageKey),
        `vivi.commentInputSessions.v1:${encodeURIComponent(root)}`,
      ),
    )
    .toBeNull();
  expect(pageErrors).toEqual([]);
}, 40_000);

it("restores Source input after reload and clears its composer after publish", async () => {
  server = await startViviServer({
    rootDir: fixture.rootDir,
    gitReviewTimeoutMs: 1_000,
  });
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(8_000);
  await page.goto(server.url);

  await page.locator('[data-tree-path="README.md"]').click();
  await page.getByRole("tab", { name: "Document" }).click();
  await page.getByRole("button", { name: "Source", exact: true }).click();
  await page.getByRole("button", { name: "Add comment on line 1" }).click();
  await page
    .getByRole("textbox", { name: "New line comment" })
    .fill("Persist this review thought across reload");
  await page.getByRole("button", { name: "Rendered", exact: true }).click();

  await page
    .getByRole("button", {
      name: "Return to Source, 1 input in progress",
    })
    .waitFor({ state: "visible" });

  await page.reload();
  await page.locator('[data-tree-path="README.md"]').click();
  await page
    .getByRole("button", { name: "Return to Source, 1 input in progress" })
    .click();
  await expect
    .poll(() =>
      page.getByRole("textbox", { name: "New line comment" }).inputValue(),
    )
    .toBe("Persist this review thought across reload");

  await page
    .getByRole("button", { name: "Save pending draft comment" })
    .click();
  await page.getByRole("tab", { name: /Review queue/ }).click();
  await page
    .getByRole("button", { name: "Publish 1 draft for README.md" })
    .click();
  await page.getByRole("tab", { name: "Document" }).click();

  const lineAction = page.getByRole("button", {
    name: "Open comment thread on line 1 with 1 message",
  });
  await lineAction.click();
  await expect
    .poll(() =>
      page.getByRole("article", { name: "Comment thread for line 1" }).count(),
    )
    .toBe(1);
  await expect
    .poll(() => page.getByText("Composing", { exact: true }).count())
    .toBe(0);
}, 40_000);

it("reanchors an out-of-range stale Source input to the current file", async () => {
  server = await startViviServer({
    rootDir: fixture.rootDir,
    gitReviewTimeoutMs: 1_000,
  });
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(8_000);
  await page.goto(server.url);

  await page.locator('[data-tree-path="README.md"]').click();
  await page.getByRole("tab", { name: "Document" }).click();
  await page.getByRole("button", { name: "Source", exact: true }).click();
  await page.getByRole("button", { name: "Add comment on line 5" }).click();
  const body = "Keep this thought after the selected lines disappear";
  await page.getByRole("textbox", { name: "New line comment" }).fill(body);
  await page.getByRole("button", { name: "Close comment thread" }).click();

  await writeFile(path.join(fixture.rootDir, "README.md"), "# Short now\n");
  await page.reload();
  await page.locator('[data-tree-path="README.md"]').click();
  await page.getByRole("tab", { name: "Document" }).click();
  await page.getByRole("button", { name: "Source", exact: true }).click();
  await expect
    .poll(() =>
      page.locator('.code-line[data-line="1"] .line-code').textContent(),
    )
    .toBe("# Short now");
  await page
    .getByRole("button", { name: /Resume input in README\.md/ })
    .click();

  const reanchor = page.getByRole("button", { name: "Re-anchor here" });
  await expect.poll(() => reanchor.count()).toBe(1);
  await expect
    .poll(() => reanchor.evaluate((node) => node === document.activeElement))
    .toBe(true);
  await expect
    .poll(() => page.getByRole("textbox", { name: "New line comment" }).inputValue())
    .toBe(body);
  await reanchor.click();
  const input = page.getByRole("textbox", { name: "New line comment" });
  await expect.poll(() => input.isEnabled()).toBe(true);
  await expect.poll(() => input.inputValue()).toBe(body);
  await expect
    .poll(() => input.evaluate((node) => node === document.activeElement))
    .toBe(true);
  const updatedBody = `${body} — checked on the current line`;
  await input.fill(updatedBody);

  await page.getByRole("button", { name: "Close comment thread" }).click();
  await page
    .getByRole("button", { name: /Resume input in README\.md/ })
    .click();
  await expect.poll(() => reanchor.count()).toBe(0);
  await expect.poll(() => input.inputValue()).toBe(updatedBody);
  await page
    .getByRole("button", { name: "Save pending draft comment" })
    .click();
  await expect
    .poll(() =>
      page
        .getByRole("article", { name: "Comment thread for line 1" })
        .getByText(updatedBody, { exact: true })
        .count(),
    )
    .toBe(1);
}, 40_000);

it("deletes a saved pending comment before publish", async () => {
  server = await startViviServer({
    rootDir: fixture.rootDir,
    gitReviewTimeoutMs: 1_000,
  });
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(8_000);
  await page.goto(server.url);

  await page.locator('[data-tree-path="README.md"]').click();
  await page.getByRole("tab", { name: "Document" }).click();
  await page.getByRole("button", { name: "Source", exact: true }).click();
  await page.getByRole("button", { name: "Add comment on line 1" }).click();
  await page
    .getByRole("textbox", { name: "New line comment" })
    .fill("Remove this pending thought");
  await page
    .getByRole("button", { name: "Save pending draft comment" })
    .click();
  await page
    .getByRole("complementary", { name: "Document inspector" })
    .getByRole("button", { name: /Remove this pending thought/ })
    .click();

  const deletePending = page.getByRole("button", {
    name: "Delete pending draft comment 1",
  });
  await deletePending.waitFor({ state: "visible" });
  await deletePending.click();

  await expect.poll(() => deletePending.count()).toBe(0);
  await expect
    .poll(() => page.getByRole("article", { name: /Comment thread/ }).count())
    .toBe(0);
  await page.getByRole("tab", { name: /Review queue/ }).click();
  await expect
    .poll(() =>
      page
        .getByRole("button", { name: "Publish 1 draft for README.md" })
        .count(),
    )
    .toBe(0);
}, 40_000);

it("keeps a saved Markdown thread open and focuses its follow-up", async () => {
  server = await startViviServer({
    rootDir: fixture.rootDir,
    gitReviewTimeoutMs: 1_000,
  });
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(8_000);
  await page.goto(server.url);

  await page.locator('[data-tree-path="README.md"]').click();
  await page.getByRole("tab", { name: "Document" }).click();
  await page
    .getByText("Contract workspace changed", { exact: true })
    .dblclick();

  const firstBody = "First pending Markdown review note.";
  await page.getByRole("textbox", { name: "New line comment" }).fill(firstBody);
  await page
    .getByRole("button", { name: "Save pending draft comment" })
    .click();

  await expect
    .poll(() =>
      page
        .getByRole("article", { name: "Comment thread for line 5" })
        .getByText(firstBody, { exact: true })
        .count(),
    )
    .toBe(1);
  const followUp = page.getByRole("textbox", {
    name: "Add another pending note",
  });
  await expect.poll(() => followUp.count()).toBe(1);
  await expect.poll(() => followUp.inputValue()).toBe("");
  await expect
    .poll(() => followUp.evaluate((node) => node === document.activeElement))
    .toBe(true);

  const secondBody = "Second pending note in the same Markdown thread.";
  await followUp.fill(secondBody);
  await followUp.press("Control+Enter");
  await expect.poll(() => followUp.inputValue()).toBe("");
  await expect
    .poll(() =>
      page
        .getByRole("article", { name: "Comment thread for line 5" })
        .getByText(secondBody, { exact: true })
        .count(),
    )
    .toBe(1);
  await expect.poll(() => followUp.count()).toBe(1);
  await expect
    .poll(() => followUp.evaluate((node) => node === document.activeElement))
    .toBe(true);
}, 40_000);

it("keeps a saved HTML thread open and focuses its follow-up", async () => {
  server = await startViviServer({
    rootDir: fixture.rootDir,
    gitReviewTimeoutMs: 1_000,
  });
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  let createDraftRequestCount = 0;
  await page.route("**/graphql", async (route) => {
    const payload = route.request().postDataJSON() as {
      operationName?: string;
    } | null;
    if (payload?.operationName === "CreateDraftReviewComment") {
      createDraftRequestCount += 1;
      if (createDraftRequestCount === 2) {
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
    }
    await route.continue();
  });
  page.setDefaultTimeout(8_000);
  await page.goto(server.url);

  await page.locator('[data-tree-path="index.html"]').click();
  await page.getByRole("tab", { name: "Document" }).click();
  const previewFrame = page.frameLocator('iframe[title="index.html"]');
  await previewFrame.getByText("HTML Fixture", { exact: true }).dblclick();

  const firstBody = "First pending HTML review note.";
  await page.getByRole("textbox", { name: "New line comment" }).fill(firstBody);
  await page
    .getByRole("button", { name: "Save pending draft comment" })
    .click();

  await expect
    .poll(() =>
      page
        .getByRole("article", { name: "Comment thread for line 4" })
        .getByText(firstBody, { exact: true })
        .count(),
    )
    .toBe(1);
  await expect
    .poll(() => page.getByRole("textbox", { name: "New line comment" }).count())
    .toBe(0);
  const followUp = page.getByRole("textbox", {
    name: "Add another pending note",
  });
  await expect.poll(() => followUp.count()).toBe(1);
  await expect.poll(() => followUp.inputValue()).toBe("");
  await expect
    .poll(() => followUp.evaluate((node) => node === document.activeElement))
    .toBe(true);
  const threadBounds = await page
    .getByRole("article", { name: "Comment thread for line 4" })
    .boundingBox();
  const inspectorBounds = await page
    .getByRole("complementary", { name: "Document inspector" })
    .boundingBox();
  expect(threadBounds).not.toBeNull();
  expect(inspectorBounds).not.toBeNull();
  expect(threadBounds!.x + threadBounds!.width).toBeLessThanOrEqual(
    inspectorBounds!.x + 1,
  );

  const secondBody = "Second pending note in the same HTML thread.";
  await followUp.fill(secondBody);
  await followUp.press("Control+Enter");

  const publishWhileSaving = page.getByRole("button", {
    name: "Publish 1",
    exact: true,
  });
  await expect.poll(() => publishWhileSaving.isDisabled()).toBe(true);
  const deleteWhileSaving = page.getByRole("button", {
    name: "Delete pending draft comment 1",
  });
  await expect.poll(() => deleteWhileSaving.isDisabled()).toBe(true);
  await expect.poll(() => followUp.inputValue(), { timeout: 250 }).toBe("");
  const thirdBody = "A third thought typed while the save completes.";
  await followUp.pressSequentially(thirdBody);

  await expect
    .poll(() =>
      page
        .getByRole("article", { name: "Comment thread for line 4" })
        .getByText(secondBody, { exact: true })
        .count(),
    )
    .toBe(1);
  await expect.poll(() => followUp.count()).toBe(1);
  await expect.poll(() => followUp.inputValue()).toBe(thirdBody);
  await expect
    .poll(() => followUp.evaluate((node) => node === document.activeElement))
    .toBe(true);
  await page.getByRole("tab", { name: /Review queue/ }).click();
  const reviewQueueLedger = page.getByRole("group", {
    name: /Review queue signal ledger/,
  });
  await expect.poll(() => reviewQueueLedger.count()).toBe(1);
  await expect
    .poll(() =>
      reviewQueueLedger
        .getByRole("button", { name: "Publish 2 drafts for index.html" })
        .count(),
    )
    .toBe(1);
  await expect
    .poll(() =>
      reviewQueueLedger.getByText("2 drafts", { exact: true }).count(),
    )
    .toBeGreaterThan(0);

  await page.getByRole("tab", { name: "Document" }).click();
  const documentReady = page.getByRole("region", {
    name: "Current document ready to publish",
  });
  await expect.poll(() => documentReady.count()).toBe(1);
  await expect
    .poll(() =>
      documentReady.getByText("Excluded from Publish · Resume input").count(),
    )
    .toBe(1);
  await documentReady.getByRole("button", { name: "Publish 2" }).click();
  await expect
    .poll(() =>
      page.getByRole("button", { name: "Publish 2", exact: true }).count(),
    )
    .toBe(0);
  await expect
    .poll(() =>
      page.getByRole("article", { name: "Comment thread for line 4" }).count(),
    )
    .toBe(1);
  const preservedNewFeedback = page.getByRole("textbox", {
    name: "New line comment",
  });
  await expect.poll(() => preservedNewFeedback.inputValue()).toBe(thirdBody);
  await page.getByRole("button", { name: "Close comment thread" }).click();
  await expect
    .poll(() =>
      page.getByRole("article", { name: "Comment thread for line 4" }).count(),
    )
    .toBe(0);
  await previewFrame
    .getByRole("button", { name: "Open comment thread with 2 messages" })
    .click();
  await expect
    .poll(() =>
      page.getByRole("article", { name: "Comment thread for line 4" }).count(),
    )
    .toBe(1);
  expect(pageErrors).not.toContain(
    expect.stringContaining("escapeSelectorValue is not defined"),
  );
}, 40_000);
