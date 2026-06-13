import type {
  DiffBaseOption,
  GitChange,
  TextDiff,
} from "../../domain/change-review.js";
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
  const byPath = new Map<string, ReviewChangeItem>();

  for (const change of gitState?.changes ?? []) {
    byPath.set(change.path, { ...change, source: "git" });
  }

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

export function parseUnifiedDiff(
  content: string,
  maxLines = 220,
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
