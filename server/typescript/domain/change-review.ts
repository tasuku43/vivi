export type GitChangeStatus = "added" | "modified" | "deleted" | "renamed";
export type GitChangeKind = "file" | "directory" | "embedded-repo";

export interface GitChange {
  path: string;
  status: GitChangeStatus;
  kind?: GitChangeKind;
  originalPath?: string;
}

export interface ChangeReviewSummary {
  available: boolean;
  reason?: string;
  changes: GitChange[];
}

export interface DiffBaseOption {
  ref: string;
  label: string;
  subject?: string;
}

export interface DiffBaseSummary {
  available: boolean;
  reason?: string;
  options: DiffBaseOption[];
}

export type DiffStatus = "available" | "too-large" | "binary" | "unavailable";

export interface TextDiff {
  path: string;
  status: DiffStatus;
  kind?: GitChangeKind;
  baseLabel: string;
  compareLabel: string;
  content: string;
  reason?: string;
}

export function parseGitPorcelainStatus(output: string): GitChange[] {
  const entries = output.split("\0").filter(Boolean);
  const changes: GitChange[] = [];

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index] ?? "";
    const statusCode = entry.slice(0, 2);
    const rawPath = entry.slice(3);
    const status = statusFromCode(statusCode);
    if (!status || !rawPath) continue;

    if (status === "renamed") {
      const originalPath = entries[index + 1];
      if (originalPath) index += 1;
      changes.push({ path: rawPath, originalPath, status });
    } else {
      changes.push({ path: rawPath, status });
    }
  }

  return changes.sort((a, b) => a.path.localeCompare(b.path));
}

export function statusFromCode(code: string): GitChangeStatus | null {
  if (code.includes("R")) return "renamed";
  if (code === "??" || code.includes("A")) return "added";
  if (code.includes("D")) return "deleted";
  if (code.includes("M") || code.includes("T")) return "modified";
  return null;
}

export function buildAddedFileDiff(
  relativePath: string,
  content: string,
): string {
  const lines = splitLines(content);
  return [
    "diff --git a/dev/null b/" + relativePath,
    "new file mode 100644",
    "index 0000000..0000000",
    "--- /dev/null",
    `+++ b/${relativePath}`,
    `@@ -0,0 +1,${Math.max(lines.length, 1)} @@`,
    ...lines.map((line) => `+${line}`),
  ].join("\n");
}

export function buildFullFileDiff(
  relativePath: string,
  before: string,
  after: string,
): string {
  const oldLines = splitLines(before);
  const newLines = splitLines(after);
  const diffLines = buildFullFileDiffLines(oldLines, newLines);
  return [
    `diff --git a/${relativePath} b/${relativePath}`,
    "index 0000000..0000000",
    `--- a/${relativePath}`,
    `+++ b/${relativePath}`,
    ...diffLines,
  ].join("\n");
}

export function buildDeletedFileDiff(
  relativePath: string,
  content: string,
): string {
  const lines = splitLines(content);
  return [
    `diff --git a/${relativePath} b/dev/null`,
    "deleted file mode 100644",
    "index 0000000..0000000",
    `--- a/${relativePath}`,
    "+++ /dev/null",
    `@@ -1,${Math.max(lines.length, 1)} +0,0 @@`,
    ...lines.map((line) => `-${line}`),
  ].join("\n");
}

function splitLines(content: string): string[] {
  if (content.length === 0) return [""];
  const normalized = content.endsWith("\n") ? content.slice(0, -1) : content;
  return normalized.split(/\r?\n/);
}

type DiffOp =
  | { kind: "context"; line: string; oldNumber: number; newNumber: number }
  | { kind: "remove"; line: string; oldNumber: number }
  | { kind: "add"; line: string; newNumber: number };

function buildFullFileDiffLines(
  oldLines: string[],
  newLines: string[],
): string[] {
  const ops = buildInterleavedLineDiff(oldLines, newLines);
  const oldCount = Math.max(0, ops.filter((op) => op.kind !== "add").length);
  const newCount = Math.max(0, ops.filter((op) => op.kind !== "remove").length);
  return [`@@ -1,${oldCount} +1,${newCount} @@`, ...ops.map(formatDiffOp)];
}

function buildInterleavedLineDiff(
  oldLines: string[],
  newLines: string[],
): DiffOp[] {
  const cellCount = oldLines.length * newLines.length;
  if (cellCount > 2_000_000) {
    return [
      ...oldLines.map((line, index) => ({
        kind: "remove" as const,
        line,
        oldNumber: index + 1,
      })),
      ...newLines.map((line, index) => ({
        kind: "add" as const,
        line,
        newNumber: index + 1,
      })),
    ];
  }

  const columns = newLines.length + 1;
  const table = new Uint16Array((oldLines.length + 1) * columns);
  for (let oldIndex = oldLines.length - 1; oldIndex >= 0; oldIndex -= 1) {
    for (let newIndex = newLines.length - 1; newIndex >= 0; newIndex -= 1) {
      const offset = oldIndex * columns + newIndex;
      if (oldLines[oldIndex] === newLines[newIndex]) {
        table[offset] = table[(oldIndex + 1) * columns + newIndex + 1] + 1;
      } else {
        table[offset] = Math.max(
          table[(oldIndex + 1) * columns + newIndex],
          table[oldIndex * columns + newIndex + 1],
        );
      }
    }
  }

  const output: DiffOp[] = [];
  let oldIndex = 0;
  let newIndex = 0;
  while (oldIndex < oldLines.length && newIndex < newLines.length) {
    if (oldLines[oldIndex] === newLines[newIndex]) {
      output.push({
        kind: "context",
        line: oldLines[oldIndex] ?? "",
        oldNumber: oldIndex + 1,
        newNumber: newIndex + 1,
      });
      oldIndex += 1;
      newIndex += 1;
      continue;
    }
    if (
      table[(oldIndex + 1) * columns + newIndex] >=
      table[oldIndex * columns + newIndex + 1]
    ) {
      output.push({
        kind: "remove",
        line: oldLines[oldIndex] ?? "",
        oldNumber: oldIndex + 1,
      });
      oldIndex += 1;
    } else {
      output.push({
        kind: "add",
        line: newLines[newIndex] ?? "",
        newNumber: newIndex + 1,
      });
      newIndex += 1;
    }
  }
  while (oldIndex < oldLines.length) {
    output.push({
      kind: "remove",
      line: oldLines[oldIndex] ?? "",
      oldNumber: oldIndex + 1,
    });
    oldIndex += 1;
  }
  while (newIndex < newLines.length) {
    output.push({
      kind: "add",
      line: newLines[newIndex] ?? "",
      newNumber: newIndex + 1,
    });
    newIndex += 1;
  }
  return interleaveReplacementRuns(output);
}

function interleaveReplacementRuns(ops: DiffOp[]): DiffOp[] {
  const output: DiffOp[] = [];
  for (let index = 0; index < ops.length; index += 1) {
    if (ops[index]?.kind !== "remove") {
      if (ops[index]) output.push(ops[index]);
      continue;
    }

    const removed: DiffOp[] = [];
    while (ops[index]?.kind === "remove") {
      removed.push(ops[index]);
      index += 1;
    }

    const added: DiffOp[] = [];
    while (ops[index]?.kind === "add") {
      added.push(ops[index]);
      index += 1;
    }

    if (added.length === 0) {
      output.push(...removed);
    } else {
      const maxLength = Math.max(removed.length, added.length);
      for (let pairIndex = 0; pairIndex < maxLength; pairIndex += 1) {
        if (removed[pairIndex]) output.push(removed[pairIndex]);
        if (added[pairIndex]) output.push(added[pairIndex]);
      }
    }

    index -= 1;
  }
  return output;
}

function formatDiffOp(op: DiffOp): string {
  if (op.kind === "add") return `+${op.line}`;
  if (op.kind === "remove") return `-${op.line}`;
  return ` ${op.line}`;
}
