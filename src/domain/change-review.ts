export type GitChangeStatus = "added" | "modified" | "deleted" | "renamed";

export interface GitChange {
  path: string;
  status: GitChangeStatus;
  originalPath?: string;
}

export interface ChangeReviewSummary {
  available: boolean;
  reason?: string;
  changes: GitChange[];
}

export type DiffStatus = "available" | "too-large" | "binary" | "unavailable";

export interface TextDiff {
  path: string;
  status: DiffStatus;
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

function splitLines(content: string): string[] {
  if (content.length === 0) return [""];
  const normalized = content.endsWith("\n") ? content.slice(0, -1) : content;
  return normalized.split(/\r?\n/);
}
