import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { chromium, type Browser, type Page } from "playwright";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  createContractFixture,
  type ContractFixture,
} from "./support/fixture-workspace.js";
import { startViviServer, type StartedServer } from "./support/vivi-server.js";

const runBinary = promisify(execFile);
let fixture: ContractFixture;
let server: StartedServer;
let browser: Browser;

async function startServer() {
  return startViviServer({
    rootDir: fixture.rootDir,
    useProductDefaults: true,
    extraEnv: {
      VIVI_DATA_DIR: path.join(fixture.outsideDir, "published-deletion-data"),
    },
  });
}

beforeEach(async () => {
  fixture = await createContractFixture();
  vi.stubEnv("VIVI_E2E_SERVER_COMMAND", path.resolve("vivi"));
  vi.stubEnv(
    "VIVI_E2E_SERVER_ARGS",
    JSON.stringify(["{root}", "--host", "{host}", "--port", "{port}"]),
  );
  server = await startServer();
  browser = await chromium.launch({ headless: true });
});

afterEach(async () => {
  await browser?.close();
  await server?.close();
  await fixture?.cleanup();
  vi.unstubAllEnvs();
});

async function graphql<T>(query: string, variables = {}): Promise<T> {
  const response = await fetch(`${server.url}/graphql`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const payload = await response.json();
  expect(response.ok).toBe(true);
  expect(payload.errors).toBeUndefined();
  return payload.data as T;
}

async function draft(body: string, threadId?: string) {
  const data = await graphql<{ createDraftReviewComment: { id: string } }>(
    "mutation($input:DraftReviewCommentInput!){createDraftReviewComment(input:$input){id}}",
    {
      input: {
        path: "README.md",
        body,
        ...(threadId ? { threadId } : {}),
        actor: { id: "human:deletion-e2e", kind: "human" },
        anchor: {
          surface: "source",
          canonical: {
            path: "README.md",
            lineStart: 1,
            lineEnd: 1,
            quote: "# Vivi Fixture",
          },
        },
      },
    },
  );
  return data.createDraftReviewComment.id;
}

async function publish(body: string, threadId?: string) {
  const draftId = await draft(body, threadId);
  const data = await graphql<{
    publishDraftReviewComments: { threads: Array<{ id: string }> };
  }>(
    "mutation($input:PublishDraftReviewCommentsInput){publishDraftReviewComments(input:$input){threads{id}}}",
    { input: { draftIds: [draftId] } },
  );
  return data.publishDraftReviewComments.threads[0].id;
}

async function openSource(page: Page, messages: number) {
  page.setDefaultTimeout(8_000);
  await page.goto(server.url);
  await page.locator('[data-tree-path="README.md"]').click();
  await page.getByRole("tab", { name: "Document" }).click();
  await page
    .getByRole("combobox", { name: /view mode/ })
    .selectOption("source");
  await page
    .getByRole("button", {
      name: `Open comment thread on line 1 with ${messages} ${messages === 1 ? "message" : "messages"}`,
    })
    .click();
}

async function inbox(unseen = false) {
  return (
    await runBinary(
      path.resolve("vivi"),
      [
        "inbox",
        server.url,
        ...(unseen ? ["--read-as", "codex", "--unseen"] : []),
      ],
      { timeout: 15_000 },
    )
  ).stdout;
}

it("deletes published feedback with cancel and retry, synchronizes peers, and stays deleted after restart", async () => {
  const removed = "Withdraw this published instruction";
  const retained = "Keep this other instruction in the same thread";
  const threadId = await publish(removed);
  await publish(retained, threadId);
  expect(await inbox()).toContain(removed);
  const page = await browser.newPage();
  const peer = await browser.newPage();
  await openSource(page, 2);
  await openSource(peer, 2);
  const thread = page.getByRole("article", {
    name: "Comment thread for line 1",
  });
  const peerThread = peer.getByRole("article", {
    name: "Comment thread for line 1",
  });
  const deleteFirst = thread.getByRole("button", {
    name: "Delete published comment 1",
    exact: true,
  });
  await deleteFirst.click();
  const confirmation = thread.getByRole("group", {
    name: "Delete this comment?",
  });
  await confirmation
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  expect(await thread.getByText(removed, { exact: true }).count()).toBe(1);
  expect(await confirmation.count()).toBe(0);

  let failNextDelete = true;
  await page.route("**/graphql", async (route) => {
    const payload = route.request().postDataJSON() as { query?: string };
    if (payload.query?.includes("deletePublishedComment") && failNextDelete) {
      failNextDelete = false;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          errors: [{ message: "Injected deletion failure" }],
        }),
      });
      return;
    }
    await route.continue();
  });
  await deleteFirst.click();
  await confirmation
    .getByRole("button", { name: "Delete comment", exact: true })
    .click();
  await thread
    .getByText(/Couldn[’']t delete this comment\. Try again\./)
    .waitFor();
  expect(await thread.getByText(removed, { exact: true }).count()).toBe(1);
  expect(await inbox()).toContain(removed);
  await thread.getByRole("button", { name: "Try again", exact: true }).click();
  await expect
    .poll(() => thread.getByText(removed, { exact: true }).count())
    .toBe(0);
  await expect
    .poll(() => peerThread.getByText(removed, { exact: true }).count())
    .toBe(0);
  expect(await peerThread.getByText(retained, { exact: true }).count()).toBe(1);
  const remainingInbox = await inbox();
  expect(remainingInbox).not.toContain(removed);
  expect(remainingInbox).toContain(retained);
  await page.getByRole("tab", { name: /For you/ }).click();
  await expect
    .poll(() => page.getByRole("region", { name: "Feedback" }).innerText())
    .toContain("README.md");
  await page.getByRole("tab", { name: "Document" }).click();
  await thread
    .getByRole("button", { name: "Delete published comment 1", exact: true })
    .click();
  await thread
    .getByRole("button", { name: "Delete comment", exact: true })
    .click();
  await expect
    .poll(() => peerThread.getByText(retained, { exact: true }).count())
    .toBe(0);
  await expect
    .poll(() =>
      page.evaluate(() =>
        document.activeElement?.classList.contains("document-viewer"),
      ),
    )
    .toBe(true);
  await page.getByRole("tab", { name: /For you/ }).click();
  await expect
    .poll(() => page.getByRole("region", { name: "Feedback" }).count())
    .toBe(0);
  expect(await inbox()).toContain("inbox count=0");
  expect(await inbox(true)).toContain("inbox count=0");

  await server.close();
  server = await startServer();
  await page.goto(server.url);
  await page.locator('[data-tree-path="README.md"]').click();
  await page.getByRole("tab", { name: "Document" }).click();
  await page
    .getByRole("combobox", { name: /view mode/ })
    .selectOption("source");
  await page
    .getByRole("button", { name: "Add comment on line 1", exact: true })
    .waitFor();
  expect(await inbox()).toContain("inbox count=0");
  expect(await inbox(true)).toContain("inbox count=0");
}, 60_000);

it("keeps pending feedback and Recent reasons after the last published comment is deleted", async () => {
  const threadId = await publish("Delete only the published note");
  await draft("Keep this private pending note", threadId);
  const page = await browser.newPage();
  await openSource(page, 2);
  const thread = page.getByRole("article", {
    name: "Comment thread for line 1",
  });
  await thread
    .getByRole("button", { name: /Delete published comment/ })
    .click();
  await thread
    .getByRole("button", { name: "Delete comment", exact: true })
    .click();
  await expect
    .poll(() =>
      page.getByText("Delete only the published note", { exact: true }).count(),
    )
    .toBe(0);
  await page.getByRole("tab", { name: /For you/ }).click();
  const feedback = page.getByRole("region", { name: "Feedback" });
  await feedback
    .getByRole("button", { name: "Publish 1 draft for README.md", exact: true })
    .waitFor();
  expect(await inbox()).toContain("inbox count=0");
  await page.getByRole("tab", { name: "Document" }).click();
  // Remove the remaining draft to expose the independent recent-open reason.
  await page
    .getByRole("button", { name: /Delete pending draft comment/ })
    .click();
  await page.getByRole("tab", { name: /For you/ }).click();
  await expect.poll(() => feedback.count()).toBe(0);
  await expect
    .poll(() => page.getByRole("region", { name: "Recent" }).innerText())
    .toContain("README.md");
}, 40_000);
