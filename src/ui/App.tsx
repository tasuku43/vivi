import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { TextDiff } from "../domain/change-review.js";
import type {
  FilePayload,
  FsEvent,
  TreeSnapshot,
  ViewerConfig,
} from "../domain/fs-node.js";
import { TreeSidebar } from "./components/TreeSidebar.js";
import { FileViewer } from "./components/FileViewer.js";
import {
  OpenTabs,
  readDraggedTab,
  type DraggedTabPayload,
  type OpenTab,
} from "./components/OpenTabs.js";
import { Inspector } from "./components/Inspector.js";
import { CommandPalette } from "./components/CommandPalette.js";
import { extractHtmlOutline, extractMarkdownOutline } from "./state/outline.js";
import type { LineRange } from "./state/code-viewer.js";
import type { FileSearchResult, TextSearchResult } from "../domain/search.js";
import {
  recordReviewEvent,
  summarizeReviewEvents,
  type ReviewEvent,
} from "./state/review-events.js";
import {
  closeOtherOpenTabs,
  closeOpenTab,
  closePreviewTabs,
  closeTabsToRight,
  closeUnchangedTabs,
  markTabChanged,
  moveOpenTab,
  promoteOpenTab,
  upsertOpenTab,
  type OpenTabMode,
} from "./state/tabs.js";
import {
  closePaneIfEmpty,
  flattenPanes,
  initialEditorLayout,
  setPaneActivePath,
  splitEditorPane,
  type EditorLayoutNode,
  type EditorPane,
  type SplitDirection,
  type SplitEdge,
} from "./state/editor-layout.js";
import {
  filterTreeToPaths,
  parentDirectoryPath,
  replaceDirectoryChildren,
} from "./state/files.js";
import {
  buildDiffStat,
  latestUnreadReviewPath,
  mergeReviewChanges,
  nextReviewQueuePath,
  type GitChangeReviewState,
} from "./state/git-review.js";
import {
  isThemePreference,
  nextThemePreference,
  resolveThemePreference,
  themePreferenceLabel,
  themeStorageKey,
  type ResolvedTheme,
  type ThemePreference,
} from "./state/theme.js";
import {
  clampInspectorWidth,
  clampSidebarWidth,
  defaultInspectorWidth,
  defaultSidebarWidth,
} from "./state/workbench-layout.js";
import {
  buildWorkspaceSession,
  parseWorkspaceSession,
  recordRecentFile,
  restoreOnlyActiveWorkspaceTab,
  restoreWorkspaceSession,
  shouldPromptForWorkspaceSessionRestore,
  workspaceSessionStorageKey,
  workspaceSessionStorageKeyForRoot,
  workspaceSessionTtlMs,
  type RecentFile,
  type StoredWorkspaceSessionV1,
  type WorkspaceSessionState,
} from "./state/workspace-session.js";
import {
  defaultViewerMode,
  supportsDiffMode,
  type ViewerMode,
} from "./state/viewer-mode.js";
import type { SearchPaletteMode } from "./state/search-palette.js";

interface LiveRefreshMetrics {
  fsEventsReceived: number;
  gitRefreshes: number;
  diffRefreshes: number;
  lastGitRefreshMs: number | null;
  lastDiffRefreshMs: number | null;
  pendingGitRefresh: boolean;
  pendingDiffPaths: number;
}

export function App() {
  const [tree, setTree] = useState<TreeSnapshot | null>(null);
  const [config, setConfig] = useState<ViewerConfig | null>(null);
  const [layout, setLayout] = useState(initialEditorLayout);
  const [files, setFiles] = useState<Record<string, FilePayload>>({});
  const [openTabs, setOpenTabs] = useState<OpenTab[]>([]);
  const [recentFiles, setRecentFiles] = useState<RecentFile[]>([]);
  const [recentEvents, setRecentEvents] = useState<ReviewEvent[]>([]);
  const [unreadReviewPaths, setUnreadReviewPaths] = useState<string[]>([]);
  const [liveMetrics, setLiveMetrics] = useState<LiveRefreshMetrics>({
    fsEventsReceived: 0,
    gitRefreshes: 0,
    diffRefreshes: 0,
    lastGitRefreshMs: null,
    lastDiffRefreshMs: null,
    pendingGitRefresh: false,
    pendingDiffPaths: 0,
  });
  const [gitReview, setGitReview] = useState<GitChangeReviewState | null>(null);
  const [diffs, setDiffs] = useState<Record<string, TextDiff>>({});
  const [loadingDiffs, setLoadingDiffs] = useState<Record<string, boolean>>({});
  const [diffEnabled, setDiffEnabled] = useState(false);
  const [diffFocusByPath, setDiffFocusByPath] = useState<
    Record<string, boolean>
  >({});
  const [viewerModes, setViewerModes] = useState<Record<string, ViewerMode>>(
    {},
  );
  const [codeSelections, setCodeSelections] = useState<
    Record<string, LineRange | null>
  >({});
  const [refreshedFiles, setRefreshedFiles] = useState<Record<string, number>>(
    {},
  );
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteMode, setPaletteMode] = useState<SearchPaletteMode>("file");
  const [paletteQuery, setPaletteQuery] = useState("");
  const [fileSearchResults, setFileSearchResults] = useState<
    FileSearchResult[]
  >([]);
  const [fileSearchLoading, setFileSearchLoading] = useState(false);
  const [textSearchResults, setTextSearchResults] = useState<
    TextSearchResult[]
  >([]);
  const [textSearchLoading, setTextSearchLoading] = useState(false);
  const [loadingDirectoryPaths, setLoadingDirectoryPaths] = useState<
    Set<string>
  >(new Set());
  const [draggingTab, setDraggingTab] = useState(false);
  const [manualDraggedTab, setManualDraggedTab] =
    useState<DraggedTabPayload | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    paneId: string;
    edge: SplitEdge;
  } | null>(null);
  const [themePreference, setThemePreference] = useState<ThemePreference>(
    readStoredThemePreference,
  );
  const [systemTheme, setSystemTheme] =
    useState<ResolvedTheme>(readSystemTheme);
  const [inspectorVisible, setInspectorVisible] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(defaultSidebarWidth);
  const [inspectorWidth, setInspectorWidth] = useState(defaultInspectorWidth);
  const [resizingWorkbenchPane, setResizingWorkbenchPane] = useState<
    "sidebar" | "inspector" | null
  >(null);
  const [treeChangedOnly, setTreeChangedOnly] = useState(false);
  const [inspectorTargetVisible, setInspectorTargetVisible] = useState(false);
  const [workspaceSessionReady, setWorkspaceSessionReady] = useState(false);
  const [pendingRestoreSession, setPendingRestoreSession] =
    useState<WorkspaceSessionState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const gitRefreshTimer = useRef<number | null>(null);
  const knownReviewPaths = useRef(new Set<string>());
  const gitRefreshInFlight = useRef(false);
  const gitRefreshQueued = useRef(false);
  const diffRefreshTimer = useRef<number | null>(null);
  const pendingDiffRefreshPaths = useRef(new Set<string>());
  const diffRequestVersions = useRef<Record<string, number>>({});

  async function loadTree() {
    const response = await fetch("/api/tree?depth=1");
    if (!response.ok)
      throw new Error(`tree request failed: ${response.status}`);
    setTree(await response.json());
  }

  async function loadDirectory(path: string) {
    setLoadingDirectoryPaths((items) => new Set(items).add(path));
    try {
      const params = new URLSearchParams({ path, depth: "1" });
      const response = await fetch(`/api/tree?${params.toString()}`);
      if (!response.ok)
        throw new Error(`tree request failed: ${response.status}`);
      const snapshot = (await response.json()) as TreeSnapshot;
      setTree((current) => {
        if (!current) return snapshot;
        return {
          ...current,
          version: snapshot.version,
          nodes: replaceDirectoryChildren(
            current.nodes,
            path,
            snapshot.nodes,
          ),
        };
      });
    } finally {
      setLoadingDirectoryPaths((items) => {
        const next = new Set(items);
        next.delete(path);
        return next;
      });
    }
  }

  async function loadConfig() {
    const response = await fetch("/api/config");
    if (!response.ok)
      throw new Error(`config request failed: ${response.status}`);
    setConfig(await response.json());
  }

  async function loadGitReview() {
    const startedAt = performance.now();
    const response = await fetch("/api/changes");
    if (!response.ok)
      throw new Error(`changes request failed: ${response.status}`);
    setGitReview((await response.json()) as GitChangeReviewState);
    setLiveMetrics((metrics) => ({
      ...metrics,
      gitRefreshes: metrics.gitRefreshes + 1,
      lastGitRefreshMs: Math.round(performance.now() - startedAt),
      pendingGitRefresh: false,
    }));
  }

  async function loadHeadDiff(path: string) {
    const requestVersion = (diffRequestVersions.current[path] ?? 0) + 1;
    diffRequestVersions.current[path] = requestVersion;
    const startedAt = performance.now();
    setLoadingDiffs((items) => ({ ...items, [path]: true }));
    const params = new URLSearchParams({ path, base: "HEAD" });
    try {
      const response = await fetch(`/api/diff?${params.toString()}`);
      if (!response.ok)
        throw new Error(`diff request failed: ${response.status}`);
      const diff = (await response.json()) as TextDiff;
      if (diffRequestVersions.current[path] !== requestVersion) return;
      setDiffs((items) => ({
        ...items,
        [path]: diff,
      }));
      setLiveMetrics((metrics) => ({
        ...metrics,
        diffRefreshes: metrics.diffRefreshes + 1,
        lastDiffRefreshMs: Math.round(performance.now() - startedAt),
      }));
    } finally {
      if (diffRequestVersions.current[path] === requestVersion) {
        setLoadingDiffs((items) => ({ ...items, [path]: false }));
      }
    }
  }

  const panes = useMemo(() => flattenPanes(layout), [layout]);
  const activePane =
    panes.find((pane) => pane.id === layout.activePaneId) ?? panes[0];
  const selectedPath = activePane?.activePath ?? null;
  const file = selectedPath ? (files[selectedPath] ?? null) : null;
  const resolvedTheme = resolveThemePreference(themePreference, systemTheme);
  const recentActivityEvents = useMemo(
    () =>
      recentEvents.filter(
        (item) => Date.now() - item.receivedAt <= recentEventWindowMs,
      ),
    [recentEvents],
  );
  const reviewState = useMemo(
    () => summarizeReviewEvents(recentActivityEvents),
    [recentActivityEvents],
  );
  const reviewChanges = useMemo(
    () => mergeReviewChanges(reviewState, gitReview),
    [gitReview, reviewState],
  );
  const reviewDiffStats = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(diffs).map(([path, diff]) => [path, buildDiffStat(diff)]),
      ),
    [diffs],
  );
  const unreadReviewPathSet = useMemo(
    () => new Set(unreadReviewPaths),
    [unreadReviewPaths],
  );
  const changedPathSet = useMemo(
    () => new Set(reviewChanges.map((change) => change.path)),
    [reviewChanges],
  );
  const sidebarNodes = useMemo(
    () =>
      treeChangedOnly && tree
        ? filterTreeToPaths(tree.nodes, changedPathSet)
        : (tree?.nodes ?? []),
    [changedPathSet, tree, treeChangedOnly],
  );
  async function fetchFilePayload(path: string): Promise<FilePayload> {
    const response = await fetch(`/api/file?path=${encodeURIComponent(path)}`);
    if (!response.ok)
      throw new Error(`file request failed: ${response.status}`);
    return (await response.json()) as FilePayload;
  }

  async function loadFile(
    path: string,
    paneId = layout.activePaneId,
    mode: OpenTabMode = "preview",
  ): Promise<FilePayload> {
    setLayout((current) => setPaneActivePath(current, paneId, path));
    setError(null);
    const payload = await fetchFilePayload(path);
    setFiles((items) => ({ ...items, [payload.path]: payload }));
    setOpenTabs((tabs) => upsertOpenTab(tabs, payload, paneId, mode));
    setRecentFiles((items) => recordRecentFile(items, payload));
    markReviewPathRead(payload.path);
    if (diffEnabled && supportsDiffMode(payload)) {
      void loadHeadDiff(payload.path).catch((err) => setError(String(err)));
    }
    return payload;
  }

  async function openHeadDiff(path: string, paneId = layout.activePaneId) {
    const payload = await loadFile(path, paneId, "preview");
    if (!supportsDiffMode(payload)) return;
    setDiffEnabled(true);
    await loadHeadDiff(path);
  }

  function scheduleGitReviewRefresh(delayMs = 250) {
    gitRefreshQueued.current = true;
    setLiveMetrics((metrics) => ({
      ...metrics,
      pendingGitRefresh: true,
    }));
    if (gitRefreshTimer.current) {
      window.clearTimeout(gitRefreshTimer.current);
    }
    gitRefreshTimer.current = window.setTimeout(() => {
      gitRefreshTimer.current = null;
      void runQueuedGitReviewRefresh();
    }, delayMs);
  }

  async function runQueuedGitReviewRefresh(): Promise<void> {
    if (gitRefreshInFlight.current) return;
    if (!gitRefreshQueued.current) return;

    gitRefreshQueued.current = false;
    gitRefreshInFlight.current = true;
    try {
      await loadGitReview();
    } catch (err) {
      setLiveMetrics((metrics) => ({
        ...metrics,
        pendingGitRefresh: false,
      }));
      setError(String(err));
    } finally {
      gitRefreshInFlight.current = false;
      if (gitRefreshQueued.current) scheduleGitReviewRefresh(50);
    }
  }

  function scheduleDiffRefresh(path: string, delayMs = 250) {
    pendingDiffRefreshPaths.current.add(path);
    setLiveMetrics((metrics) => ({
      ...metrics,
      pendingDiffPaths: pendingDiffRefreshPaths.current.size,
    }));
    if (diffRefreshTimer.current) {
      window.clearTimeout(diffRefreshTimer.current);
    }
    diffRefreshTimer.current = window.setTimeout(() => {
      diffRefreshTimer.current = null;
      const paths = [...pendingDiffRefreshPaths.current];
      pendingDiffRefreshPaths.current.clear();
      setLiveMetrics((metrics) => ({
        ...metrics,
        pendingDiffPaths: 0,
      }));
      for (const path of paths) {
        void loadHeadDiff(path).catch((err) => setError(String(err)));
      }
    }, delayMs);
  }

  function toggleHeadDiff(path = selectedPath) {
    const nextEnabled = !diffEnabled;
    setDiffEnabled(nextEnabled);
    if (nextEnabled && path) {
      const target = files[path];
      if (target && !supportsDiffMode(target)) return;
      void loadHeadDiff(path).catch((err) => setError(String(err)));
    }
  }

  async function hydrateRestoredFiles(
    restoredLayout: EditorLayoutNode,
    restoredDiffEnabled = false,
  ) {
    const activePaths = [
      ...new Set(
        flattenPanes({
          root: restoredLayout,
          activePaneId: "main",
          nextPaneNumber: 1,
        }).flatMap((pane) => (pane.activePath ? [pane.activePath] : [])),
      ),
    ];
    const payloads = await Promise.all(activePaths.map(fetchFilePayload));
    setFiles((items) => {
      const next = { ...items };
      for (const payload of payloads) next[payload.path] = payload;
      return next;
    });
    if (restoredDiffEnabled) {
      for (const payload of payloads) {
        if (supportsDiffMode(payload)) {
          void loadHeadDiff(payload.path).catch((err) => setError(String(err)));
        }
      }
    }
  }

  function closeTab(path: string, paneId = layout.activePaneId) {
    setOpenTabs((tabs) => {
      const pane = panes.find((item) => item.id === paneId);
      const result = closeOpenTab(tabs, path, pane?.activePath ?? null, paneId);
      setLayout((current) => {
        const next = setPaneActivePath(current, paneId, result.nextActivePath);
        return closePaneIfEmpty(
          next,
          paneId,
          result.tabs.some((tab) => tab.paneId === paneId),
        );
      });
      if (result.nextActivePath && !files[result.nextActivePath]) {
        void loadFile(result.nextActivePath, paneId, "preserve").catch((err) =>
          setError(String(err)),
        );
      }
      return result.tabs;
    });
  }

  function openFromPalette(path: string, preview: boolean) {
    setPaletteOpen(false);
    setPaletteQuery("");
    void loadFile(
      path,
      layout.activePaneId,
      preview ? "preview" : "normal",
    ).catch((err) => setError(String(err)));
  }

  function openPalette(mode: SearchPaletteMode) {
    setPaletteMode(mode);
    setPaletteQuery("");
    setPaletteOpen(true);
  }

  function openAllChangedFiles() {
    for (const { path, status } of reviewChanges) {
      if (status === "deleted") continue;
      void loadFile(path, layout.activePaneId, "normal").catch((err) =>
        setError(String(err)),
      );
    }
  }

  function openReviewQueueFile(direction: "next" | "previous") {
    const path = nextReviewQueuePath(reviewChanges, selectedPath, direction);
    if (path)
      void loadFile(path, layout.activePaneId, "preview").catch((err) =>
        setError(String(err)),
      );
  }

  function openLatestUnreadReviewFile() {
    const path = latestUnreadReviewPath(reviewChanges, unreadReviewPaths);
    if (path)
      void loadFile(path, layout.activePaneId, "preview").catch((err) =>
        setError(String(err)),
      );
  }

  function markReviewPathUnread(path: string) {
    setUnreadReviewPaths((paths) => [
      path,
      ...paths.filter((item) => item !== path),
    ]);
  }

  function markReviewPathRead(path: string) {
    setUnreadReviewPaths((paths) => paths.filter((item) => item !== path));
  }

  function promoteTab(path: string, paneId = layout.activePaneId) {
    setOpenTabs((tabs) => promoteOpenTab(tabs, path, paneId));
  }

  function applyTabCleanup(
    cleanup: (
      tabs: OpenTab[],
      activePath: string | null,
      paneId: string,
    ) => { tabs: OpenTab[]; nextActivePath: string | null },
    paneId = layout.activePaneId,
  ) {
    const pane = panes.find((item) => item.id === paneId);
    setOpenTabs((tabs) => {
      const result = cleanup(tabs, pane?.activePath ?? null, paneId);
      setLayout((current) => {
        const next = setPaneActivePath(current, paneId, result.nextActivePath);
        return closePaneIfEmpty(
          next,
          paneId,
          result.tabs.some((tab) => tab.paneId === paneId),
        );
      });
      if (result.nextActivePath && !files[result.nextActivePath]) {
        void loadFile(result.nextActivePath, paneId, "preserve").catch((err) =>
          setError(String(err)),
        );
      }
      return result.tabs;
    });
  }

  function moveTab(
    path: string,
    fromPaneId: string,
    toPaneId: string,
    beforePath: string | null,
  ) {
    setOpenTabs((tabs) =>
      moveOpenTab(tabs, path, fromPaneId, toPaneId, beforePath),
    );
    setLayout((current) => setPaneActivePath(current, toPaneId, path));
    if (!files[path])
      void loadFile(path, toPaneId, "preserve").catch((err) =>
        setError(String(err)),
      );
  }

  function splitTab(
    path: string,
    _fromPaneId: string,
    paneId: string,
    edge: SplitEdge,
  ) {
    const direction: SplitDirection =
      edge === "left" || edge === "right" ? "vertical" : "horizontal";
    const targetPaneId = `pane-${layout.nextPaneNumber}`;
    const cached = files[path];

    setLayout((current) => {
      const split = splitEditorPane(current, paneId, direction, edge);
      return setPaneActivePath(split, targetPaneId, path);
    });

    if (cached) {
      setOpenTabs((tabs) =>
        upsertOpenTab(tabs, cached, targetPaneId, "normal"),
      );
    } else {
      void loadFile(path, targetPaneId, "normal").catch((err) =>
        setError(String(err)),
      );
    }
  }

  const outline = useMemo(() => {
    if (!file) return [];
    if (file.viewerKind === "html") return extractHtmlOutline(file.content);
    if (file.viewerKind !== "markdown") return [];
    return extractMarkdownOutline(file.content);
  }, [file]);

  function jumpToOutline(id: string) {
    const pane = document.querySelector<HTMLElement>(
      `[data-pane-id="${layout.activePaneId}"]`,
    );
    const viewer = pane?.querySelector<HTMLElement>(".viewer-pane");
    if (!viewer) return;

    const escapedId =
      typeof CSS !== "undefined" && CSS.escape
        ? CSS.escape(id)
        : id.replace(/"/g, '\\"');
    const markdownTarget = viewer.querySelector<HTMLElement>(`#${escapedId}`);
    if (markdownTarget) {
      markdownTarget.scrollIntoView({ block: "start", behavior: "smooth" });
      return;
    }

    const iframe = viewer.querySelector<HTMLIFrameElement>("iframe.html-frame");
    const iframeTarget = iframe?.contentDocument?.getElementById(id);
    if (iframeTarget) {
      iframeTarget.scrollIntoView({ block: "start", behavior: "smooth" });
      return;
    }

    if (iframe) {
      const next = new URL(iframe.src, window.location.href);
      next.hash = id;
      iframe.src = next.toString();
    }
  }

  function revealInspectorTarget() {
    const pane = document.querySelector<HTMLElement>(
      `[data-pane-id="${layout.activePaneId}"]`,
    );
    pane?.scrollIntoView({
      block: "nearest",
      inline: "nearest",
      behavior: "smooth",
    });
    setInspectorTargetVisible(true);
    window.setTimeout(() => setInspectorTargetVisible(false), 900);
  }

  useEffect(() => {
    loadConfig().catch((err) => setError(String(err)));
    loadTree().catch((err) => setError(String(err)));
    loadGitReview().catch((err) => setError(String(err)));
  }, []);

  useEffect(() => {
    if (!config || !tree || workspaceSessionReady) return;
    pruneStoredWorkspaceSessions();

    const restored = restoreWorkspaceSession(
      readStoredWorkspaceSession(config.root),
      config.root,
      null,
    );

    if (restored) {
      if (shouldPromptForWorkspaceSessionRestore(restored)) {
        setPendingRestoreSession(restored);
      } else {
        applyWorkspaceSession(restored);
      }
    }

    setWorkspaceSessionReady(true);
  }, [config, tree, workspaceSessionReady]);

  useEffect(() => {
    if (!config || !workspaceSessionReady || pendingRestoreSession) return;
    writeStoredWorkspaceSession(
      buildWorkspaceSession(config.root, {
        openTabs,
        layout,
        recentFiles,
        inspectorVisible,
        sidebarWidth,
        inspectorWidth,
        diffEnabled,
        diffFocusByPath,
      }),
    );
  }, [
    config,
    workspaceSessionReady,
    openTabs,
    layout,
    recentFiles,
    inspectorVisible,
    sidebarWidth,
    inspectorWidth,
    diffEnabled,
    diffFocusByPath,
    pendingRestoreSession,
  ]);

  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: light)");
    const updateSystemTheme = () =>
      setSystemTheme(query.matches ? "light" : "dark");
    updateSystemTheme();
    query.addEventListener("change", updateSystemTheme);
    return () => query.removeEventListener("change", updateSystemTheme);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
    document.documentElement.style.colorScheme = resolvedTheme;
    window.localStorage.setItem(themeStorageKey, themePreference);
  }, [resolvedTheme, themePreference]);

  useEffect(() => {
    if (!resizingWorkbenchPane) return;

    const resize = (event: PointerEvent) => {
      if (resizingWorkbenchPane === "sidebar") {
        setSidebarWidth(clampSidebarWidth(event.clientX));
      } else {
        setInspectorWidth(clampInspectorWidth(window.innerWidth - event.clientX));
      }
    };
    const stopResize = () => setResizingWorkbenchPane(null);

    window.addEventListener("pointermove", resize);
    window.addEventListener("pointerup", stopResize);
    window.addEventListener("pointercancel", stopResize);
    document.body.classList.add("resizing-workbench-pane");

    return () => {
      window.removeEventListener("pointermove", resize);
      window.removeEventListener("pointerup", stopResize);
      window.removeEventListener("pointercancel", stopResize);
      document.body.classList.remove("resizing-workbench-pane");
    };
  }, [resizingWorkbenchPane]);

  useEffect(() => {
    if (!paletteOpen || paletteMode !== "file") {
      setFileSearchResults([]);
      setFileSearchLoading(false);
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      setFileSearchLoading(true);
      const params = new URLSearchParams({
        q: paletteQuery.trim(),
        limit: "40",
      });
      fetch(`/api/files?${params.toString()}`, {
        signal: controller.signal,
      })
        .then((response) => {
          if (!response.ok)
            throw new Error(`file search request failed: ${response.status}`);
          return response.json() as Promise<{
            results: FileSearchResult[];
          }>;
        })
        .then((result) => setFileSearchResults(result.results))
        .catch((err) => {
          if (err instanceof DOMException && err.name === "AbortError") return;
          setError(String(err));
        })
        .finally(() => {
          if (!controller.signal.aborted) setFileSearchLoading(false);
        });
    }, 120);

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [paletteMode, paletteOpen, paletteQuery]);

  useEffect(() => {
    const currentPaths = new Set(reviewChanges.map((change) => change.path));
    const newPaths = reviewChanges
      .map((change) => change.path)
      .filter((path) => !knownReviewPaths.current.has(path));

    for (const path of [...knownReviewPaths.current]) {
      if (!currentPaths.has(path)) knownReviewPaths.current.delete(path);
    }
    for (const path of newPaths) knownReviewPaths.current.add(path);

    setUnreadReviewPaths((paths) => [
      ...newPaths.reverse(),
      ...paths.filter(
        (path) => currentPaths.has(path) && !newPaths.includes(path),
      ),
    ]);
  }, [reviewChanges]);

  useEffect(() => {
    for (const change of reviewChanges.slice(0, 12)) {
      if (diffs[change.path] || loadingDiffs[change.path]) continue;
      void loadHeadDiff(change.path).catch((err) => setError(String(err)));
    }
  }, [reviewChanges]);

  useEffect(() => {
    const query = paletteQuery.trim();
    if (!paletteOpen || paletteMode !== "text" || !query) {
      setTextSearchResults([]);
      setTextSearchLoading(false);
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      setTextSearchLoading(true);
      const params = new URLSearchParams({ q: query, limit: "40" });
      fetch(`/api/search?${params.toString()}`, {
        signal: controller.signal,
      })
        .then((response) => {
          if (!response.ok)
            throw new Error(`search request failed: ${response.status}`);
          return response.json() as Promise<{
            results: TextSearchResult[];
          }>;
        })
        .then((result) => setTextSearchResults(result.results))
        .catch((err) => {
          if (err instanceof DOMException && err.name === "AbortError") return;
          setError(String(err));
        })
        .finally(() => {
          if (!controller.signal.aborted) setTextSearchLoading(false);
        });
    }, 180);

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [paletteMode, paletteOpen, paletteQuery]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (paletteOpen && paletteMode === "file") setPaletteOpen(false);
        else openPalette("file");
      }
      if (
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        event.key.toLowerCase() === "f"
      ) {
        event.preventDefault();
        if (paletteOpen && paletteMode === "text") setPaletteOpen(false);
        else openPalette("text");
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "d") {
        event.preventDefault();
        toggleHeadDiff();
      }
      if (
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        event.key.toLowerCase() === "u"
      ) {
        event.preventDefault();
        openLatestUnreadReviewFile();
      }
      if (event.key === "Escape") setPaletteOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    paletteMode,
    paletteOpen,
    selectedPath,
    diffEnabled,
    reviewChanges,
    unreadReviewPaths,
  ]);

  useEffect(() => {
    const events = new EventSource("/events");
    events.addEventListener("fs", (raw) => {
      const event = JSON.parse((raw as MessageEvent).data) as FsEvent;
      setLiveMetrics((metrics) => ({
        ...metrics,
        fsEventsReceived: metrics.fsEventsReceived + 1,
      }));
      setRecentEvents((items) => recordReviewEvent(items, event));
      markReviewPathUnread(event.path);

      if (event.type === "change" && event.path === selectedPath) {
        loadFile(event.path, layout.activePaneId, "preserve")
          .then(() =>
            setRefreshedFiles((items) => ({
              ...items,
              [event.path]: Date.now(),
            })),
          )
          .catch((err) => setError(String(err)));
      } else if (event.type === "change") {
        setOpenTabs((tabs) => markTabChanged(tabs, event.path));
      }

      if (event.type === "add" || event.type === "unlink") {
        const parentPath = parentDirectoryPath(event.path);
        const refresh = parentPath ? loadDirectory(parentPath) : loadTree();
        refresh.catch((err) => setError(String(err)));
      }
      scheduleGitReviewRefresh();
      if (diffEnabled) {
        scheduleDiffRefresh(event.path);
      }
    });
    return () => {
      events.close();
      if (gitRefreshTimer.current) window.clearTimeout(gitRefreshTimer.current);
      if (diffRefreshTimer.current)
        window.clearTimeout(diffRefreshTimer.current);
    };
  }, [selectedPath, layout.activePaneId, diffEnabled]);

  useEffect(() => {
    if (!manualDraggedTab) return;
    const clearManualDrag = () => {
      setManualDraggedTab(null);
      setDraggingTab(false);
      setDropTarget(null);
    };
    window.addEventListener("mouseup", clearManualDrag);
    return () => window.removeEventListener("mouseup", clearManualDrag);
  }, [manualDraggedTab]);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="logo" />
          pathlens
        </div>
        <span className="pathbar">
          {config?.root ?? "local workspace viewer"}
        </span>
        <button
          className="theme-button"
          aria-label={`Theme: ${themePreferenceLabel(themePreference)}`}
          title={`Theme: ${themePreferenceLabel(themePreference)}`}
          onClick={() =>
            setThemePreference((current) => nextThemePreference(current))
          }
        >
          {themePreferenceLabel(themePreference)}
        </button>
        <button className="command-button" onClick={() => openPalette("file")}>
          Quick open
          <kbd>Cmd K</kbd>
        </button>
        <button className="command-button" onClick={() => openPalette("text")}>
          Search
          <kbd>Cmd Shift F</kbd>
        </button>
      </header>

      <div
        className={
          inspectorVisible ? "workbench" : "workbench inspector-hidden"
        }
        style={
          {
            "--sidebar-width": `${sidebarWidth}px`,
            "--inspector-width": `${inspectorWidth}px`,
          } as CSSProperties
        }
      >
        <button
          className="workbench-resizer sidebar-resizer"
          type="button"
          aria-label="Resize sidebar"
          title="Resize sidebar"
          onPointerDown={(event) => {
            event.preventDefault();
            setResizingWorkbenchPane("sidebar");
          }}
          onDoubleClick={() => setSidebarWidth(defaultSidebarWidth)}
        />
        <aside className="sidebar">
          <div className="panel-title">
            <span>Explorer</span>
            <button
              className={treeChangedOnly ? "pill active" : "pill"}
              type="button"
              onClick={() => setTreeChangedOnly((value) => !value)}
            >
              {treeChangedOnly ? "changed" : "live"}
            </button>
          </div>
          {tree ? (
            <TreeSidebar
              nodes={sidebarNodes}
              selectedPath={selectedPath}
              changedPaths={changedPathSet}
              removedPaths={reviewState.removedPaths}
              loadingDirectoryPaths={loadingDirectoryPaths}
              onLoadDirectory={(path) => loadDirectory(path)}
              onSelect={(path) =>
                void loadFile(path, layout.activePaneId, "preview").catch(
                  (err) => setError(String(err)),
                )
              }
              onOpen={(path) =>
                void loadFile(path, layout.activePaneId, "normal").catch(
                  (err) => setError(String(err)),
                )
              }
            />
          ) : (
            <p className="muted">Loading tree...</p>
          )}
        </aside>

        <main className="main">
          <div className={`editor-grid ${draggingTab ? "dragging-tab" : ""}`}>
            {renderLayoutNode(layout.root)}
          </div>
        </main>

        {inspectorVisible ? (
          <>
            <button
              className="workbench-resizer inspector-resizer"
              type="button"
              aria-label="Resize inspector"
              title="Resize inspector"
              onPointerDown={(event) => {
                event.preventDefault();
                setResizingWorkbenchPane("inspector");
              }}
              onDoubleClick={() => setInspectorWidth(defaultInspectorWidth)}
            />
            <Inspector
              file={file}
              outline={outline}
              reviewChanges={reviewChanges}
              reviewDiffStats={reviewDiffStats}
              loadingReviewDiffs={loadingDiffs}
              unreadReviewPaths={unreadReviewPathSet}
              selectedCodeRange={
                file?.path ? (codeSelections[file.path] ?? null) : null
              }
              refreshedAt={file?.path ? refreshedFiles[file.path] : undefined}
              activePaneId={layout.activePaneId}
              onOutlineSelect={jumpToOutline}
              onOpenEventPath={(path) =>
                void loadFile(path, layout.activePaneId, "preview").catch(
                  (err) => setError(String(err)),
                )
              }
              onConfirmEventPath={(path) =>
                void loadFile(path, layout.activePaneId, "normal").catch(
                  (err) => setError(String(err)),
                )
              }
              onOpenNextChanged={() => openReviewQueueFile("next")}
              onOpenPreviousChanged={() => openReviewQueueFile("previous")}
              onOpenAllChanged={openAllChangedFiles}
              onTargetHoverChange={setInspectorTargetVisible}
              onRevealTarget={revealInspectorTarget}
            />
          </>
        ) : null}
      </div>

      <footer className="statusbar">
        <span>
          {openTabs.length} tabs · {reviewChanges.length} to review ·{" "}
          {tree?.nodes.length ?? 0} root entries
        </span>
        <span>
          {liveMetrics.fsEventsReceived} fs events · {liveMetrics.gitRefreshes}{" "}
          git refreshes
          {liveMetrics.lastGitRefreshMs !== null
            ? ` · git ${liveMetrics.lastGitRefreshMs}ms`
            : ""}
          {liveMetrics.diffRefreshes
            ? ` · ${liveMetrics.diffRefreshes} diff refreshes`
            : ""}
          {liveMetrics.lastDiffRefreshMs !== null
            ? ` · diff ${liveMetrics.lastDiffRefreshMs}ms`
            : ""}
          {liveMetrics.pendingGitRefresh || liveMetrics.pendingDiffPaths
            ? ` · pending ${liveMetrics.pendingGitRefresh ? "git" : ""}${liveMetrics.pendingDiffPaths ? ` diff:${liveMetrics.pendingDiffPaths}` : ""}`
            : ""}
        </span>
      </footer>

      <CommandPalette
        open={paletteOpen}
        mode={paletteMode}
        query={paletteQuery}
        fileResults={fileSearchResults}
        fileLoading={fileSearchLoading}
        textResults={textSearchResults}
        textLoading={textSearchLoading}
        onQueryChange={setPaletteQuery}
        onModeChange={(mode) => {
          setPaletteMode(mode);
          setPaletteQuery("");
        }}
        onClose={() => setPaletteOpen(false)}
        onOpenPath={openFromPalette}
      />
      {pendingRestoreSession ? (
        <RestoreSessionPrompt
          tabCount={pendingRestoreSession.openTabs.length}
          onRestoreAll={() => {
            applyWorkspaceSession(pendingRestoreSession);
            setPendingRestoreSession(null);
          }}
          onRestoreActive={() => {
            applyWorkspaceSession(
              restoreOnlyActiveWorkspaceTab(pendingRestoreSession),
            );
            setPendingRestoreSession(null);
          }}
          onSkip={() => setPendingRestoreSession(null)}
        />
      ) : null}
    </div>
  );

  function applyWorkspaceSession(restored: WorkspaceSessionState) {
    setOpenTabs(restored.openTabs);
    setLayout(restored.layout);
    setRecentFiles(restored.recentFiles);
    setInspectorVisible(restored.inspectorVisible);
    setSidebarWidth(clampSidebarWidth(restored.sidebarWidth ?? sidebarWidth));
    setInspectorWidth(
      clampInspectorWidth(restored.inspectorWidth ?? inspectorWidth),
    );
    setDiffEnabled(restored.diffEnabled ?? false);
    setDiffFocusByPath(restored.diffFocusByPath ?? {});
    void hydrateRestoredFiles(
      restored.layout.root,
      restored.diffEnabled ?? false,
    ).catch((err) => setError(String(err)));
  }

  function renderLayoutNode(node: EditorLayoutNode): ReactNode {
    if (node.kind === "split") {
      return (
        <div className={`editor-split ${node.direction}`} key={node.id}>
          {renderLayoutNode(node.first)}
          {renderLayoutNode(node.second)}
        </div>
      );
    }

    return renderEditorPane(node.pane);
  }

  function renderEditorPane(pane: EditorPane): ReactNode {
    const paneTabs = openTabs.filter((tab) => tab.paneId === pane.id);
    const paneFile = pane.activePath ? (files[pane.activePath] ?? null) : null;

    return (
      <section
        className={`${pane.id === layout.activePaneId ? "editor-pane active" : "editor-pane"} ${inspectorTargetVisible && pane.id === layout.activePaneId ? "inspector-target-visible" : ""}`}
        data-pane-id={pane.id}
        key={pane.id}
        onFocus={() =>
          setLayout((current) => ({ ...current, activePaneId: pane.id }))
        }
        onMouseDown={() =>
          setLayout((current) => ({ ...current, activePaneId: pane.id }))
        }
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null))
            setDropTarget(null);
        }}
      >
        <OpenTabs
          tabs={paneTabs}
          activePath={pane.activePath}
          paneId={pane.id}
          onActivate={(path) =>
            void loadFile(path, pane.id, "preserve").catch((err) =>
              setError(String(err)),
            )
          }
          onClose={(path) => closeTab(path, pane.id)}
          onPromote={(path) => promoteTab(path, pane.id)}
          onCloseOtherTabs={() => applyTabCleanup(closeOtherOpenTabs, pane.id)}
          onCloseTabsToRight={() => applyTabCleanup(closeTabsToRight, pane.id)}
          onCloseUnchangedTabs={() =>
            applyTabCleanup(closeUnchangedTabs, pane.id)
          }
          onClosePreviewTabs={() => applyTabCleanup(closePreviewTabs, pane.id)}
          onDropTab={moveTab}
          onDragStateChange={setDraggingTab}
          onManualDragStart={(payload) => {
            setManualDraggedTab(payload);
            setDraggingTab(true);
          }}
        />
        {pane.id === layout.activePaneId ? (
          <div className="pane-focus-badge">Inspector target</div>
        ) : null}
        <div className="viewer-pane">
          {error && pane.id === layout.activePaneId ? (
            <div className="error">{error}</div>
          ) : (
            <FileViewer
              key={paneFile?.path ?? "empty"}
              file={paneFile}
              allowHtmlScripts={config?.allowHtmlScripts ?? false}
              theme={resolvedTheme}
              selectedCodeRange={
                paneFile?.path ? (codeSelections[paneFile.path] ?? null) : null
              }
              viewerMode={
                paneFile
                  ? (viewerModes[paneFile.path] ?? defaultViewerMode(paneFile))
                  : undefined
              }
              diff={paneFile?.path ? (diffs[paneFile.path] ?? null) : null}
              diffLoading={
                paneFile?.path ? Boolean(loadingDiffs[paneFile.path]) : false
              }
              diffEnabled={
                paneFile ? diffEnabled && supportsDiffMode(paneFile) : false
              }
              diffFocusChanges={
                paneFile?.path ? Boolean(diffFocusByPath[paneFile.path]) : false
              }
              refreshedAt={
                paneFile?.path ? refreshedFiles[paneFile.path] : undefined
              }
              onCodeSelectionChange={(range) => {
                if (!paneFile?.path) return;
                setCodeSelections((items) => ({
                  ...items,
                  [paneFile.path]: range,
                }));
              }}
              onViewerModeChange={(mode) => {
                if (!paneFile?.path) return;
                setViewerModes((items) => ({
                  ...items,
                  [paneFile.path]: mode,
                }));
              }}
              onDiffToggle={() => {
                if (!paneFile?.path) return;
                toggleHeadDiff(paneFile.path);
              }}
              onDiffFocusChange={(focusChanges) => {
                if (!paneFile?.path) return;
                setDiffFocusByPath((items) => ({
                  ...items,
                  [paneFile.path]: focusChanges,
                }));
              }}
            />
          )}
        </div>
        <div
          aria-label="Split pane"
          className={`split-drop-zone ${dropTarget?.paneId === pane.id ? `active ${dropTarget.edge}` : ""}`}
          onDragOver={(event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
            setDropTarget({
              paneId: pane.id,
              edge: edgeForPoint(
                event.currentTarget,
                event.clientX,
                event.clientY,
              ),
            });
          }}
          onDrop={(event) => {
            event.preventDefault();
            event.stopPropagation();
            const dragged = readDraggedTab(event.dataTransfer);
            const edge = edgeForPoint(
              event.currentTarget,
              event.clientX,
              event.clientY,
            );
            setDraggingTab(false);
            setManualDraggedTab(null);
            setDropTarget(null);
            if (dragged) splitTab(dragged.path, dragged.paneId, pane.id, edge);
          }}
          onMouseUp={(event) => {
            if (!manualDraggedTab) return;
            event.preventDefault();
            event.stopPropagation();
            const edge = edgeForPoint(
              event.currentTarget,
              event.clientX,
              event.clientY,
            );
            const dragged = manualDraggedTab;
            setManualDraggedTab(null);
            setDraggingTab(false);
            setDropTarget(null);
            splitTab(dragged.path, dragged.paneId, pane.id, edge);
          }}
        />
      </section>
    );
  }
}

function RestoreSessionPrompt({
  tabCount,
  onRestoreAll,
  onRestoreActive,
  onSkip,
}: {
  tabCount: number;
  onRestoreAll: () => void;
  onRestoreActive: () => void;
  onSkip: () => void;
}) {
  return (
    <div className="restore-overlay" role="presentation">
      <section
        aria-label="Restore previous tabs"
        className="restore-prompt"
        role="dialog"
      >
        <strong>Restore previous tabs?</strong>
        <p>
          The last session had {tabCount} tabs. Choose how much of that
          workspace to bring back.
        </p>
        <div className="restore-actions">
          <button onClick={onRestoreAll} type="button">
            Restore all tabs
          </button>
          <button onClick={onRestoreActive} type="button">
            Restore active tab
          </button>
          <button onClick={onSkip} type="button">
            Start without tabs
          </button>
        </div>
      </section>
    </div>
  );
}

function edgeForPoint(
  target: HTMLElement,
  clientX: number,
  clientY: number,
): SplitEdge {
  const rect = target.getBoundingClientRect();
  const x = (clientX - rect.left) / rect.width;
  const y = (clientY - rect.top) / rect.height;
  if (x < 0.25) return "left";
  if (x > 0.75) return "right";
  return y < 0.5 ? "top" : "bottom";
}

function readStoredThemePreference(): ThemePreference {
  if (typeof window === "undefined") return "system";
  const stored = window.localStorage.getItem(themeStorageKey);
  return isThemePreference(stored) ? stored : "system";
}

function readStoredWorkspaceSession(
  root: string,
): StoredWorkspaceSessionV1 | null {
  if (typeof window === "undefined") return null;
  try {
    return parseWorkspaceSession(
      window.localStorage.getItem(workspaceSessionStorageKeyForRoot(root)),
    );
  } catch {
    return null;
  }
}

function writeStoredWorkspaceSession(session: StoredWorkspaceSessionV1) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      workspaceSessionStorageKeyForRoot(session.root),
      JSON.stringify(session),
    );
  } catch {
    // Storage can be unavailable in private or quota-limited browser contexts.
  }
}

function pruneStoredWorkspaceSessions(now = Date.now()) {
  if (typeof window === "undefined") return;
  const prefix = `${workspaceSessionStorageKey}:`;
  try {
    for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
      const key = window.localStorage.key(index);
      if (!key?.startsWith(prefix)) continue;
      const session = parseWorkspaceSession(window.localStorage.getItem(key));
      if (!session || now - session.updatedAt > workspaceSessionTtlMs) {
        window.localStorage.removeItem(key);
      }
    }
  } catch {
    // Best-effort cleanup only; persistence should never block the viewer.
  }
}

function readSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: light)").matches
    ? "light"
    : "dark";
}

const recentEventWindowMs = 5 * 60 * 1000;
