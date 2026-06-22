import type { TextSearchResult } from "../domain/search.js";
import type { FilePayload } from "../domain/fs-node.js";
import type { LineRange } from "./code-viewer.js";
import type { ViewerMode } from "./viewer-mode.js";

export interface TextSearchNavigationSession {
  query: string;
  results: TextSearchResult[];
  activeIndex: number;
}

export type SearchNavigationDirection = "next" | "previous";

export function viewerModeForTextSearchTarget(
  file: Pick<FilePayload, "viewerKind">,
): ViewerMode | null {
  if (file.viewerKind === "markdown" || file.viewerKind === "html")
    return "source";
  return null;
}

export function codeSelectionForTextSearchTarget(
  file: Pick<FilePayload, "viewerKind">,
  lineNumber: number,
): LineRange | null {
  if (file.viewerKind !== "code") return null;
  return { start: lineNumber, end: lineNumber };
}

export function textSearchSessionForSelection({
  query,
  results,
  path,
  lineNumber,
}: {
  query: string;
  results: TextSearchResult[];
  path: string;
  lineNumber: number;
}): TextSearchNavigationSession | null {
  const normalizedQuery = query.trim();
  if (!normalizedQuery || !results.length) return null;
  const activeIndex = results.findIndex(
    (result) => result.path === path && result.lineNumber === lineNumber,
  );
  if (activeIndex < 0) return null;
  return {
    query: normalizedQuery,
    results: [...results],
    activeIndex,
  };
}

export function activeTextSearchResult(
  session: TextSearchNavigationSession | null,
): TextSearchResult | null {
  if (!session?.results.length) return null;
  return session.results[session.activeIndex] ?? null;
}

export function moveTextSearchSession(
  session: TextSearchNavigationSession | null,
  direction: SearchNavigationDirection,
): TextSearchNavigationSession | null {
  if (!session?.results.length) return null;
  const delta = direction === "next" ? 1 : -1;
  const activeIndex =
    (session.activeIndex + delta + session.results.length) %
    session.results.length;
  return { ...session, activeIndex };
}

export function textSearchPositionLabel(
  session: TextSearchNavigationSession | null,
): string | null {
  if (!session?.results.length) return null;
  return `${session.activeIndex + 1} of ${session.results.length}`;
}
