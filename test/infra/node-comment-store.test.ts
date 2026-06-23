import { mkdir, mkdtemp, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { workspaceViviDataDir } from "../../server/typescript/infrastructure/node-comment-store.js";

describe("workspaceViviDataDir", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("scopes comment storage by canonical workspace root", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "vivi-data-"));
    vi.stubEnv("VIVI_DATA_DIR", dataDir);

    const parentA = await mkdtemp(path.join(tmpdir(), "vivi-root-a-"));
    const parentB = await mkdtemp(path.join(tmpdir(), "vivi-root-b-"));
    const rootA = path.join(parentA, "project");
    const rootB = path.join(parentB, "project");
    await mkdir(rootA);
    await mkdir(rootB);
    const linkA = path.join(parentA, "project-link");
    await symlink(rootA, linkA);

    const scopedA = workspaceViviDataDir(rootA);
    const scopedB = workspaceViviDataDir(rootB);
    const scopedLinkA = workspaceViviDataDir(linkA);

    expect(scopedA).toContain(path.join(dataDir, "workspaces"));
    expect(scopedA).not.toBe(scopedB);
    expect(scopedLinkA).toBe(scopedA);
  });
});
