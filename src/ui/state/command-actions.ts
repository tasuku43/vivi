import type { FsNode } from "../../domain/fs-node.js";
import { fuzzyFileResults } from "./files.js";

export type CommandActionId =
  | "open-changed-file"
  | "show-diff"
  | "reveal-in-tree"
  | "toggle-source-rendered"
  | "copy-local-url"
  | "focus-outline"
  | "toggle-inspector"
  | "split-right"
  | "close-tab"
  | "reopen-last-closed-tab"
  | "open-recent-file"
  | "show-keyboard-shortcuts"
  | "export-current-context";

export interface CommandAction {
  id: CommandActionId;
  label: string;
  detail: string;
  keywords: string[];
  disabled?: boolean;
}

export type PaletteItem =
  | {
      kind: "file";
      id: string;
      path: string;
      label: string;
      detail: string;
      viewerKind?: string;
    }
  | {
      kind: "action";
      id: CommandActionId;
      label: string;
      detail: string;
      disabled?: boolean;
    };

export function buildPaletteItems(
  nodes: FsNode[],
  actions: CommandAction[],
  query: string,
  limit = 10,
): PaletteItem[] {
  const actionItems = filterCommandActions(actions, query, limit).map(
    (action): PaletteItem => ({
      kind: "action",
      id: action.id,
      label: action.label,
      detail: action.detail,
      disabled: action.disabled,
    }),
  );
  const fileLimit = Math.max(0, limit - actionItems.length);
  const fileItems = fuzzyFileResults(nodes, query, fileLimit).map(
    (file): PaletteItem => ({
      kind: "file",
      id: `file:${file.path}`,
      path: file.path,
      label: file.path,
      detail: file.viewerKind ?? "file",
      viewerKind: file.viewerKind,
    }),
  );

  if (query.trim()) return [...actionItems, ...fileItems].slice(0, limit);
  return [...fileItems, ...actionItems].slice(0, limit);
}

export function filterCommandActions(
  actions: CommandAction[],
  query: string,
  limit = 10,
): CommandAction[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return actions.slice(0, limit);

  return actions
    .map((action) => ({
      action,
      score: actionScore(action, terms),
    }))
    .filter((result) => result.score > 0)
    .sort(
      (a, b) =>
        Number(a.action.disabled) - Number(b.action.disabled) ||
        b.score - a.score ||
        a.action.label.localeCompare(b.action.label),
    )
    .slice(0, limit)
    .map((result) => result.action);
}

function actionScore(action: CommandAction, terms: string[]): number {
  const haystack = [action.label, action.detail, ...action.keywords]
    .join(" ")
    .toLowerCase();
  let score = 0;
  for (const term of terms) {
    const index = haystack.indexOf(term);
    if (index < 0) return 0;
    score += 100 - index;
  }
  return score;
}
