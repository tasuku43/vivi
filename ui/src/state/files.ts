import type { FsNode } from "../domain/fs-node.js";

export function flattenFiles(nodes: FsNode[]): FsNode[] {
  return nodes.flatMap((node) =>
    node.kind === "directory" ? flattenFiles(node.children ?? []) : [node],
  );
}

export function replaceDirectoryChildren(
  nodes: FsNode[],
  directoryPath: string,
  children: FsNode[],
): FsNode[] {
  if (!directoryPath) return children;
  return nodes.map((node) => {
    if (node.kind !== "directory") return node;
    if (node.path === directoryPath) {
      return { ...node, children, childrenLoaded: true };
    }
    if (!node.children) return node;
    return {
      ...node,
      children: replaceDirectoryChildren(
        node.children,
        directoryPath,
        children,
      ),
    };
  });
}

export function parentDirectoryPath(path: string): string {
  const segments = path.split("/").filter(Boolean);
  segments.pop();
  return segments.join("/");
}

export function unloadedAncestorDirectoryPaths(
  nodes: FsNode[],
  paths: Iterable<string>,
  loadingPaths: Set<string> = new Set(),
): string[] {
  const directories = directoryMap(nodes);
  const needed: string[] = [];
  for (const path of paths) {
    const segments = path.split("/").filter(Boolean);
    for (let index = 1; index < segments.length; index += 1) {
      const ancestor = segments.slice(0, index).join("/");
      const node = directories.get(ancestor);
      if (
        node?.childrenLoaded === false &&
        !loadingPaths.has(ancestor) &&
        !needed.includes(ancestor)
      ) {
        needed.push(ancestor);
        break;
      }
    }
  }
  return needed;
}

function directoryMap(nodes: FsNode[]): Map<string, FsNode> {
  const map = new Map<string, FsNode>();
  for (const node of nodes) {
    if (node.kind !== "directory") continue;
    map.set(node.path, node);
    for (const [path, child] of directoryMap(node.children ?? [])) {
      map.set(path, child);
    }
  }
  return map;
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

export function filterTreeToPaths(
  nodes: FsNode[],
  paths: Set<string>,
): FsNode[] {
  if (!paths.size) return [];
  return nodes.flatMap((node) => {
    if (node.kind === "file") return paths.has(node.path) ? [node] : [];
    const children = filterTreeToPaths(node.children ?? [], paths);
    return children.length ? [{ ...node, children }] : [];
  });
}

export function reviewArtifactResults(nodes: FsNode[], limit = 8): FsNode[] {
  return flattenFiles(nodes)
    .map((file) => ({
      file,
      score: reviewArtifactScore(file),
    }))
    .filter((result) => result.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        (b.file.mtimeMs ?? 0) - (a.file.mtimeMs ?? 0) ||
        a.file.path.localeCompare(b.file.path),
    )
    .slice(0, limit)
    .map((result) => result.file);
}

export function isReviewArtifactPath(path: string): boolean {
  return reviewArtifactScore({ path } as FsNode) > 0;
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

function reviewArtifactScore(file: FsNode): number {
  const path = file.path.toLowerCase();
  const extension = path.includes(".") ? path.slice(path.lastIndexOf(".")) : "";
  let score = 0;

  if (
    /(^|\/)(dist|build|reports|coverage|screenshots|docs|storybook|public)(\/|$)/.test(
      path,
    )
  ) {
    score += 80;
  }
  if (
    new Set([
      ".html",
      ".md",
      ".json",
      ".csv",
      ".tsv",
      ".log",
      ".png",
      ".jpg",
      ".jpeg",
      ".webp",
      ".svg",
    ]).has(extension)
  ) {
    score += 30;
  }
  if (
    /(report|summary|index|coverage|screenshot|artifact|output|preview)/.test(
      path,
    )
  ) {
    score += 20;
  }

  return score;
}
