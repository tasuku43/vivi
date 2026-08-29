import type { FsEvent } from "../domain/fs-node.js";
import {
  reviewActivityWindowMs,
  type ReviewAttentionClock,
} from "./review-attention.js";

export interface ReviewEvent {
  id: string;
  event: FsEvent;
  receivedAt: number;
}

export interface FileReviewState {
  changedPaths: Set<string>;
  removedPaths: Set<string>;
  latestByPath: Map<string, ReviewEvent>;
  renamePairs: RenameReviewPair[];
}

export interface RenameReviewPair {
  fromPath: string;
  toPath: string;
  receivedAt: number;
  intermediatePaths?: string[];
}

export function recentReviewEvents(
  events: readonly ReviewEvent[],
  now = Date.now(),
  windowMs = reviewActivityWindowMs,
): ReviewEvent[] {
  return events.filter((item) => now - item.receivedAt <= windowMs);
}

export function recordReviewEvent(
  events: ReviewEvent[],
  event: FsEvent,
  now = Date.now(),
): ReviewEvent[] {
  const recent = events.filter(
    (item) => now - item.receivedAt <= reviewActivityWindowMs,
  );
  if (event.type !== "change" && event.kind === "directory") return recent;

  const next: ReviewEvent = {
    id: `${event.version}:${event.type}:${event.path}:${now}`,
    event,
    receivedAt: now,
  };
  return compactReviewEvents([next, ...recent]);
}

export function isFileReviewActivityEvent(event: FsEvent): boolean {
  return event.type === "change" || event.kind === "file";
}

export function fileReviewAttentionForQueue(
  clock: ReviewAttentionClock,
  state: Pick<FileReviewState, "renamePairs">,
): ReviewAttentionClock {
  const renamedFromPaths = new Set(
    state.renamePairs.flatMap(renameSuppressedPaths),
  );
  return Object.fromEntries(
    Object.entries(clock).filter(([path]) => !renamedFromPaths.has(path)),
  );
}

export function summarizeReviewEvents(events: ReviewEvent[]): FileReviewState {
  const changedPaths = new Set<string>();
  const removedPaths = new Set<string>();
  const latestByPath = new Map<string, ReviewEvent>();
  const renamePairs = detectRenamePairs(events);
  const renamedFromPaths = new Set(renamePairs.flatMap(renameSuppressedPaths));
  const renamedToPaths = new Set(renamePairs.map((pair) => pair.toPath));

  for (const item of events) {
    if (item.event.type !== "change" && item.event.kind === "directory")
      continue;
    if (renamedFromPaths.has(item.event.path)) {
      removedPaths.delete(item.event.path);
      continue;
    }
    if (latestByPath.has(item.event.path)) continue;
    latestByPath.set(item.event.path, item);
    if (item.event.type === "unlink") {
      removedPaths.add(item.event.path);
      changedPaths.delete(item.event.path);
      continue;
    }
    changedPaths.add(item.event.path);
    removedPaths.delete(item.event.path);
  }

  for (const path of renamedToPaths) {
    if (!removedPaths.has(path)) changedPaths.add(path);
  }

  return { changedPaths, removedPaths, latestByPath, renamePairs };
}

export function eventLabel(event: FsEvent): string {
  if (event.type === "add")
    return event.kind === "directory" ? "Added dir" : "Added";
  if (event.type === "unlink")
    return event.kind === "directory" ? "Removed dir" : "Removed";
  return "Changed";
}

function detectRenamePairs(events: ReviewEvent[]): RenameReviewPair[] {
  const additions = events.filter(
    (item) => item.event.type === "add" && item.event.kind === "file",
  );
  const removals = events.filter(
    (item) => item.event.type === "unlink" && item.event.kind === "file",
  );
  const usedRemovals = new Set<string>();
  const pairs: RenameReviewPair[] = [];

  for (const add of additions) {
    const match = removals.find((remove) => {
      if (usedRemovals.has(remove.id)) return false;
      return looksLikeRename(remove, add);
    });
    if (!match) continue;
    usedRemovals.add(match.id);
    pairs.push({
      fromPath: match.event.path,
      toPath: add.event.path,
      receivedAt: Math.max(match.receivedAt, add.receivedAt),
    });
  }

  return collapseRenameChains(pairs);
}

function collapseRenameChains(pairs: RenameReviewPair[]): RenameReviewPair[] {
  const byFromPath = new Map(pairs.map((pair) => [pair.fromPath, pair]));
  const byToPath = new Map(pairs.map((pair) => [pair.toPath, pair]));
  const collapsed: RenameReviewPair[] = [];

  for (const terminal of pairs) {
    if (byFromPath.has(terminal.toPath)) continue;
    let first = terminal;
    const intermediatePaths: string[] = [];
    const visited = new Set([terminal.toPath]);
    while (byToPath.has(first.fromPath) && !visited.has(first.fromPath)) {
      visited.add(first.fromPath);
      intermediatePaths.unshift(first.fromPath);
      first = byToPath.get(first.fromPath)!;
    }
    collapsed.push({
      fromPath: first.fromPath,
      toPath: terminal.toPath,
      receivedAt: Math.max(first.receivedAt, terminal.receivedAt),
      ...(intermediatePaths.length ? { intermediatePaths } : {}),
    });
  }

  const handledCyclePaths = new Set<string>();
  for (const seed of pairs) {
    if (handledCyclePaths.has(seed.fromPath)) continue;
    const pathOrder: string[] = [];
    const pathIndex = new Map<string, number>();
    let cursor = seed.fromPath;
    while (byFromPath.has(cursor) && !pathIndex.has(cursor)) {
      pathIndex.set(cursor, pathOrder.length);
      pathOrder.push(cursor);
      cursor = byFromPath.get(cursor)!.toPath;
    }
    const cycleStart = pathIndex.get(cursor);
    if (cycleStart === undefined) continue;
    const cyclePaths = pathOrder.slice(cycleStart);
    for (const path of cyclePaths) handledCyclePaths.add(path);
    const cyclePairs = cyclePaths.map((path) => byFromPath.get(path)!);
    const latest = cyclePairs.reduce((candidate, pair) =>
      pair.receivedAt > candidate.receivedAt ? pair : candidate,
    );
    const finalPath = latest.toPath;
    collapsed.push({
      fromPath: finalPath,
      toPath: finalPath,
      receivedAt: latest.receivedAt,
      intermediatePaths: cyclePaths.filter((path) => path !== finalPath),
    });
  }

  return collapsed;
}

function compactReviewEvents(events: ReviewEvent[]): ReviewEvent[] {
  const sorted = [...events].sort((a, b) => b.receivedAt - a.receivedAt);
  const byPathAndType = new Map<string, ReviewEvent[]>();
  for (const item of sorted) {
    const key = `${item.event.path}\u0000${item.event.type}`;
    const grouped = byPathAndType.get(key);
    if (grouped) grouped.push(item);
    else byPathAndType.set(key, [item]);
  }
  return [...byPathAndType.values()]
    .flatMap((grouped) => {
      if (grouped[0]!.event.type === "change" || grouped.length === 1) {
        return grouped[0]!;
      }
      return [grouped[0]!, grouped[grouped.length - 1]!];
    })
    .sort((a, b) => b.receivedAt - a.receivedAt);
}

function renameSuppressedPaths(pair: RenameReviewPair): string[] {
  if (pair.fromPath === pair.toPath) return pair.intermediatePaths ?? [];
  return [pair.fromPath, ...(pair.intermediatePaths ?? [])];
}

function looksLikeRename(remove: ReviewEvent, add: ReviewEvent): boolean {
  if (Math.abs(add.receivedAt - remove.receivedAt) > 2_000) return false;
  if (add.event.path === remove.event.path) return false;
  return (
    parentPath(add.event.path) === parentPath(remove.event.path) &&
    extensionForPath(add.event.path) === extensionForPath(remove.event.path)
  );
}

function parentPath(path: string): string {
  const segments = path.split("/");
  segments.pop();
  return segments.join("/");
}

function extensionForPath(path: string): string {
  const basename = path.split("/").pop() ?? path;
  const dotIndex = basename.lastIndexOf(".");
  return dotIndex >= 0 ? basename.slice(dotIndex + 1).toLowerCase() : "";
}
