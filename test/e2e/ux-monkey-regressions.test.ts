import { chromium, type Browser, type Page } from "playwright";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  createContractFixture,
  type ContractFixture,
} from "./support/fixture-workspace.js";
import { startViviServer, type StartedServer } from "./support/vivi-server.js";

let fixture: ContractFixture;
let server: StartedServer | null = null;
let browser: Browser | null = null;
let page: Page | null = null;

beforeEach(async () => {
  fixture = await createContractFixture();
  server = await startViviServer({
    rootDir: fixture.rootDir,
    gitReviewTimeoutMs: 1_000,
  });
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage();
  page.setDefaultTimeout(8_000);
  await page.goto(server.url);
});

afterEach(async () => {
  await browser?.close();
  page = null;
  browser = null;
  await server?.close();
  server = null;
  await fixture.cleanup();
});

it("closes individual tab controls immediately across file types", async () => {
  await page!.locator('[data-tree-path="README.md"]').click();
  await expect
    .poll(
      () => page!.getByRole("button", { name: "Close README.md" }).count(),
      { timeout: 8_000 },
    )
    .toBe(1);
  await page!.getByRole("button", { name: "Close README.md" }).click();
  await expect
    .poll(
      () => page!.getByRole("button", { name: "Close README.md" }).count(),
      { timeout: 8_000 },
    )
    .toBe(0);

  await page!.locator('[data-tree-path="index.html"]').click();
  await expect
    .poll(
      () => page!.getByRole("button", { name: "Close index.html" }).count(),
      { timeout: 8_000 },
    )
    .toBe(1);

  await page!.getByRole("button", { name: "Close index.html" }).click();
  await expect
    .poll(
      () => page!.getByRole("button", { name: "Close index.html" }).count(),
      { timeout: 8_000 },
    )
    .toBe(0);
  await expect
    .poll(
      () =>
        page!
          .getByRole("group", { name: /Open file tabs/ })
          .getAttribute("aria-label"),
      { timeout: 8_000 },
    )
    .toBe("Open file tabs");
});

it("keeps modal focus inside the overlay and returns it to the opener", async () => {
  const shortcutsTrigger = page!.getByRole("button", {
    name: "Keyboard shortcuts",
    exact: true,
  });
  await shortcutsTrigger.click();

  const closeShortcuts = page!.getByRole("button", {
    name: "Close keyboard shortcuts",
  });
  await expect
    .poll(() =>
      closeShortcuts.evaluate((node) => node === document.activeElement),
    )
    .toBe(true);
  await closeShortcuts.press("Tab");
  await expect
    .poll(() =>
      closeShortcuts.evaluate((node) => node === document.activeElement),
    )
    .toBe(true);
  await closeShortcuts.click();
  await expect
    .poll(() =>
      shortcutsTrigger.evaluate((node) => node === document.activeElement),
    )
    .toBe(true);

  const paletteTrigger = page!.getByRole("button", {
    name: "Open command palette",
  });
  await paletteTrigger.click();
  const paletteInput = page!.getByLabel("Quick open query");
  await expect
    .poll(() =>
      paletteInput.evaluate((node) => node === document.activeElement),
    )
    .toBe(true);
  await paletteInput.press("Escape");
  await expect
    .poll(() =>
      paletteTrigger.evaluate((node) => node === document.activeElement),
    )
    .toBe(true);
});

it("dismisses the compact inspector when file navigation needs the reader", async () => {
  await page!.setViewportSize({ width: 720, height: 720 });
  await page!.getByRole("button", { name: "Expand inspector" }).click();
  await expect
    .poll(() =>
      page!
        .getByRole("complementary", { name: "Review inspector" })
        .isVisible(),
    )
    .toBe(true);

  await page!.locator('[data-tree-path="README.md"]').click();
  await expect
    .poll(() =>
      page!.getByRole("complementary", { name: "Review inspector" }).count(),
    )
    .toBe(0);
  await expect
    .poll(() =>
      page!.getByRole("heading", { name: "Vivi Fixture" }).isVisible(),
    )
    .toBe(true);
});

it("keeps typed feedback through outside clicks and comment close controls", async () => {
  await page!.locator('[data-tree-path="README.md"]').click();
  await page!.getByRole("button", { name: "Source", exact: true }).click();
  await page!.getByRole("button", { name: "Add comment on line 1" }).click();

  const input = page!.getByRole("textbox", { name: "New line comment" });
  await input.fill("Keep this thought while I inspect the workspace");
  await page!.getByRole("button", { name: /Theme:/ }).click();
  await expect
    .poll(() => input.inputValue())
    .toBe("Keep this thought while I inspect the workspace");

  await page!.getByRole("button", { name: "Close comment thread" }).click();
  await expect.poll(() => input.count()).toBe(0);

  await page!
    .getByRole("button", { name: "Resume input in README.md, L1" })
    .click();
  await expect
    .poll(() =>
      page!.getByRole("textbox", { name: "New line comment" }).inputValue(),
    )
    .toBe("Keep this thought while I inspect the workspace");
  await page!.getByRole("button", { name: "Discard" }).click();
  await expect
    .poll(() =>
      page!.getByRole("textbox", { name: "New line comment" }).count(),
    )
    .toBe(0);
}, 20_000);

it("resumes a collapsed rendered comment without rediscovering its target", async () => {
  await page!.locator('[data-tree-path="README.md"]').click();
  await page!
    .getByRole("heading", { name: "Vivi Fixture" })
    .click({ modifiers: ["Alt"] });
  const input = page!.getByRole("textbox", { name: "New line comment" });
  await input.fill("Return me to this rendered heading");
  await page!.getByRole("button", { name: "Close comment thread" }).click();
  await expect.poll(() => input.count()).toBe(0);

  await page!
    .getByRole("button", { name: "Resume input in README.md, L1" })
    .click();
  await expect
    .poll(() =>
      page!.getByRole("textbox", { name: "New line comment" }).inputValue(),
    )
    .toBe("Return me to this rendered heading");
  await page!.getByRole("button", { name: "Discard" }).click();
}, 20_000);

it("keeps one HTML thread through repeated targeting and closes it after mode changes", async () => {
  await page!.locator('[data-tree-path="index.html"]').click();
  const previewFrame = page!.frameLocator('iframe[title="index.html"]');
  const heading = previewFrame.getByRole("heading", { name: "HTML Fixture" });

  await heading.click({ modifiers: ["Alt"] });
  await heading.click({ modifiers: ["Alt"] });
  await heading.click({ modifiers: ["Alt"] });
  await expect
    .poll(() => page!.getByRole("article", { name: /Comment thread/ }).count())
    .toBe(1);
  await expect
    .poll(() =>
      page!.getByRole("textbox", { name: "New line comment" }).count(),
    )
    .toBe(1);

  const body = "One HTML note after repeated targeting";
  await page!.getByRole("textbox", { name: "New line comment" }).fill(body);
  await page!
    .getByRole("button", { name: "Save pending draft comment" })
    .click();
  await expect
    .poll(() => page!.getByText(body, { exact: true }).count())
    .toBe(1);
  await expect
    .poll(() => page!.getByRole("textbox", { name: "Continue thread" }).count())
    .toBe(1);

  await page!.getByRole("button", { name: "Source", exact: true }).click();
  await expect
    .poll(() => page!.getByRole("article", { name: /Comment thread/ }).count())
    .toBe(0);
  await page!.getByRole("button", { name: "Preview", exact: true }).click();
  await expect
    .poll(() => page!.getByText(body, { exact: true }).count())
    .toBe(1);
  await expect
    .poll(() => page!.getByRole("article", { name: /Comment thread/ }).count())
    .toBe(1);

  await page!.getByRole("button", { name: "Close comment thread" }).click();
  await expect
    .poll(() => page!.getByRole("article", { name: /Comment thread/ }).count())
    .toBe(0);
  await previewFrame
    .getByRole("button", { name: "Open comment thread with 1 message" })
    .click();
  await expect
    .poll(() => page!.getByRole("article", { name: /Comment thread/ }).count())
    .toBe(1);
  await expect
    .poll(() =>
      page!
        .getByRole("article", { name: /Comment thread/ })
        .getByText(body, { exact: true })
        .count(),
    )
    .toBe(1);
  await expect
    .poll(() =>
      page!.getByRole("article", { name: "Comment", exact: true }).count(),
    )
    .toBe(0);
}, 30_000);

it("survives rapid viewer, tree, palette, and layout transitions", async () => {
  const docs = page!.locator('[data-tree-path="docs"]');
  await docs.click();
  await expect
    .poll(() => page!.locator('[data-tree-path="docs/guide.md"]').count())
    .toBe(1);
  await docs.click();
  await expect
    .poll(() => page!.locator('[data-tree-path="docs/guide.md"]').count())
    .toBe(0);

  await page!.locator('[data-tree-path="README.md"]').click();
  await page!.getByRole("button", { name: "Source", exact: true }).click();
  await page!.getByRole("button", { name: "Rendered", exact: true }).click();
  await expect
    .poll(() => page!.getByRole("heading", { name: "Vivi Fixture" }).count())
    .toBe(1);

  await page!.locator('[data-tree-path="index.html"]').click();
  await expect
    .poll(() =>
      page!
        .frameLocator('iframe[title="index.html"]')
        .getByRole("heading", { name: "HTML Fixture" })
        .count(),
    )
    .toBe(1);
  await page!.getByRole("button", { name: "Source", exact: true }).click();
  await page!.getByRole("button", { name: "Preview", exact: true }).click();

  await page!.getByRole("button", { name: "Open command palette" }).click();
  const query = page!.getByLabel("Quick open query");
  await query.fill(`missing/${"x".repeat(80)}`);
  await expect
    .poll(() => page!.getByText("No matching files.", { exact: true }).count())
    .toBe(1);
  await page!.getByRole("tab", { name: "Text" }).click();
  await page!.getByLabel("Search text query").fill("Contract workspace");
  await expect.poll(() => page!.getByRole("option").count()).toBeGreaterThan(0);
  await page!.getByLabel("Search text query").press("Escape");
  await expect.poll(() => page!.getByRole("dialog").count()).toBe(0);

  await page!.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect
    .poll(() =>
      page!.getByRole("complementary", { name: "File explorer" }).count(),
    )
    .toBe(0);
  await page!.getByRole("button", { name: "Expand sidebar" }).click();
  await page!.getByRole("button", { name: "Collapse inspector" }).click();
  await expect
    .poll(() =>
      page!.getByRole("complementary", { name: "Review inspector" }).count(),
    )
    .toBe(0);
  await page!.getByRole("button", { name: "Expand inspector" }).click();
  await expect.poll(() => page!.getByRole("dialog").count()).toBe(0);
}, 20_000);
