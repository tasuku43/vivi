import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, expect, it } from "vitest";
import { ViewerService } from "../../src/app/viewer-service.js";
import { GitChangeReview } from "../../src/infra/git-change-review.js";
import { NodeFileSystem } from "../../src/infra/node-file-system.js";
import { startHttpServer } from "../../src/server/http-server.js";

const execFileAsync = promisify(execFile);

let dir: string;
let server: { url: string; close: () => Promise<void> } | null = null;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "pathlens-git-diff-"));
  await mkdir(path.join(dir, "src"), { recursive: true });
  await mkdir(path.join(dir, "assets"), { recursive: true });
  await writeFile(
    path.join(dir, "src", "app.ts"),
    'export const message = "before";\n',
  );
  await writeFile(
    path.join(dir, "assets", "logo.png"),
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]),
  );
  await git("init");
  await git("config", "user.email", "pathlens@example.test");
  await git("config", "user.name", "pathlens");
  await git("add", ".");
  await git("commit", "-m", "initial");
  await writeFile(
    path.join(dir, "src", "app.ts"),
    'export const message = "after";\n',
  );
  await writeFile(
    path.join(dir, "assets", "logo.png"),
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 4, 5, 6, 7]),
  );
});

afterEach(async () => {
  await server?.close();
  await rm(dir, { recursive: true, force: true });
});

it("serves HEAD diffs for changed source files", async () => {
  const service = new ViewerService({
    fileSystem: new NodeFileSystem({ rootDir: dir }),
    changeReview: new GitChangeReview({ rootDir: dir }),
  });
  server = await startHttpServer({ host: "127.0.0.1", port: 0, service });

  const changes = await fetch(`${server.url}/api/changes`).then(
    (res) =>
      res.json() as Promise<{
        available: boolean;
        changes: Array<{ path: string; status: string }>;
      }>,
  );
  expect(changes.available).toBe(true);
  expect(changes.changes).toContainEqual({
    path: "src/app.ts",
    status: "modified",
  });

  const diff = await fetch(
    `${server.url}/api/diff?path=${encodeURIComponent("src/app.ts")}&base=HEAD`,
  ).then(
    (res) =>
      res.json() as Promise<{
        status: string;
        content: string;
      }>,
  );

  expect(diff.status).toBe("available");
  expect(diff.content).toContain('-export const message = "before";');
  expect(diff.content).toContain('+export const message = "after";');
}, 10000);

it("serves binary diff status for changed image files", async () => {
  const service = new ViewerService({
    fileSystem: new NodeFileSystem({ rootDir: dir }),
    changeReview: new GitChangeReview({ rootDir: dir }),
  });
  server = await startHttpServer({ host: "127.0.0.1", port: 0, service });

  const diff = await fetch(
    `${server.url}/api/diff?path=${encodeURIComponent("assets/logo.png")}&base=HEAD`,
  ).then(
    (res) =>
      res.json() as Promise<{
        status: string;
        reason?: string;
      }>,
  );

  expect(diff.status).toBe("binary");
  expect(diff.reason).toBe("Binary diff is not shown in pathlens.");
}, 10000);

it("keeps Git subdirectory workspaces bounded to workspace-relative API paths", async () => {
  const workspaceDir = path.join(dir, "packages", "app");
  await mkdir(path.join(workspaceDir, "src"), { recursive: true });
  await writeFile(path.join(workspaceDir, "README.md"), "# App\n");
  await writeFile(
    path.join(workspaceDir, "src", "index.ts"),
    "export const value = 1;\n",
  );
  await writeFile(path.join(dir, "other.md"), "# Other\n");
  await git(
    "add",
    "packages/app/README.md",
    "packages/app/src/index.ts",
    "other.md",
  );
  await git("commit", "-m", "subdirectory workspace");

  await writeFile(path.join(workspaceDir, "README.md"), "# App changed\n");
  await writeFile(
    path.join(workspaceDir, "src", "index.ts"),
    "export const value = 2;\n",
  );
  await writeFile(path.join(dir, "other.md"), "# Other changed\n");

  const service = new ViewerService({
    fileSystem: new NodeFileSystem({ rootDir: workspaceDir }),
    changeReview: new GitChangeReview({ rootDir: workspaceDir }),
  });
  server = await startHttpServer({ host: "127.0.0.1", port: 0, service });

  const tree = await fetch(`${server.url}/api/tree`).then(
    (res) => res.json() as Promise<{ nodes: Array<{ path: string }> }>,
  );
  expect(tree.nodes.map((node) => node.path)).toContain("README.md");
  expect(JSON.stringify(tree)).toContain("src/index.ts");
  expect(JSON.stringify(tree)).not.toContain("other.md");

  const outside = await fetch(
    `${server.url}/api/file?path=${encodeURIComponent("../../other.md")}`,
  );
  expect(outside.status).toBe(400);

  const changes = await fetch(`${server.url}/api/changes`).then(
    (res) =>
      res.json() as Promise<{
        available: boolean;
        changes: Array<{ path: string; status: string }>;
      }>,
  );
  expect(changes.available).toBe(true);
  expect(changes.changes).toEqual([
    { path: "README.md", status: "modified" },
    { path: "src/index.ts", status: "modified" },
  ]);

  const diff = await fetch(
    `${server.url}/api/diff?path=${encodeURIComponent("README.md")}&base=HEAD`,
  ).then(
    (res) =>
      res.json() as Promise<{
        path: string;
        status: string;
        content: string;
      }>,
  );
  expect(diff.path).toBe("README.md");
  expect(diff.status).toBe("available");
  expect(diff.content).toContain("diff --git a/README.md b/README.md");
  expect(diff.content).not.toContain("packages/app/README.md");
}, 10000);

async function git(...args: string[]) {
  await execFileAsync("git", args, { cwd: dir });
}
