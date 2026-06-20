import type { FilePayload } from "../domain/fs-node.js";

export interface OpenTab {
  path: string;
  viewerKind: string;
  paneId: string;
  changed?: boolean;
  removed?: boolean;
  isPreview?: boolean;
}

export type OpenTabMode = "normal" | "preview" | "preserve";

export function upsertOpenTab(
  tabs: OpenTab[],
  file: FilePayload,
  paneId = "main",
  mode: OpenTabMode = "normal",
): OpenTab[] {
  const existing = tabs.find(
    (tab) => tab.path === file.path && tab.paneId === paneId,
  );
  if (existing) {
    return tabs.map((tab) =>
      tab.path === file.path && tab.paneId === paneId
        ? {
            ...tab,
            viewerKind: file.viewerKind,
            changed: false,
            removed: false,
            isPreview:
              mode === "normal"
                ? false
                : mode === "preview"
                  ? tab.isPreview !== false
                  : tab.isPreview,
          }
        : tab,
    );
  }

  if (mode === "preview") {
    const previewIndex = tabs.findIndex(
      (tab) => tab.paneId === paneId && tab.isPreview,
    );
    const previewTab = {
      path: file.path,
      viewerKind: file.viewerKind,
      paneId,
      removed: false,
      isPreview: true,
    };
    if (previewIndex >= 0) {
      return tabs.map((tab, index) =>
        index === previewIndex ? previewTab : tab,
      );
    }
    return [...tabs, previewTab];
  }

  return [...tabs, { path: file.path, viewerKind: file.viewerKind, paneId }];
}

export function promoteOpenTab(
  tabs: OpenTab[],
  path: string,
  paneId = "main",
): OpenTab[] {
  return tabs.map((tab) =>
    tab.path === path && tab.paneId === paneId
      ? { ...tab, isPreview: false }
      : tab,
  );
}

export function markTabChanged(tabs: OpenTab[], path: string): OpenTab[] {
  return tabs.map((tab) =>
    tab.path === path ? { ...tab, changed: true, removed: false } : tab,
  );
}

export function markTabRemoved(tabs: OpenTab[], path: string): OpenTab[] {
  return tabs.map((tab) =>
    tab.path === path ? { ...tab, changed: false, removed: true } : tab,
  );
}

export function markTabLoaded(tabs: OpenTab[], file: FilePayload): OpenTab[] {
  return tabs.map((tab) =>
    tab.path === file.path
      ? {
          ...tab,
          viewerKind: file.viewerKind,
          changed: false,
          removed: false,
        }
      : tab,
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

export function closeOtherOpenTabs(
  tabs: OpenTab[],
  activePath: string | null,
  paneId = "main",
): { tabs: OpenTab[]; nextActivePath: string | null } {
  if (!activePath) return { tabs, nextActivePath: activePath };
  return {
    tabs: tabs.filter(
      (tab) => tab.paneId !== paneId || tab.path === activePath,
    ),
    nextActivePath: activePath,
  };
}

export function closeTabsToRight(
  tabs: OpenTab[],
  activePath: string | null,
  paneId = "main",
): { tabs: OpenTab[]; nextActivePath: string | null } {
  if (!activePath) return { tabs, nextActivePath: activePath };
  const paneTabs = tabs.filter((tab) => tab.paneId === paneId);
  const activeIndex = paneTabs.findIndex((tab) => tab.path === activePath);
  if (activeIndex < 0) return { tabs, nextActivePath: activePath };
  const closingPaths = new Set(
    paneTabs.slice(activeIndex + 1).map((tab) => tab.path),
  );
  return {
    tabs: tabs.filter(
      (tab) => tab.paneId !== paneId || !closingPaths.has(tab.path),
    ),
    nextActivePath: activePath,
  };
}

export function closeUnchangedTabs(
  tabs: OpenTab[],
  activePath: string | null,
  paneId = "main",
): { tabs: OpenTab[]; nextActivePath: string | null } {
  return closeTabsByPredicate(tabs, activePath, paneId, (tab) => !tab.changed);
}

export function closePreviewTabs(
  tabs: OpenTab[],
  activePath: string | null,
  paneId = "main",
): { tabs: OpenTab[]; nextActivePath: string | null } {
  return closeTabsByPredicate(tabs, activePath, paneId, (tab) =>
    Boolean(tab.isPreview),
  );
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
  const withoutMoved = tabs.filter(
    (item) => !(item.path === path && item.paneId === fromPaneId),
  );
  const moved = { ...tab, paneId: toPaneId };
  const without = moved.isPreview
    ? withoutMoved.filter((item) => item.paneId !== toPaneId || !item.isPreview)
    : withoutMoved;
  const index = beforePath
    ? without.findIndex(
        (item) => item.path === beforePath && item.paneId === toPaneId,
      )
    : -1;
  if (index < 0) return [...without, moved];
  return [...without.slice(0, index), moved, ...without.slice(index)];
}

function closeTabsByPredicate(
  tabs: OpenTab[],
  activePath: string | null,
  paneId: string,
  shouldClose: (tab: OpenTab) => boolean,
): { tabs: OpenTab[]; nextActivePath: string | null } {
  const nextTabs = tabs.filter(
    (tab) => tab.paneId !== paneId || !shouldClose(tab),
  );
  if (
    !activePath ||
    nextTabs.some((tab) => tab.paneId === paneId && tab.path === activePath)
  ) {
    return { tabs: nextTabs, nextActivePath: activePath };
  }
  const nextPaneTabs = nextTabs.filter((tab) => tab.paneId === paneId);
  return {
    tabs: nextTabs,
    nextActivePath: nextPaneTabs[0]?.path ?? null,
  };
}
