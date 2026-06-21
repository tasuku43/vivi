import { afterEach, beforeEach, expect, it } from "vitest";
import {
  createContractFixture,
  type ContractFixture,
} from "./support/fixture-workspace.js";
import { startViviServer, type StartedServer } from "./support/vivi-server.js";

let fixture: ContractFixture;
let server: StartedServer | null = null;

beforeEach(async () => {
  fixture = await createContractFixture();
});

afterEach(async () => {
  await server?.close();
  server = null;
  await fixture.cleanup();
});

it("serves the language-independent workspace API contract", async () => {
  server = await startViviServer({
    rootDir: fixture.rootDir,
    extraEnv: { VIVI_DATA_DIR: `${fixture.outsideDir}/vivi-data` },
  });

  const config = await fetchJson<{
    root: string;
    allowHtmlScripts: boolean;
    maxFileSizeBytes: number;
  }>("/api/config");
  expect(config.root).toBe(fixture.rootDir);
  expect(config.allowHtmlScripts).toBe(false);
  expect(config.maxFileSizeBytes).toBe(1024 * 1024);

  const tree = await fetchJson<{
    nodes: Array<{
      path: string;
      kind: string;
      childrenLoaded?: boolean;
      viewerKind?: string;
    }>;
    stats: { scannedDirectories: number; returnedNodes: number };
  }>("/api/tree?depth=1");
  expect(pathsFromTree(tree.nodes)).toEqual(
    expect.arrayContaining([
      ".hidden.txt",
      "README.md",
      "assets",
      "docs",
      "empty-dir",
      "agent-cache",
      "agent-output",
      "index.html",
      "large.log",
      "readme-link.md",
      "src.ts",
      "untracked.md",
    ]),
  );
  expect(JSON.stringify(tree)).not.toContain("node_modules");
  expect(JSON.stringify(tree)).not.toContain(".cache");
  expect(JSON.stringify(tree)).not.toContain(".git");
  expect(JSON.stringify(tree)).not.toContain("outside-link.txt");
  expect(tree.nodes.find((node) => node.path === "docs")).toMatchObject({
    kind: "directory",
    childrenLoaded: false,
  });

  const nestedTree = await fetchJson<{
    nodes: Array<{ path: string; viewerKind?: string }>;
  }>("/api/tree?path=docs&depth=1");
  expect(pathsFromTree(nestedTree.nodes)).toContain("docs/guide.md");
  expect(pathsFromTree(nestedTree.nodes)).not.toContain("docs/nested/note.txt");

  await expect(fetchJson("/api/file?path=README.md")).resolves.toMatchObject({
    path: "README.md",
    viewerKind: "markdown",
    encoding: "utf8",
    content: expect.stringContaining("# Vivi Fixture"),
    etag: expect.stringMatching(/^sha256:/),
  });
  await expect(
    fetchJson("/api/file?path=readme-link.md"),
  ).resolves.toMatchObject({
    path: "readme-link.md",
    viewerKind: "markdown",
    content: expect.stringContaining("# Vivi Fixture"),
  });

  const binary = await fetchJson<{
    encoding: string;
    content: string;
    mimeType: string;
  }>("/api/file?path=assets%2Fpixel.png");
  expect(binary).toMatchObject({
    encoding: "base64",
    mimeType: "image/png",
  });
  expect(binary.content.length).toBeGreaterThan(0);

  await expect(fetchJson("/api/file?path=agent-output")).resolves.toMatchObject(
    {
      path: "agent-output",
      viewerKind: "text",
      encoding: "utf8",
      content: expect.stringContaining("next=review"),
      mimeType: "text/plain; charset=utf-8",
    },
  );
  await expect(fetchJson("/api/file?path=agent-cache")).resolves.toMatchObject({
    path: "agent-cache",
    viewerKind: "binary",
    encoding: "none",
    content: "",
    mimeType: "application/octet-stream",
  });

  const large = await fetchJson<{
    path: string;
    encoding: string;
    truncated: boolean;
    previewBytes: number;
  }>("/api/file?path=large.log");
  expect(large).toMatchObject({
    path: "large.log",
    encoding: "utf8",
    truncated: true,
    previewBytes: 1024 * 1024,
  });

  await expectStatus("/api/file?path=..%2Fsecret.txt", 400);
  await expectStatus("/api/file?path=outside-link.txt", 400);

  const preview = await fetchRoute("/preview/html?path=index.html");
  expect(preview.status).toBe(200);
  expect(preview.headers.get("content-security-policy")).toContain(
    "script-src 'nonce-",
  );
  expect(preview.headers.get("content-security-policy")).not.toContain(
    "script-src 'self' 'unsafe-inline'",
  );
  expect(await preview.text()).toContain('<h1 id="html-fixture"');

  const changes = await fetchJson<{
    available: boolean;
    changes: Array<{ path: string; status: string; kind: string }>;
  }>("/api/changes");
  expect(changes.available).toBe(true);
  expect(changes.changes.map((change) => change.path)).not.toContain(
    "outside-link.txt",
  );
  expect(changes.changes).toEqual(
    expect.arrayContaining([
      { path: "README.md", status: "modified", kind: "file" },
      { path: "docs/guide.md", status: "modified", kind: "file" },
      { path: "src.ts", status: "modified", kind: "file" },
      { path: "untracked.md", status: "added", kind: "file" },
      { path: "deleted.md", status: "deleted", kind: "file" },
    ]),
  );

  const diff = await fetchJson<{ status: string; content: string }>(
    "/api/diff?path=README.md&base=HEAD",
  );
  expect(diff.status).toBe("available");
  expect(diff.content).toContain("-Contract workspace");
  expect(diff.content).toContain("+Contract workspace changed");

  const files = await fetchJson<{
    query: string;
    results: Array<{ path: string; viewerKind?: string; score: number }>;
    stats: { scannedFiles: number };
  }>("/api/files?q=guide&limit=10");
  expect(files.query).toBe("guide");
  expect(files.results).toContainEqual(
    expect.objectContaining({ path: "docs/guide.md", viewerKind: "markdown" }),
  );
  expect(files.stats.scannedFiles).toBeGreaterThan(0);

  const search = await fetchJson<{
    query: string;
    results: Array<{
      path: string;
      viewerKind?: string;
      lineNumber: number;
      lineText: string;
    }>;
    stats: { scannedFiles: number; readFiles?: number };
  }>("/api/search?q=Contract%20workspace%20changed&limit=10");
  expect(search.query).toBe("Contract workspace changed");
  expect(search.results).toContainEqual(
    expect.objectContaining({
      path: "README.md",
      viewerKind: "markdown",
      lineNumber: 5,
      lineText: "Contract workspace changed",
    }),
  );
  expect(search.stats.scannedFiles).toBeGreaterThan(0);

  const meta = await fetchJson<{ version: string }>("/api/v1/meta");
  expect(meta.version).toBe("v1");

  const created = await postJson<{
    id: string;
    path: string;
    body: string;
    status: string;
    viewerKind: string;
    anchor: { canonical: { fileHash?: string } };
  }>("/api/v1/comments", {
    path: "README.md",
    body: "Contract comment",
    anchor: {
      surface: "source",
      canonical: {
        path: "README.md",
        lineStart: 1,
        lineEnd: 1,
        quote: "# Vivi Fixture",
      },
    },
  });
  expect(created).toMatchObject({
    path: "README.md",
    body: "Contract comment",
    status: "open",
    viewerKind: "markdown",
  });
  expect(created.id).toEqual(expect.any(String));
  expect(created.anchor.canonical.fileHash).toMatch(/^sha256:/);

  const commentsForPath = await fetchJson<Array<{ id: string; path: string }>>(
    "/api/v1/comments?path=README.md",
  );
  expect(commentsForPath).toContainEqual(
    expect.objectContaining({ id: created.id, path: "README.md" }),
  );

  const resolved = await patchJson<{
    id: string;
    status: string;
    resolvedAt?: string;
  }>(`/api/v1/comments/${created.id}`, { status: "resolved" });
  expect(resolved).toMatchObject({ id: created.id, status: "resolved" });
  expect(resolved.resolvedAt).toEqual(expect.any(String));

  const openComments = await fetchJson<Array<{ id: string }>>(
    "/api/v1/comments?status=open",
  );
  expect(openComments.map((comment) => comment.id)).not.toContain(created.id);

  const exported = await fetchRoute(
    "/api/v1/comments/export?status=resolved&format=jsonl",
  ).then((response) => response.text());
  const exportedLines = exported.trim().split("\n").filter(Boolean);
  expect(exportedLines.map((line) => JSON.parse(line))).toContainEqual(
    expect.objectContaining({
      id: created.id,
      path: "README.md",
      status: "resolved",
      type: "commentThread",
      comments: expect.arrayContaining([
        expect.objectContaining({ body: "Contract comment" }),
      ]),
    }),
  );
});

it("keeps HTML preview scripts disabled unless explicitly allowed", async () => {
  server = await startViviServer({
    rootDir: fixture.rootDir,
    allowHtmlScripts: true,
  });

  const preview = await fetchRoute("/preview/html?path=index.html");
  expect(preview.status).toBe(200);
  expect(preview.headers.get("content-security-policy")).toContain(
    "script-src 'self' 'unsafe-inline'",
  );
});

async function fetchJson<T>(route: string): Promise<T> {
  const response = await fetchRoute(route);
  if (!response.ok) {
    throw new Error(
      `${route} failed with ${response.status}: ${await response.text()}`,
    );
  }
  return (await response.json()) as T;
}

async function expectStatus(route: string, status: number): Promise<void> {
  const response = await fetchRoute(route);
  expect(response.status).toBe(status);
}

async function postJson<T>(route: string, body: unknown): Promise<T> {
  const response = await fetchRoute(route, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(
      `${route} failed with ${response.status}: ${await response.text()}`,
    );
  }
  return (await response.json()) as T;
}

async function patchJson<T>(route: string, body: unknown): Promise<T> {
  const response = await fetchRoute(route, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(
      `${route} failed with ${response.status}: ${await response.text()}`,
    );
  }
  return (await response.json()) as T;
}

async function fetchRoute(
  route: string,
  init?: RequestInit,
): Promise<Response> {
  if (!server) throw new Error("server is not running");
  return fetch(`${server.url}${route}`, init);
}

function pathsFromTree(
  nodes: Array<{ path: string; children?: Array<{ path: string }> }>,
): string[] {
  const paths: string[] = [];
  for (const node of nodes) {
    paths.push(node.path);
    if (node.children) paths.push(...pathsFromTree(node.children));
  }
  return paths.sort();
}
