import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, expect, it } from "vitest";

const fixtures: string[] = [];

afterEach(async () => {
  await Promise.all(
    fixtures.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function fixture(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "vivi-supply-chain-"));
  fixtures.push(dir);
  await cp(".github", path.join(dir, ".github"), { recursive: true });
  await cp("package.json", path.join(dir, "package.json"));
  await cp("package-lock.json", path.join(dir, "package-lock.json"));
  return dir;
}

function check(dir = ".") {
  return spawnSync(process.execPath, ["scripts/check-supply-chain.mjs", dir], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
}

it("accepts the repository supply-chain policy", () => {
  expect(check().status).toBe(0);
});

it("rejects an unpinned action", async () => {
  const dir = await fixture();
  const workflow = path.join(dir, ".github/workflows/ci.yml");
  const source = await readFile(workflow, "utf8");
  await writeFile(
    workflow,
    source.replace(/actions\/checkout@[0-9a-f]{40}/, "actions/checkout@v7"),
  );
  const result = check(dir);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("action must use a full commit SHA");
});

it("rejects broad token permissions", async () => {
  const dir = await fixture();
  const workflow = path.join(dir, ".github/workflows/ci.yml");
  const source = await readFile(workflow, "utf8");
  await writeFile(
    workflow,
    source.replace("permissions: read-all", "permissions: write-all"),
  );
  const result = check(dir);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("write-all is forbidden");
});

it("rejects an unapproved third-party action even when pinned", async () => {
  const dir = await fixture();
  const workflow = path.join(dir, ".github/workflows/ci.yml");
  const source = await readFile(workflow, "utf8");
  await writeFile(
    workflow,
    source.replace(
      /actions\/checkout@[0-9a-f]{40}/,
      `example/setup@${"a".repeat(40)}`,
    ),
  );
  const result = check(dir);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("third-party action is not approved");
});

it("rejects vulnerable transitive packages in the npm lockfile", async () => {
  const dir = await fixture();
  await writeFile(
    path.join(dir, "package-lock.json"),
    JSON.stringify(
      {
        name: "vivi",
        lockfileVersion: 3,
        packages: {
          "node_modules/js-yaml": { version: "4.1.1" },
          "node_modules/uuid": { version: "8.3.2" },
        },
      },
      null,
      2,
    ),
  );

  const result = check(dir);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("vulnerable js-yaml 4.1.1");
  expect(result.stderr).toContain("vulnerable uuid 8.3.2");
});
