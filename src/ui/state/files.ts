import type { FsNode } from "../../domain/fs-node.js";

export function flattenFiles(nodes: FsNode[]): FsNode[] {
  return nodes.flatMap((node) =>
    node.kind === "directory" ? flattenFiles(node.children ?? []) : [node],
  );
}

export function fuzzyFileResults(
  nodes: FsNode[],
  query: string,
  limit = 8,
): FsNode[] {
  const files = flattenFiles(nodes);
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);

  if (!terms.length) return files.slice(0, limit);

  return files
    .map((file) => ({
      file,
      score: fuzzyScore(file.path.toLowerCase(), terms),
    }))
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score || a.file.path.localeCompare(b.file.path))
    .slice(0, limit)
    .map((result) => result.file);
}

function fuzzyScore(path: string, terms: string[]): number {
  let score = 0;
  for (const term of terms) {
    const contiguous = path.indexOf(term);
    if (contiguous >= 0) {
      score += 100 - contiguous;
      continue;
    }
    if (isSubsequence(term, path)) {
      score += 10;
      continue;
    }
    return 0;
  }
  return score;
}

function isSubsequence(needle: string, haystack: string): boolean {
  let cursor = 0;
  for (const char of haystack) {
    if (char === needle[cursor]) cursor += 1;
    if (cursor === needle.length) return true;
  }
  return false;
}
