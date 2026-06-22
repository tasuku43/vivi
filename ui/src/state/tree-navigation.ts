import type { VisibleTreeRow } from "./tree-expansion.js";

export type TreeKeyboardAction =
  | { kind: "focus"; path: string }
  | { kind: "toggle"; path: string }
  | { kind: "activate"; path: string };

export function treeKeyboardAction(
  rows: VisibleTreeRow[],
  expandedPaths: ReadonlySet<string>,
  currentPath: string | null,
  key: string,
): TreeKeyboardAction | null {
  if (!rows.length) return null;
  const currentIndex = currentPath
    ? rows.findIndex((row) => row.node.path === currentPath)
    : -1;
  const index = currentIndex >= 0 ? currentIndex : 0;
  const current = rows[index]!;

  if (key === "ArrowDown") {
    return {
      kind: "focus",
      path: rows[Math.min(index + 1, rows.length - 1)]!.node.path,
    };
  }
  if (key === "ArrowUp") {
    return { kind: "focus", path: rows[Math.max(index - 1, 0)]!.node.path };
  }
  if (key === "Home") return { kind: "focus", path: rows[0]!.node.path };
  if (key === "End") {
    return { kind: "focus", path: rows[rows.length - 1]!.node.path };
  }
  if (key === "Enter" || key === " ") {
    return { kind: "activate", path: current.node.path };
  }
  if (key === "ArrowRight" && current.node.kind === "directory") {
    if (!expandedPaths.has(current.node.path)) {
      return { kind: "toggle", path: current.node.path };
    }
    const child = rows[index + 1];
    if (child && child.depth > current.depth) {
      return { kind: "focus", path: child.node.path };
    }
  }
  if (key === "ArrowLeft") {
    if (
      current.node.kind === "directory" &&
      expandedPaths.has(current.node.path)
    ) {
      return { kind: "toggle", path: current.node.path };
    }
    for (let parentIndex = index - 1; parentIndex >= 0; parentIndex -= 1) {
      const candidate = rows[parentIndex]!;
      if (candidate.depth < current.depth) {
        return { kind: "focus", path: candidate.node.path };
      }
    }
  }
  return null;
}
