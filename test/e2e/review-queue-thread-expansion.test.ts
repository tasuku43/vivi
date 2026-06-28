import { chromium, type Browser, type Locator } from "playwright";
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

it(
  "keeps In Review row navigation separate from the thread expansion badge",
  async () => {
    server = await startViviServer({
      rootDir: fixture.rootDir,
      gitReviewTimeoutMs: 1_000,
    });
    const openComment = await createComment({
      threadId: "thread-open-readme",
      body: "Open thread visible from the badge only.",
      status: "open",
      lineStart: 1,
    });
    const resolvedComment = await createComment({
      threadId: "thread-resolved-readme",
      body: "Resolved thread remains available in context.",
      status: "resolved",
      lineStart: 3,
    });
    await createComment({
      threadId: "thread-archived-readme",
      body: "Archived thread stays quiet in the row list.",
      status: "archived",
      lineStart: 5,
    });

    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    page.setDefaultTimeout(5_000);
    await page.goto(server.url);

    const reviewRow = page.getByRole("button", {
      name: /Review queue item, modified README\.md/i,
    });
    await reviewRow.waitFor({ state: "visible" });
    const readmeFileRow = page.locator(".review-thread-expand-file", {
      hasText: "README.md",
    });
    const visibleThreadRows = readmeFileRow.locator(
      ".review-thread-hairline-row:visible",
    );

    expect(await visibleThreadRows.count()).toBe(0);

    await reviewRow.click();
    await page
      .locator(`.code-thread-comment[data-comment-id="${openComment.id}"]`)
      .waitFor({ state: "visible" });
    expect(await visibleThreadRows.count()).toBe(0);

    await readmeFileRow
      .locator(".review-thread-count-toggle", { hasText: "2 threads" })
      .click();

    await readmeFileRow
      .locator(".review-thread-hairline-row:visible")
      .first()
      .waitFor({ state: "visible" });
    expect(await visibleThreadRows.count()).toBe(2);
    await expectThreadStatuses(readmeFileRow, ["Open", "Resolved"]);

    await readmeFileRow
      .getByRole("button", {
        name: /Open Resolved thread in README\.md/i,
      })
      .click();

    await page
      .locator(`.code-thread-comment[data-comment-id="${resolvedComment.id}"]`)
      .waitFor({ state: "visible" });
    expect(await visibleThreadRows.count()).toBe(2);
  },
  40_000,
);

async function createComment({
  threadId,
  body,
  status,
  lineStart,
}: {
  threadId: string;
  body: string;
  status: "open" | "resolved" | "archived";
  lineStart: number;
}): Promise<{ id: string }> {
  if (!server) throw new Error("server is not running");
  const response = await fetch(`${server.url}/api/v1/comments`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      threadId,
      path: "README.md",
      body,
      status,
      anchor: {
        surface: "source",
        canonical: {
          path: "README.md",
          lineStart,
          lineEnd: lineStart,
        },
      },
    }),
  });
  if (!response.ok) {
    throw new Error(`create comment failed: ${await response.text()}`);
  }
  return (await response.json()) as { id: string };
}

async function expectThreadStatuses(
  row: Locator,
  statuses: string[],
) {
  const labels = await row
    .locator(".review-thread-status-badge")
    .evaluateAll((items) => items.map((item) => item.textContent?.trim()));
  expect(labels).toEqual(statuses);
}
