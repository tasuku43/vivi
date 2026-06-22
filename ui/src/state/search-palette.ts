import type { FileSearchResult, TextSearchResult } from "../domain/search.js";

export type SearchPaletteMode = "file" | "text" | "action";

export interface CommandActionItem {
  id: string;
  label: string;
  detail: string;
  shortcut?: string;
  disabled?: boolean;
}

export interface RecentFileSearchResult {
  path: string;
  viewerKind?: string;
  source?: "active" | "open" | "recent";
}

export type SearchPaletteItem =
  | {
      kind: "file";
      id: string;
      path: string;
      label: string;
      detail: string;
      viewerKind?: string;
      source?: "search" | "active" | "open" | "recent";
    }
  | {
      kind: "text";
      id: string;
      path: string;
      label: string;
      detail: string;
      viewerKind?: string;
      lineNumber: number;
      lineText: string;
      matchStart: number;
      matchLength: number;
    }
  | {
      kind: "action";
      id: string;
      label: string;
      detail: string;
      shortcut?: string;
      disabled?: boolean;
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
    source: "search",
  }));
}

export function buildRecentFileSearchItems(
  results: RecentFileSearchResult[],
): SearchPaletteItem[] {
  return results.map((file) => ({
    kind: "file" as const,
    id: `${file.source ?? "recent"}:${file.path}`,
    path: file.path,
    label: file.path,
    detail: `${
      file.source === "active"
        ? "Active tab"
        : file.source === "open"
          ? "Open tab"
          : "Recent"
    }${
      file.viewerKind ? ` · ${file.viewerKind}` : ""
    }`,
    viewerKind: file.viewerKind,
    source: file.source ?? "recent",
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
    lineText: result.lineText,
    matchStart: result.matchStart,
    matchLength: result.matchLength,
  }));
}

export function buildCommandActionItems(
  actions: CommandActionItem[],
): SearchPaletteItem[] {
  return actions.map((action) => ({
    kind: "action" as const,
    id: `action:${action.id}`,
    label: action.label,
    detail: action.detail,
    shortcut: action.shortcut,
    disabled: action.disabled,
  }));
}

export interface TextSearchPreviewSegment {
  text: string;
  match: boolean;
}

export function textSearchPreviewSegments(
  lineText: string,
  matchStart: number,
  matchLength: number,
): TextSearchPreviewSegment[] {
  if (!lineText || matchLength <= 0) return [{ text: lineText, match: false }];
  const start = Math.max(0, Math.min(matchStart, lineText.length));
  const end = Math.max(start, Math.min(start + matchLength, lineText.length));
  if (start === end) return [{ text: lineText, match: false }];
  return [
    { text: lineText.slice(0, start), match: false },
    { text: lineText.slice(start, end), match: true },
    { text: lineText.slice(end), match: false },
  ].filter((segment) => segment.text.length > 0);
}
