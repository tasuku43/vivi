import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  GitChangeReview,
  gitErrorReason,
} from "../../src/infra/git-change-review.js";

const execFileAsync = promisify(execFile);

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "pathlens-git-review-"));
  await git(["init"]);
  await git(["config", "user.email", "pathlens@example.test"]);
  await git(["config", "user.name", "Pathlens Test"]);
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
    { path: "README.md", status: "modified" },
    { path: "report.csv", status: "added" },
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
    gitCommands: ["pathlens-missing-git-command", "git"],
  });

  await expect(review.readDiff("README.md")).resolves.toMatchObject({
    status: "available",
  });
});

it("reads HEAD diffs without a Git executable for tracked loose objects", async () => {
  await writeFile(path.join(dir, "README.md"), "# After\n");

  const review = new GitChangeReview({
    rootDir: dir,
    gitCommands: ["pathlens-missing-git-command"],
  });

  const diff = await review.readDiff("README.md");
  expect(diff.status).toBe("available");
  expect(diff.reason).toBeUndefined();
  expect(diff.content).toContain("-# Middle");
  expect(diff.content).toContain("+# After");
});

it("explains Docker linked-worktree mounts when Git metadata is outside the root", async () => {
  const missingGitDir = path.join(tmpdir(), "pathlens-missing-gitdir");
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
    "Git executable was not found. Install Git or start pathlens with Git on PATH.",
  );
});

async function git(args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd: dir });
}
