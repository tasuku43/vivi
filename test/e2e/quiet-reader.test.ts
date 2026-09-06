import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile } from "node:fs/promises";
import path from "node:path";
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
let page: Page;
beforeEach(async () => {
  fixture = await createContractFixture();
  await writeFile(
    path.join(fixture.rootDir, "docs", "nested", "deep.md"),
    "# Nested document\n",
  );
  vi.stubEnv("VIVI_E2E_SERVER_COMMAND", path.resolve("vivi"));
  vi.stubEnv(
    "VIVI_E2E_SERVER_ARGS",
    JSON.stringify(["{root}", "--host", "{host}", "--port", "{port}"]),
  );
  server = await startViviServer({
    rootDir: fixture.rootDir,
    useProductDefaults: true,
    extraEnv: { VIVI_DATA_DIR: path.join(fixture.outsideDir, "quiet-data") },
  });
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(8000);
  await page.goto(server.url);
  await page.locator('[data-tree-path="README.md"]').waitFor();
});
afterEach(async () => {
  await browser?.close();
  await server?.close();
  await fixture?.cleanup();
  vi.unstubAllEnvs();
});

it("opens real search from first use, restores focus and keeps changed tabs through the compact menu", async () => {
  const find = page
    .getByRole("region", { name: "Start reading" })
    .getByRole("button", { name: "Find a document" });
  await find.click();
  const input = page.getByRole("textbox", { name: "Quick open query" });
  await expect
    .poll(() => input.evaluate((el) => el === document.activeElement))
    .toBe(true);
  await input.fill("no-such-document");
  await page.keyboard.press("Escape");
  await expect
    .poll(() => find.evaluate((el) => el === document.activeElement))
    .toBe(true);
  await find.click();
  await input.fill("README.md");
  await expect.poll(() => page.getByRole("option").count()).toBeGreaterThan(0);
  await page.keyboard.press("Enter");
  await page.locator('[data-tab-path="README.md"]').waitFor();
  await page.getByRole("button", { name: "Dismiss reading tip" }).click();
  const menu = page.getByRole("button", { name: "Tab actions" });
  await menu.click();
  await page.getByRole("menuitem", { name: "Keep preview open" }).click();
  await expect
    .poll(() =>
      page.locator('[data-tab-path="README.md"]').getAttribute("aria-label"),
    )
    .toBe("README.md");
  await page.locator('[data-tree-path="index.html"]').dblclick();
  await page.locator('[data-tab-path="index.html"]').waitFor();
  await writeFile(
    path.join(fixture.rootDir, "README.md"),
    "# Changed while reading another document\n",
  );
  await expect
    .poll(() =>
      page.locator('[data-tab-path="README.md"]').getAttribute("aria-label"),
    )
    .toContain("changed");
  await menu.click();
  await page.getByRole("menuitem", { name: "Close unchanged tabs" }).click();
  expect(await page.locator("[data-tab-path]").count()).toBe(1);
  expect(await page.locator('[data-tab-path="README.md"]').count()).toBe(1);
  await menu.click();
  expect(
    await page.getByRole("menuitem", { name: "Close other tabs" }).isDisabled(),
  ).toBe(true);
  await page.keyboard.press("Escape");
  expect(await menu.evaluate((el) => el === document.activeElement)).toBe(true);
  await menu.click();
  await page.keyboard.press("ControlOrMeta+k");
  await input.waitFor();
  await expect
    .poll(() => page.getByRole("menu", { name: "Tab actions" }).count())
    .toBe(0);
  await page.keyboard.press("Escape");
  await expect
    .poll(() =>
      page
        .getByText(
          "Double-click a block to leave feedback. Save a draft, then publish for your agent.",
        )
        .isVisible(),
    )
    .toBe(false);
});

it("keeps the inspector reachable at 800 and 520 px with Escape and preserved inspector tabs", async () => {
  await page.locator('[data-tree-path="README.md"]').click();
  await page.locator(".markdown-document").waitFor();
  for (const width of [800, 520]) {
    await page.setViewportSize({ width, height: 800 });
    await expect
      .poll(async () => {
        const pane = page.locator("[data-viewer-pane]");
        return pane.evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
      })
      .toBe(true);
    const tabName = page
      .locator('[data-tab-path="README.md"]')
      .getByText("README.md", { exact: true });
    expect(
      await tabName.evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    const toggle = page.getByRole("button", { name: "Expand inspector" });
    await toggle.waitFor();
    expect(await toggle.innerText()).toContain("For you");
    await toggle.click();
    const documentTab = page.getByRole("tab", {
      name: "Document",
      exact: true,
    });
    await documentTab.click();
    await page.keyboard.press("Escape");
    await expect.poll(() => toggle.getAttribute("aria-expanded")).toBe("false");
    expect(await toggle.evaluate((el) => el === document.activeElement)).toBe(
      true,
    );
    await toggle.click();
    await expect
      .poll(() => documentTab.getAttribute("aria-selected"))
      .toBe("true");
    await page.getByRole("button", { name: "Collapse inspector" }).click();
    await page.getByRole("button", { name: "Tab actions" }).click();
    const menu = page.getByRole("menu", { name: "Tab actions" });
    const bounds = await menu.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    await page.keyboard.press("Escape");
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
  }
});

it("uses reader widths for fresh workspaces and restores the user's resized widths", async () => {
  const sidebar = page.getByRole("complementary", {
    name: "Documents",
    exact: true,
  });
  const inspector = page.getByRole("complementary", {
    name: "Review inspector",
    exact: true,
  });
  expect((await sidebar.boundingBox())!.width).toBe(210);
  expect((await inspector.boundingBox())!.width).toBe(310);
  for (const [name, x] of [
    ["Resize sidebar", 340],
    ["Resize inspector", 860],
  ] as const) {
    const box = (await page.getByRole("button", { name }).boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + 40);
    await page.mouse.down();
    await page.mouse.move(x, box.y + 40, { steps: 4 });
    await page.mouse.up();
  }
  await expect.poll(async () => (await sidebar.boundingBox())!.width).toBe(340);
  await expect
    .poll(async () => (await inspector.boundingBox())!.width)
    .toBe(420);
  await page.reload();
  await sidebar.waitFor();
  await expect.poll(async () => (await sidebar.boundingBox())!.width).toBe(340);
  await expect
    .poll(async () => (await inspector.boundingBox())!.width)
    .toBe(420);
});

it("keeps tab menus and keyboard focus scoped to the correct split pane", async () => {
  await page.locator('[data-tree-path="README.md"]').dblclick();
  await page.locator('[data-tree-path="index.html"]').dblclick();
  const source = page.locator('[data-tab-path="README.md"]');
  const drop = page.locator('[aria-label="Split pane"]');
  const bounds = (await drop.boundingBox())!;
  await source.dragTo(drop, {
    targetPosition: { x: bounds.width - 40, y: bounds.height / 2 },
  });
  await expect.poll(() => page.locator("[data-pane-id]").count()).toBe(2);
  const panes = page.locator("[data-pane-id]");
  const second = panes.nth(1);
  await second.locator('[data-tab-path="README.md"]').click();
  await second.locator('[data-tab-path="README.md"]').press("Home");
  expect(
    await second
      .locator('[data-tab-path="README.md"]')
      .evaluate((el) => el === document.activeElement),
  ).toBe(true);
  await second.getByRole("button", { name: "Tab actions" }).click();
  expect(
    await page.getByRole("menuitem", { name: "Close other tabs" }).isDisabled(),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await panes.first().getByRole("button", { name: "Tab actions" }).click();
  await page.getByRole("menuitem", { name: "Close other tabs" }).click();
  expect(await second.locator('[data-tab-path="README.md"]').count()).toBe(1);
}, 20_000);

it("keeps folder-only structure and live nested H1 labels through collapse and keyboard reopen", async () => {
  const tree = page.getByRole("tree");
  const docs = tree.locator('[data-tree-path="docs"]');
  await docs.click();
  const nested = tree.locator('[data-tree-path="docs/nested"]');
  await nested.waitFor();
  if ((await nested.getAttribute("aria-expanded")) !== "true")
    await nested.click();
  const file = tree.locator('[data-tree-path="docs/nested/deep.md"]');
  await file.waitFor();
  expect(await file.locator("svg").count()).toBe(0);
  expect(await file.locator("[data-tree-guide]").count()).toBe(2);
  expect(await docs.locator("[data-folder-icon]").count()).toBe(1);
  expect(await tree.innerText()).not.toMatch(/[📘📁]/u);
  await file.click();
  await writeFile(
    path.join(fixture.rootDir, "docs", "nested", "deep.md"),
    "# Updated nested heading\n",
  );
  await expect.poll(() => file.innerText()).toContain("Updated nested heading");
  await nested.click();
  await expect.poll(() => file.count()).toBe(0);
  await nested.press("ArrowRight");
  await file.waitFor();
  await nested.press("ArrowRight");
  await expect
    .poll(() => file.evaluate((el) => el === document.activeElement))
    .toBe(true);
  await file.press("Enter");
  await expect.poll(() => file.getAttribute("aria-selected")).toBe("true");
  await expect
    .poll(() =>
      page
        .locator('[data-tab-path="docs/nested/deep.md"]')
        .getAttribute("aria-label"),
    )
    .toBe("docs/nested/deep.md");
});

for (const kind of ["markdown", "html"] as const) {
  it(`loads a relative image and reopens published feedback on an image-only ${kind} block`, async () => {
    await writeFile(
      path.join(fixture.rootDir, "diagram.svg"),
      '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="80"><rect width="160" height="80" fill="#789"/></svg>',
    );
    const resource = await page.request.get(
      new URL("/preview/raw/diagram.svg", server.url).href,
    );
    expect(resource.status()).toBe(200);
    expect(resource.headers()["content-security-policy"]).toContain("sandbox;");
    const filePath = kind === "markdown" ? "README.md" : "index.html";
    await writeFile(
      path.join(fixture.rootDir, filePath),
      kind === "markdown"
        ? '# Diagram review\n\n<p><img src="diagram.svg" alt="Workspace diagram"></p>\n'
        : '<!doctype html>\n<html><body>\n<p><img src="diagram.svg" alt="Workspace diagram"></p>\n</body></html>',
    );
    const opened = await runBinary(path.resolve("vivi"), [
      "open",
      server.url,
      filePath,
      "--print",
    ]);
    await page.goto(opened.stdout.trim());
    await page.locator(`[data-tab-path="${filePath}"]`).waitFor();
    const surface =
      kind === "markdown"
        ? page
        : page.frameLocator('iframe[title="index.html"]');
    const diagram = surface.getByRole("img", { name: "Workspace diagram" });
    await expect
      .poll(() =>
        diagram.evaluate((image) => (image as HTMLImageElement).naturalWidth),
      )
      .toBe(160);
    await diagram.dblclick();
    await page
      .getByRole("textbox", { name: "New line comment" })
      .fill("Please clarify this diagram.");
    await page
      .getByRole("button", { name: "Save pending draft comment" })
      .click();
    const passiveDraft = await runBinary(path.resolve("vivi"), [
      "inbox",
      server.url,
    ]);
    expect(passiveDraft.stdout).toContain("inbox count=0");
    await page.reload();
    await page.locator(`[data-tree-path="${filePath}"]`).click();
    await page.getByRole("tab", { name: /For you/ }).click();
    await page
      .getByRole("button", { name: `Publish 1 draft for ${filePath}` })
      .click();
    const close = page.getByRole("button", { name: "Close comment thread" });
    if (await close.count()) await close.click();
    await surface
      .getByRole("button", { name: "Open comment thread with 1 message" })
      .click();
    await expect
      .poll(() =>
        page
          .getByLabel(/Comment thread for line/)
          .getByText("Please clarify this diagram.", { exact: true })
          .isVisible(),
      )
      .toBe(true);
    expect(
      await page.getByRole("textbox", { name: "New line comment" }).count(),
    ).toBe(0);
    await expect
      .poll(() =>
        page
          .getByLabel(/Comment thread for line/)
          .getByText("Published", { exact: true })
          .count(),
      )
      .toBeGreaterThan(0);
    const passive = await runBinary(path.resolve("vivi"), [
      "inbox",
      server.url,
    ]);
    expect(passive.stdout).toContain(filePath);
    expect(passive.stdout).toContain("Please clarify this diagram.");
    const thread = page.getByLabel(/Comment thread for line/);
    await expect
      .poll(() => thread.getByText("Unseen", { exact: true }).count())
      .toBe(1);
    const read = await runBinary(path.resolve("vivi"), [
      "inbox",
      server.url,
      "--read-as",
      kind === "markdown" ? "codex" : "claude",
    ]);
    const actor = kind === "markdown" ? "codex" : "claude";
    expect(read.stdout).toContain(`read-as=${actor}`);
    await expect
      .poll(() => thread.getByText("Seen", { exact: true }).count())
      .toBe(1);
    await expect
      .poll(() => thread.getByText(new RegExp(`${actor} read`)).count())
      .toBe(1);
  });
}

it("recovers the active document and missed tree changes after the server restarts", async () => {
  await page.locator('[data-tree-path="README.md"]').dblclick();
  await page.getByRole("heading", { name: "Fixture" }).waitFor();
  const port = Number(new URL(server.url).port);
  await server.close();
  const status = page.getByRole("button", { name: "Workspace status details" });
  await expect.poll(() => status.innerText()).toContain("Disconnected");
  await page.getByRole("button", { name: "README.md", exact: true }).click();
  await page.getByText("Preview unavailable", { exact: true }).waitFor();
  await writeFile(
    path.join(fixture.rootDir, "README.md"),
    "# Reconnected document\n\nUpdated while offline.\n",
  );
  await writeFile(
    path.join(fixture.rootDir, "offline-note.md"),
    "# Added while offline\n",
  );
  server = await startViviServer({
    rootDir: fixture.rootDir,
    port,
    useProductDefaults: true,
    extraEnv: { VIVI_DATA_DIR: path.join(fixture.outsideDir, "quiet-data") },
  });
  await expect
    .poll(() => status.innerText(), { timeout: 10_000 })
    .toBe("Live\n⌃");
  await expect
    .poll(
      () => page.getByRole("heading", { name: "Reconnected document" }).count(),
      { timeout: 10_000 },
    )
    .toBe(1);
  await expect
    .poll(() => page.locator('[data-tree-path="offline-note.md"]').count())
    .toBe(1);
  expect(
    await page.getByText("Preview unavailable", { exact: true }).count(),
  ).toBe(0);
}, 30_000);

it.each(["close", "save"] as const)(
  "preserves a newer %s action when an earlier resume request finishes late",
  async (action) => {
    await page.locator('[data-tree-path="README.md"]').dblclick();
    await page
      .getByRole("combobox", { name: "Markdown view mode" })
      .selectOption("source");
    await page.getByRole("button", { name: "Add comment on line 1" }).click();
    const input = page.getByRole("textbox", { name: "New line comment" });
    await input.fill("Preserve this thought without reopening it.");
    await page.locator('[data-tree-path="index.html"]').click();
    await expect.poll(() => input.count()).toBe(0);
    let releaseRequest!: () => void;
    const pause = new Promise<void>((resolve) => {
      releaseRequest = resolve;
    });
    let paused = false;
    await page.route("**/graphql", async (route) => {
      const body = route.request().postData() ?? "";
      if (
        !paused &&
        body.includes("ViviFileContext") &&
        body.includes("README.md")
      ) {
        paused = true;
        await pause;
      }
      await route.continue();
    });
    try {
      await page
        .getByRole("button", { name: /Resume input in README\.md/ })
        .click();
      await expect.poll(() => paused).toBe(true);
      await expect
        .poll(() => input.inputValue())
        .toBe("Preserve this thought without reopening it.");
      const savedBody = page
        .getByRole("article", { name: "Comment thread for line 1" })
        .getByText("Preserve this thought without reopening it.", {
          exact: true,
        });
      if (action === "close") {
        await page
          .getByRole("button", { name: "Close comment thread" })
          .click();
        await expect.poll(() => input.count()).toBe(0);
      } else {
        await page
          .getByRole("button", { name: "Save pending draft comment" })
          .click();
        await expect.poll(() => input.count()).toBe(0);
        await expect
          .poll(() =>
            page
              .getByRole("article", { name: "Comment thread for line 1" })
              .count(),
          )
          .toBe(0);
      }
      const refreshComplete = page.waitForResponse((response) => {
        const body = response.request().postData() ?? "";
        return body.includes("ViviComments") && body.includes("README.md");
      });
      releaseRequest();
      await refreshComplete;
      if (action === "close") {
        await expect.poll(() => input.count()).toBe(0);
        await page
          .getByRole("button", { name: /Resume input in README\.md/ })
          .click();
        await expect
          .poll(() => input.inputValue())
          .toBe("Preserve this thought without reopening it.");
      } else {
        await expect
          .poll(() =>
            page
              .getByRole("article", { name: "Comment thread for line 1" })
              .count(),
          )
          .toBe(0);
        await page
          .getByRole("button", {
            name: "Open comment thread on line 1 with 1 message",
          })
          .click();
        await expect.poll(() => savedBody.count()).toBe(1);
        expect(await input.count()).toBe(0);
      }
    } finally {
      releaseRequest();
    }
  },
  20_000,
);

it("opens an encoded nested document from the CLI in the reader", async () => {
  const filePath = "docs/nested/日本語 & # ? %.md";
  await writeFile(
    path.join(fixture.rootDir, filePath),
    "# Exact document\n\nReady for review.\n",
  );
  const opened = await runBinary(path.resolve("vivi"), [
    "open",
    server.url,
    filePath,
    "--print",
  ]);
  const link = opened.stdout.trim();
  expect(new URL(link).searchParams.get("path")).toBe(filePath);
  await page.goto(link);
  await page.locator(`[data-tab-path="${filePath}"]`).waitFor();
  await page
    .getByRole("heading", { name: "Exact document", exact: true })
    .waitFor();
  await writeFile(
    path.join(fixture.rootDir, filePath),
    "# Revised document\n\nFeedback applied.\n",
  );
  await page
    .getByRole("heading", { name: "Revised document", exact: true })
    .waitFor();
});

it("shares For you activity and receipts across servers without reopening or extending passive reads", async () => {
  const peer = await startViviServer({
    rootDir: fixture.rootDir,
    useProductDefaults: true,
    extraEnv: { VIVI_DATA_DIR: path.join(fixture.outsideDir, "quiet-data") },
  });
  const query = async (
    url: string,
    query: string,
    variables: Record<string, unknown> = {},
  ) => {
    const response = await fetch(`${url}/graphql`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
    });
    const payload = await response.json();
    expect(payload.errors).toBeUndefined();
    return payload.data;
  };
  const filePath = "docs/nested/deep.md";
  const row = page.locator(
    `[data-testid="review-queue-item"][data-review-path="${filePath}"]`,
  );
  try {
    await page.getByRole("tab", { name: /For you/ }).click();
    await row.waitFor();
    await page
      .getByRole("button", { name: `Hide ${filePath} for now`, exact: true })
      .click();
    await page.getByRole("tab", { name: /For you/ }).click();
    await expect.poll(() => row.count()).toBe(0);
    await query(
      peer.url,
      'mutation($path:String!){observeDocument(path:$path,reason:"Presented by agent")}',
      { path: filePath },
    );
    await row.waitFor();
    await expect.poll(() => row.innerText()).toContain("Presented by agent");
    expect(await page.locator(`[data-tab-path="${filePath}"]`).count()).toBe(0);
    await query(
      peer.url,
      "mutation($input:CommentInput!){createComment(input:$input){id}}",
      {
        input: {
          path: filePath,
          viewerKind: "markdown",
          body: "Clarify this document",
          source: "human",
          anchor: {
            surface: "source",
            canonical: {
              path: filePath,
              start: { line: 1, column: 1 },
              end: { line: 1, column: 5 },
            },
          },
        },
      },
    );
    await expect
      .poll(() => page.getByRole("region", { name: "Feedback" }).innerText())
      .toContain("deep.md");
    await runBinary(path.resolve("vivi"), [
      "inbox",
      peer.url,
      "--read-as",
      "codex",
    ]);
    await expect.poll(() => row.innerText()).toContain("Read by agent");
    await expect
      .poll(() => page.getByRole("region", { name: "Feedback" }).count())
      .toBe(0);
    const snapshot = async () =>
      (await query(peer.url, "query {attention}")).attention.events.find(
        (event: { path: string }) => event.path === filePath,
      );
    const before = await snapshot();
    await runBinary(path.resolve("vivi"), [
      "inbox",
      peer.url,
      "--read-as",
      "codex",
    ]);
    expect((await snapshot()).at).toBe(before.at);
    await page.reload();
    await row.waitFor();
    expect((await snapshot()).at).toBe(before.at);
    expect(await page.locator('[data-review-path$=".css"]').count()).toBe(0);
  } finally {
    await peer.close();
  }
}, 30000);

it("expires recent activity at thirty minutes while keeping the document open", async () => {
  await page.clock.install({ time: new Date() });
  await page.reload();
  await page.locator('[data-tree-path="README.md"]').waitFor();
  await page.locator('[data-tree-path="README.md"]').dblclick();
  await page.getByRole("tab", { name: /For you/ }).click();
  const row = page.locator(
    '[data-testid="review-queue-item"][data-review-path="README.md"]',
  );
  await expect.poll(() => row.innerText()).toContain("Opened");
  await page
    .getByRole("heading", { name: "Vivi Fixture", exact: true })
    .waitFor({ state: "visible" });
  // Timers were installed before reload so the expiry timer is controlled.
  await page.clock.fastForward(29 * 60 * 1000);
  await expect.poll(() => row.count()).toBe(1);
  await expect.poll(() => row.innerText()).toContain("29m ago");
  await page.clock.fastForward(61 * 1000);
  await expect.poll(() => row.count()).toBe(0);
  expect(await page.locator('[data-tab-path="README.md"]').count()).toBe(1);
  expect(
    await page
      .getByRole("heading", { name: "Vivi Fixture", exact: true })
      .isVisible(),
  ).toBe(true);
});
