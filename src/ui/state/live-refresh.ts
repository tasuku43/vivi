import type { FsEvent } from "../../domain/fs-node.js";
import type { EditorPane } from "./editor-layout.js";
import { parentDirectoryPath } from "./files.js";

export interface LiveRefreshDecision {
  reloadPath: string | null;
  stalePath: string | null;
  removedPath: string | null;
  treeRefreshParentPath: string | null;
}

export function activePanePaths(panes: EditorPane[]): Set<string> {
  return new Set(
    panes
      .map((pane) => pane.activePath)
      .filter((path): path is string => Boolean(path)),
  );
}

export function decideLiveRefresh(
  event: FsEvent,
  activePaths: ReadonlySet<string>,
): LiveRefreshDecision {
  return {
    reloadPath:
      event.type === "change" && activePaths.has(event.path)
        ? event.path
        : null,
    stalePath:
      event.type === "change" && !activePaths.has(event.path)
        ? event.path
        : null,
    removedPath: event.type === "unlink" ? event.path : null,
    treeRefreshParentPath:
      event.type === "add" || event.type === "unlink"
        ? parentDirectoryPath(event.path)
        : null,
  };
}

export function shouldApplyLiveRefresh(
  versions: Readonly<Record<string, number>>,
  path: string,
  requestVersion: number,
): boolean {
  return versions[path] === requestVersion;
}
