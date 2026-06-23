import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  assertStorybookTestRunnerInstalled,
  findStorybookTestRunner,
} from "../scripts/run-storybook-interactions.mjs";

const fixtures: string[] = [];

afterEach(async () => {
  await Promise.all(
    fixtures.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("Storybook interaction test runner script", () => {
  it("fails before launching Storybook when the local test runner is missing", async () => {
    const dir = await fixture();

    expect(findStorybookTestRunner(dir)).toBeNull();
    expect(() => assertStorybookTestRunnerInstalled(dir)).toThrow(
      /Storybook interaction test runner is not installed/,
    );
  });

  it("uses the repository-local test-storybook executable", async () => {
    const dir = await fixture();
    const binDir = path.join(dir, "node_modules", ".bin");
    await mkdir(binDir, { recursive: true });
    const bin = path.join(binDir, testRunnerBinName());
    await writeFile(bin, "");

    expect(findStorybookTestRunner(dir)).toBe(bin);
    expect(assertStorybookTestRunnerInstalled(dir)).toBe(bin);
  });
});

async function fixture() {
  const dir = await mkdtemp(path.join(tmpdir(), "vivi-storybook-test-"));
  fixtures.push(dir);
  return dir;
}

function testRunnerBinName() {
  return process.platform === "win32" ? "test-storybook.cmd" : "test-storybook";
}
