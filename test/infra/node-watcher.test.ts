import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  eventFromKnownPath,
  NodeWatcher,
} from "../../server/typescript/infrastructure/node-watcher.js";

afterEach(() => {
  vi.useRealTimers();
});

it("classifies watcher state transitions into semantic events", () => {
  expect(eventFromKnownPath("new.md", undefined, "file", 2)).toEqual({
    type: "add",
    path: "new.md",
    kind: "file",
    version: 2,
  });
  expect(eventFromKnownPath("README.md", "file", "file", 3)).toEqual({
    type: "change",
    path: "README.md",
    version: 3,
  });
  expect(eventFromKnownPath("old.md", "file", null, 4)).toEqual({
    type: "unlink",
    path: "old.md",
    kind: "file",
    version: 4,
  });
  expect(eventFromKnownPath("missing.md", undefined, null, 5)).toBeNull();
});

it("bounds pending watcher events during event storms", async () => {
  vi.useFakeTimers();
  const watcher = new NodeWatcher({
    rootDir: ".",
    debounceMs: 1_000,
    maxPendingEvents: 2,
  }) as unknown as {
    queueEvent(path: string, onEvent: () => void): void;
    stop(): Promise<void>;
    getMetrics(): {
      pendingEvents: number;
      droppedEvents: number;
      emittedEvents: number;
    };
  };

  watcher.queueEvent("a.md", () => {});
  watcher.queueEvent("b.md", () => {});
  watcher.queueEvent("c.md", () => {});

  expect(watcher.getMetrics()).toMatchObject({
    pendingEvents: 2,
    droppedEvents: 1,
    emittedEvents: 0,
  });
  await watcher.stop();
});

it("starts without synchronously opening the recursive watcher", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "vivi-watcher-"));
  const watcher = new NodeWatcher({
    rootDir: dir,
    watchStartDelayMs: 10_000,
  }) as unknown as {
    start(onEvent: () => void): Promise<void>;
    stop(): Promise<void>;
    getMetrics(): { workerRunning: boolean; recursiveWatch: boolean | null };
  };

  await expect(
    Promise.race([
      watcher.start(() => {}),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("start waited for recursive watcher")),
          500,
        ),
      ),
    ]),
  ).resolves.toBeUndefined();
  expect(watcher.getMetrics().workerRunning).toBe(true);
  expect(watcher.getMetrics().recursiveWatch).toBe(true);

  await watcher.stop();
  await rm(dir, { recursive: true, force: true });
});

it("falls back to a non-recursive root watcher for broad workspaces", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "vivi-wide-watcher-"));
  for (let index = 0; index < 3; index += 1) {
    await mkdir(path.join(dir, `dir-${index}`));
  }
  await writeFile(path.join(dir, "README.md"), "# Wide");

  const watcher = new NodeWatcher({
    rootDir: dir,
    recursiveWatchEntryLimit: 2,
    watchStartDelayMs: 10_000,
  });

  await watcher.start(() => {});
  expect(watcher.getMetrics().recursiveWatch).toBe(false);

  await watcher.stop();
  await rm(dir, { recursive: true, force: true });
});
