import type { GitChange, TextDiff } from "../../domain/change-review.js";
import type { FileReviewState } from "./review-events.js";

export interface GitChangeReviewState {
  available: boolean;
  reason?: string;
  changes: GitChange[];
}

export interface ReviewChangeItem extends GitChange {
  source: "git" | "watcher";
}

export function mergeReviewChanges(
  watcherState: FileReviewState,
  gitState: GitChangeReviewState | null,
): ReviewChangeItem[] {
  const byPath = new Map<string, ReviewChangeItem>();

  for (const change of gitState?.changes ?? []) {
    byPath.set(change.path, { ...change, source: "git" });
  }

  for (const path of watcherState.changedPaths) {
    if (byPath.has(path)) continue;
    const latest = watcherState.latestByPath.get(path);
    byPath.set(path, {
      path,
      status: latest?.event.type === "add" ? "added" : "modified",
      source: "watcher",
    });
  }

  for (const path of watcherState.removedPaths) {
    if (byPath.has(path)) continue;
    byPath.set(path, { path, status: "deleted", source: "watcher" });
  }

  return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
}

export function changeStatusLabel(status: GitChange["status"]): string {
  if (status === "added") return "Added";
  if (status === "deleted") return "Deleted";
  if (status === "renamed") return "Renamed";
  return "Modified";
}

export function diffStatusLabel(diff: TextDiff | null): string {
  if (!diff) return "No diff selected";
  if (diff.status === "available")
    return `${diff.baseLabel} -> ${diff.compareLabel}`;
  if (diff.status === "too-large") return "Diff too large";
  if (diff.status === "binary") return "Binary file";
  return "Diff unavailable";
}
