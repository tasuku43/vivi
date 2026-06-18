import { afterEach, beforeEach, expect, it } from "vitest";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { delimiter } from "node:path";
import path from "node:path";
import { tmpdir } from "node:os";
import {
  createContractFixture,
  createLargeFixture,
  type ContractFixture,
  type LargeFixture,
} from "./support/fixture-workspace.js";
import { startViviServer, type StartedServer } from "./support/vivi-server.js";

let fixture: ContractFixture;
let largeFixture: LargeFixture | null = null;
let server: StartedServer | null = null;
let fakeGitDir: string | null = null;

beforeEach(async () => {
  fixture = await createContractFixture();
});

afterEach(async () => {
  await server?.close();
  server = null;
  await fixture.cleanup();
  await largeFixture?.cleanup();
  largeFixture = null;
  if (fakeGitDir) await rm(fakeGitDir, { recursive: true, force: true });
  fakeGitDir = null;
});

it("returns the tree before slow Git review completes", async () => {
  fakeGitDir = await mkdtemp(path.join(tmpdir(), "vivi-slow-git-"));
  const fakeGit = path.join(fakeGitDir, "git");
  await writeFile(fakeGit, "#!/bin/sh\nsleep 5\n", { mode: 0o755 });
  await chmod(fakeGit, 0o755);

  const startupStarted = performance.now();
  server = await startViviServer({
    rootDir: fixture.rootDir,
    gitReviewTimeoutMs: 100,
    extraEnv: {
      PATH: `${fakeGitDir}${delimiter}${process.env.PATH ?? ""}`,
    },
  });
  const startupMs = performance.now() - startupStarted;
  expect(startupMs).toBeLessThan(5_000);

  const treeStarted = performance.now();
  const tree = await fetchJson<{
    nodes: Array<{ path: string }>;
    stats: { durationMs: number };
  }>("/api/tree?depth=1");
  const treeMs = performance.now() - treeStarted;
  expect(tree.nodes.map((node) => node.path)).toContain("README.md");
  expect(treeMs).toBeLessThan(1_500);

  const reviewStarted = performance.now();
  const review = await fetchJson<{
    available: boolean;
    reason?: string;
    changes: unknown[];
  }>("/api/changes");
  const reviewMs = performance.now() - reviewStarted;
  expect(review.available).toBe(false);
  expect(review.reason).toMatch(/timed out/i);
  expect(review.changes).toEqual([]);
  expect(reviewMs).toBeLessThan(2_500);
});

it("renders the initial tree contract for a generated medium workspace", async () => {
  largeFixture = await createLargeFixture({
    directories: 35,
    filesPerDirectory: 45,
  });
  server = await startViviServer({
    rootDir: largeFixture.rootDir,
    gitReviewTimeoutMs: 500,
  });

  const treeStarted = performance.now();
  const tree = await fetchJson<{
    nodes: Array<{ path: string; kind: string; childrenLoaded?: boolean }>;
    stats: { returnedNodes: number; scannedDirectories: number };
  }>("/api/tree?depth=1");
  const treeMs = performance.now() - treeStarted;

  expect(tree.nodes).toContainEqual(
    expect.objectContaining({ path: "README.md", kind: "file" }),
  );
  expect(tree.nodes).toContainEqual(
    expect.objectContaining({
      path: "pkg-000",
      kind: "directory",
      childrenLoaded: false,
    }),
  );
  expect(tree.stats.returnedNodes).toBeLessThan(largeFixture.fileCount);
  expect(treeMs).toBeLessThan(1_500);

  const nestedStarted = performance.now();
  const nested = await fetchJson<{
    nodes: Array<{ path: string; kind: string }>;
  }>("/api/tree?path=pkg-000&depth=1");
  const nestedMs = performance.now() - nestedStarted;
  expect(nested.nodes).toContainEqual(
    expect.objectContaining({ path: "pkg-000/file-000.ts", kind: "file" }),
  );
  expect(nestedMs).toBeLessThan(1_500);
});

async function fetchJson<T>(route: string): Promise<T> {
  if (!server) throw new Error("server is not running");
  const response = await fetch(`${server.url}${route}`);
  if (!response.ok) {
    throw new Error(
      `${route} failed with ${response.status}: ${await response.text()}`,
    );
  }
  return (await response.json()) as T;
}
