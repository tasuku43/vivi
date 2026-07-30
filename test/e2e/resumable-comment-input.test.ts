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
  await page.getByRole("button", { name: "Publish all 1 pending" }).click();

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
  await page.getByRole("button", { name: "Source", exact: true }).click();
  await page.getByRole("button", { name: "Add comment on line 1" }).click();
  await page
    .getByRole("textbox", { name: "New line comment" })
    .fill("Remove this pending thought");
  await page
    .getByRole("button", { name: "Save pending draft comment" })
    .click();

  const deletePending = page.getByRole("button", {
    name: "Delete pending draft comment 1",
  });
  await deletePending.waitFor({ state: "visible" });
  await deletePending.click();

  await expect.poll(() => deletePending.count()).toBe(0);
  await expect
    .poll(() =>
      page.getByRole("button", { name: "Publish all 1 pending" }).count(),
    )
    .toBe(0);
}, 40_000);

it("continues a just-saved HTML preview comment in the same pending thread", async () => {
  server = await startViviServer({
    rootDir: fixture.rootDir,
    gitReviewTimeoutMs: 1_000,
  });
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.setDefaultTimeout(8_000);
  await page.goto(server.url);

  await page.locator('[data-tree-path="index.html"]').click();
  const previewFrame = page.frameLocator('iframe[title="index.html"]');
  await previewFrame
    .getByText("HTML Fixture", { exact: true })
    .click({ modifiers: ["Alt"] });

  const firstBody = "First pending HTML review note.";
  await page.getByRole("textbox", { name: "New line comment" }).fill(firstBody);
  await page
    .getByRole("button", { name: "Save pending draft comment" })
    .click();

  await expect
    .poll(() => page.getByText(firstBody, { exact: true }).count())
    .toBe(1);
  const followUp = page.getByRole("textbox", { name: "Continue thread" });
  await expect.poll(() => followUp.count()).toBe(1);
  const threadBounds = await page
    .getByRole("article", { name: "Comment thread for line 4" })
    .boundingBox();
  const inspectorBounds = await page
    .getByRole("complementary", { name: "Review inspector" })
    .boundingBox();
  expect(threadBounds).not.toBeNull();
  expect(inspectorBounds).not.toBeNull();
  expect(threadBounds!.x + threadBounds!.width).toBeLessThanOrEqual(
    inspectorBounds!.x + 1,
  );

  const secondBody = "Second pending note in the same HTML thread.";
  await followUp.fill(secondBody);
  await page.getByRole("button", { name: "Add follow-up" }).click();

  await expect
    .poll(() => page.getByText(secondBody, { exact: true }).count())
    .toBe(1);
  await expect
    .poll(() =>
      page.getByRole("button", { name: "Publish all 2 pending" }).count(),
    )
    .toBe(1);
  await page.getByRole("button", { name: "Publish all 2 pending" }).click();
  await expect
    .poll(() =>
      page.getByRole("button", { name: "Publish all 2 pending" }).count(),
    )
    .toBe(0);
  await expect.poll(() => followUp.count()).toBe(1);
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
