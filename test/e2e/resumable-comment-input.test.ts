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
