import type { FileSearchResult, TextSearchResult } from "../domain/search.js";

export type SearchPaletteMode = "file" | "text" | "action";

export interface CommandActionItem {
  id: string;
  label: string;
  detail: string;
  shortcut?: string;
  disabled?: boolean;
}

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
