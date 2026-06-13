import type { FilePayload } from "../../domain/fs-node.js";

export interface OpenTab {
  path: string;
  viewerKind: string;
  paneId: string;
  changed?: boolean;
}

export function upsertOpenTab(
  tabs: OpenTab[],
  file: FilePayload,
  paneId = "main",
): OpenTab[] {
  const existing = tabs.find(
    (tab) => tab.path === file.path && tab.paneId === paneId,
  );
  if (existing) {
    return tabs.map((tab) =>
      tab.path === file.path && tab.paneId === paneId
        ? { ...tab, viewerKind: file.viewerKind, changed: false }
        : tab,
    );
  }
  return [...tabs, { path: file.path, viewerKind: file.viewerKind, paneId }];
}

export function markTabChanged(tabs: OpenTab[], path: string): OpenTab[] {
  return tabs.map((tab) =>
    tab.path === path ? { ...tab, changed: true } : tab,
  );
}

export function closeOpenTab(
  tabs: OpenTab[],
  path: string,
  activePath: string | null,
  paneId = "main",
): { tabs: OpenTab[]; nextActivePath: string | null } {
  const paneTabs = tabs.filter((tab) => tab.paneId === paneId);
  const index = paneTabs.findIndex((tab) => tab.path === path);
  const nextTabs = tabs.filter(
    (tab) => !(tab.path === path && tab.paneId === paneId),
  );
  if (path !== activePath)
    return { tabs: nextTabs, nextActivePath: activePath };
  const nextPaneTabs = nextTabs.filter((tab) => tab.paneId === paneId);
  return {
    tabs: nextTabs,
    nextActivePath:
      nextPaneTabs[Math.max(0, index - 1)]?.path ??
      nextPaneTabs[0]?.path ??
      null,
  };
}

export function moveOpenTab(
  tabs: OpenTab[],
  path: string,
  fromPaneId: string,
  toPaneId: string,
  beforePath: string | null,
): OpenTab[] {
  const tab = tabs.find(
    (item) => item.path === path && item.paneId === fromPaneId,
  );
  if (!tab) return tabs;
  const without = tabs.filter(
    (item) => !(item.path === path && item.paneId === fromPaneId),
  );
  const moved = { ...tab, paneId: toPaneId };
  const index = beforePath
    ? without.findIndex(
        (item) => item.path === beforePath && item.paneId === toPaneId,
      )
    : -1;
  if (index < 0) return [...without, moved];
  return [...without.slice(0, index), moved, ...without.slice(index)];
}
