import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, expect, it } from "vitest";
import { GitChangeReview } from "../../src/infra/git-change-review.js";

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
  expect(modified.content).toContain("-# Before");
  expect(modified.content).toContain("+# After");

  const added = await review.readDiff("report.csv");
  expect(added.status).toBe("available");
  expect(added.content).toContain("+++ b/report.csv");
  expect(added.content).toContain("+html,ok");
});

it("rejects paths outside the selected root", async () => {
  const review = new GitChangeReview({ rootDir: dir });

  await expect(review.readDiff("../secret.txt")).resolves.toMatchObject({
    status: "unavailable",
    reason: "path escapes root",
  });
});

async function git(args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd: dir });
}
