import type { FilePayload, FsNode } from "./fs-node.js";
import type { ViewerKind } from "./viewer-kind.js";

export interface SearchStats {
  durationMs: number;
  scannedDirectories: number;
  scannedFiles: number;
  readFiles?: number;
  skippedFiles?: number;
  cached?: boolean;
}

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

export function searchFilePayload(
  file: FilePayload,
  query: string,
  maxMatches = 3,
): TextSearchResult[] {
  const needle = query.trim().toLowerCase();
  if (!needle || file.encoding !== "utf8" || file.truncated) return [];
  if (!isTextSearchableViewerKind(file.viewerKind)) return [];

  const results: TextSearchResult[] = [];
  const lines = file.content.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const matchStart = line.toLowerCase().indexOf(needle);
    if (matchStart < 0) continue;
    results.push({
      path: file.path,
      viewerKind: file.viewerKind,
      lineNumber: index + 1,
      ...excerptLine(line, matchStart, needle.length),
    });
    if (results.length >= maxMatches) break;
  }
  return results;
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

function excerptLine(
  lineText: string,
  matchStart: number,
  matchLength: number,
): Pick<TextSearchResult, "lineText" | "matchStart" | "matchLength"> {
  const maxLength = 220;
  if (lineText.length <= maxLength) {
    return { lineText, matchStart, matchLength };
  }

  const context = Math.floor((maxLength - matchLength) / 2);
  const rawStart = Math.max(0, matchStart - context);
  const start = Math.min(rawStart, Math.max(0, lineText.length - maxLength));
  const end = Math.min(lineText.length, start + maxLength);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < lineText.length ? "..." : "";
  return {
    lineText: `${prefix}${lineText.slice(start, end)}${suffix}`,
    matchStart: matchStart - start + prefix.length,
    matchLength,
  };
}
