import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
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
import type { CommandActionId } from "./state/command-actions.js";
import {
  recordReviewEvent,
  summarizeReviewEvents,
  type ReviewEvent,
} from "./state/review-events.js";
import {
  closeOpenTab,
  markTabChanged,
  moveOpenTab,
  upsertOpenTab,
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
import { filterTreeToPaths, reviewArtifactResults } from "./state/files.js";
import {
  mergeReviewChanges,
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
  buildWorkspaceSession,
  collectFilePaths,
  parseWorkspaceSession,
  recordRecentFile,
  restoreWorkspaceSession,
  workspaceSessionStorageKey,
  workspaceSessionStorageKeyForRoot,
  workspaceSessionTtlMs,
  type RecentFile,
  type StoredWorkspaceSessionV1,
} from "./state/workspace-session.js";
import {
  defaultViewerMode,
  modeLabel,
  nextViewerMode,
  supportsSourceToggle,
  type ViewerMode,
} from "./state/viewer-mode.js";

export function App() {
  const [tree, setTree] = useState<TreeSnapshot | null>(null);
  const [config, setConfig] = useState<ViewerConfig | null>(null);
  const [layout, setLayout] = useState(initialEditorLayout);
  const [files, setFiles] = useState<Record<string, FilePayload>>({});
  const [openTabs, setOpenTabs] = useState<OpenTab[]>([]);
  const [closedTabs, setClosedTabs] = useState<OpenTab[]>([]);
  const [recentFiles, setRecentFiles] = useState<RecentFile[]>([]);
  const [recentEvents, setRecentEvents] = useState<ReviewEvent[]>([]);
  const [gitReview, setGitReview] = useState<GitChangeReviewState | null>(null);
  const [activeDiff, setActiveDiff] = useState<TextDiff | null>(null);
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
  const [paletteQuery, setPaletteQuery] = useState("");
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
  const [treeChangedOnly, setTreeChangedOnly] = useState(false);
  const [inspectorTargetVisible, setInspectorTargetVisible] = useState(false);
  const [workspaceSessionReady, setWorkspaceSessionReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadTree() {
    const response = await fetch("/api/tree");
    if (!response.ok)
      throw new Error(`tree request failed: ${response.status}`);
    setTree(await response.json());
  }

  async function loadConfig() {
    const response = await fetch("/api/config");
    if (!response.ok)
      throw new Error(`config request failed: ${response.status}`);
    setConfig(await response.json());
  }

  async function loadGitReview() {
    const response = await fetch("/api/changes");
    if (!response.ok)
      throw new Error(`changes request failed: ${response.status}`);
    setGitReview((await response.json()) as GitChangeReviewState);
  }

  async function showDiff(path: string) {
    const response = await fetch(`/api/diff?path=${encodeURIComponent(path)}`);
    if (!response.ok)
      throw new Error(`diff request failed: ${response.status}`);
    setActiveDiff((await response.json()) as TextDiff);
  }

  const panes = useMemo(() => flattenPanes(layout), [layout]);
  const activePane =
    panes.find((pane) => pane.id === layout.activePaneId) ?? panes[0];
  const selectedPath = activePane?.activePath ?? null;
  const file = selectedPath ? (files[selectedPath] ?? null) : null;
  const resolvedTheme = resolveThemePreference(themePreference, systemTheme);
  const reviewState = useMemo(
    () => summarizeReviewEvents(recentEvents),
    [recentEvents],
  );
  const reviewChanges = useMemo(
    () => mergeReviewChanges(reviewState, gitReview),
    [gitReview, reviewState],
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
  const reviewTargets = useMemo(
    () => reviewArtifactResults(tree?.nodes ?? []),
    [tree],
  );
  const activeViewerMode = file
    ? (viewerModes[file.path] ?? defaultViewerMode(file))
    : undefined;

  async function fetchFilePayload(path: string): Promise<FilePayload> {
    const response = await fetch(`/api/file?path=${encodeURIComponent(path)}`);
    if (!response.ok)
      throw new Error(`file request failed: ${response.status}`);
    return (await response.json()) as FilePayload;
  }

  async function loadFile(path: string, paneId = layout.activePaneId) {
    setLayout((current) => setPaneActivePath(current, paneId, path));
    setError(null);
    const payload = await fetchFilePayload(path);
    setFiles((items) => ({ ...items, [payload.path]: payload }));
    setOpenTabs((tabs) => upsertOpenTab(tabs, payload, paneId));
    setRecentFiles((items) => recordRecentFile(items, payload));
  }

  async function hydrateRestoredFiles(restoredLayout: EditorLayoutNode) {
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
  }

  function closeTab(path: string, paneId = layout.activePaneId) {
    const closed = openTabs.find(
      (tab) => tab.path === path && tab.paneId === paneId,
    );
    if (closed) {
      setClosedTabs((tabs) =>
        [
          closed,
          ...tabs.filter(
            (tab) =>
              !(tab.path === closed.path && tab.paneId === closed.paneId),
          ),
        ].slice(0, 12),
      );
    }
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
        void loadFile(result.nextActivePath, paneId).catch((err) =>
          setError(String(err)),
        );
      }
      return result.tabs;
    });
  }

  function openFromPalette(path: string) {
    setPaletteOpen(false);
    setPaletteQuery("");
    void loadFile(path).catch((err) => setError(String(err)));
  }

  function openAllChangedFiles() {
    for (const { path, status } of reviewChanges) {
      if (status === "deleted") continue;
      void loadFile(path).catch((err) => setError(String(err)));
    }
  }

  function openFirstChangedFile() {
    const firstRecentChanged = recentEvents.find(
      (item) =>
        (item.event.type === "change" ||
          (item.event.type === "add" && item.event.kind === "file")) &&
        reviewState.changedPaths.has(item.event.path),
    )?.event.path;
    const path =
      firstRecentChanged ??
      reviewChanges.find((change) => change.status !== "deleted")?.path;
    if (path) void loadFile(path).catch((err) => setError(String(err)));
  }

  function openFirstRecentFile() {
    const path = recentFiles[0]?.path;
    if (path) void loadFile(path).catch((err) => setError(String(err)));
  }

  function reopenLastClosedTab() {
    const tab = closedTabs[0];
    if (!tab) return;
    setClosedTabs((tabs) => tabs.slice(1));
    void loadFile(tab.path, tab.paneId).catch((err) => setError(String(err)));
  }

  function toggleActiveViewerMode() {
    const next = nextViewerMode(file, activeViewerMode);
    if (!file || !next) return;
    setViewerModes((items) => ({ ...items, [file.path]: next }));
  }

  function revealActiveInTree() {
    if (!selectedPath) return;
    setTreeChangedOnly(false);
    window.setTimeout(() => {
      const row = document.querySelector<HTMLElement>(
        `[data-tree-path="${cssEscape(selectedPath)}"]`,
      );
      row?.scrollIntoView({ block: "center", behavior: "smooth" });
      row?.focus();
    }, 0);
  }

  function focusOutline() {
    const outlineLink = document.querySelector<HTMLElement>(".outline a");
    outlineLink?.focus();
  }

  async function copyActiveLocalUrl() {
    if (!selectedPath) return;
    await copyToClipboard(localUrlForPath(selectedPath));
  }

  async function exportCurrentContext() {
    const context = [
      `root: ${config?.root ?? "unknown"}`,
      `active: ${selectedPath ?? "none"}`,
      `tabs: ${openTabs.map((tab) => `${tab.paneId}:${tab.path}`).join(", ") || "none"}`,
      `recent events: ${
        recentEvents
          .slice(0, 8)
          .map((item) => `${item.event.type}:${item.event.path}`)
          .join(", ") || "none"
      }`,
      `git changes: ${
        reviewChanges
          .slice(0, 12)
          .map((item) => `${item.status}:${item.path}`)
          .join(", ") || "none"
      }`,
    ].join("\n");
    await copyToClipboard(context);
  }

  function runCommandAction(id: CommandActionId) {
    if (id === "open-changed-file") openFirstChangedFile();
    else if (id === "show-diff" && selectedPath)
      void showDiff(selectedPath).catch((err) => setError(String(err)));
    else if (id === "reveal-in-tree") revealActiveInTree();
    else if (id === "toggle-source-rendered") toggleActiveViewerMode();
    else if (id === "copy-local-url")
      void copyActiveLocalUrl().catch((err) => setError(String(err)));
    else if (id === "focus-outline") focusOutline();
    else if (id === "toggle-inspector")
      setInspectorVisible((visible) => !visible);
    else if (id === "split-right" && selectedPath)
      splitTab(selectedPath, layout.activePaneId, layout.activePaneId, "right");
    else if (id === "close-tab" && selectedPath)
      closeTab(selectedPath, layout.activePaneId);
    else if (id === "reopen-last-closed-tab") reopenLastClosedTab();
    else if (id === "open-recent-file") openFirstRecentFile();
    else if (id === "show-keyboard-shortcuts") setPaletteQuery("");
    else if (id === "export-current-context")
      void exportCurrentContext().catch((err) => setError(String(err)));

    if (id !== "show-keyboard-shortcuts") setPaletteOpen(false);
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
      void loadFile(path, toPaneId).catch((err) => setError(String(err)));
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
      setOpenTabs((tabs) => upsertOpenTab(tabs, cached, targetPaneId));
    } else {
      void loadFile(path, targetPaneId).catch((err) => setError(String(err)));
    }
  }

  const outline = useMemo(() => {
    if (!file) return [];
    if (file.viewerKind === "html") return extractHtmlOutline(file.content);
    if (file.viewerKind !== "markdown") return [];
    return extractMarkdownOutline(file.content);
  }, [file]);

  const commandActions = useMemo(
    () => [
      {
        id: "open-changed-file" as const,
        label: "Open changed file",
        detail: `${reviewChanges.length} changed files`,
        keywords: ["review", "changed", "recent", "open"],
        disabled: reviewChanges.length === 0,
      },
      {
        id: "show-diff" as const,
        label: "Show diff",
        detail: selectedPath ?? "No active file",
        keywords: ["review", "diff", "change", "git"],
        disabled:
          !selectedPath ||
          !reviewChanges.some((change) => change.path === selectedPath),
      },
      {
        id: "reveal-in-tree" as const,
        label: "Reveal in tree",
        detail: selectedPath ?? "No active file",
        keywords: ["tree", "sidebar", "show"],
        disabled: !selectedPath,
      },
      {
        id: "toggle-source-rendered" as const,
        label: "Toggle source/rendered",
        detail:
          file && supportsSourceToggle(file)
            ? `Current: ${modeLabel(activeViewerMode ?? defaultViewerMode(file))}`
            : "Markdown and HTML only",
        keywords: ["source", "rendered", "preview", "mode"],
        disabled: !supportsSourceToggle(file),
      },
      {
        id: "copy-local-url" as const,
        label: "Copy local URL",
        detail: selectedPath ?? "No active file",
        keywords: ["copy", "url", "link"],
        disabled: !selectedPath,
      },
      {
        id: "focus-outline" as const,
        label: "Focus outline",
        detail: outline.length ? `${outline.length} headings` : "No outline",
        keywords: ["outline", "headings", "inspector"],
        disabled: outline.length === 0 || !inspectorVisible,
      },
      {
        id: "toggle-inspector" as const,
        label: inspectorVisible ? "Hide inspector" : "Show inspector",
        detail: "Toggle right inspector",
        keywords: ["inspector", "right", "metadata"],
      },
      {
        id: "split-right" as const,
        label: "Split right",
        detail: selectedPath ?? "No active file",
        keywords: ["split", "pane", "compare"],
        disabled: !selectedPath,
      },
      {
        id: "close-tab" as const,
        label: "Close tab",
        detail: selectedPath ?? "No active tab",
        keywords: ["close", "tab"],
        disabled: !selectedPath,
      },
      {
        id: "reopen-last-closed-tab" as const,
        label: "Reopen last closed tab",
        detail: closedTabs[0]?.path ?? "No closed tab",
        keywords: ["reopen", "closed", "tab"],
        disabled: closedTabs.length === 0,
      },
      {
        id: "open-recent-file" as const,
        label: "Open recent file",
        detail: recentFiles[0]?.path ?? "No recent file",
        keywords: ["recent", "history", "open"],
        disabled: recentFiles.length === 0,
      },
      {
        id: "show-keyboard-shortcuts" as const,
        label: "Show keyboard shortcuts",
        detail: "Cmd/Ctrl K, Enter, Esc, line selection",
        keywords: ["keyboard", "shortcuts", "help"],
      },
      {
        id: "export-current-context" as const,
        label: "Export current context",
        detail: "Copy root, active file, tabs, and recent events",
        keywords: ["copy", "context", "export", "review"],
      },
    ],
    [
      activeViewerMode,
      closedTabs,
      file,
      inspectorVisible,
      outline.length,
      recentEvents,
      recentFiles,
      reviewChanges,
      selectedPath,
    ],
  );

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
      collectFilePaths(tree.nodes),
    );

    if (restored) {
      setOpenTabs(restored.openTabs);
      setLayout(restored.layout);
      setRecentFiles(restored.recentFiles);
      setInspectorVisible(restored.inspectorVisible);
      void hydrateRestoredFiles(restored.layout.root).catch((err) =>
        setError(String(err)),
      );
    }

    setWorkspaceSessionReady(true);
  }, [config, tree, workspaceSessionReady]);

  useEffect(() => {
    if (!config || !workspaceSessionReady) return;
    writeStoredWorkspaceSession(
      buildWorkspaceSession(config.root, {
        openTabs,
        layout,
        recentFiles,
        inspectorVisible,
      }),
    );
  }, [
    config,
    workspaceSessionReady,
    openTabs,
    layout,
    recentFiles,
    inspectorVisible,
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
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((value) => !value);
      }
      if (event.key === "Escape") setPaletteOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    const events = new EventSource("/events");
    events.addEventListener("fs", (raw) => {
      const event = JSON.parse((raw as MessageEvent).data) as FsEvent;
      setRecentEvents((items) => recordReviewEvent(items, event));

      if (event.type === "change" && event.path === selectedPath) {
        loadFile(event.path, layout.activePaneId)
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
        loadTree().catch((err) => setError(String(err)));
      }
      loadGitReview().catch((err) => setError(String(err)));
    });
    return () => events.close();
  }, [selectedPath, layout.activePaneId]);

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
        <button className="command-button" onClick={() => setPaletteOpen(true)}>
          Cmd/Ctrl K
        </button>
      </header>

      <div
        className={
          inspectorVisible ? "workbench" : "workbench inspector-hidden"
        }
      >
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
              onSelect={(path) =>
                void loadFile(path).catch((err) => setError(String(err)))
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
          <Inspector
            file={file}
            outline={outline}
            events={recentEvents}
            gitReview={gitReview}
            reviewChanges={reviewChanges}
            activeDiff={activeDiff}
            reviewTargets={reviewTargets}
            selectedCodeRange={
              file?.path ? (codeSelections[file.path] ?? null) : null
            }
            refreshedAt={file?.path ? refreshedFiles[file.path] : undefined}
            activePaneId={layout.activePaneId}
            onOutlineSelect={jumpToOutline}
            onOpenEventPath={(path) =>
              void loadFile(path).catch((err) => setError(String(err)))
            }
            onOpenAllChanged={openAllChangedFiles}
            onShowDiff={(path) =>
              void showDiff(path).catch((err) => setError(String(err)))
            }
            onTargetHoverChange={setInspectorTargetVisible}
            onRevealTarget={revealInspectorTarget}
          />
        ) : null}
      </div>

      <footer className="statusbar">
        <span>
          {openTabs.length} tabs · {recentEvents.length} recent events ·{" "}
          {reviewChanges.length} changed · {tree?.nodes.length ?? 0} root
          entries
        </span>
        <span>localhost</span>
      </footer>

      <CommandPalette
        open={paletteOpen}
        query={paletteQuery}
        nodes={tree?.nodes ?? []}
        actions={commandActions}
        onQueryChange={setPaletteQuery}
        onClose={() => setPaletteOpen(false)}
        onOpenPath={openFromPalette}
        onRunAction={runCommandAction}
      />
    </div>
  );

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
            void loadFile(path, pane.id).catch((err) => setError(String(err)))
          }
          onClose={(path) => closeTab(path, pane.id)}
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

function localUrlForPath(path: string): string {
  const encoded = path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return new URL(`/preview/raw/${encoded}`, window.location.href).toString();
}

async function copyToClipboard(value: string): Promise<void> {
  await navigator.clipboard.writeText(value);
}

function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && CSS.escape) return CSS.escape(value);
  return value.replace(/["\\]/g, "\\$&");
}
