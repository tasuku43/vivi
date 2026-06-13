import type { FsNode } from "../../domain/fs-node.js";
import {
  flattenPanes,
  initialEditorLayout,
  type EditorLayout,
  type EditorLayoutNode,
} from "./editor-layout.js";
import type { OpenTab } from "./tabs.js";

export interface RecentFile {
  path: string;
  viewerKind: string;
  lastOpenedAt: number;
}

export interface WorkspaceSessionState {
  openTabs: OpenTab[];
  layout: EditorLayout;
  recentFiles: RecentFile[];
}

export interface StoredWorkspaceSessionV1 extends WorkspaceSessionState {
  version: 1;
  root: string;
  updatedAt: number;
}

export const workspaceSessionStorageKey = "pathlens.workspaceSession.v1";
export const workspaceSessionTtlMs = 30 * 24 * 60 * 60 * 1000;
export const maxRecentFiles = 20;

export function workspaceSessionStorageKeyForRoot(root: string): string {
  return `${workspaceSessionStorageKey}:${encodeURIComponent(root)}`;
}

export function collectFilePaths(nodes: FsNode[]): Set<string> {
  const paths = new Set<string>();
  for (const node of nodes) {
    if (node.kind === "file") paths.add(node.path);
    if (node.children) {
      for (const childPath of collectFilePaths(node.children)) {
        paths.add(childPath);
      }
    }
  }
  return paths;
}

export function buildWorkspaceSession(
  root: string,
  state: WorkspaceSessionState,
  now = Date.now(),
): StoredWorkspaceSessionV1 {
  return {
    version: 1,
    root,
    updatedAt: now,
    openTabs: state.openTabs.map(({ path, viewerKind, paneId }) => ({
      path,
      viewerKind,
      paneId,
    })),
    layout: state.openTabs.length > 0 ? state.layout : initialEditorLayout,
    recentFiles: trimRecentFiles(state.recentFiles),
  };
}

export function parseWorkspaceSession(
  raw: string | null,
): StoredWorkspaceSessionV1 | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    if (!isStoredWorkspaceSession(value)) return null;
    return value;
  } catch {
    return null;
  }
}

export function restoreWorkspaceSession(
  stored: StoredWorkspaceSessionV1 | null,
  root: string,
  validPaths: Set<string>,
  now = Date.now(),
): WorkspaceSessionState | null {
  if (!stored) return null;
  if (stored.root !== root) return null;
  if (now - stored.updatedAt > workspaceSessionTtlMs) return null;

  const openTabs = stored.openTabs.filter((tab) => validPaths.has(tab.path));
  const recentFiles = trimRecentFiles(
    stored.recentFiles.filter((file) => validPaths.has(file.path)),
  );
  const layout = sanitizeLayout(stored.layout, openTabs);

  return { openTabs, layout, recentFiles };
}

export function recordRecentFile(
  recentFiles: RecentFile[],
  file: Pick<RecentFile, "path" | "viewerKind">,
  now = Date.now(),
): RecentFile[] {
  return trimRecentFiles([
    { path: file.path, viewerKind: file.viewerKind, lastOpenedAt: now },
    ...recentFiles.filter((item) => item.path !== file.path),
  ]);
}

function sanitizeLayout(
  layout: EditorLayout,
  openTabs: OpenTab[],
): EditorLayout {
  if (openTabs.length === 0) return initialEditorLayout;

  const nextRoot = sanitizeLayoutNode(layout.root, openTabs);
  if (!nextRoot) return layoutFromTabs(openTabs);

  const panes = flattenPanes({
    ...layout,
    root: nextRoot,
  });
  const activePaneId = panes.some((pane) => pane.id === layout.activePaneId)
    ? layout.activePaneId
    : (panes[0]?.id ?? "main");

  return {
    root: nextRoot,
    activePaneId,
    nextPaneNumber: Math.max(layout.nextPaneNumber, nextPaneNumberFor(panes)),
  };
}

function sanitizeLayoutNode(
  node: EditorLayoutNode,
  openTabs: OpenTab[],
): EditorLayoutNode | null {
  if (node.kind === "pane") {
    const paneTabs = openTabs.filter((tab) => tab.paneId === node.pane.id);
    if (paneTabs.length === 0) return null;
    const activePath = paneTabs.some((tab) => tab.path === node.pane.activePath)
      ? node.pane.activePath
      : (paneTabs[0]?.path ?? null);
    return { kind: "pane", pane: { ...node.pane, activePath } };
  }

  const first = sanitizeLayoutNode(node.first, openTabs);
  const second = sanitizeLayoutNode(node.second, openTabs);
  if (!first) return second;
  if (!second) return first;
  return { ...node, first, second };
}

function layoutFromTabs(openTabs: OpenTab[]): EditorLayout {
  const firstTab = openTabs[0];
  return {
    root: {
      kind: "pane",
      pane: {
        id: firstTab?.paneId ?? "main",
        activePath: firstTab?.path ?? null,
      },
    },
    activePaneId: firstTab?.paneId ?? "main",
    nextPaneNumber: 1,
  };
}

function nextPaneNumberFor(panes: { id: string }[]): number {
  return (
    panes.reduce((next, pane) => {
      const match = /^pane-(\d+)$/.exec(pane.id);
      return match ? Math.max(next, Number(match[1]) + 1) : next;
    }, 1) || 1
  );
}

function trimRecentFiles(recentFiles: RecentFile[]): RecentFile[] {
  return recentFiles
    .filter(isRecentFile)
    .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
    .slice(0, maxRecentFiles);
}

function isStoredWorkspaceSession(
  value: unknown,
): value is StoredWorkspaceSessionV1 {
  if (!isRecord(value)) return false;
  return (
    value.version === 1 &&
    typeof value.root === "string" &&
    typeof value.updatedAt === "number" &&
    Array.isArray(value.openTabs) &&
    value.openTabs.every(isOpenTab) &&
    isEditorLayout(value.layout) &&
    Array.isArray(value.recentFiles) &&
    value.recentFiles.every(isRecentFile)
  );
}

function isOpenTab(value: unknown): value is OpenTab {
  return (
    isRecord(value) &&
    typeof value.path === "string" &&
    typeof value.viewerKind === "string" &&
    typeof value.paneId === "string"
  );
}

function isRecentFile(value: unknown): value is RecentFile {
  return (
    isRecord(value) &&
    typeof value.path === "string" &&
    typeof value.viewerKind === "string" &&
    typeof value.lastOpenedAt === "number"
  );
}

function isEditorLayout(value: unknown): value is EditorLayout {
  return (
    isRecord(value) &&
    isEditorLayoutNode(value.root) &&
    typeof value.activePaneId === "string" &&
    typeof value.nextPaneNumber === "number"
  );
}

function isEditorLayoutNode(value: unknown): value is EditorLayoutNode {
  if (!isRecord(value)) return false;
  if (value.kind === "pane") {
    return (
      isRecord(value.pane) &&
      typeof value.pane.id === "string" &&
      (typeof value.pane.activePath === "string" ||
        value.pane.activePath === null)
    );
  }
  if (value.kind === "split") {
    return (
      typeof value.id === "string" &&
      (value.direction === "horizontal" || value.direction === "vertical") &&
      isEditorLayoutNode(value.first) &&
      isEditorLayoutNode(value.second)
    );
  }
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
