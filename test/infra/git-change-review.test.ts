import { execFile } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  GitChangeReview,
  gitErrorReason,
} from "../../server/typescript/infrastructure/git-change-review.js";

const execFileAsync = promisify(execFile);

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "vivi-git-review-"));
  await git(["init"]);
  await git(["config", "user.email", "vivi@example.test"]);
  await git(["config", "user.name", "Vivi Test"]);
  await writeFile(path.join(dir, "README.md"), "# Before\n");
  await git(["add", "README.md"]);
  await git(["commit", "-m", "initial"]);
  await writeFile(path.join(dir, "README.md"), "# Middle\n");
  await git(["add", "README.md"]);
  await git(["commit", "-m", "middle"]);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

it("reads uncommitted Git changes and small text diffs", async () => {
  await writeFile(path.join(dir, "README.md"), "# After\n");
  await writeFile(path.join(dir, "report.csv"), "name,status\nhtml,ok\n");

  const review = new GitChangeReview({ rootDir: dir });
  const changes = await review.readChanges();

  expect(changes.available).toBe(true);
  expect(changes.changes).toEqual([
    { path: "README.md", status: "modified", kind: "file" },
    { path: "report.csv", status: "added", kind: "file" },
  ]);

  const modified = await review.readDiff("README.md");
  expect(modified.status).toBe("available");
  expect(modified.content).toContain("-# Middle");
  expect(modified.content).toContain("+# After");

  const added = await review.readDiff("report.csv");
  expect(added.status).toBe("available");
  expect(added.content).toContain("+++ b/report.csv");
  expect(added.content).toContain("+html,ok");
});

it("expands untracked directories into file-level review changes", async () => {
  await mkdir(path.join(dir, "notes", "daily"), { recursive: true });
  await writeFile(path.join(dir, "notes", "daily", "today.md"), "# Today\n");

  const review = new GitChangeReview({ rootDir: dir });
  const changes = await review.readChanges();

  expect(changes.available).toBe(true);
  expect(changes.changes).toContainEqual({
    path: "notes/daily/today.md",
    status: "added",
    kind: "file",
  });
  expect(changes.changes).not.toContainEqual({
    path: "notes",
    status: "added",
  });
});

it("does not surface untracked symlinks that resolve outside the workspace", async () => {
  const outside = await mkdtemp(
    path.join(tmpdir(), "vivi-git-review-outside-"),
  );
  try {
    await writeFile(path.join(outside, "secret.txt"), "secret\n");
    await symlink(
      path.join(outside, "secret.txt"),
      path.join(dir, "secret-link.txt"),
    );

    const review = new GitChangeReview({ rootDir: dir });
    const changes = await review.readChanges();

    expect(changes.available).toBe(true);
    expect(changes.changes.map((change) => change.path)).not.toContain(
      "secret-link.txt",
    );
    await expect(review.readDiff("secret-link.txt")).resolves.toMatchObject({
      status: "unavailable",
    });
  } finally {
    await rm(outside, { recursive: true, force: true });
  }
});

it("treats embedded repositories as non-file review changes", async () => {
  await mkdir(path.join(dir, "00_references", "docs"), { recursive: true });
  await mkdir(path.join(dir, "00_references", "repos", "charts"), {
    recursive: true,
  });
  await writeFile(
    path.join(dir, "00_references", "docs", "note.md"),
    "# Note\n",
  );
  await git(["init"], path.join(dir, "00_references", "repos", "charts"));
  await writeFile(
    path.join(dir, "00_references", "repos", "charts", "Chart.yaml"),
    "name: charts\n",
  );

  const review = new GitChangeReview({ rootDir: dir });
  const changes = await review.readChanges();

  expect(changes.available).toBe(true);
  expect(changes.changes).toContainEqual({
    path: "00_references/docs/note.md",
    status: "added",
    kind: "file",
  });
  expect(changes.changes).toContainEqual({
    path: "00_references/repos/charts",
    status: "added",
    kind: "embedded-repo",
  });
  expect(changes.changes).not.toContainEqual({
    path: "00_references",
    status: "added",
  });
  expect(changes.changes).not.toContainEqual({
    path: "00_references/repos/charts/Chart.yaml",
    status: "added",
  });

  await expect(review.readDiff("00_references")).resolves.toMatchObject({
    path: "00_references",
    status: "unavailable",
    kind: "directory",
    reason: "Diff is not available because the selected path is a directory.",
  });
  await expect(
    review.readDiff("00_references/repos/charts"),
  ).resolves.toMatchObject({
    path: "00_references/repos/charts",
    status: "unavailable",
    kind: "embedded-repo",
    reason:
      "Diff is not available because the selected path is an embedded Git repository.",
  });
});

it("returns unavailable instead of reading directory paths as added files", async () => {
  await mkdir(path.join(dir, "untracked-dir"));
  const fakeGit = path.join(dir, "fake-git");
  await writeFile(
    fakeGit,
    [
      "#!/bin/sh",
      'if [ "$1" = "rev-parse" ]; then',
      '  printf "%s\\n" "$PWD"',
      "  exit 0",
      "fi",
      'if [ "$1" = "status" ]; then',
      '  printf "?? untracked-dir\\0"',
      "  exit 0",
      "fi",
      "exit 1",
      "",
    ].join("\n"),
  );
  await chmod(fakeGit, 0o755);

  const review = new GitChangeReview({
    rootDir: dir,
    gitCommands: [fakeGit],
  });

  await expect(review.readDiff("untracked-dir")).resolves.toMatchObject({
    path: "untracked-dir",
    status: "unavailable",
    reason: "Diff is not available because the selected path is a directory.",
  });
});

it("reports Git changes under a subdirectory workspace as workspace-relative paths", async () => {
  const workspaceDir = path.join(dir, "packages", "app");
  await mkdir(path.join(workspaceDir, "src"), { recursive: true });
  await writeFile(path.join(workspaceDir, "README.md"), "# App\n");
  await writeFile(
    path.join(workspaceDir, "src", "index.ts"),
    "export const value = 1;\n",
  );
  await writeFile(path.join(dir, "other.md"), "# Other\n");
  await git([
    "add",
    "packages/app/README.md",
    "packages/app/src/index.ts",
    "other.md",
  ]);
  await git(["commit", "-m", "workspace fixture"]);

  await writeFile(path.join(workspaceDir, "README.md"), "# App changed\n");
  await writeFile(
    path.join(workspaceDir, "src", "index.ts"),
    "export const value = 2;\n",
  );
  await writeFile(path.join(dir, "other.md"), "# Other changed\n");

  const review = new GitChangeReview({ rootDir: workspaceDir });
  const changes = await review.readChanges();

  expect(changes.available).toBe(true);
  expect(changes.changes).toEqual([
    { path: "README.md", status: "modified", kind: "file" },
    { path: "src/index.ts", status: "modified", kind: "file" },
  ]);

  const diff = await review.readDiff("README.md");
  expect(diff.status).toBe("available");
  expect(diff.path).toBe("README.md");
  expect(diff.content).toContain("diff --git a/README.md b/README.md");
  expect(diff.content).not.toContain("packages/app/README.md");

  await expect(review.readDiff("../other.md")).resolves.toMatchObject({
    status: "unavailable",
    reason: "path escapes root",
  });
});

it("lists recent diff bases and compares from an allowed older commit", async () => {
  await writeFile(path.join(dir, "README.md"), "# After\n");

  const review = new GitChangeReview({ rootDir: dir });
  const bases = await review.readDiffBases();

  expect(bases.available).toBe(true);
  expect(bases.options[0]).toMatchObject({
    ref: "HEAD",
    label: "HEAD",
    subject: "middle",
  });
  expect(bases.options[1]).toMatchObject({
    label: "HEAD~1",
    subject: "initial",
  });

  const older = bases.options[1]!;
  const diff = await review.readDiff("README.md", older.ref);
  expect(diff.status).toBe("available");
  expect(diff.baseLabel).toBe("HEAD~1");
  expect(diff.content).toContain("-# Before");
  expect(diff.content).toContain("+# After");

  await expect(
    review.readDiff("README.md", "main;rm -rf /"),
  ).resolves.toMatchObject({
    status: "unavailable",
    reason: "Diff base is not an allowed recent commit.",
  });
});

it("rejects paths outside the selected root", async () => {
  const review = new GitChangeReview({ rootDir: dir });

  await expect(review.readDiff("../secret.txt")).resolves.toMatchObject({
    status: "unavailable",
    reason: "path escapes root",
  });
});

it("falls back when git is not available at the first command name", async () => {
  await writeFile(path.join(dir, "README.md"), "# After\n");

  const review = new GitChangeReview({
    rootDir: dir,
    gitCommands: ["vivi-missing-git-command", "git"],
  });

  await expect(review.readDiff("README.md")).resolves.toMatchObject({
    status: "available",
  });
});

it("bounds slow Git commands so review status cannot block startup", async () => {
  const slowGit = path.join(dir, "slow-git");
  await writeFile(slowGit, "#!/bin/sh\nsleep 2\n");
  await chmod(slowGit, 0o755);

  const review = new GitChangeReview({
    rootDir: dir,
    gitCommands: [slowGit],
    gitTimeoutMs: 50,
  });

  const startedAt = Date.now();
  await expect(review.readChanges()).resolves.toMatchObject({
    available: false,
    reason: "Git command timed out while reading this workspace.",
    changes: [],
  });
  expect(Date.now() - startedAt).toBeLessThan(1_000);
});

it("does not retry Git immediately after a timeout", async () => {
  const slowGit = path.join(dir, "slow-git");
  await writeFile(slowGit, "#!/bin/sh\nsleep 2\n");
  await chmod(slowGit, 0o755);

  const review = new GitChangeReview({
    rootDir: dir,
    gitCommands: [slowGit],
    gitTimeoutMs: 200,
    gitTimeoutCooldownMs: 10_000,
  });

  await expect(review.readChanges()).resolves.toMatchObject({
    available: false,
    reason: "Git command timed out while reading this workspace.",
    changes: [],
  });

  const startedAt = Date.now();
  await expect(review.readChanges()).resolves.toMatchObject({
    available: false,
    reason: "Git command timed out while reading this workspace.",
    changes: [],
  });
  expect(Date.now() - startedAt).toBeLessThan(100);
});

it("falls back to tracked changes when untracked status times out", async () => {
  const fakeGit = path.join(dir, "fallback-git");
  await writeFile(
    fakeGit,
    [
      "#!/bin/sh",
      'if [ "$1" = "rev-parse" ]; then',
      '  printf "%s\\n" "$PWD"',
      "  exit 0",
      "fi",
      'if [ "$1" = "status" ] && [ "$3" = "--untracked-files=all" ]; then',
      "  sleep 5",
      "  exit 0",
      "fi",
      'if [ "$1" = "status" ] && [ "$3" = "--untracked-files=no" ]; then',
      '  printf " M README.md\\0"',
      "  exit 0",
      "fi",
      "exit 1",
      "",
    ].join("\n"),
  );
  await chmod(fakeGit, 0o755);

  const review = new GitChangeReview({
    rootDir: dir,
    gitCommands: [fakeGit],
    gitTimeoutMs: 1_000,
  });

  const startedAt = Date.now();
  await expect(review.readChanges()).resolves.toMatchObject({
    available: true,
    reason: "Git untracked scan timed out; showing tracked changes only.",
    changes: [{ path: "README.md", status: "modified", kind: "file" }],
  });
  expect(Date.now() - startedAt).toBeLessThan(2_500);
});

it("uses the status timeout for slow complete Review Queue scans", async () => {
  await writeFile(path.join(dir, "slow.md"), "# Slow\n");
  const fakeGit = path.join(dir, "slow-status-git");
  await writeFile(
    fakeGit,
    [
      "#!/bin/sh",
      'if [ "$1" = "rev-parse" ]; then',
      '  printf "%s\\n" "$PWD"',
      "  exit 0",
      "fi",
      'if [ "$1" = "status" ]; then',
      "  sleep 1",
      '  printf "?? slow.md\\0"',
      "  exit 0",
      "fi",
      "exit 1",
      "",
    ].join("\n"),
  );
  await chmod(fakeGit, 0o755);

  const review = new GitChangeReview({
    rootDir: dir,
    gitCommands: [fakeGit],
    gitTimeoutMs: 300,
    gitStatusTimeoutMs: 1_500,
  });

  await expect(review.readChanges()).resolves.toMatchObject({
    available: true,
    changes: [{ path: "slow.md", status: "added", kind: "file" }],
  });
});

it("uses the status timeout while resolving the Review Queue Git workspace", async () => {
  await writeFile(path.join(dir, "workspace.md"), "# Workspace\n");
  const fakeGit = path.join(dir, "slow-workspace-git");
  await writeFile(
    fakeGit,
    [
      "#!/bin/sh",
      'if [ "$1" = "rev-parse" ]; then',
      "  sleep 1",
      '  printf "%s\\n" "$PWD"',
      "  exit 0",
      "fi",
      'if [ "$1" = "status" ]; then',
      '  printf "?? workspace.md\\0"',
      "  exit 0",
      "fi",
      "exit 1",
      "",
    ].join("\n"),
  );
  await chmod(fakeGit, 0o755);

  const review = new GitChangeReview({
    rootDir: dir,
    gitCommands: [fakeGit],
    gitTimeoutMs: 300,
    gitStatusTimeoutMs: 1_500,
  });

  await expect(review.readChanges()).resolves.toMatchObject({
    available: true,
    changes: [{ path: "workspace.md", status: "added", kind: "file" }],
  });
});

it("kills in-flight Git commands on stop", async () => {
  const fakeGit = path.join(dir, "stoppable-git");
  await writeFile(
    fakeGit,
    [
      "#!/bin/sh",
      'if [ "$1" = "rev-parse" ]; then',
      '  printf "%s\\n" "$PWD"',
      "  exit 0",
      "fi",
      'if [ "$1" = "status" ]; then',
      "  sleep 30",
      "  exit 0",
      "fi",
      "exit 1",
      "",
    ].join("\n"),
  );
  await chmod(fakeGit, 0o755);

  const review = new GitChangeReview({
    rootDir: dir,
    gitCommands: [fakeGit],
    gitStatusTimeoutMs: 30_000,
  });

  const pending = review.readChanges();
  await new Promise((resolve) => setTimeout(resolve, 100));

  await review.stop();
  await expect(
    Promise.race([pending, timeoutAfter(1_000)]),
  ).resolves.toMatchObject({
    available: false,
    reason: "Git command timed out while reading this workspace.",
    changes: [],
  });
});

it("reads HEAD diffs without a Git executable for tracked loose objects", async () => {
  await writeFile(path.join(dir, "README.md"), "# After\n");

  const review = new GitChangeReview({
    rootDir: dir,
    gitCommands: ["vivi-missing-git-command"],
  });

  const diff = await review.readDiff("README.md");
  expect(diff.status).toBe("available");
  expect(diff.reason).toBeUndefined();
  expect(diff.content).toContain("-# Middle");
  expect(diff.content).toContain("+# After");
});

it("explains Docker linked-worktree mounts when Git metadata is outside the root", async () => {
  const missingGitDir = path.join(tmpdir(), "vivi-missing-gitdir");
  await rm(path.join(dir, ".git"), { recursive: true, force: true });
  await writeFile(path.join(dir, ".git"), `gitdir: ${missingGitDir}\n`);

  const review = new GitChangeReview({ rootDir: dir });

  await expect(review.readChanges()).resolves.toMatchObject({
    available: false,
    reason: expect.stringContaining(
      "Git metadata is referenced outside the served root",
    ),
    changes: [],
  });
});

it("does not expose raw spawn ENOENT errors", () => {
  expect(
    gitErrorReason(
      Object.assign(new Error("spawn git ENOENT"), { code: "ENOENT" }),
    ),
  ).toBe(
    "Git executable was not found. Install Git or start vivi with Git on PATH.",
  );
});

async function git(args: string[], cwd = dir): Promise<void> {
  await execFileAsync("git", args, { cwd });
}

function timeoutAfter(ms: number): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
  });
}
