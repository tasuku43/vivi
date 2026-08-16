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

it("wires document and review inspector surfaces to the active workspace", async () => {
  await page!.locator('[data-tree-path="README.md"]').click();

  const reviewInspector = page!.getByRole("complementary", {
    name: "Review inspector",
  });
  await expect.poll(() => reviewInspector.isVisible()).toBe(true);
  await expect
    .poll(() => reviewInspector.getByText("Review", { exact: true }).count())
    .toBe(0);

  const reviewTab = reviewInspector.getByRole("tab", {
    name: /Review queue/,
  });
  await expect.poll(() => reviewTab.getAttribute("aria-selected")).toBe("true");

  await reviewInspector.getByRole("tab", { name: "Document" }).click();
  const inspector = page!.getByRole("complementary", {
    name: "Document inspector",
  });
  await expect.poll(() => inspector.isVisible()).toBe(true);
  await expect
    .poll(() =>
      inspector
        .getByRole("tab", { name: "Document" })
        .getAttribute("aria-selected"),
    )
    .toBe("true");
  await expect
    .poll(() => inspector.getByRole("tab", { name: /Review queue/ }).count())
    .toBe(1);
  await expect
    .poll(() => inspector.getByText("README.md", { exact: true }).count())
    .toBeGreaterThan(0);
  await expect
    .poll(() => inspector.getByRole("button", { name: "Vivi Fixture" }).count())
    .toBe(1);

  await inspector.getByRole("tab", { name: /Review queue/ }).click();
  await expect.poll(() => reviewInspector.isVisible()).toBe(true);
  await reviewInspector.getByRole("tab", { name: "Document" }).click();

  await inspector.getByRole("button", { name: "Show changes" }).click();
  await expect
    .poll(() =>
      inspector.getByRole("button", { name: "Back to document" }).count(),
    )
    .toBe(1);
  await expect
    .poll(() =>
      page!.getByTestId("viewer-diff-toggle").getAttribute("aria-pressed"),
    )
    .toBe("true");

  await inspector.getByRole("button", { name: "Back to document" }).click();
  await page!.locator('[data-tree-path="index.html"]').click();
  await expect
    .poll(() => inspector.getByText("index.html", { exact: true }).count())
    .toBeGreaterThan(0);
  await expect
    .poll(() => inspector.locator('span[title="index.html"]').innerText())
    .toBe("workspace root · HTML");
}, 20_000);

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

  await page!.locator('[data-tree-path="index.html"]').click();
  await expect.poll(() => input.count()).toBe(0);
  await page!
    .getByRole("button", { name: /Resume input in README\.md/ })
    .click();
  await expect
    .poll(() =>
      page!.getByRole("textbox", { name: "New line comment" }).inputValue(),
    )
    .toBe("Keep this thought while I inspect the workspace");

  await page!.getByRole("button", { name: "Close comment thread" }).click();
  await expect.poll(() => input.count()).toBe(0);

  await page!
    .getByRole("button", { name: /Resume input in README\.md/ })
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

it("keeps a saved Markdown follow-up focused while the next block stays targetable", async () => {
  await page!.locator('[data-tree-path="README.md"]').click();
  const heading = page!.getByRole("heading", { name: "Vivi Fixture" });
  await heading.dblclick();

  const firstBody = "First note in a rapid Markdown pass";
  await page!
    .getByRole("textbox", { name: "New line comment" })
    .fill(firstBody);
  await page!
    .getByRole("button", { name: "Save pending draft comment" })
    .click();

  const followUp = page!.getByRole("textbox", { name: "Continue thread" });
  await expect.poll(() => followUp.count()).toBe(1);
  await expect.poll(() => followUp.inputValue()).toBe("");
  await expect
    .poll(() => followUp.evaluate((node) => node === document.activeElement))
    .toBe(true);
  await expect
    .poll(() =>
      page!
        .getByRole("article", { name: "Comment thread for line 1" })
        .getByText(firstBody, { exact: true })
        .count(),
    )
    .toBe(1);

  const paragraph = page!.getByText("Contract workspace changed", {
    exact: true,
  });
  await paragraph.dblclick();
  await expect
    .poll(() =>
      page!.getByRole("textbox", { name: "New line comment" }).count(),
    )
    .toBe(1);
  await expect.poll(() => followUp.count()).toBe(1);
}, 20_000);

it("resumes a collapsed rendered comment without rediscovering its target", async () => {
  await page!.locator('[data-tree-path="README.md"]').click();
  const heading = page!.getByRole("heading", { name: "Vivi Fixture" });
  await heading.click();
  await expect
    .poll(() =>
      page!.getByRole("textbox", { name: "New line comment" }).count(),
    )
    .toBe(0);

  const paragraph = page!.getByText("Contract workspace changed", {
    exact: true,
  });
  const bounds = await paragraph.boundingBox();
  expect(bounds).not.toBeNull();
  await page!.mouse.move(bounds!.x + 4, bounds!.y + bounds!.height / 2);
  await page!.mouse.down();
  await page!.mouse.move(
    bounds!.x + bounds!.width - 4,
    bounds!.y + bounds!.height / 2,
    { steps: 6 },
  );
  await page!.mouse.up();
  await expect
    .poll(() =>
      page!.getByRole("textbox", { name: "New line comment" }).count(),
    )
    .toBe(0);
  await expect
    .poll(() => page!.evaluate(() => window.getSelection()?.toString() ?? ""))
    .toContain("Contract workspace changed");

  await heading.dblclick();
  const input = page!.getByRole("textbox", { name: "New line comment" });
  await input.fill("Return me to this rendered heading");
  await page!.getByRole("button", { name: "Close comment thread" }).click();
  await expect.poll(() => input.count()).toBe(0);

  await page!
    .getByRole("button", { name: /Resume input in README\.md/ })
    .click();
  await expect
    .poll(() =>
      page!.getByRole("textbox", { name: "New line comment" }).inputValue(),
    )
    .toBe("Return me to this rendered heading");
  await page!.getByRole("button", { name: "Discard" }).click();
}, 20_000);

it("keeps a saved HTML follow-up focused while the next block stays targetable", async () => {
  await page!.locator('[data-tree-path="index.html"]').click();
  await page!.getByRole("tab", { name: "Document" }).click();
  const previewFrame = page!.frameLocator('iframe[title="index.html"]');
  const heading = previewFrame.getByRole("heading", { name: "HTML Fixture" });

  await heading.dblclick();
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
    .poll(() =>
      page!
        .getByRole("article", { name: /Comment thread/ })
        .getByText(body, { exact: true })
        .count(),
    )
    .toBe(1);
  await expect
    .poll(() => page!.getByRole("textbox", { name: "Continue thread" }).count())
    .toBe(1);
  await expect
    .poll(() =>
      page!
        .getByRole("textbox", { name: "Continue thread" })
        .evaluate((node) => node === document.activeElement),
    )
    .toBe(true);

  const paragraph = previewFrame.getByText("Second HTML comment target", {
    exact: true,
  });
  // The fixed follow-up card occupies the preview's right side. Target the
  // visible text edge, as a reader would, so the open thread is replaced
  // without requiring an explicit close first.
  await paragraph.dblclick({ position: { x: 8, y: 8 } });
  await expect
    .poll(() =>
      page!.getByRole("textbox", { name: "New line comment" }).count(),
    )
    .toBe(1);
  await page!.getByRole("button", { name: "Close comment thread" }).click();

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

it("never opens stale Quick Open results while a new query is loading", async () => {
  await page!.locator('[data-tree-path="README.md"]').click();
  await page!.getByRole("button", { name: "Open command palette" }).click();
  const query = page!.getByLabel("Quick open query");

  await query.fill("README");
  await expect
    .poll(() =>
      page!.getByRole("option", { name: /README\.md.*open file/ }).count(),
    )
    .toBe(1);

  await query.fill("index.html");
  await expect
    .poll(() => page!.getByText("Searching file names...").count())
    .toBe(1);
  await expect
    .poll(() =>
      page!.getByRole("option", { name: /README\.md.*open file/ }).count(),
    )
    .toBe(0);
  await query.press("Enter");
  await expect
    .poll(() => page!.getByRole("dialog", { name: "Quick open" }).count())
    .toBe(1);

  await expect
    .poll(() =>
      page!.getByRole("option", { name: /index\.html.*open file/ }).count(),
    )
    .toBe(1);
  await query.press("Enter");
  await page!.getByRole("tab", { name: "Document" }).click();
  await expect
    .poll(() =>
      page!
        .getByRole("complementary", { name: "Document inspector" })
        .getByText("index.html", { exact: true })
        .count(),
    )
    .toBeGreaterThan(0);
}, 20_000);
