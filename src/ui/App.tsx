import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
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

export function App() {
  const [tree, setTree] = useState<TreeSnapshot | null>(null);
  const [config, setConfig] = useState<ViewerConfig | null>(null);
  const [layout, setLayout] = useState(initialEditorLayout);
  const [files, setFiles] = useState<Record<string, FilePayload>>({});
  const [openTabs, setOpenTabs] = useState<OpenTab[]>([]);
  const [recentFiles, setRecentFiles] = useState<RecentFile[]>([]);
  const [recentEvents, setRecentEvents] = useState<FsEvent[]>([]);
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

  const panes = useMemo(() => flattenPanes(layout), [layout]);
  const activePane =
    panes.find((pane) => pane.id === layout.activePaneId) ?? panes[0];
  const selectedPath = activePane?.activePath ?? null;
  const file = selectedPath ? (files[selectedPath] ?? null) : null;
  const resolvedTheme = resolveThemePreference(themePreference, systemTheme);

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
      }),
    );
  }, [config, workspaceSessionReady, openTabs, layout, recentFiles]);

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
      setRecentEvents((items) => [event, ...items].slice(0, 20));

      if (event.type === "change" && event.path === selectedPath) {
        loadFile(event.path, layout.activePaneId).catch((err) =>
          setError(String(err)),
        );
      } else if (event.type === "change") {
        setOpenTabs((tabs) => markTabChanged(tabs, event.path));
      }

      if (event.type === "add" || event.type === "unlink") {
        loadTree().catch((err) => setError(String(err)));
      }
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

      <div className="workbench">
        <aside className="sidebar">
          <div className="panel-title">
            <span>Explorer</span>
            <span className="pill">live</span>
          </div>
          {tree ? (
            <TreeSidebar
              nodes={tree.nodes}
              selectedPath={selectedPath}
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

        <Inspector
          file={file}
          outline={outline}
          events={recentEvents}
          activePaneId={layout.activePaneId}
          onOutlineSelect={jumpToOutline}
          onTargetHoverChange={setInspectorTargetVisible}
          onRevealTarget={revealInspectorTarget}
        />
      </div>

      <footer className="statusbar">
        <span>
          {openTabs.length} tabs · {recentEvents.length} recent events ·{" "}
          {tree?.nodes.length ?? 0} root entries
        </span>
        <span>localhost</span>
      </footer>

      <CommandPalette
        open={paletteOpen}
        query={paletteQuery}
        nodes={tree?.nodes ?? []}
        onQueryChange={setPaletteQuery}
        onClose={() => setPaletteOpen(false)}
        onOpenPath={openFromPalette}
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
