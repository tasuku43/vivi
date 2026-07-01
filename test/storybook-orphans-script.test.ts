import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { findStorybookOrphans } from "../scripts/verify-storybook-orphans.mjs";

const fixtures: string[] = [];

afterEach(async () => {
  await Promise.all(
    fixtures.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("Storybook orphan verifier", () => {
  it("reports product source imported only by Storybook", async () => {
    const root = await fixture();
    await writeFixture(root, {
      "ui/src/main.tsx": `import "./features/live.js";`,
      "ui/src/features/live.ts": `export const live = true;`,
      "ui/src/features/story-only.stories.tsx": `import "./StoryOnlyPanel.js";`,
      "ui/src/features/StoryOnlyPanel.tsx": `export function StoryOnlyPanel() { return null; }`,
    });

    expect(findStorybookOrphans(root)).toEqual([
      "ui/src/features/StoryOnlyPanel.tsx",
    ]);
  });

  it("allows source that Storybook shares with production", async () => {
    const root = await fixture();
    await writeFixture(root, {
      "ui/src/main.tsx": `import "./features/SharedPanel.js";`,
      "ui/src/features/shared.stories.tsx": `import "./SharedPanel.js";`,
      "ui/src/features/SharedPanel.tsx": `export function SharedPanel() { return null; }`,
    });

    expect(findStorybookOrphans(root)).toEqual([]);
  });
});

async function fixture() {
  const dir = await mkdtemp(path.join(tmpdir(), "vivi-storybook-orphans-"));
  fixtures.push(dir);
  return dir;
}

async function writeFixture(root: string, files: Record<string, string>) {
  for (const [relativePath, content] of Object.entries(files)) {
    const file = path.join(root, relativePath);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, content);
  }
}
