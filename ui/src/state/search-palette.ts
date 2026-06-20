import type { FileSearchResult, TextSearchResult } from "../domain/search.js";

export type SearchPaletteMode = "file" | "text";

export type SearchPaletteItem =
  | {
      kind: "file";
      id: string;
      path: string;
      label: string;
      detail: string;
      viewerKind?: string;
    }
  | {
      kind: "text";
      id: string;
      path: string;
      label: string;
      detail: string;
      viewerKind?: string;
      lineNumber: number;
    };

export function buildFileSearchItems(
  results: FileSearchResult[],
): SearchPaletteItem[] {
  return results.map((file) => ({
    kind: "file" as const,
    id: `file:${file.path}`,
    path: file.path,
    label: file.path,
    detail: file.viewerKind ?? "file",
    viewerKind: file.viewerKind,
  }));
}

export function buildTextSearchItems(
  results: TextSearchResult[],
): SearchPaletteItem[] {
  return results.map((result) => ({
    kind: "text" as const,
    id: `text:${result.path}:${result.lineNumber}:${result.matchStart}`,
    path: result.path,
    label: result.path,
    detail: `L${result.lineNumber} ${result.lineText.trim()}`,
    viewerKind: result.viewerKind,
    lineNumber: result.lineNumber,
  }));
}
