import type { FsEvent } from "../domain/fs-node.js";

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
}

export function recordReviewEvent(
  events: ReviewEvent[],
  event: FsEvent,
  now = Date.now(),
  limit = 40,
): ReviewEvent[] {
  const next: ReviewEvent = {
    id: `${event.version}:${event.type}:${event.path}:${now}`,
    event,
    receivedAt: now,
  };
  return [next, ...events].slice(0, limit);
}

export function summarizeReviewEvents(events: ReviewEvent[]): FileReviewState {
  const changedPaths = new Set<string>();
  const removedPaths = new Set<string>();
  const latestByPath = new Map<string, ReviewEvent>();
  const renamePairs = detectRenamePairs(events);
  const renamedFromPaths = new Set(renamePairs.map((pair) => pair.fromPath));
  const renamedToPaths = new Set(renamePairs.map((pair) => pair.toPath));

  for (const item of events) {
    if (!latestByPath.has(item.event.path))
      latestByPath.set(item.event.path, item);
    if (renamedFromPaths.has(item.event.path)) {
      removedPaths.delete(item.event.path);
      continue;
    }
    if (item.event.type === "unlink") {
      removedPaths.add(item.event.path);
      changedPaths.delete(item.event.path);
      continue;
    }
    if (item.event.type === "add" && item.event.kind === "directory") continue;
    changedPaths.add(item.event.path);
    removedPaths.delete(item.event.path);
  }

  for (const path of renamedToPaths) changedPaths.add(path);

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

  return pairs;
}

function looksLikeRename(remove: ReviewEvent, add: ReviewEvent): boolean {
  if (Math.abs(add.receivedAt - remove.receivedAt) > 2_000) return false;
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
