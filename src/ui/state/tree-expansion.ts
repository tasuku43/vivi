import type { FsNode } from "../../domain/fs-node.js";

export interface TreeExpansionOptions {
  maxAutoExpandedRows?: number;
  forceVisiblePaths?: Iterable<string>;
}

export function initialExpandedPaths(
  nodes: FsNode[],
  options: TreeExpansionOptions = {},
): Set<string> {
  const maxRows = options.maxAutoExpandedRows ?? 280;
  const expanded = new Set<string>();
  const forcedAncestors = ancestorDirectoryPaths(
    options.forceVisiblePaths ?? [],
  );
  let visibleRows = 0;

  function visit(items: FsNode[]): void {
    for (const node of items) {
      visibleRows += 1;
      if (node.kind !== "directory") continue;
      const childRows = countTreeNodes(node.children ?? []);
      if (
        forcedAncestors.has(node.path) ||
        visibleRows + childRows <= maxRows
      ) {
        expanded.add(node.path);
        visit(node.children ?? []);
      }
    }
  }

  visit(nodes);
  for (const path of forcedAncestors) expanded.add(path);
  return expanded;
}

export function ensureVisibleAncestors(
  expandedPaths: Set<string>,
  paths: Iterable<string>,
): Set<string> {
  const next = new Set(expandedPaths);
  for (const path of ancestorDirectoryPaths(paths)) next.add(path);
  return next;
}

export function countTreeNodes(nodes: FsNode[]): number {
  let count = 0;
  for (const node of nodes) {
    count += 1;
    if (node.kind === "directory") count += countTreeNodes(node.children ?? []);
  }
  return count;
}

export function visibleTreeRows(
  nodes: FsNode[],
  expandedPaths: Set<string>,
): number {
  let count = 0;
  for (const node of nodes) {
    count += 1;
    if (node.kind === "directory" && expandedPaths.has(node.path)) {
      count += visibleTreeRows(node.children ?? [], expandedPaths);
    }
  }
  return count;
}

function ancestorDirectoryPaths(paths: Iterable<string>): Set<string> {
  const ancestors = new Set<string>();
  for (const path of paths) {
    const segments = path.split("/").filter(Boolean);
    for (let index = 1; index < segments.length; index += 1) {
      ancestors.add(segments.slice(0, index).join("/"));
    }
  }
  return ancestors;
}
