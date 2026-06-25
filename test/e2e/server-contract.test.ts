import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium, type Page } from "playwright";
import { afterEach, beforeEach, expect, it } from "vitest";
import { ViewerService } from "../../server/typescript/application/viewer-service.js";
import type {
  ChangeReviewPort,
  FileSystemPort,
  WatcherPort,
} from "../../server/typescript/application/contracts.js";
import type { FsEvent } from "../../server/typescript/domain/fs-node.js";
import { NodeFileSystem } from "../../server/typescript/infrastructure/node-file-system.js";
import { NodeCommentStore } from "../../server/typescript/infrastructure/node-comment-store.js";
import { startHttpServer } from "../../server/typescript/http/http-server.js";

let dir: string;
let server: { url: string; close: () => Promise<void> } | null = null;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "vivi-e2e-"));
  await writeFile(path.join(dir, "README.md"), "# E2E");
  await mkdir(path.join(dir, "docs"));
  await writeFile(path.join(dir, "docs", "guide.md"), "# Nested E2E");
  await writeFile(
    path.join(dir, "index.html"),
    '<head><link rel="stylesheet" href="style.css"></head><h1>Hello</h1><script>window.ran=true</script>',
  );
  await writeFile(path.join(dir, "style.css"), "h1 { color: rgb(255, 0, 0); }");
  await writeFile(path.join(dir, "app.js"), "window.viviFixture = true;");
});

afterEach(async () => {
  await server?.close();
  await rm(dir, { recursive: true, force: true });
});

it("serves tree, config, file, preview, and path-safety API responses", async () => {
  const service = new ViewerService({
    fileSystem: new NodeFileSystem({ rootDir: dir }),
    changeReview: new StaticChangeReview(),
  });
  server = await startHttpServer({ host: "127.0.0.1", port: 0, service });

  const tree = await fetch(`${server.url}/api/tree`).then((res) => res.json());
  expect(JSON.stringify(tree)).toContain("README.md");

  const shallowTree = await fetch(`${server.url}/api/tree?depth=1`).then(
    (res) => res.json(),
  );
  expect(JSON.stringify(shallowTree)).not.toContain("docs/guide.md");
  expect(shallowTree.stats.returnedNodes).toBeGreaterThan(0);

  const nestedTree = await fetch(
    `${server.url}/api/tree?path=docs&depth=1`,
  ).then((res) => res.json());
  expect(nestedTree.nodes).toContainEqual(
    expect.objectContaining({ path: "docs/guide.md" }),
  );

  const config = await fetch(`${server.url}/api/config`).then((res) =>
    res.json(),
  );
  expect(config.allowHtmlScripts).toBe(false);

  const file = await fetch(`${server.url}/api/file?path=README.md`).then(
    (res) => res.json(),
  );
  expect(file.viewerKind).toBe("markdown");
  expect(file.content).toBe("# E2E");

  const search = await fetch(`${server.url}/api/search?q=E2E`).then((res) =>
    res.json(),
  );
  expect(search.results).toContainEqual(
    expect.objectContaining({
      path: "README.md",
      lineNumber: 1,
      lineText: "# E2E",
    }),
  );
  expect(search.stats.scannedFiles).toBeGreaterThan(0);

  const files = await fetch(`${server.url}/api/files?q=guide`).then((res) =>
    res.json(),
  );
  expect(files.results).toContainEqual(
    expect.objectContaining({ path: "docs/guide.md" }),
  );

  const changes = await fetch(`${server.url}/api/changes`).then((res) =>
    res.json(),
  );
  expect(changes.changes).toEqual([{ path: "README.md", status: "modified" }]);

  const bases = await fetch(`${server.url}/api/diff-bases`).then((res) =>
    res.json(),
  );
  expect(bases.options).toEqual([{ ref: "HEAD", label: "HEAD" }]);

  const diff = await fetch(
    `${server.url}/api/diff?path=README.md&base=HEAD`,
  ).then((res) => res.json());
  expect(diff.content).toContain("+# E2E");

  const rejected = await fetch(
    `${server.url}/api/file?path=${encodeURIComponent("../secret.txt")}`,
  );
  expect(rejected.status).toBe(400);

  const preview = await fetch(`${server.url}/preview/html?path=index.html`);
  expect(preview.status).toBe(200);
  expect(preview.headers.get("content-security-policy")).toContain(
    "base-uri 'self'",
  );
  expect(preview.headers.get("content-security-policy")).toContain(
    "style-src 'self' 'unsafe-inline'",
  );
  expect(preview.headers.get("content-security-policy")).toContain(
    "script-src 'nonce-",
  );
  expect(preview.headers.get("content-security-policy")).toContain(
    "sandbox allow-same-origin allow-scripts",
  );
  expect(preview.headers.get("content-security-policy")).not.toContain(
    "script-src 'self' 'unsafe-inline'",
  );
  const previewHtml = await preview.text();
  expect(previewHtml).toContain('<base href="/preview/raw/">');
  expect(previewHtml).toContain('<h1 id="hello"');
  expect(previewHtml).toContain('data-vivi-comment-block-id="vivi-block-1"');
  expect(previewHtml).toContain('data-vivi-source-line-start="1"');
  expect(previewHtml).toContain('data-vivi-source-line-end="1"');
  expect(previewHtml).toContain("vivi-html-block-target");
  expect(previewHtml).toContain("vivi-html-comment-open");
  expect(previewHtml).toContain("vivi-html-thread-layout");
  expect(previewHtml).toContain(
    "if (event.source && event.source !== parent) return;",
  );
  expect(previewHtml).toContain("Open comment thread with ");
  expect(previewHtml).toContain("drafting-rendered-comment");
  expect(previewHtml).toContain("rendered-comment-marker");
  expect(previewHtml).toContain(
    'document.querySelector(`[data-vivi-comment-block-id="${escapeSelectorValue(comment.blockId)}"]`)',
  );
  expect(previewHtml).toContain("spansMultipleLines");
  expect(previewHtml).toContain('data-vivi-html-theme="dark"');
  expect(previewHtml).toContain("--vivi-rendered-palette:#0e1316");
  expect(previewHtml).not.toContain("html{color-scheme:dark;background:");
  expect(previewHtml).not.toContain("body{background:");

  const css = await fetch(`${server.url}/preview/raw/style.css`);
  expect(css.status).toBe(200);
  expect(css.headers.get("content-type")).toContain("text/css");
  expect(await css.text()).toContain("rgb(255, 0, 0)");
}, 10000);

it("targets the nearest rendered HTML block in the UI mock index cards", async () => {
  const indexHtml = await readFile("docs/ui-mocks/index.html", "utf8");
  await writeFile(path.join(dir, "index.html"), indexHtml);
  const service = new ViewerService({
    fileSystem: new NodeFileSystem({ rootDir: dir }),
    changeReview: new StaticChangeReview(),
  });
  server = await startHttpServer({ host: "127.0.0.1", port: 0, service });

  const titleLine = lineNumberFor(indexHtml, "<h2>01 Classic explorer</h2>");
  const cardLine = lineNumberFor(
    indexHtml,
    '<a class="mock-card" href="01-classic-explorer.html"',
  );
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`${server.url}/preview/html?path=index.html`);

    const titleTargetPromise = nextHtmlBlockTarget(page);
    await page
      .getByRole("heading", { name: "01 Classic explorer" })
      .click({ modifiers: ["Alt"] });
    const titleTarget = await titleTargetPromise;
    expect(titleTarget).toMatchObject({
      type: "vivi-html-block-target",
      text: "01 Classic explorer",
      sourceLineStart: titleLine,
      sourceLineEnd: titleLine,
    });

    const cardTargetPromise = nextHtmlBlockTarget(page);
    await page
      .locator('a.mock-card[href="01-classic-explorer.html"] .tag')
      .click({ modifiers: ["Alt"] });
    const cardTarget = await cardTargetPromise;
    expect(cardTarget.type).toBe("vivi-html-block-target");
    expect(cardTarget.text).toContain("01 Classic explorer");
    expect(cardTarget.text).toContain("Open mock");
    expect(cardTarget.sourceLineStart).toBe(cardLine);
    expect(cardTarget.sourceLineEnd).toBeGreaterThan(cardLine);
  } finally {
    await browser.close();
  }
}, 10000);

it("shows hover feedback only on the nearest rendered HTML block", async () => {
  const readerHtml = await readFile("docs/ui-mocks/02-doc-reader.html", "utf8");
  await writeFile(path.join(dir, "index.html"), readerHtml);
  const service = new ViewerService({
    fileSystem: new NodeFileSystem({ rootDir: dir }),
    changeReview: new StaticChangeReview(),
  });
  server = await startHttpServer({ host: "127.0.0.1", port: 0, service });

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`${server.url}/preview/html?path=index.html`);
    await page
      .getByText("This layout treats Markdown as the primary surface.")
      .hover();

    const paragraphHover = await renderedHtmlHoverState(page);
    expect(paragraphHover).toEqual([
      expect.objectContaining({
        tagName: "p",
        beforeLeft: "0px",
        beforeRight: "0px",
      }),
    ]);
    expect(paragraphHover[0]?.text).toContain(
      "This layout treats Markdown as the primary surface.",
    );

    await page.locator(".toolbar .btn.active").hover();
    const buttonHover = await renderedHtmlHoverState(page);
    expect(buttonHover).toEqual([
      expect.objectContaining({
        tagName: "button",
        text: "Rendered",
        beforeLeft: "0px",
        beforeRight: "0px",
      }),
    ]);
  } finally {
    await browser.close();
  }
}, 10000);

it("does not dim broad layout containers during a complex rendered HTML draft flow", async () => {
  const readerHtml = await readFile("docs/ui-mocks/02-doc-reader.html", "utf8");
  await writeFile(path.join(dir, "index.html"), readerHtml);
  const service = new ViewerService({
    fileSystem: new NodeFileSystem({ rootDir: dir }),
    changeReview: new StaticChangeReview(),
  });
  server = await startHttpServer({ host: "127.0.0.1", port: 0, service });

  const paragraphLine = lineNumberFor(
    readerHtml,
    "<p>\n                  This layout treats Markdown as the primary surface.",
  );
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`${server.url}/preview/html?path=index.html`);

    await expectNoHtmlBlockTarget(page, async () => {
      await page
        .getByText("This layout treats Markdown as the primary surface.")
        .click();
    });

    const targetPromise = nextHtmlBlockTarget(page);
    await page
      .getByText("This layout treats Markdown as the primary surface.")
      .click({ modifiers: ["Alt"] });
    const target = await targetPromise;
    expect(target).toMatchObject({
      type: "vivi-html-block-target",
      sourceLineStart: paragraphLine,
      sourceLineEnd: paragraphLine + 4,
    });
    expect(target.text).toContain(
      "This layout treats Markdown as the primary surface.",
    );

    await page.locator(".toolbar .btn.active").hover();
    expect(await renderedHtmlHoverState(page)).toEqual([]);

    await page.evaluate((messageTarget) => {
      const blockIds = Array.isArray(messageTarget.blockIds)
        ? messageTarget.blockIds
        : [messageTarget.blockId].filter(Boolean);
      window.postMessage(
        {
          type: "vivi-html-comments",
          path: "index.html",
          activeCommentId: null,
          comments: [],
          draftingBlockIds: blockIds,
          openBlockIds: blockIds,
          openBlockIdGroups: [blockIds],
        },
        "*",
      );
    }, target);

    const point = await page.evaluate(() => {
      const viewer = document.querySelector(".viewer")!.getBoundingClientRect();
      return { x: viewer.left + 8, y: viewer.top + 8 };
    });
    await page.mouse.move(point.x, point.y);

    const state = await renderedHtmlCommentClassState(page);
    expect(state.hover).toEqual([]);
    expect(state.drafting).toEqual([
      expect.objectContaining({
        tagName: "p",
        text: expect.stringContaining(
          "This layout treats Markdown as the primary surface.",
        ),
      }),
    ]);
    expect(state.drafting.map((item) => item.tagName)).not.toEqual(
      expect.arrayContaining(["main", "section", "article"]),
    );
  } finally {
    await browser.close();
  }
}, 10000);

it("preserves authored HTML styles during a rendered HTML draft flow", async () => {
  const mockIndexHtml = await readFile("docs/ui-mocks/index.html", "utf8");
  await writeFile(path.join(dir, "index.html"), mockIndexHtml);
  const service = new ViewerService({
    fileSystem: new NodeFileSystem({ rootDir: dir }),
    changeReview: new StaticChangeReview(),
  });
  server = await startHttpServer({ host: "127.0.0.1", port: 0, service });

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`${server.url}/preview/html?path=index.html&theme=light`);

    expect(await authoredHtmlStyleState(page)).toMatchObject({
      bodyBackground: "rgb(15, 17, 23)",
      cardBackground: "rgb(21, 25, 35)",
      cardTextColor: "rgb(230, 232, 239)",
    });

    const targetPromise = nextHtmlBlockTarget(page);
    await page
      .getByText("02 Document reader", { exact: true })
      .first()
      .click({ modifiers: ["Alt"] });
    await targetPromise;
    await page.mouse.move(500, 540);

    expect(await authoredHtmlStyleState(page)).toMatchObject({
      bodyBackground: "rgb(15, 17, 23)",
      cardBackground: "rgb(21, 25, 35)",
      cardTextColor: "rgb(230, 232, 239)",
    });
    expect(await renderedHtmlHoverState(page)).toEqual([]);
  } finally {
    await browser.close();
  }
}, 10000);

it("serves HTML preview with sanitized generated ids and escaped Mermaid source", async () => {
  await writeFile(
    path.join(dir, "danger.html"),
    '<h1><script>alert(1)</script>Title</h1><pre class="mermaid">graph TD\nA["\\\\quoted"] --> B["<script>x</script>"]</pre>',
  );
  const service = new ViewerService({
    fileSystem: new NodeFileSystem({ rootDir: dir }),
  });
  server = await startHttpServer({ host: "127.0.0.1", port: 0, service });

  const response = await fetch(`${server.url}/preview/html?path=danger.html`);
  expect(response.status).toBe(200);
  const html = await response.text();
  expect(html).toContain('<h1 id="title"');
  expect(html).toContain('data-mermaid-source="graph TD');
  expect(html).toContain("&quot;\\\\quoted&quot;");
  expect(html).toContain("--&gt;");
  expect(html).not.toContain('data-mermaid-source="graph TD\nA["\\\\quoted"]');
  expect(html).not.toContain("<script>x</script>");
}, 10000);

it("keeps draft review comments hidden until GraphQL publish", async () => {
  const service = new ViewerService({
    fileSystem: new NodeFileSystem({ rootDir: dir }),
    commentStore: new NodeCommentStore({ dataDir: path.join(dir, ".vivi") }),
  });
  server = await startHttpServer({ host: "127.0.0.1", port: 0, service });

  const input = {
    path: "README.md",
    viewerKind: "markdown",
    anchor: {
      surface: "source",
      canonical: { path: "README.md", lineStart: 1, lineEnd: 1 },
    },
    body: "Draft from rendered workflow",
    actor: { id: "human:tasuku", kind: "human", displayName: "Tasuku" },
    source: "human",
  };

  const created = await graphql("CreateDraftReviewComment", {
    query:
      "mutation CreateDraftReviewComment($input: DraftReviewCommentInput!) { createDraftReviewComment(input: $input) { id path body createdBy { kind } } }",
    variables: { input },
  });
  expect(created.createDraftReviewComment).toEqual(
    expect.objectContaining({
      path: "README.md",
      body: "Draft from rendered workflow",
      createdBy: expect.objectContaining({ kind: "human" }),
    }),
  );

  const beforeDrafts = await graphql("ViviDraftReviewComments", {
    query:
      "query ViviDraftReviewComments($path: String) { draftReviewComments(path: $path) { id body } }",
    variables: { path: "README.md" },
  });
  const beforeComments = await graphql("ViviComments", {
    query:
      "query ViviComments($path: String) { comments(path: $path) { id } commentThreads(path: $path) { id } }",
    variables: { path: "README.md" },
  });
  expect(beforeDrafts.draftReviewComments).toHaveLength(1);
  expect(beforeComments.comments).toEqual([]);
  expect(beforeComments.commentThreads).toEqual([]);

  const updated = await graphql("UpdateDraftReviewComment", {
    query:
      "mutation UpdateDraftReviewComment($id: ID!, $input: DraftReviewCommentUpdateInput!) { updateDraftReviewComment(id: $id, input: $input) { id body } }",
    variables: {
      id: created.createDraftReviewComment.id,
      input: { body: "Edited draft body" },
    },
  });
  expect(updated.updateDraftReviewComment.body).toBe("Edited draft body");

  const published = await graphql("PublishDraftReviewComments", {
    query:
      "mutation PublishDraftReviewComments { publishDraftReviewComments { reviewBatchId threads { path reviewBatchId status comments { body reviewBatchId } } } }",
  });
  expect(published.publishDraftReviewComments.reviewBatchId).toMatch(
    /^review-/,
  );
  expect(published.publishDraftReviewComments.threads).toContainEqual(
    expect.objectContaining({
      path: "README.md",
      status: "open",
      comments: [
        expect.objectContaining({
          body: "Edited draft body",
          reviewBatchId: published.publishDraftReviewComments.reviewBatchId,
        }),
      ],
    }),
  );

  const afterDrafts = await graphql("ViviDraftReviewComments", {
    query:
      "query ViviDraftReviewComments($path: String) { draftReviewComments(path: $path) { id } }",
    variables: { path: "README.md" },
  });
  const afterThreads = await graphql("ViviCommentThreads", {
    query:
      "query ViviCommentThreads($path: String) { commentThreads(path: $path) { id reviewBatchId } }",
    variables: { path: "README.md" },
  });
  expect(afterDrafts.draftReviewComments).toEqual([]);
  expect(afterThreads.commentThreads).toHaveLength(1);
});

it("serves adversarial HTML preview input without regex backtracking stalls", async () => {
  await writeFile(
    path.join(dir, "stress.html"),
    `<body ${"<body ".repeat(2_000)}><pre class="mermaid">${"<div>a".repeat(4_000)}</body>`,
  );
  const service = new ViewerService({
    fileSystem: new NodeFileSystem({ rootDir: dir }),
  });
  server = await startHttpServer({ host: "127.0.0.1", port: 0, service });

  const startedAt = Date.now();
  const response = await fetch(`${server.url}/preview/html?path=stress.html`);

  expect(response.status).toBe(200);
  expect(Date.now() - startedAt).toBeLessThan(1_000);
  await expect(response.text()).resolves.toContain("data-vivi-mermaid-preview");
}, 10000);

async function graphql<T = Record<string, unknown>>(
  operationName: string,
  payload: { query: string; variables?: Record<string, unknown> },
): Promise<T> {
  const response = await fetch(`${server!.url}/graphql`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ operationName, ...payload }),
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { data?: T; errors?: unknown };
  expect(body.errors).toBeUndefined();
  return body.data!;
}

it("does not expose internal error details in API error responses", async () => {
  const service = new ViewerService({
    fileSystem: {
      async readTree() {
        throw new Error("not used");
      },
      async readFile() {
        throw new Error("stack secret: /private/root/file.txt");
      },
      async readHtmlPreview() {
        throw new Error("not used");
      },
    },
  });
  server = await startHttpServer({ host: "127.0.0.1", port: 0, service });

  const response = await fetch(`${server.url}/api/file?path=README.md`);
  expect(response.status).toBe(500);
  const text = await response.text();
  expect(text).not.toContain("stack secret");
  expect(text).not.toContain("/private/root/file.txt");
  expect(text).not.toContain(" at ");
  expect(JSON.parse(text)).toEqual({
    error: "internal server error",
    reason: "An internal error occurred.",
    status: "internal_error",
  });
}, 10000);

it("rejects encoded static paths that escape the bundled app root", async () => {
  const service = new ViewerService({
    fileSystem: new NodeFileSystem({ rootDir: dir }),
  });
  server = await startHttpServer({ host: "127.0.0.1", port: 0, service });

  const response = await fetch(`${server.url}/%2e%2e%2fpackage.json`);
  expect(response.status).toBe(400);
  await expect(response.json()).resolves.toEqual({
    error: "static path escapes root",
  });
}, 10000);

it("normalizes filesystem errors from API routes", async () => {
  const fileSystem: FileSystemPort = {
    async readTree() {
      throw new Error("not used");
    },
    async readFile() {
      throw Object.assign(new Error("EISDIR: illegal operation"), {
        code: "EISDIR",
      });
    },
    async readHtmlPreview() {
      throw new Error("not used");
    },
  };
  const service = new ViewerService({ fileSystem });
  server = await startHttpServer({ host: "127.0.0.1", port: 0, service });

  const response = await fetch(`${server.url}/api/file?path=docs`);
  expect(response.status).toBe(400);
  await expect(response.json()).resolves.toEqual({
    error: "filesystem error",
    reason: "The requested path is a directory.",
    status: "EISDIR",
  });
}, 10000);

it("allows preview scripts only when explicitly requested", async () => {
  const service = new ViewerService({
    fileSystem: new NodeFileSystem({ rootDir: dir, allowHtmlScripts: true }),
  });
  server = await startHttpServer({
    host: "127.0.0.1",
    port: 0,
    service,
    allowHtmlScripts: true,
  });

  const preview = await fetch(`${server.url}/preview/html?path=index.html`);
  expect(preview.status).toBe(200);
  expect(preview.headers.get("content-security-policy")).toContain(
    "style-src 'self' 'unsafe-inline'",
  );
  expect(preview.headers.get("content-security-policy")).toContain(
    "script-src 'self' 'unsafe-inline'",
  );

  const js = await fetch(`${server.url}/preview/raw/app.js`);
  expect(js.status).toBe(200);
  expect(js.headers.get("content-type")).toContain("text/javascript");
  expect(await js.text()).toContain("viviFixture");
}, 10000);

it("closes promptly with an open event stream", async () => {
  const service = new ViewerService({
    fileSystem: new NodeFileSystem({ rootDir: dir }),
  });
  server = await startHttpServer({ host: "127.0.0.1", port: 0, service });

  const events = await fetch(`${server.url}/events`);
  expect(events.status).toBe(200);

  await expect(
    Promise.race([server.close(), timeoutAfter(1_000)]),
  ).resolves.toBeUndefined();
  server = null;
}, 10000);

it("closes promptly while a Git review request is still pending", async () => {
  const service = new ViewerService({
    fileSystem: new NodeFileSystem({ rootDir: dir }),
    changeReview: new HangingChangeReview(),
  });
  server = await startHttpServer({ host: "127.0.0.1", port: 0, service });

  const pending = fetch(`${server.url}/api/changes`).catch(() => undefined);
  await new Promise((resolve) => setTimeout(resolve, 50));

  await expect(
    Promise.race([server.close(), timeoutAfter(3_000)]),
  ).resolves.toBeUndefined();
  server = null;
  await pending;
}, 10000);

it("streams filesystem events over SSE for live review", async () => {
  const watcher = new ManualWatcher();
  const service = new ViewerService({
    fileSystem: new NodeFileSystem({ rootDir: dir }),
    watcher,
  });
  server = await startHttpServer({ host: "127.0.0.1", port: 0, service });

  const response = await fetch(`${server.url}/events`);
  expect(response.status).toBe(200);
  const reader = response.body?.getReader();
  expect(reader).toBeDefined();

  watcher.emit({ type: "change", path: "README.md", version: 2 });
  const chunk = await readUntil(reader!, "README.md");

  expect(chunk).toContain("event: fs");
  expect(chunk).toContain('"type":"change"');
  expect(chunk).toContain('"path":"README.md"');
  await reader?.cancel();
}, 10000);

it("streams filesystem events through GraphQL SSE", async () => {
  const watcher = new ManualWatcher();
  const service = new ViewerService({
    fileSystem: new NodeFileSystem({ rootDir: dir }),
    watcher,
  });
  server = await startHttpServer({ host: "127.0.0.1", port: 0, service });

  const params = new URLSearchParams({
    operationName: "WorkspaceEvents",
    query:
      "subscription WorkspaceEvents { workspaceEvents { type path kind version } }",
  });
  const response = await fetch(`${server.url}/graphql?${params}`);
  expect(response.status).toBe(200);
  const reader = response.body?.getReader();
  expect(reader).toBeDefined();

  watcher.emit({ type: "change", path: "README.md", version: 2 });
  const chunk = await readUntil(reader!, "README.md");

  expect(chunk).toContain("event: next");
  expect(chunk).toContain('"workspaceEvents"');
  expect(chunk).toContain('"type":"change"');
  expect(chunk).toContain('"path":"README.md"');
  await reader?.cancel();
}, 10000);

it("serves latest file payloads for active-viewer refetches after watcher events", async () => {
  const watcher = new ManualWatcher();
  const service = new ViewerService({
    fileSystem: new NodeFileSystem({ rootDir: dir }),
    watcher,
  });
  server = await startHttpServer({ host: "127.0.0.1", port: 0, service });

  const opened = await fetch(`${server.url}/api/file?path=README.md`).then(
    (res) => res.json(),
  );
  expect(opened.content).toBe("# E2E");

  const response = await fetch(`${server.url}/events`);
  expect(response.status).toBe(200);
  const reader = response.body?.getReader();
  expect(reader).toBeDefined();

  await writeFile(path.join(dir, "README.md"), "# First refresh");
  watcher.emit({ type: "change", path: "README.md", version: 2 });
  await readUntil(reader!, '"version":2');

  const refreshed = await fetch(`${server.url}/api/file?path=README.md`).then(
    (res) => res.json(),
  );
  expect(refreshed.content).toBe("# First refresh");

  await writeFile(path.join(dir, "README.md"), "# Intermediate refresh");
  watcher.emit({ type: "change", path: "README.md", version: 3 });
  await writeFile(path.join(dir, "README.md"), "# Final refresh");
  watcher.emit({ type: "change", path: "README.md", version: 4 });
  await readUntil(reader!, '"version":4');

  const final = await fetch(`${server.url}/api/file?path=README.md`).then(
    (res) => res.json(),
  );
  expect(final.content).toBe("# Final refresh");

  await writeFile(path.join(dir, "docs", "guide.md"), "# Other file");
  watcher.emit({ type: "change", path: "docs/guide.md", version: 5 });
  await readUntil(reader!, "docs/guide.md");

  const activeAfterUnrelatedEvent = await fetch(
    `${server.url}/api/file?path=README.md`,
  ).then((res) => res.json());
  expect(activeAfterUnrelatedEvent.content).toBe("# Final refresh");
  await reader?.cancel();
}, 10000);

it("keeps review and diff endpoints responsive after a burst of live events", async () => {
  const watcher = new ManualWatcher();
  const service = new ViewerService({
    fileSystem: new NodeFileSystem({ rootDir: dir }),
    watcher,
    changeReview: new StaticChangeReview(),
  });
  server = await startHttpServer({ host: "127.0.0.1", port: 0, service });

  const response = await fetch(`${server.url}/events`);
  expect(response.status).toBe(200);
  const reader = response.body?.getReader();
  expect(reader).toBeDefined();

  for (let index = 0; index < 25; index += 1) {
    watcher.emit({
      type: "change",
      path: `burst-${index}.md`,
      version: index + 2,
    });
  }
  const chunk = await readUntil(reader!, "burst-24.md");
  expect(chunk).toContain('"path":"burst-24.md"');

  const startedAt = Date.now();
  const changes = await fetch(`${server.url}/api/changes`).then((res) =>
    res.json(),
  );
  const diff = await fetch(
    `${server.url}/api/diff?path=README.md&base=HEAD`,
  ).then((res) => res.json());

  expect(Date.now() - startedAt).toBeLessThan(1_000);
  expect(changes.changes).toEqual([{ path: "README.md", status: "modified" }]);
  expect(diff).toMatchObject({
    path: "README.md",
    status: "available",
  });
  await reader?.cancel();
}, 10000);

function timeoutAfter(ms: number): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
  });
}

async function readUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  text: string,
): Promise<string> {
  const decoder = new TextDecoder();
  let received = "";
  const deadline = Date.now() + 1_000;
  while (!received.includes(text)) {
    const timeout = deadline - Date.now();
    if (timeout <= 0) throw new Error(`timed out waiting for ${text}`);
    const result = await Promise.race([reader.read(), timeoutAfter(timeout)]);
    if (result.done) break;
    received += decoder.decode(result.value, { stream: true });
  }
  return received;
}

function lineNumberFor(source: string, needle: string): number {
  const index = source.indexOf(needle);
  if (index < 0) throw new Error(`missing fixture text: ${needle}`);
  return source.slice(0, index).split("\n").length;
}

async function nextHtmlBlockTarget(
  page: Page,
): Promise<Record<string, unknown>> {
  return await page.evaluate(
    () =>
      new Promise<Record<string, unknown>>((resolve) => {
        const onMessage = (event: MessageEvent) => {
          if (event.data?.type !== "vivi-html-block-target") return;
          window.removeEventListener("message", onMessage);
          resolve(event.data as Record<string, unknown>);
        };
        window.addEventListener("message", onMessage);
      }),
  );
}

async function expectNoHtmlBlockTarget(
  page: Page,
  action: () => Promise<void>,
): Promise<void> {
  const received = page.evaluate(
    () =>
      new Promise<boolean>((resolve) => {
        let sawTarget = false;
        const onMessage = (event: MessageEvent) => {
          if (event.data?.type === "vivi-html-block-target") sawTarget = true;
        };
        window.addEventListener("message", onMessage);
        window.setTimeout(() => {
          window.removeEventListener("message", onMessage);
          resolve(sawTarget);
        }, 150);
      }),
  );
  await action();
  expect(await received).toBe(false);
}

async function renderedHtmlHoverState(page: Page): Promise<
  Array<{
    tagName: string;
    text: string;
    beforeLeft: string;
    beforeRight: string;
  }>
> {
  return await page.evaluate(() =>
    Array.from(
      document.querySelectorAll<HTMLElement>(".hover-rendered-comment-block"),
    ).map((element) => {
      const before = getComputedStyle(element, "::before");
      return {
        tagName: element.localName,
        text: (element.innerText || element.textContent || "")
          .replace(/\s+/g, " ")
          .trim(),
        beforeLeft: before.left,
        beforeRight: before.right,
      };
    }),
  );
}

async function renderedHtmlCommentClassState(page: Page): Promise<{
  hover: Array<{ tagName: string; text: string }>;
  drafting: Array<{ tagName: string; text: string }>;
}> {
  return await page.evaluate(() => {
    const read = (selector: string) =>
      Array.from(document.querySelectorAll<HTMLElement>(selector)).map(
        (element) => ({
          tagName: element.localName,
          text: (element.innerText || element.textContent || "")
            .replace(/\s+/g, " ")
            .trim(),
        }),
      );
    return {
      hover: read(".hover-rendered-comment-block"),
      drafting: read(".drafting-rendered-comment"),
    };
  });
}

async function authoredHtmlStyleState(page: Page): Promise<{
  bodyBackground: string;
  cardBackground: string;
  cardTextColor: string;
}> {
  return await page.evaluate(() => {
    const card = document.querySelector<HTMLElement>(".mock-card")!;
    const heading = card.querySelector<HTMLElement>("h2")!;
    return {
      bodyBackground: getComputedStyle(document.body).backgroundColor,
      cardBackground: getComputedStyle(card).backgroundColor,
      cardTextColor: getComputedStyle(heading).color,
    };
  });
}

class ManualWatcher implements WatcherPort {
  private listener: ((event: FsEvent) => void) | null = null;

  async start(onEvent: (event: FsEvent) => void): Promise<void> {
    this.listener = onEvent;
  }

  async stop(): Promise<void> {
    this.listener = null;
  }

  emit(event: FsEvent): void {
    this.listener?.(event);
  }
}

class StaticChangeReview implements ChangeReviewPort {
  async readChanges() {
    return {
      available: true,
      changes: [{ path: "README.md", status: "modified" as const }],
    };
  }

  async readDiff(relativePath: string, baseRef = "HEAD") {
    return {
      path: relativePath,
      status: "available" as const,
      baseLabel: baseRef,
      compareLabel: "working tree",
      content: "diff --git a/README.md b/README.md\n+# E2E",
    };
  }

  async readDiffBases() {
    return {
      available: true,
      options: [{ ref: "HEAD", label: "HEAD" }],
    };
  }
}

class HangingChangeReview implements ChangeReviewPort {
  async readChanges() {
    return new Promise<never>(() => undefined);
  }

  async readDiff(relativePath: string) {
    return {
      path: relativePath,
      status: "unavailable" as const,
      baseLabel: "HEAD",
      compareLabel: "working tree",
      content: "",
      reason: "pending",
    };
  }

  async readDiffBases() {
    return {
      available: true,
      options: [{ ref: "HEAD", label: "HEAD" }],
    };
  }
}
