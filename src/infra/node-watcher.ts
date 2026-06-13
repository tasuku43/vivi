import { promises as fsPromises, watch, type FSWatcher } from "node:fs";
import path from "node:path";
import type { WatcherPort } from "../app/contracts.js";
import type { FsEvent, NodeKind } from "../domain/fs-node.js";
import {
  defaultIgnoredNames,
  isIgnoredPath,
  normalizeRelativePath,
} from "../domain/path-policy.js";

export interface NodeWatcherOptions {
  rootDir: string;
  ignoredNames?: Set<string>;
  debounceMs?: number;
}

export function eventFromKnownPath(
  relativePath: string,
  previous: NodeKind | undefined,
  current: NodeKind | null,
  version: number,
): FsEvent | null {
  if (!current) {
    return previous
      ? { type: "unlink", path: relativePath, kind: previous, version }
      : null;
  }
  if (!previous)
    return { type: "add", path: relativePath, kind: current, version };
  return { type: "change", path: relativePath, version };
}

export class NodeWatcher implements WatcherPort {
  private watcher: FSWatcher | null = null;
  private version = 1;
  private readonly rootDir: string;
  private readonly ignoredNames: Set<string>;
  private readonly debounceMs: number;
  private readonly knownPaths = new Map<string, NodeKind>();
  private pending = new Map<string, NodeJS.Timeout>();

  constructor(options: string | NodeWatcherOptions) {
    if (typeof options === "string") {
      this.rootDir = path.resolve(options);
      this.ignoredNames = defaultIgnoredNames;
      this.debounceMs = 50;
    } else {
      this.rootDir = path.resolve(options.rootDir);
      this.ignoredNames = options.ignoredNames ?? defaultIgnoredNames;
      this.debounceMs = options.debounceMs ?? 50;
    }
  }

  async start(onEvent: (event: FsEvent) => void): Promise<void> {
    this.knownPaths.clear();
    await this.seedKnownPaths("");
    this.watcher = watch(
      this.rootDir,
      { recursive: true },
      (_eventType, filename) => {
        if (!filename) return;
        const normalized = normalizeRelativePath(
          String(filename).split(path.sep).join("/"),
        );
        if (!normalized.ok || !normalized.relativePath) return;
        if (isIgnoredPath(normalized.relativePath, this.ignoredNames)) return;
        this.queueEvent(normalized.relativePath, onEvent);
      },
    );
  }

  async stop(): Promise<void> {
    for (const timer of this.pending.values()) clearTimeout(timer);
    this.pending.clear();
    this.watcher?.close();
    this.watcher = null;
  }

  private queueEvent(
    relativePath: string,
    onEvent: (event: FsEvent) => void,
  ): void {
    const existing = this.pending.get(relativePath);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.pending.delete(relativePath);
      void this.emitCurrentState(relativePath, onEvent);
    }, this.debounceMs);
    this.pending.set(relativePath, timer);
  }

  private async emitCurrentState(
    relativePath: string,
    onEvent: (event: FsEvent) => void,
  ): Promise<void> {
    const previous = this.knownPaths.get(relativePath);
    const kind = await this.kindFor(relativePath);

    if (!kind) {
      if (previous) {
        this.knownPaths.delete(relativePath);
        const event = eventFromKnownPath(
          relativePath,
          previous,
          null,
          ++this.version,
        );
        if (event) onEvent(event);
      }
      return;
    }

    this.knownPaths.set(relativePath, kind);
    const event = eventFromKnownPath(
      relativePath,
      previous,
      kind,
      ++this.version,
    );
    if (event) onEvent(event);
  }

  private async seedKnownPaths(relativeDir: string): Promise<void> {
    const absoluteDir = path.join(this.rootDir, relativeDir);
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fsPromises.readdir(absoluteDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const relativePath = relativeDir
        ? `${relativeDir}/${entry.name}`
        : entry.name;
      if (isIgnoredPath(relativePath, this.ignoredNames)) continue;
      if (entry.isDirectory()) {
        this.knownPaths.set(relativePath, "directory");
        await this.seedKnownPaths(relativePath);
      } else if (entry.isFile()) {
        this.knownPaths.set(relativePath, "file");
      }
    }
  }

  private async kindFor(relativePath: string): Promise<NodeKind | null> {
    try {
      const stat = await fsPromises.stat(path.join(this.rootDir, relativePath));
      if (stat.isDirectory()) return "directory";
      if (stat.isFile()) return "file";
      return null;
    } catch {
      return null;
    }
  }
}
