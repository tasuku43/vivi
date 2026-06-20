import type {
  DiffBaseOption,
  GitChange,
  TextDiff,
} from "../domain/change-review.js";
import type { FileReviewState } from "./review-events.js";

export interface GitChangeReviewState {
  available: boolean;
  reason?: string;
  changes: GitChange[];
}

export interface DiffBaseState {
  available: boolean;
  reason?: string;
  options: DiffBaseOption[];
}

export interface ReviewChangeItem extends GitChange {
  source: "git" | "watcher";
}

export interface DiffStat {
  additions: number;
  deletions: number;
}

export type DiffLineKind = "meta" | "hunk" | "add" | "remove" | "context";

export interface ParsedDiffLine {
  kind: DiffLineKind;
  text: string;
  oldLine?: number;
  newLine?: number;
}

export type SideBySideDiffRow =
  | {
      kind: "meta" | "hunk";
      text: string;
    }
  | {
      kind: "context" | "changed" | "add" | "remove";
      oldLine?: number;
      oldText?: string;
      newLine?: number;
      newText?: string;
    };

export function mergeReviewChanges(
  watcherState: FileReviewState,
  gitState: GitChangeReviewState | null,
): ReviewChangeItem[] {
  if (gitState?.available) {
    return gitState.changes
      .map((change) => ({ ...change, source: "git" as const }))
      .sort(compareReviewChanges);
  }

  const byPath = new Map<string, ReviewChangeItem>();

  for (const pair of watcherState.renamePairs) {
    if (byPath.has(pair.toPath)) continue;
    byPath.set(pair.toPath, {
      path: pair.toPath,
      originalPath: pair.fromPath,
      status: "renamed",
      source: "watcher",
    });
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

  return [...byPath.values()].sort(compareReviewChanges);
}

export function reviewQueueSourceLabel(source: ReviewChangeItem["source"]) {
  return source === "git" ? "HEAD diff" : "local change";
}

export function nextReviewQueuePath(
  changes: ReviewChangeItem[],
  currentPath: string | null,
  direction: "next" | "previous",
): string | null {
  const reviewable = changes
    .filter(isReviewChangeOpenable)
    .map((change) => change.path);
  if (!reviewable.length) return null;

  const currentIndex = currentPath ? reviewable.indexOf(currentPath) : -1;
  if (currentIndex < 0) {
    return direction === "previous"
      ? reviewable[reviewable.length - 1]!
      : reviewable[0]!;
  }

  const offset = direction === "previous" ? -1 : 1;
  return reviewable[
    (currentIndex + offset + reviewable.length) % reviewable.length
  ]!;
}

export function latestUnreadReviewPath(
  changes: ReviewChangeItem[],
  unreadPaths: readonly string[],
): string | null {
  const byPath = new Map(changes.map((change) => [change.path, change]));
  for (const path of unreadPaths) {
    const change = byPath.get(path);
    if (change && isReviewChangeOpenable(change)) return path;
  }
  return null;
}

export function isReviewChangeOpenable(change: GitChange): boolean {
  return change.status !== "deleted" && (change.kind ?? "file") === "file";
}

export function changeStatusLabel(
  status: GitChange["status"],
  kind?: GitChange["kind"],
): string {
  if (kind === "embedded-repo") return "embedded repo";
  if (kind === "directory") return "directory";
  if (status === "added") return "added";
  if (status === "deleted") return "deleted";
  if (status === "renamed") return "renamed";
  return "modified";
}

export function buildDiffStat(diff: TextDiff | null): DiffStat | null {
  if (!diff || diff.status !== "available") return null;

  let additions = 0;
  let deletions = 0;
  for (const line of diff.content.split(/\r?\n/)) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) additions += 1;
    if (line.startsWith("-")) deletions += 1;
  }

  return { additions, deletions };
}

export function diffStatusLabel(diff: TextDiff | null): string {
  if (!diff) return "No diff selected";
  if (diff.status === "available")
    return `${diff.baseLabel} -> ${diff.compareLabel}`;
  if (diff.status === "too-large") return "Diff too large";
  if (diff.status === "binary") return "Binary file";
  if (diff.kind === "embedded-repo") return "Embedded repository";
  if (diff.kind === "directory") return "Directory";
  return "Diff unavailable";
}

function compareReviewChanges(a: ReviewChangeItem, b: ReviewChangeItem) {
  const typeCompare = reviewFileTypeKey(a.path).localeCompare(
    reviewFileTypeKey(b.path),
  );
  if (typeCompare !== 0) return typeCompare;
  return a.path.localeCompare(b.path);
}

function reviewFileTypeKey(path: string): string {
  const lower = path.toLowerCase();
  const basename = lower.split("/").pop() ?? lower;
  if (!basename.includes(".")) return basename;
  return basename.split(".").pop() ?? "";
}

export function parseUnifiedDiff(
  content: string,
  maxLines = Number.POSITIVE_INFINITY,
): ParsedDiffLine[] {
  const parsed: ParsedDiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;

  for (const rawLine of content.split(/\r?\n/)) {
    if (parsed.length >= maxLines) {
      parsed.push({
        kind: "meta",
        text: `... diff truncated after ${maxLines} rendered lines`,
      });
      break;
    }

    const hunk = rawLine.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      parsed.push({ kind: "hunk", text: rawLine });
      continue;
    }

    if (rawLine.startsWith("diff --git") || rawLine.startsWith("index ")) {
      parsed.push({ kind: "meta", text: rawLine });
      continue;
    }

    if (rawLine.startsWith("--- ") || rawLine.startsWith("+++ ")) {
      parsed.push({ kind: "meta", text: rawLine });
      continue;
    }

    if (rawLine.startsWith("+")) {
      parsed.push({ kind: "add", text: rawLine.slice(1), newLine });
      newLine += 1;
      continue;
    }

    if (rawLine.startsWith("-")) {
      parsed.push({ kind: "remove", text: rawLine.slice(1), oldLine });
      oldLine += 1;
      continue;
    }

    parsed.push({
      kind: "context",
      text: rawLine.startsWith(" ") ? rawLine.slice(1) : rawLine,
      oldLine: oldLine || undefined,
      newLine: newLine || undefined,
    });
    if (oldLine) oldLine += 1;
    if (newLine) newLine += 1;
  }

  return parsed.filter(
    (line) => line.text.length > 0 || line.kind === "context",
  );
}

export function buildSideBySideDiffRows(
  lines: ParsedDiffLine[],
): SideBySideDiffRow[] {
  const rows: SideBySideDiffRow[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line) break;

    if (line.kind === "meta" || line.kind === "hunk") {
      rows.push({ kind: line.kind, text: line.text });
      index += 1;
      continue;
    }

    if (line.kind === "context") {
      rows.push({
        kind: "context",
        oldLine: line.oldLine,
        oldText: line.text,
        newLine: line.newLine,
        newText: line.text,
      });
      index += 1;
      continue;
    }

    if (line.kind === "remove") {
      const removed: ParsedDiffLine[] = [];
      const added: ParsedDiffLine[] = [];
      while (lines[index]?.kind === "remove") {
        removed.push(lines[index]);
        index += 1;
      }
      while (lines[index]?.kind === "add") {
        added.push(lines[index]);
        index += 1;
      }
      const rowCount = Math.max(removed.length, added.length);
      for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
        const oldLine = removed[rowIndex];
        const newLine = added[rowIndex];
        rows.push({
          kind: oldLine && newLine ? "changed" : oldLine ? "remove" : "add",
          oldLine: oldLine?.oldLine,
          oldText: oldLine?.text,
          newLine: newLine?.newLine,
          newText: newLine?.text,
        });
      }
      continue;
    }

    rows.push({
      kind: "add",
      newLine: line.newLine,
      newText: line.text,
    });
    index += 1;
  }

  return rows;
}
