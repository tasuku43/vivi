import type { FsNode } from "./fs-node.js";
import type { ViewerKind } from "./viewer-kind.js";

export interface FileSearchResult {
  path: string;
  name: string;
  viewerKind?: ViewerKind;
  size?: number;
  mtimeMs?: number;
  score: number;
}

export interface TextSearchResult {
  path: string;
  viewerKind?: ViewerKind;
  lineNumber: number;
  lineText: string;
  matchStart: number;
  matchLength: number;
}

export function collectSearchableFiles(nodes: FsNode[]): FsNode[] {
  return nodes.flatMap((node) => {
    if (node.kind === "directory") {
      return collectSearchableFiles(node.children ?? []);
    }
    return isTextSearchableViewerKind(node.viewerKind) ? [node] : [];
  });
}

export function isTextSearchableViewerKind(
  viewerKind: ViewerKind | undefined,
): boolean {
  return (
    viewerKind === "markdown" ||
    viewerKind === "html" ||
    viewerKind === "code" ||
    viewerKind === "text" ||
    viewerKind === "json" ||
    viewerKind === "mermaid"
  );
}
