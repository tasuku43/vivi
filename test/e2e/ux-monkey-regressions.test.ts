import { writeFile } from "node:fs/promises";
import path from "node:path";
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

function explorerTree() {
  return page!.getByRole("tree", { name: /Live workspace map/ });
}

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
  await explorerTree().locator('[data-tree-path="README.md"]').click();
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

  await explorerTree().locator('[data-tree-path="index.html"]').click();
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
  await explorerTree().locator('[data-tree-path="README.md"]').click();

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
  await explorerTree().locator('[data-tree-path="index.html"]').click();
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

  await explorerTree().locator('[data-tree-path="README.md"]').click();
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

it("keeps the compact status bar readable without overlapping groups", async () => {
  await page!.setViewportSize({ width: 900, height: 700 });
  await explorerTree().locator('[data-tree-path="README.md"]').click();

  const visibleGroups = await page!
    .locator('footer[aria-label^="Workspace status"] > span')
    .evaluateAll((groups) =>
      groups
        .filter((group) => getComputedStyle(group).display !== "none")
        .map((group) => {
          const rect = group.getBoundingClientRect();
          return {
            left: rect.left,
            right: rect.right,
            text: group.textContent ?? "",
          };
        }),
    );

  expect(visibleGroups).toHaveLength(2);
  expect(visibleGroups[0]?.text).toContain("Current");
  expect(visibleGroups[1]?.text).toContain("Feedback");
  expect(visibleGroups[0]!.right).toBeLessThanOrEqual(visibleGroups[1]!.left);
});

it("keeps a narrow HTML feedback popover below the sticky viewer toolbar", async () => {
  await page!.setViewportSize({ width: 700, height: 700 });
  await writeFile(
    path.join(fixture.rootDir, "index.html"),
    [
      "<!doctype html>",
      "<html><body>",
      "<h1>HTML Toolbar Boundary</h1>",
      '<div style="height: 760px">Scrollable preview</div>',
      "<p>Bottom HTML comment target</p>",
      "</body></html>",
      "",
    ].join("\n"),
  );
  await explorerTree().locator('[data-tree-path="index.html"]').click();

  const previewFrame = page!.frameLocator('iframe[title="index.html"]');
  const target = previewFrame.getByText("Bottom HTML comment target", {
    exact: true,
  });
  await target.scrollIntoViewIfNeeded();
  await target.dblclick({ position: { x: 8, y: 8 } });

  const host = page!.locator(".html-rendered-comment-thread-host");
  const toolbar = page!.locator(".html-viewer > .viewer-toolbar");
  await expect.poll(() => host.count()).toBe(1);
  await expect
    .poll(async () => {
      const [hostBounds, toolbarBounds] = await Promise.all([
        host.boundingBox(),
        toolbar.boundingBox(),
      ]);
      return Boolean(
        hostBounds &&
        toolbarBounds &&
        hostBounds.y >= toolbarBounds.y + toolbarBounds.height + 16,
      );
    })
    .toBe(true);

  await page!.getByRole("button", { name: "Source", exact: true }).click();
  await expect.poll(() => host.count()).toBe(0);
}, 20_000);

it("keeps typed feedback through outside clicks and comment close controls", async () => {
  // Keep README open while another preview is inspected. Inputs belonging to a
  // replaced preview tab are intentionally omitted from the inspector.
  await explorerTree().locator('[data-tree-path="README.md"]').dblclick();
  await page!.getByRole("button", { name: "Source", exact: true }).click();
  await page!.getByRole("button", { name: "Add comment on line 1" }).click();

  const input = page!.getByRole("textbox", { name: "New line comment" });
  await input.fill("Keep this thought while I inspect the workspace");
  await page!.getByRole("button", { name: /Theme:/ }).click();
  await expect
    .poll(() => input.inputValue())
    .toBe("Keep this thought while I inspect the workspace");

  await explorerTree().locator('[data-tree-path="index.html"]').click();
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

it("keeps a failed pending draft visible and retryable", async () => {
  await explorerTree().locator('[data-tree-path="README.md"]').click();
  await page!.getByRole("button", { name: "Source", exact: true }).click();
  await page!.getByRole("button", { name: "Add comment on line 1" }).click();

  const input = page!.getByRole("textbox", { name: "New line comment" });
  await input.fill("Keep this input after the failed save");
  await page!.route("**/graphql", async (route) => {
    const requestBody = route.request().postData() ?? "";
    if (!requestBody.includes("CreateDraftReviewComment")) {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        errors: [{ message: "Monkey draft save failed" }],
      }),
    });
  });
  await page!
    .getByRole("button", { name: "Save pending draft comment" })
    .click();

  await expect
    .poll(() =>
      page!
        .getByRole("alert")
        .getByText(/Monkey draft save failed/)
        .count(),
    )
    .toBe(1);
  await expect
    .poll(() => input.inputValue())
    .toBe("Keep this input after the failed save");
  await expect.poll(() => input.isEnabled()).toBe(true);
  await page!.unroute("**/graphql");
  await page!
    .getByRole("button", { name: "Save pending draft comment" })
    .click();
  await expect.poll(() => input.count()).toBe(0);
  await expect
    .poll(() =>
      page!
        .locator("#root")
        .evaluate((root) => root.childElementCount),
    )
    .toBeGreaterThan(0);
}, 20_000);

it("keeps a saved Markdown follow-up focused while the next block stays targetable", async () => {
  await explorerTree().locator('[data-tree-path="README.md"]').click();
  const heading = page!.getByRole("heading", { name: "Vivi Fixture" });
  await heading.dblclick();

  const firstBody = "First note in a rapid Markdown pass";
  await page!
    .getByRole("textbox", { name: "New line comment" })
    .fill(firstBody);
  await page!
    .getByRole("button", { name: "Save pending draft comment" })
    .click();

  const followUp = page!.getByRole("textbox", {
    name: "Add another pending note",
  });
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
  // The anchored follow-up card occupies the block's right side. Use the
  // readable leading edge to continue the pass without closing the draft.
  await paragraph.dblclick({ position: { x: 8, y: 8 } });
  await expect
    .poll(() =>
      page!.getByRole("textbox", { name: "New line comment" }).count(),
    )
    .toBe(1);
  await expect.poll(() => followUp.count()).toBe(0);
}, 20_000);

it("resumes a collapsed rendered comment without rediscovering its target", async () => {
  await explorerTree().locator('[data-tree-path="README.md"]').click();
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

  await writeFile(
    path.join(fixture.rootDir, "README.md"),
    "# Vivi Fixture updated\n\n## Overview\n\nContract workspace changed\n",
  );
  await page!.reload();
  await explorerTree().locator('[data-tree-path="README.md"]').click();
  await expect
    .poll(() =>
      page!.getByRole("heading", { name: "Vivi Fixture updated" }).count(),
    )
    .toBe(1);

  await page!
    .getByRole("button", { name: /Resume input in README\.md/ })
    .click();
  await expect
    .poll(() =>
      page!.getByRole("textbox", { name: "New line comment" }).inputValue(),
    )
    .toBe("Return me to this rendered heading");
  const reanchor = page!.getByRole("button", { name: "Re-anchor here" });
  await expect.poll(() => reanchor.count()).toBe(1);
  await expect
    .poll(() => reanchor.evaluate((node) => node === document.activeElement))
    .toBe(true);
  await reanchor.click();
  await expect.poll(() => input.isEnabled()).toBe(true);
  const reanchoredBody = "Return me to this rendered heading after re-anchor";
  await input.fill(reanchoredBody);
  await page!.getByRole("button", { name: "Close comment thread" }).click();
  await page!
    .getByRole("button", { name: /Resume input in README\.md/ })
    .click();
  await expect.poll(() => reanchor.count()).toBe(0);
  await expect.poll(() => input.inputValue()).toBe(reanchoredBody);
  await page!.getByRole("button", { name: "Discard" }).click();
}, 20_000);

it("keeps a saved HTML follow-up focused while the next block stays targetable", async () => {
  await explorerTree().locator('[data-tree-path="index.html"]').click();
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
    .poll(() =>
      page!.getByRole("textbox", { name: "Add another pending note" }).count(),
    )
    .toBe(1);
  await expect
    .poll(() =>
      page!
        .getByRole("textbox", { name: "Add another pending note" })
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
  const docs = explorerTree().locator('[data-tree-path="docs"]');
  await docs.click();
  await expect
    .poll(() =>
      explorerTree().locator('[data-tree-path="docs/guide.md"]').count(),
    )
    .toBe(1);
  await docs.click();
  await expect
    .poll(() =>
      explorerTree().locator('[data-tree-path="docs/guide.md"]').count(),
    )
    .toBe(0);

  await explorerTree().locator('[data-tree-path="README.md"]').click();
  await page!.getByRole("button", { name: "Source", exact: true }).click();
  await page!.getByRole("button", { name: "Rendered", exact: true }).click();
  await expect
    .poll(() => page!.getByRole("heading", { name: "Vivi Fixture" }).count())
    .toBe(1);

  await explorerTree().locator('[data-tree-path="index.html"]').click();
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
  await explorerTree().locator('[data-tree-path="README.md"]').click();
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
