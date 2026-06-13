import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { ViewerService } from "../../src/app/viewer-service.js";
import type { ChangeReviewPort, WatcherPort } from "../../src/app/contracts.js";
import type { FsEvent } from "../../src/domain/fs-node.js";
import { NodeFileSystem } from "../../src/infra/node-file-system.js";
import { startHttpServer } from "../../src/server/http-server.js";

let dir: string;
let server: { url: string; close: () => Promise<void> } | null = null;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "pathlens-e2e-"));
  await writeFile(path.join(dir, "README.md"), "# E2E");
  await writeFile(
    path.join(dir, "index.html"),
    '<head><link rel="stylesheet" href="style.css"></head><h1>Hello</h1><script>window.ran=true</script>',
  );
  await writeFile(path.join(dir, "style.css"), "h1 { color: rgb(255, 0, 0); }");
  await writeFile(path.join(dir, "app.js"), "window.pathlensFixture = true;");
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

  const config = await fetch(`${server.url}/api/config`).then((res) =>
    res.json(),
  );
  expect(config.allowHtmlScripts).toBe(false);

  const file = await fetch(`${server.url}/api/file?path=README.md`).then(
    (res) => res.json(),
  );
  expect(file.viewerKind).toBe("markdown");
  expect(file.content).toBe("# E2E");

  const changes = await fetch(`${server.url}/api/changes`).then((res) =>
    res.json(),
  );
  expect(changes.changes).toEqual([{ path: "README.md", status: "modified" }]);

  const diff = await fetch(`${server.url}/api/diff?path=README.md`).then(
    (res) => res.json(),
  );
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
    "script-src 'none'",
  );
  const previewHtml = await preview.text();
  expect(previewHtml).toContain('<base href="/preview/raw/">');
  expect(previewHtml).toContain('<h1 id="hello">Hello</h1>');

  const css = await fetch(`${server.url}/preview/raw/style.css`);
  expect(css.status).toBe(200);
  expect(css.headers.get("content-type")).toContain("text/css");
  expect(await css.text()).toContain("rgb(255, 0, 0)");
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
  expect(await js.text()).toContain("pathlensFixture");
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

  async readDiff(relativePath: string) {
    return {
      path: relativePath,
      status: "available" as const,
      baseLabel: "HEAD",
      compareLabel: "working tree",
      content: "diff --git a/README.md b/README.md\n+# E2E",
    };
  }
}
