import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { FsNode } from "../../server/typescript/domain/fs-node.js";
import { ViewerService } from "../../server/typescript/application/viewer-service.js";
import { NodeFileSystem } from "../../server/typescript/infrastructure/node-file-system.js";
import { startHttpServer } from "../../server/typescript/http/http-server.js";

let dir: string;
let server: { url: string; close: () => Promise<void> } | null = null;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "vivi-open-all-"));
  await mkdir(path.join(dir, "docs"), { recursive: true });
  await mkdir(path.join(dir, "src"), { recursive: true });
  await mkdir(path.join(dir, "assets"), { recursive: true });

  await writeFile(path.join(dir, "README.md"), "# Readme\n\n## Start");
  await writeFile(
    path.join(dir, "docs", "flow.mmd"),
    "sequenceDiagram\n  Alice->>Bob: Hello from Mermaid\n",
  );
  await writeFile(path.join(dir, "docs", "notes.txt"), "plain text");
  await writeFile(path.join(dir, "index.html"), "<h1>Preview</h1>");
  await writeFile(path.join(dir, "src", "app.ts"), "export const ok = true;\n");
  await writeFile(path.join(dir, "data.json"), '{"ok":true}\n');
  await writeFile(
    path.join(dir, "config.yaml"),
    "name: vivi\nfeatures:\n  preview: true\n",
  );
  await writeFile(
    path.join(dir, "assets", "logo.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1"/></svg>',
  );
  await writeFile(path.join(dir, "archive.bin"), Buffer.from([0, 1, 2, 3]));
});

afterEach(async () => {
  await server?.close();
  await rm(dir, { recursive: true, force: true });
});

it("opens every file returned by the tree API", async () => {
  const service = new ViewerService({
    fileSystem: new NodeFileSystem({ rootDir: dir }),
  });
  server = await startHttpServer({ host: "127.0.0.1", port: 0, service });

  const tree = await fetch(`${server.url}/api/tree`).then(
    (res) => res.json() as Promise<{ nodes: FsNode[] }>,
  );
  const files = flattenFiles(tree.nodes);

  expect(files.map((file) => file.path).sort()).toEqual([
    "README.md",
    "archive.bin",
    "assets/logo.svg",
    "config.yaml",
    "data.json",
    "docs/flow.mmd",
    "docs/notes.txt",
    "index.html",
    "src/app.ts",
  ]);

  for (const file of files) {
    const response = await fetch(
      `${server.url}/api/file?path=${encodeURIComponent(file.path)}`,
    );
    expect(response.status, file.path).toBe(200);
    const payload = await response.json();
    expect(payload.path).toBe(file.path);
    expect(payload.viewerKind).toBe(file.viewerKind);
    expect(payload.size).toBeGreaterThanOrEqual(0);
  }

  const mermaid = await fetch(
    `${server.url}/api/file?path=${encodeURIComponent("docs/flow.mmd")}`,
  );
  expect(mermaid.status).toBe(200);
  const mermaidPayload = await mermaid.json();
  expect(mermaidPayload.viewerKind).toBe("mermaid");
  expect(mermaidPayload.content).toContain("sequenceDiagram");

  const preview = await fetch(`${server.url}/preview/html?path=index.html`);
  expect(preview.status).toBe(200);
  expect(await preview.text()).toContain('<h1 id="preview"');
}, 10000);

function flattenFiles(nodes: FsNode[]): FsNode[] {
  return nodes.flatMap((node) =>
    node.kind === "directory" ? flattenFiles(node.children ?? []) : [node],
  );
}
