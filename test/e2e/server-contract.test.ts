import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { ViewerService } from "../../src/app/viewer-service.js";
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
  });
  server = await startHttpServer({ host: "127.0.0.1", port: 0, service });

  const tree = await fetch(`${server.url}/api/tree`).then((res) => res.json());
  expect(JSON.stringify(tree)).toContain("README.md");

  const config = await fetch(`${server.url}/api/config`).then((res) =>
    res.json(),
  );
  expect(config.allowHtmlScripts).toBe(true);

  const file = await fetch(`${server.url}/api/file?path=README.md`).then(
    (res) => res.json(),
  );
  expect(file.viewerKind).toBe("markdown");
  expect(file.content).toBe("# E2E");

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
    "script-src 'self' 'unsafe-inline'",
  );
  const previewHtml = await preview.text();
  expect(previewHtml).toContain('<base href="/preview/raw/">');
  expect(previewHtml).toContain('<h1 id="hello">Hello</h1>');

  const css = await fetch(`${server.url}/preview/raw/style.css`);
  expect(css.status).toBe(200);
  expect(css.headers.get("content-type")).toContain("text/css");
  expect(await css.text()).toContain("rgb(255, 0, 0)");
}, 10000);

it("disables preview scripts when explicitly requested", async () => {
  const service = new ViewerService({
    fileSystem: new NodeFileSystem({ rootDir: dir, allowHtmlScripts: false }),
  });
  server = await startHttpServer({
    host: "127.0.0.1",
    port: 0,
    service,
    allowHtmlScripts: false,
  });

  const preview = await fetch(`${server.url}/preview/html?path=index.html`);
  expect(preview.status).toBe(200);
  expect(preview.headers.get("content-security-policy")).toContain(
    "style-src 'self' 'unsafe-inline'",
  );
  expect(preview.headers.get("content-security-policy")).toContain(
    "script-src 'none'",
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

function timeoutAfter(ms: number): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
  });
}
