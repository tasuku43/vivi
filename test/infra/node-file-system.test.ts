import { mkdtemp, rm, writeFile, mkdir, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { NodeFileSystem } from "../../server/typescript/infrastructure/node-file-system.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "vivi-"));
  await writeFile(path.join(dir, "README.md"), "# Hello");
  await writeFile(path.join(dir, "index.html"), "<h1>Hello</h1>");
  await mkdir(path.join(dir, "docs"));
  await writeFile(path.join(dir, "docs", "guide.md"), "# Deep guide");
  await writeFile(
    path.join(dir, "image.png"),
    Buffer.from([0x89, 0x50, 0x4e, 0x47]),
  );
  await writeFile(path.join(dir, "large.txt"), "too large");
  await mkdir(path.join(dir, "node_modules"));
  await writeFile(path.join(dir, "node_modules", "ignored.js"), "ignored");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

it("scans a tree and ignores default ignored directories", async () => {
  const fs = new NodeFileSystem({ rootDir: dir });
  const tree = await fs.readTree();
  expect(tree.nodes.map((node) => node.path)).toContain("README.md");
  expect(tree.stats?.returnedNodes).toBeGreaterThan(0);
  expect(JSON.stringify(tree)).not.toContain("node_modules");
});

it("reads one directory level without recursively loading child directories", async () => {
  const fs = new NodeFileSystem({ rootDir: dir });
  const root = await fs.readDirectory("", { depth: 1 });
  const docs = root.nodes.find((node) => node.path === "docs");

  expect(root.path).toBe("");
  expect(root.depth).toBe(1);
  expect(root.stats).toMatchObject({
    scannedDirectories: 1,
  });
  expect(JSON.stringify(root)).not.toContain("docs/guide.md");
  expect(docs).toMatchObject({
    kind: "directory",
    childrenLoaded: false,
  });

  const nested = await fs.readDirectory("docs", { depth: 1 });
  expect(nested.nodes).toContainEqual(
    expect.objectContaining({
      path: "docs/guide.md",
      parentPath: "docs",
      viewerKind: "markdown",
    }),
  );
});

it("does not descend into ignored directories while scanning", async () => {
  await mkdir(path.join(dir, "node_modules", "deep"), { recursive: true });
  await writeFile(path.join(dir, "node_modules", "deep", "ignored.md"), "nope");

  const fs = new NodeFileSystem({ rootDir: dir });
  const tree = await fs.readTree();

  expect(JSON.stringify(tree)).not.toContain("node_modules");
  expect(JSON.stringify(tree)).not.toContain("ignored.md");
  expect(tree.stats?.scannedDirectories).toBe(2);
});

it("reflects added and removed files on subsequent tree reads", async () => {
  const fs = new NodeFileSystem({ rootDir: dir });
  await writeFile(path.join(dir, "generated.log"), "started\n");

  const afterAdd = JSON.stringify(await fs.readTree());
  expect(afterAdd).toContain("generated.log");

  await unlink(path.join(dir, "generated.log"));
  const afterRemove = JSON.stringify(await fs.readTree());
  expect(afterRemove).not.toContain("generated.log");
});

it("reads a file payload with viewer kind and etag", async () => {
  const fs = new NodeFileSystem({ rootDir: dir });
  const file = await fs.readFile("README.md");
  expect(file.viewerKind).toBe("markdown");
  expect(file.etag).toMatch(/^sha256:/);
});

it("returns image payloads as base64 with a mime type", async () => {
  const fs = new NodeFileSystem({ rootDir: dir });
  const file = await fs.readFile("image.png");
  expect(file.viewerKind).toBe("image");
  expect(file.encoding).toBe("base64");
  expect(file.mimeType).toBe("image/png");
  expect(file.content).toBe(
    Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64"),
  );
});

it("returns a bounded partial preview for large text files", async () => {
  const fs = new NodeFileSystem({ rootDir: dir, maxFileSizeBytes: 4 });
  const file = await fs.readFile("large.txt");
  expect(file.encoding).toBe("utf8");
  expect(file.content).toBe("too ");
  expect(file.truncated).toBe(true);
  expect(file.maxSizeBytes).toBe(4);
  expect(file.previewBytes).toBe(4);
});

it("does not read large HTML files into preview content", async () => {
  const fs = new NodeFileSystem({ rootDir: dir, maxFileSizeBytes: 4 });
  const file = await fs.readFile("index.html");
  expect(file.encoding).toBe("none");
  expect(file.content).toBe("");
  expect(file.truncated).toBe(true);
});

it("rejects HTML preview when the file exceeds the preview limit", async () => {
  const fs = new NodeFileSystem({ rootDir: dir, maxFileSizeBytes: 4 });
  await expect(fs.readHtmlPreview("index.html")).rejects.toThrow(
    "file is too large to preview",
  );
});

it("filters files when include extensions are configured", async () => {
  const fs = new NodeFileSystem({
    rootDir: dir,
    includeExtensions: new Set(["md"]),
  });
  const tree = await fs.readTree();
  expect(JSON.stringify(tree)).toContain("README.md");
  expect(JSON.stringify(tree)).not.toContain("image.png");
  await expect(fs.readFile("image.png")).rejects.toThrow("path is excluded");
});

it("searches file paths without requiring a full tree snapshot", async () => {
  const fs = new NodeFileSystem({ rootDir: dir });
  const result = await fs.searchFiles("guide", { limit: 5 });
  expect(result.results).toContainEqual(
    expect.objectContaining({
      path: "docs/guide.md",
      viewerKind: "markdown",
    }),
  );
  expect(result.stats.scannedFiles).toBeGreaterThan(0);
});

it("searches text through bounded filesystem traversal", async () => {
  const fs = new NodeFileSystem({ rootDir: dir });
  const result = await fs.searchText("deep", { limit: 5 });
  expect(result.results).toContainEqual(
    expect.objectContaining({
      path: "docs/guide.md",
      lineText: "# Deep guide",
    }),
  );
  expect(result.stats.readFiles).toBeGreaterThan(0);
});

it("exposes server-safe viewer config", () => {
  const fs = new NodeFileSystem({
    rootDir: dir,
    maxFileSizeBytes: 4,
  });
  expect(fs.getConfig()).toEqual({
    root: path.resolve(dir),
    allowHtmlScripts: false,
    maxFileSizeBytes: 4,
  });
});
