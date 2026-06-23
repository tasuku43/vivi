import { expect, it, vi } from "vitest";
import type { FilePayload, FsNode } from "../ui/src/domain/fs-node.js";
import type { FileSearchResult } from "../ui/src/domain/search.js";
import { iconForPath, languageForPath } from "../ui/src/state/file-icons.js";
import {
  clampPaletteSelection,
  movePaletteSelection,
  paletteModeKeyboardAction,
} from "../ui/src/state/command-palette.js";
import {
  filterTreeToPaths,
  fuzzyFileResults,
  isPathKnownMissing,
  parentDirectoryPath,
  replaceDirectoryChildren,
  reviewArtifactResults,
  unloadedAncestorDirectoryPaths,
} from "../ui/src/state/files.js";
import {
  buildDiffStat,
  buildSideBySideDiffRows,
  changeStatusLabel,
  diffStatusLabel,
  latestUnreadReviewPath,
  mergeReviewChanges,
  nextReviewQueuePath,
  parseUnifiedDiff,
  reviewQueueSourceLabel,
} from "../ui/src/state/git-review.js";
import {
  gitReviewPollMs,
  shouldLoadInitialGitReview,
  shouldPollGitReview,
  shouldStartGitReviewPolling,
  startGitReviewPolling,
} from "../ui/src/state/git-review-refresh.js";
import {
  buildFileSearchItems,
  buildRecentFileSearchItems,
  buildTextSearchItems,
  textSearchPreviewSegments,
} from "../ui/src/state/search-palette.js";
import {
  currentThreadLifecycleShortcutStatus,
  reviewCommandActions,
} from "../ui/src/state/review-command-actions.js";
import {
  fileLocationSegments,
  fileLocationSummary,
} from "../ui/src/state/file-location.js";
import {
  activeTextSearchResult,
  codeSelectionForTextSearchTarget,
  moveTextSearchSession,
  textSearchPositionLabel,
  textSearchSessionForSelection,
  viewerModeForTextSearchTarget,
} from "../ui/src/state/search-navigation.js";
import {
  flattenPanes,
  initialEditorLayout,
  setPaneActivePath,
  splitEditorPane,
} from "../ui/src/state/editor-layout.js";
import {
  closeOtherOpenTabs,
  closeOpenTab,
  closePreviewTabs,
  closeTabsToRight,
  closeUnchangedTabs,
  markTabChanged,
  markTabLoaded,
  markTabRemoved,
  moveOpenTab,
  promoteOpenTab,
  upsertOpenTab,
} from "../ui/src/state/tabs.js";
import { tabKeyboardAction } from "../ui/src/state/tab-navigation.js";
import {
  activePanePaths,
  decideLiveRefresh,
  shouldApplyLiveRefresh,
} from "../ui/src/state/live-refresh.js";
import {
  isThemePreference,
  nextThemePreference,
  resolveThemePreference,
  themePreferenceLabel,
} from "../ui/src/state/theme.js";
import {
  clampInspectorWidth,
  clampSidebarWidth,
  compactSidebarWidth,
  defaultInspectorWidth,
  defaultSidebarWidth,
  isInspectorEffectivelyVisible,
  maxInspectorWidth,
  maxSidebarWidth,
  minInspectorWidth,
  minSidebarWidth,
  shouldCollapseInspector,
} from "../ui/src/state/workbench-layout.js";
import { summarizeWorkspaceStatus } from "../ui/src/state/workspace-status.js";
import {
  buildWorkspaceSession,
  collectFilePaths,
  parseWorkspaceSession,
  recordRecentFile,
  restoreOnlyActiveWorkspaceTab,
  restorePromptTabThreshold,
  restoreWorkspaceSession,
  shouldPromptForWorkspaceSessionRestore,
  workspaceSessionStorageKeyForRoot,
  workspaceSessionTtlMs,
} from "../ui/src/state/workspace-session.js";
import {
  defaultViewerMode,
  diffSupportForFile,
  diffUnsupportedViewerKinds,
  nextViewerMode,
  supportsDiffMode,
  supportsSourceToggle,
} from "../ui/src/state/viewer-mode.js";
import { summarizeReviewEvents } from "../ui/src/state/review-events.js";
import { keyboardShortcutAction } from "../ui/src/state/shortcuts.js";
import {
  activityNeedsHumanAttention,
  buildReviewQueueItems,
  latestUnreadReviewItemPath,
  nextReviewQueueItemPath,
  pinActiveReviewQueueItem,
  reviewQueuePosition,
  summarizeReviewQueue,
} from "../ui/src/state/review-queue.js";
import {
  agentReplyNavigationTargets,
  commentActivityThreadTargets,
  commentInboxEntryState,
  commentInboxEntryStatus,
  commentInboxOpenState,
  commentNavigationTarget,
  countAttentionCommentThreads,
  draftCommentNavigationTargets,
  firstRelevantThreadForReviewItem,
  latestUnreadActivityTarget,
  moveReviewNavigationTarget,
  openThreadNavigationTargets,
  reviewQueueOpenTransition,
} from "../ui/src/state/review-navigation.js";
import {
  boundedVisibleTreeRows,
  countTreeNodes,
  ensureVisibleAncestors,
  initialExpandedPaths,
  visibleTreeRows,
} from "../ui/src/state/tree-expansion.js";
import {
  explorerFilterLabel,
  explorerFilterText,
} from "../ui/src/state/tree-filter.js";
import { treeKeyboardAction } from "../ui/src/state/tree-navigation.js";

it("opens, updates, and marks tabs by path", () => {
  const tabs = upsertOpenTab([], {
    path: "README.md",
    viewerKind: "markdown",
    encoding: "utf8",
    content: "# Hello",
    etag: "sha256:test",
    size: 7,
    mtimeMs: 1,
  });

  expect(tabs).toEqual([
    { path: "README.md", viewerKind: "markdown", paneId: "main" },
  ]);
  expect(markTabChanged(tabs, "README.md")).toEqual([
    {
      path: "README.md",
      viewerKind: "markdown",
      paneId: "main",
      changed: true,
      removed: false,
    },
  ]);
  expect(markTabRemoved(tabs, "README.md")).toEqual([
    {
      path: "README.md",
      viewerKind: "markdown",
      paneId: "main",
      changed: false,
      removed: true,
    },
  ]);
});

it("can show the same file in two split panes", () => {
  const file: FilePayload = {
    path: "README.md",
    viewerKind: "markdown",
    encoding: "utf8",
    content: "# Hello",
    etag: "sha256:test",
    size: 7,
    mtimeMs: 1,
  };

  const tabs = upsertOpenTab(upsertOpenTab([], file, "main"), file, "side");

  expect(tabs).toEqual([
    { path: "README.md", viewerKind: "markdown", paneId: "main" },
    { path: "README.md", viewerKind: "markdown", paneId: "side" },
  ]);
});

it("prepares Review Queue opens by clearing stale viewer state", () => {
  const layout = setPaneActivePath(initialEditorLayout, "main", "README.md");
  const transition = reviewQueueOpenTransition({
    layout,
    paneId: "main",
    path: "src/app.ts",
  });

  expect(flattenPanes(transition.layout)).toEqual([
    { id: "main", activePath: "src/app.ts" },
  ]);
  expect(transition.layout.activePaneId).toBe("main");
  expect(transition.activeCommentId).toBeNull();
  expect(transition.activeCommentRect).toBeNull();
  expect(transition.commentsPanelOpen).toBe(false);
  expect(transition.paletteOpen).toBe(false);
  expect(transition.shortcutHelpOpen).toBe(false);
  expect(transition.error).toBeNull();
});

it("reuses one preview tab per pane while preserving normal tabs", () => {
  const first: FilePayload = {
    path: "README.md",
    viewerKind: "markdown",
    encoding: "utf8",
    content: "# Hello",
    etag: "sha256:a",
    size: 7,
    mtimeMs: 1,
  };
  const second: FilePayload = {
    ...first,
    path: "docs/guide.md",
    etag: "sha256:b",
  };
  const normal: FilePayload = {
    ...first,
    path: "src/app.ts",
    viewerKind: "code",
    etag: "sha256:c",
  };

  const tabs = upsertOpenTab(
    upsertOpenTab(
      upsertOpenTab([], normal, "main", "normal"),
      first,
      "main",
      "preview",
    ),
    second,
    "main",
    "preview",
  );

  expect(tabs).toEqual([
    { path: "src/app.ts", viewerKind: "code", paneId: "main" },
    {
      path: "docs/guide.md",
      viewerKind: "markdown",
      paneId: "main",
      removed: false,
      isPreview: true,
    },
  ]);
});

it("promotes a preview tab into a stable normal tab", () => {
  const tabs = promoteOpenTab(
    [
      {
        path: "README.md",
        viewerKind: "markdown",
        paneId: "main",
        isPreview: true,
      },
    ],
    "README.md",
  );

  expect(tabs).toEqual([
    {
      path: "README.md",
      viewerKind: "markdown",
      paneId: "main",
      isPreview: false,
    },
  ]);
});

it("maps tab keyboard navigation across open files", () => {
  const tabs = [
    { path: "a.md", viewerKind: "markdown", paneId: "main" },
    { path: "b.html", viewerKind: "html", paneId: "main" },
    { path: "c.ts", viewerKind: "code", paneId: "main" },
  ];

  expect(tabKeyboardAction(tabs, "b.html", "ArrowRight")).toEqual({
    kind: "activate",
    path: "c.ts",
  });
  expect(tabKeyboardAction(tabs, "b.html", "ArrowLeft")).toEqual({
    kind: "activate",
    path: "a.md",
  });
  expect(tabKeyboardAction(tabs, "c.ts", "ArrowRight")).toEqual({
    kind: "activate",
    path: "a.md",
  });
  expect(tabKeyboardAction(tabs, null, "End")).toEqual({
    kind: "activate",
    path: "c.ts",
  });
  expect(tabKeyboardAction(tabs, "b.html", "x")).toBeNull();
});

it("clears stale tab flags when a file is reopened", () => {
  const file: FilePayload = {
    path: "README.md",
    viewerKind: "markdown",
    encoding: "utf8",
    content: "# Hello",
    etag: "sha256:test",
    size: 7,
    mtimeMs: 1,
  };

  expect(
    upsertOpenTab(
      [
        {
          path: "README.md",
          viewerKind: "markdown",
          paneId: "main",
          changed: true,
          removed: true,
          isPreview: true,
        },
      ],
      file,
      "main",
      "normal",
    ),
  ).toEqual([
    {
      path: "README.md",
      viewerKind: "markdown",
      paneId: "main",
      changed: false,
      removed: false,
      isPreview: false,
    },
  ]);
});

it("routes watcher change events to active file reloads and inactive markers", () => {
  const activePaths = activePanePaths([
    { id: "main", activePath: "README.md" },
    { id: "side", activePath: "docs/guide.md" },
  ]);

  expect(
    decideLiveRefresh(
      { type: "change", path: "README.md", version: 2 },
      activePaths,
    ),
  ).toEqual({
    reloadPath: "README.md",
    stalePath: null,
    removedPath: null,
    treeRefreshParentPath: null,
  });

  expect(
    decideLiveRefresh(
      { type: "change", path: "src/app.ts", version: 3 },
      activePaths,
    ),
  ).toEqual({
    reloadPath: null,
    stalePath: "src/app.ts",
    removedPath: null,
    treeRefreshParentPath: null,
  });
});

it("reloads active tabs for add events that may represent a first observed change", () => {
  const activePaths = activePanePaths([
    { id: "main", activePath: "README.md" },
  ]);

  expect(
    decideLiveRefresh(
      { type: "add", path: "README.md", kind: "file", version: 2 },
      activePaths,
    ),
  ).toEqual({
    reloadPath: "README.md",
    stalePath: null,
    removedPath: null,
    treeRefreshParentPath: "",
  });
});

it("keeps tree refresh decisions separate from file content reloads", () => {
  expect(
    decideLiveRefresh(
      { type: "add", path: "docs/new.md", kind: "file", version: 2 },
      new Set(["README.md"]),
    ),
  ).toEqual({
    reloadPath: null,
    stalePath: "docs/new.md",
    removedPath: null,
    treeRefreshParentPath: "docs",
  });

  expect(
    decideLiveRefresh(
      { type: "unlink", path: "README.md", kind: "file", version: 3 },
      new Set(["README.md"]),
    ),
  ).toEqual({
    reloadPath: null,
    stalePath: null,
    removedPath: "README.md",
    treeRefreshParentPath: "",
  });
});

it("clears changed and removed tab markers after live file reload", () => {
  const reloaded: FilePayload = {
    path: "README.md",
    viewerKind: "markdown",
    encoding: "utf8",
    content: "# Reloaded",
    etag: "sha256:reloaded",
    size: 10,
    mtimeMs: 2,
  };

  expect(
    markTabLoaded(
      [
        {
          path: "README.md",
          viewerKind: "text",
          paneId: "main",
          changed: true,
          removed: true,
        },
        {
          path: "README.md",
          viewerKind: "text",
          paneId: "side",
          changed: true,
        },
        { path: "src/app.ts", viewerKind: "code", paneId: "main" },
      ],
      reloaded,
    ),
  ).toEqual([
    {
      path: "README.md",
      viewerKind: "markdown",
      paneId: "main",
      changed: false,
      removed: false,
    },
    {
      path: "README.md",
      viewerKind: "markdown",
      paneId: "side",
      changed: false,
      removed: false,
    },
    { path: "src/app.ts", viewerKind: "code", paneId: "main" },
  ]);
});

it("applies only the newest live refresh payload for rapid repeated saves", () => {
  const versions: Record<string, number> = { "README.md": 1 };
  const firstRequest = versions["README.md"];
  versions["README.md"] = 2;
  const secondRequest = versions["README.md"];

  expect(shouldApplyLiveRefresh(versions, "README.md", firstRequest)).toBe(
    false,
  );
  expect(shouldApplyLiveRefresh(versions, "README.md", secondRequest)).toBe(
    true,
  );
});

it("does not mark the active viewer stale for unrelated watcher events", () => {
  const tabs = [
    { path: "README.md", viewerKind: "markdown", paneId: "main" },
    { path: "docs/guide.md", viewerKind: "markdown", paneId: "main" },
  ];
  const decision = decideLiveRefresh(
    { type: "change", path: "docs/guide.md", version: 2 },
    new Set(["README.md"]),
  );

  expect(decision.reloadPath).toBeNull();
  expect(markTabChanged(tabs, decision.stalePath ?? "")).toEqual([
    { path: "README.md", viewerKind: "markdown", paneId: "main" },
    {
      path: "docs/guide.md",
      viewerKind: "markdown",
      paneId: "main",
      changed: true,
      removed: false,
    },
  ]);
});

it("maps common file paths to IDE-style icons and highlight languages", () => {
  expect(iconForPath("README.md")).toBe("📘");
  expect(iconForPath("index.html")).toBe("🌐");
  expect(iconForPath("assets/logo.svg")).toBe("🖼️");
  expect(iconForPath("data/sample.json")).toBe("{}");
  expect(iconForPath("config.yaml", "code")).toBe("YAML");
  expect(languageForPath("config.yaml", "code")).toBe("yaml");
  expect(iconForPath("src/app.ts", "code")).toBe("TS");
  expect(languageForPath("src/app.ts", "code")).toBe("typescript");
  expect(iconForPath("data/sample.json", "json")).toBe("{}");
  expect(languageForPath("data/sample.json", "json")).toBe("json");
  expect(iconForPath("Dockerfile", "code")).toBe("DOCK");
  expect(languageForPath("Dockerfile", "code")).toBe("dockerfile");
  expect(languageForPath("arch/x86/Makefile", "code")).toBe("makefile");
  expect(languageForPath("kernel/Kconfig.debug", "code")).toBe("text");
  expect(languageForPath("drivers/of/base.c", "code")).toBe("c");
  expect(languageForPath("include/linux/compiler_types.h", "code")).toBe("c");
  expect(languageForPath("arch/arm64/boot/dts/vendor/board.dts", "code")).toBe(
    "text",
  );
  expect(languageForPath("scripts/checkpatch.pl", "code")).toBe("perl");
  expect(languageForPath("scripts/verify_builtin_ranges.awk", "code")).toBe(
    "awk",
  );
  expect(languageForPath(".gitignore", "code")).toBe("text");
  expect(languageForPath(".dockerignore", "code")).toBe("text");
  expect(languageForPath(".clang-format", "code")).toBe("yaml");
  expect(languageForPath(".editorconfig", "code")).toBe("ini");
  expect(languageForPath("LICENSE", "code")).toBe("text");
  expect(languageForPath("go.mod", "code")).toBe("text");
  expect(languageForPath("vite.config.mjs", "code")).toBe("javascript");
  expect(languageForPath("tsconfig.node.mts", "code")).toBe("typescript");
});

it("compacts workbench panes for narrow viewports", () => {
  expect(shouldCollapseInspector(1040)).toBe(true);
  expect(shouldCollapseInspector(1200)).toBe(false);
  expect(compactSidebarWidth(320, 390)).toBe(179);
  expect(compactSidebarWidth(320, 900)).toBe(320);
  expect(compactSidebarWidth(Number.NaN, 390)).toBe(179);
  expect(isInspectorEffectivelyVisible(true, false, 764)).toBe(false);
  expect(isInspectorEffectivelyVisible(true, true, 764)).toBe(true);
  expect(isInspectorEffectivelyVisible(false, true, 1200)).toBe(false);
  expect(isInspectorEffectivelyVisible(true, false, 1200)).toBe(true);
});

it("summarizes workspace status as a human-facing bottom bar", () => {
  const summary = summarizeWorkspaceStatus({
    tree: {
      root: "/workspace",
      version: 1,
      nodes: [],
      stats: {
        durationMs: 7,
        scannedDirectories: 3,
        scannedFiles: 42,
        returnedNodes: 12,
      },
    },
    openTabCount: 3,
    reviewFileCount: 4,
    openThreadCount: 2,
    draftCount: 1,
    connectionStatus: "connected",
    activeFile: {
      path: "docs/brief.md",
      isPreview: true,
      viewerMode: "rendered",
    },
    metrics: {
      fsEventsReceived: 0,
      gitRefreshes: 1,
      diffRefreshes: 0,
      lastGitRefreshMs: 18,
      lastDiffRefreshMs: null,
      pendingGitRefresh: false,
      pendingDiffPaths: 0,
    },
  });

  expect(summary.workspace).toBe("Watching 42 files · 3 tabs open");
  expect(summary.activeFile).toBe("brief.md · preview · rendered");
  expect(summary.review).toBe("4 files to review · 2 threads open · 1 draft");
  expect(summary.server).toBe("Live · waiting for file changes");
  expect(summary.serverTone).toBe("live");
  expect(summary.detail).toBe("1 review refresh · last review 18ms");
});

it("builds a compact file location model for the central viewer", () => {
  expect(fileLocationSegments("docs/brief/intro.md")).toEqual([
    { label: "docs", path: "docs", kind: "directory" },
    { label: "brief", path: "docs/brief", kind: "directory" },
    { label: "intro.md", path: "docs/brief/intro.md", kind: "file" },
  ]);
  expect(fileLocationSummary("docs/brief/intro.md")).toBe("brief / intro.md");
  expect(fileLocationSummary("README.md")).toBe("README.md");
});

it("summarizes pending server work without exposing raw refresh logs", () => {
  const summary = summarizeWorkspaceStatus({
    tree: {
      root: "/workspace",
      version: 1,
      nodes: [
        {
          id: "README.md",
          path: "README.md",
          name: "README.md",
          kind: "file",
          parentPath: null,
        },
      ],
    },
    openTabCount: 1,
    reviewFileCount: 1,
    openThreadCount: 0,
    draftCount: 0,
    connectionStatus: "connected",
    activeFile: {
      path: "src/app.ts",
      changed: true,
      diffEnabled: true,
      isPreview: false,
      removed: true,
      viewerMode: "source",
    },
    metrics: {
      fsEventsReceived: 2,
      gitRefreshes: 3,
      diffRefreshes: 2,
      lastGitRefreshMs: 12,
      lastDiffRefreshMs: 9,
      pendingGitRefresh: true,
      pendingDiffPaths: 2,
    },
  });

  expect(summary.workspace).toBe("1 root entry · 1 tab open");
  expect(summary.activeFile).toBe(
    "app.ts · kept · source · HEAD diff · changed · removed",
  );
  expect(summary.review).toBe("1 file to review · 0 threads open");
  expect(summary.server).toBe("Updating review + 2 diffs");
  expect(summary.serverTone).toBe("pending");
  expect(summary.detail).toBe(
    "3 review refreshes · last review 12ms · 2 diff refreshes · last diff 9ms",
  );
});

it("summarizes missing comment sources without reporting them as kept tabs", () => {
  const summary = summarizeWorkspaceStatus({
    tree: null,
    openTabCount: 1,
    reviewFileCount: 0,
    openThreadCount: 2,
    draftCount: 0,
    connectionStatus: "connected",
    activeFile: {
      path: "README.md",
      sourceMissing: true,
      isPreview: false,
      viewerMode: "source",
    },
    metrics: {
      fsEventsReceived: 0,
      gitRefreshes: 0,
      diffRefreshes: 0,
      lastGitRefreshMs: null,
      lastDiffRefreshMs: null,
      pendingGitRefresh: false,
      pendingDiffPaths: 0,
    },
  });

  expect(summary.activeFile).toBe("README.md · source missing");
});

it("summarizes connecting and disconnected workspace event streams", () => {
  const base = {
    tree: null,
    openTabCount: 0,
    reviewFileCount: 0,
    openThreadCount: 0,
    draftCount: 0,
    metrics: {
      fsEventsReceived: 0,
      gitRefreshes: 0,
      diffRefreshes: 0,
      lastGitRefreshMs: null,
      lastDiffRefreshMs: null,
      pendingGitRefresh: false,
      pendingDiffPaths: 0,
    },
  };

  expect(
    summarizeWorkspaceStatus({
      ...base,
      connectionStatus: "connecting",
    }),
  ).toMatchObject({
    server: "Connecting · waiting for events",
    serverTone: "pending",
  });
  expect(
    summarizeWorkspaceStatus({
      ...base,
      connectionStatus: "disconnected",
    }),
  ).toMatchObject({
    server: "Disconnected · live updates paused",
    serverTone: "offline",
  });
});

it("selects a neighboring tab when the active tab closes", () => {
  const result = closeOpenTab(
    [
      { path: "a.md", viewerKind: "markdown" },
      { path: "b.html", viewerKind: "html" },
      { path: "c.ts", viewerKind: "code" },
    ].map((tab) => ({ ...tab, paneId: "main" })),
    "b.html",
    "b.html",
  );

  expect(result.tabs.map((tab) => tab.path)).toEqual(["a.md", "c.ts"]);
  expect(result.nextActivePath).toBe("a.md");
});

it("maps workspace keyboard shortcuts to app actions", () => {
  const command = {
    metaKey: true,
    ctrlKey: false,
    shiftKey: false,
  };

  expect(keyboardShortcutAction({ ...command, key: "k" })).toBe("quick-open");
  expect(
    keyboardShortcutAction({
      ...command,
      key: "k",
      metaKey: false,
      ctrlKey: true,
    }),
  ).toBe("quick-open");
  expect(keyboardShortcutAction({ ...command, key: "F", shiftKey: true })).toBe(
    "search-text",
  );
  expect(keyboardShortcutAction({ ...command, key: "d" })).toBe("toggle-diff");
  expect(keyboardShortcutAction({ ...command, key: "e" })).toBe(
    "toggle-source",
  );
  expect(keyboardShortcutAction({ ...command, key: "b" })).toBe(
    "toggle-sidebar",
  );
  expect(keyboardShortcutAction({ ...command, key: "\\", shiftKey: true })).toBe(
    "toggle-inspector",
  );
  expect(keyboardShortcutAction({ ...command, key: "i" })).toBe(
    "focus-current-inline-thread",
  );
  expect(keyboardShortcutAction({ ...command, key: "Enter", shiftKey: true })).toBe(
    "toggle-current-thread-status",
  );
  expect(
    keyboardShortcutAction({ ...command, key: "Backspace", shiftKey: true }),
  ).toBe("archive-current-thread");
  expect(keyboardShortcutAction({ ...command, key: "C", shiftKey: true })).toBe(
    "focus-comments-panel",
  );
  expect(keyboardShortcutAction({ ...command, key: "U", shiftKey: true })).toBe(
    "open-latest-unread",
  );
  expect(keyboardShortcutAction({ ...command, key: "J", shiftKey: true })).toBe(
    "open-next-review",
  );
  expect(keyboardShortcutAction({ ...command, key: "K", shiftKey: true })).toBe(
    "open-previous-review",
  );
  expect(keyboardShortcutAction({ ...command, key: "]" })).toBe(
    "open-next-thread",
  );
  expect(keyboardShortcutAction({ ...command, key: "[" })).toBe(
    "open-previous-thread",
  );
  expect(keyboardShortcutAction({ ...command, key: "g" })).toBe(
    "open-next-search-result",
  );
  expect(keyboardShortcutAction({ ...command, key: "G", shiftKey: true })).toBe(
    "open-previous-search-result",
  );
  expect(keyboardShortcutAction({ ...command, key: "R", shiftKey: true })).toBe(
    null,
  );
  expect(keyboardShortcutAction({ ...command, key: "w" })).toBe(
    "close-active-tab",
  );
  expect(keyboardShortcutAction({ ...command, key: "/" })).toBe(
    "toggle-shortcuts",
  );
  expect(
    keyboardShortcutAction({
      ...command,
      key: "/",
      metaKey: false,
      ctrlKey: true,
    }),
  ).toBe("toggle-shortcuts");
  expect(
    keyboardShortcutAction({
      ...command,
      key: "/",
      altKey: true,
    }),
  ).toBeNull();
  expect(
    keyboardShortcutAction({
      key: "Escape",
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
    }),
  ).toBe("dismiss-overlays");
});

it("summarizes the Explorer filter with review-path context", () => {
  expect(explorerFilterText({ active: false, reviewPathCount: 0 })).toBe(
    "live",
  );
  expect(explorerFilterText({ active: false, reviewPathCount: 3 })).toBe(
    "live 3",
  );
  expect(explorerFilterText({ active: true, reviewPathCount: 3 })).toBe(
    "changed 3",
  );
  expect(
    explorerFilterText({
      active: false,
      reviewLoading: true,
      reviewPathCount: 0,
    }),
  ).toBe("live ...");
  expect(
    explorerFilterText({
      active: true,
      reviewLoading: true,
      reviewPathCount: 0,
    }),
  ).toBe("changed ...");
  expect(explorerFilterLabel({ active: false, reviewPathCount: 1 })).toBe(
    "Showing the live tree, 1 review path available",
  );
  expect(explorerFilterLabel({ active: true, reviewPathCount: 3 })).toBe(
    "Showing changed and review paths only, 3 review paths",
  );
  expect(
    explorerFilterLabel({
      active: false,
      reviewLoading: true,
      reviewPathCount: 0,
    }),
  ).toBe("Showing the live tree while review paths load");
  expect(
    explorerFilterLabel({
      active: true,
      reviewLoading: true,
      reviewPathCount: 0,
    }),
  ).toBe("Showing changed and review paths while review paths load");
});

it("closes other tabs while keeping the active tab in the pane", () => {
  const result = closeOtherOpenTabs(
    [
      { path: "a.md", viewerKind: "markdown", paneId: "main" },
      { path: "b.html", viewerKind: "html", paneId: "main" },
      { path: "c.ts", viewerKind: "code", paneId: "main" },
      { path: "side.md", viewerKind: "markdown", paneId: "side" },
    ],
    "b.html",
  );

  expect(result.tabs).toEqual([
    { path: "b.html", viewerKind: "html", paneId: "main" },
    { path: "side.md", viewerKind: "markdown", paneId: "side" },
  ]);
  expect(result.nextActivePath).toBe("b.html");
});

it("closes tabs to the right of the active tab in the pane", () => {
  const result = closeTabsToRight(
    [
      { path: "a.md", viewerKind: "markdown", paneId: "main" },
      { path: "b.html", viewerKind: "html", paneId: "main" },
      { path: "c.ts", viewerKind: "code", paneId: "main" },
      { path: "side.md", viewerKind: "markdown", paneId: "side" },
    ],
    "b.html",
  );

  expect(result.tabs).toEqual([
    { path: "a.md", viewerKind: "markdown", paneId: "main" },
    { path: "b.html", viewerKind: "html", paneId: "main" },
    { path: "side.md", viewerKind: "markdown", paneId: "side" },
  ]);
});

it("closes unchanged tabs without closing changed tabs", () => {
  const result = closeUnchangedTabs(
    [
      { path: "a.md", viewerKind: "markdown", paneId: "main" },
      { path: "b.html", viewerKind: "html", paneId: "main", changed: true },
      { path: "c.ts", viewerKind: "code", paneId: "main" },
    ],
    "a.md",
  );

  expect(result.tabs).toEqual([
    { path: "b.html", viewerKind: "html", paneId: "main", changed: true },
  ]);
  expect(result.nextActivePath).toBe("b.html");
});

it("closes only preview tabs in the active pane", () => {
  const result = closePreviewTabs(
    [
      {
        path: "a.md",
        viewerKind: "markdown",
        paneId: "main",
        isPreview: true,
      },
      { path: "b.html", viewerKind: "html", paneId: "main" },
      {
        path: "side.md",
        viewerKind: "markdown",
        paneId: "side",
        isPreview: true,
      },
    ],
    "a.md",
  );

  expect(result.tabs).toEqual([
    { path: "b.html", viewerKind: "html", paneId: "main" },
    {
      path: "side.md",
      viewerKind: "markdown",
      paneId: "side",
      isPreview: true,
    },
  ]);
  expect(result.nextActivePath).toBe("b.html");
});

it("moves tabs between editor panes", () => {
  const tabs = [
    { path: "a.md", viewerKind: "markdown", paneId: "main" },
    { path: "b.yaml", viewerKind: "code", paneId: "main" },
    { path: "c.html", viewerKind: "html", paneId: "side" },
  ];

  expect(moveOpenTab(tabs, "b.yaml", "main", "side", "c.html")).toEqual([
    { path: "a.md", viewerKind: "markdown", paneId: "main" },
    { path: "b.yaml", viewerKind: "code", paneId: "side" },
    { path: "c.html", viewerKind: "html", paneId: "side" },
  ]);
});

it("splits editor panes horizontally or vertically", () => {
  const active = setPaneActivePath(initialEditorLayout, "main", "README.md");
  const split = splitEditorPane(active, "main", "vertical", "right");

  expect(split.root.kind).toBe("split");
  expect(split.activePaneId).toBe("pane-1");
  expect(flattenPanes(split)).toEqual([
    { id: "main", activePath: "README.md" },
    { id: "pane-1", activePath: "README.md" },
  ]);
});

it("recursively splits panes beyond two editor groups", () => {
  let layout = setPaneActivePath(initialEditorLayout, "main", "README.md");
  for (const edge of ["right", "bottom", "right", "bottom", "left"] as const) {
    layout = splitEditorPane(
      layout,
      layout.activePaneId,
      edge === "left" || edge === "right" ? "vertical" : "horizontal",
      edge,
    );
  }

  expect(flattenPanes(layout)).toHaveLength(6);
  expect(flattenPanes(layout).map((pane) => pane.id)).toEqual([
    "main",
    "pane-1",
    "pane-2",
    "pane-3",
    "pane-5",
    "pane-4",
  ]);
  expect(layout.activePaneId).toBe("pane-5");
});

it("fuzzy-selects files by path subsequence", () => {
  const nodes: FsNode[] = [
    {
      id: "docs",
      path: "docs",
      name: "docs",
      kind: "directory",
      parentPath: null,
      children: [
        {
          id: "docs/architecture.md",
          path: "docs/architecture.md",
          name: "architecture.md",
          kind: "file",
          parentPath: "docs",
          viewerKind: "markdown",
        },
        {
          id: "docs/security.md",
          path: "docs/security.md",
          name: "security.md",
          kind: "file",
          parentPath: "docs",
          viewerKind: "markdown",
        },
      ],
    },
  ];

  expect(fuzzyFileResults(nodes, "arch").map((file) => file.path)).toEqual([
    "docs/architecture.md",
  ]);
  expect(fuzzyFileResults(nodes, "secu")[0]?.path).toBe("docs/security.md");
});

it("replaces loaded directory children in a lazy tree", () => {
  const nodes: FsNode[] = [
    {
      id: "docs",
      path: "docs",
      name: "docs",
      kind: "directory",
      parentPath: null,
      childrenLoaded: false,
    },
  ];

  expect(
    replaceDirectoryChildren(nodes, "docs", [
      {
        id: "docs/guide.md",
        path: "docs/guide.md",
        name: "guide.md",
        kind: "file",
        parentPath: "docs",
        viewerKind: "markdown",
      },
    ]),
  ).toEqual([
    {
      ...nodes[0],
      childrenLoaded: true,
      children: [
        {
          id: "docs/guide.md",
          path: "docs/guide.md",
          name: "guide.md",
          kind: "file",
          parentPath: "docs",
          viewerKind: "markdown",
        },
      ],
    },
  ]);
  expect(parentDirectoryPath("docs/guide.md")).toBe("docs");
  expect(parentDirectoryPath("README.md")).toBe("");
});

it("only treats paths as missing when the loaded tree proves absence", () => {
  const nodes: FsNode[] = [
    {
      id: "README",
      path: "README",
      name: "README",
      kind: "file",
      parentPath: null,
      viewerKind: "text",
    },
    {
      id: "net",
      path: "net",
      name: "net",
      kind: "directory",
      parentPath: null,
      childrenLoaded: false,
    },
    {
      id: "docs",
      path: "docs",
      name: "docs",
      kind: "directory",
      parentPath: null,
      childrenLoaded: true,
      children: [
        {
          id: "docs/guide.md",
          path: "docs/guide.md",
          name: "guide.md",
          kind: "file",
          parentPath: "docs",
          viewerKind: "markdown",
        },
      ],
    },
  ];

  expect(isPathKnownMissing(nodes, "README.md")).toBe(true);
  expect(isPathKnownMissing(nodes, "README")).toBe(false);
  expect(isPathKnownMissing(nodes, "docs/guide.md")).toBe(false);
  expect(isPathKnownMissing(nodes, "docs/missing.md")).toBe(true);
  expect(isPathKnownMissing(nodes, "net/netfilter/xt_DSCP.c")).toBe(false);
});

it("does not auto-expand unloaded lazy directories", () => {
  const expanded = initialExpandedPaths([
    {
      id: "src",
      path: "src",
      name: "src",
      kind: "directory",
      parentPath: null,
      childrenLoaded: false,
    },
  ]);

  expect(expanded.has("src")).toBe(false);
});

it("finds the next unloaded ancestor needed to reveal lazy paths", () => {
  const nodes: FsNode[] = [
    {
      id: "net",
      path: "net",
      name: "net",
      kind: "directory",
      parentPath: null,
      childrenLoaded: true,
      children: [
        {
          id: "net/sched",
          path: "net/sched",
          name: "sched",
          kind: "directory",
          parentPath: "net",
          childrenLoaded: false,
        },
      ],
    },
  ];

  expect(
    unloadedAncestorDirectoryPaths(nodes, ["net/sched/act_api.c"]),
  ).toEqual(["net/sched"]);
  expect(
    unloadedAncestorDirectoryPaths(
      nodes,
      ["net/sched/act_api.c"],
      new Set(["net/sched"]),
    ),
  ).toEqual([]);
});

it("moves command palette selection with keyboard wrapping", () => {
  expect(clampPaletteSelection(0, 0)).toBe(-1);
  expect(clampPaletteSelection(8, 3)).toBe(2);
  expect(movePaletteSelection(0, 3, 1)).toBe(1);
  expect(movePaletteSelection(2, 3, 1)).toBe(0);
  expect(movePaletteSelection(0, 3, -1)).toBe(2);
  expect(movePaletteSelection(-1, 3, 1)).toBe(1);
});

it("maps command palette mode tabs with keyboard navigation", () => {
  expect(paletteModeKeyboardAction(["file", "text"], "file", "ArrowRight")).toBe(
    "text",
  );
  expect(paletteModeKeyboardAction(["file", "text"], "file", "ArrowLeft")).toBe(
    "text",
  );
  expect(
    paletteModeKeyboardAction(["file", "text", "action"], "text", "End"),
  ).toBe("action");
  expect(
    paletteModeKeyboardAction(["file", "text", "action"], "action", "Home"),
  ).toBe("file");
  expect(paletteModeKeyboardAction(["file", "text"], "text", "ArrowDown")).toBe(
    null,
  );
});

it("uses HEAD changes as the Review Queue when Git is available", () => {
  const reviewEvents = [
    {
      id: "1",
      event: { type: "change" as const, path: "README.md", version: 2 },
      receivedAt: 100,
    },
    {
      id: "2",
      event: {
        type: "unlink" as const,
        path: "old.log",
        kind: "file" as const,
        version: 3,
      },
      receivedAt: 101,
    },
    {
      id: "3",
      event: {
        type: "unlink" as const,
        path: "docs/old.md",
        kind: "file" as const,
        version: 4,
      },
      receivedAt: 200,
    },
    {
      id: "4",
      event: {
        type: "add" as const,
        path: "docs/new.md",
        kind: "file" as const,
        version: 5,
      },
      receivedAt: 700,
    },
  ];
  const merged = mergeReviewChanges(summarizeReviewEvents(reviewEvents), {
    available: true,
    changes: [
      { path: "reports/new.csv", status: "added" },
      { path: "src/app.ts", status: "modified" },
      { path: "README.md", status: "modified" },
      { path: "docs/guide.md", status: "modified" },
    ],
  });

  expect(merged).toEqual([
    { path: "reports/new.csv", status: "added", source: "git" },
    { path: "docs/guide.md", status: "modified", source: "git" },
    { path: "README.md", status: "modified", source: "git" },
    { path: "src/app.ts", status: "modified", source: "git" },
  ]);
  expect(changeStatusLabel("renamed")).toBe("renamed");
  expect(reviewQueueSourceLabel("git")).toBe("HEAD diff");
  expect(
    diffStatusLabel({
      path: "README.md",
      status: "available",
      baseLabel: "HEAD",
      compareLabel: "working tree",
      content: "diff",
    }),
  ).toBe("HEAD -> working tree");
});

it("falls back to deduplicated watcher paths when Git review is unavailable", () => {
  const reviewEvents = [
    {
      id: "1",
      event: { type: "change" as const, path: "README.md", version: 2 },
      receivedAt: 100,
    },
    {
      id: "2",
      event: { type: "change" as const, path: "README.md", version: 3 },
      receivedAt: 200,
    },
    {
      id: "3",
      event: {
        type: "add" as const,
        path: "src/new.ts",
        kind: "file" as const,
        version: 4,
      },
      receivedAt: 300,
    },
  ];

  expect(mergeReviewChanges(summarizeReviewEvents(reviewEvents), null)).toEqual(
    [
      { path: "README.md", status: "modified", source: "watcher" },
      { path: "src/new.ts", status: "added", source: "watcher" },
    ],
  );
  expect(reviewQueueSourceLabel("watcher")).toBe("local change");
});

it("polls Git review while visible so Docker mounts can recover without watcher events", () => {
  let handler: (() => void) | null = null;
  let cleared = false;
  const timer = {
    setInterval(callback: () => void, timeout: number) {
      expect(timeout).toBe(gitReviewPollMs);
      handler = callback;
      return 7;
    },
    clearInterval(id: number) {
      expect(id).toBe(7);
      cleared = true;
      handler = null;
    },
  };
  const scheduleRefresh = vi.fn();
  const visibility: { visibilityState: DocumentVisibilityState } = {
    visibilityState: "visible",
  };
  const stop = startGitReviewPolling({
    timer,
    visibility,
    shouldRefresh: () => true,
    scheduleRefresh,
  });
  const runPoll = () => {
    if (!handler) throw new Error("poll handler was not registered");
    handler();
  };

  runPoll();
  expect(scheduleRefresh).toHaveBeenCalledTimes(1);

  visibility.visibilityState = "hidden";
  runPoll();
  expect(scheduleRefresh).toHaveBeenCalledTimes(1);

  visibility.visibilityState = "visible";
  runPoll();
  expect(scheduleRefresh).toHaveBeenCalledTimes(2);

  stop();
  expect(cleared).toBe(true);
  expect(handler).toBeNull();
  expect(scheduleRefresh).toHaveBeenCalledTimes(2);
});

it("retries slow unavailable Git review workspaces after the cooldown", () => {
  let handler: (() => void) | null = null;
  const timer = {
    setInterval(callback: () => void) {
      handler = callback;
      return 9;
    },
    clearInterval() {},
  };
  let gitReview = null as ReturnType<typeof unavailableGitReview> | null;
  let nowMs = 0;
  let lastAttemptMs: number | undefined;
  const scheduleRefresh = vi.fn(() => {
    lastAttemptMs = nowMs;
    gitReview = unavailableGitReview();
  });
  startGitReviewPolling({
    timer,
    shouldRefresh: () =>
      shouldPollGitReview(gitReview, {
        lastAttemptMs,
        nowMs,
        retryAfterMs: 30_000,
      }),
    scheduleRefresh,
  });
  const runPoll = () => {
    if (!handler) throw new Error("poll handler was not registered");
    handler();
  };

  runPoll();
  expect(scheduleRefresh).toHaveBeenCalledTimes(1);

  for (let index = 0; index < 20; index += 1) runPoll();
  expect(scheduleRefresh).toHaveBeenCalledTimes(1);

  nowMs = 29_999;
  runPoll();
  expect(scheduleRefresh).toHaveBeenCalledTimes(1);

  nowMs = 30_000;
  runPoll();
  expect(scheduleRefresh).toHaveBeenCalledTimes(2);
});

it("does not poll partial Git review results after untracked status times out", () => {
  expect(
    shouldPollGitReview({
      available: true,
      reason: "Git untracked scan timed out; showing tracked changes only.",
      changes: [{ path: "README.md", status: "modified" }],
    }),
  ).toBe(false);
});

it("waits for the file tree before requesting the initial Git review", () => {
  expect(shouldLoadInitialGitReview(false, false)).toBe(false);
  expect(shouldLoadInitialGitReview(true, true)).toBe(false);
  expect(shouldLoadInitialGitReview(true, false)).toBe(true);
});

it("waits for the initial Git review result before starting polling", () => {
  expect(shouldStartGitReviewPolling(null)).toBe(false);
  expect(
    shouldStartGitReviewPolling({
      available: true,
      changes: [],
    }),
  ).toBe(true);
});

function unavailableGitReview() {
  return {
    available: false,
    reason: "Git command timed out while reading this workspace.",
    changes: [],
  };
}

it("clears watcher-backed Review Queue items once Git reports no changes", () => {
  const reviewEvents = [
    {
      id: "1",
      event: { type: "change" as const, path: "README.md", version: 2 },
      receivedAt: 100,
    },
  ];

  expect(
    mergeReviewChanges(summarizeReviewEvents(reviewEvents), {
      available: true,
      changes: [],
    }),
  ).toEqual([]);
});

it("selects next and previous Review Queue paths without opening deletions", () => {
  const changes = [
    { path: "a.md", status: "modified" as const, source: "git" as const },
    { path: "b.md", status: "deleted" as const, source: "git" as const },
    { path: "c.md", status: "added" as const, source: "git" as const },
  ];

  expect(nextReviewQueuePath(changes, null, "next")).toBe("a.md");
  expect(nextReviewQueuePath(changes, "a.md", "next")).toBe("c.md");
  expect(nextReviewQueuePath(changes, "a.md", "previous")).toBe("c.md");
  expect(nextReviewQueuePath(changes, "missing.md", "previous")).toBe("c.md");
});

it("summarizes unified diff additions and deletions for review rows", () => {
  expect(
    buildDiffStat({
      path: "README.md",
      status: "available",
      baseLabel: "HEAD",
      compareLabel: "working tree",
      content: [
        "diff --git a/README.md b/README.md",
        "--- a/README.md",
        "+++ b/README.md",
        "@@ -1,2 +1,3 @@",
        " unchanged",
        "-old",
        "+new",
        "+extra",
      ].join("\n"),
    }),
  ).toEqual({ additions: 2, deletions: 1, metadataOnly: false });
  expect(
    buildDiffStat({
      path: "notes/mode-only.md",
      status: "available",
      baseLabel: "HEAD",
      compareLabel: "working tree",
      content: [
        "diff --git a/notes/mode-only.md b/notes/mode-only.md",
        "old mode 100644",
        "new mode 100755",
      ].join("\n"),
    }),
  ).toEqual({ additions: 0, deletions: 0, metadataOnly: true });
  expect(
    buildDiffStat({
      path: "image.png",
      status: "binary",
      baseLabel: "HEAD",
      compareLabel: "working tree",
      content: "",
    }),
  ).toBeNull();
});

it("selects the latest unread review file while skipping deletions", () => {
  const changes = [
    { path: "a.md", status: "modified" as const, source: "git" as const },
    { path: "b.md", status: "deleted" as const, source: "git" as const },
    { path: "c.ts", status: "added" as const, source: "git" as const },
  ];

  expect(latestUnreadReviewPath(changes, ["b.md", "c.ts", "a.md"])).toBe(
    "c.ts",
  );
  expect(latestUnreadReviewPath(changes, ["b.md"])).toBeNull();
});

it("builds an agent-aware queue from changes and authoritative open threads", () => {
  const comments = [
    {
      ...makeReviewComment("open-1", "docs/agent.md", "open"),
      threadId: "thread-open",
    },
    {
      ...makeReviewComment("reply-1", "docs/agent.md", "open"),
      threadId: "thread-open",
      updatedAt: "2026-06-20T00:01:00.000Z",
    },
    {
      ...makeReviewComment("resolved-1", "docs/history.md", "resolved"),
      threadId: "thread-resolved",
    },
    {
      ...makeReviewComment("archived-1", "docs/archive.md", "archived"),
      threadId: "thread-archived",
    },
  ];
  const items = buildReviewQueueItems(
    [{ path: "src/app.ts", status: "modified", source: "git" }],
    comments,
    {
      "thread-open": {
        inline: ["Codex replied 1m ago"],
        timeline: [
          {
            id: "activity-1",
            threadId: "thread-open",
            type: "comment_added",
            actor: { id: "codex:1", kind: "codex" },
            createdAt: "2026-06-20T00:02:00.000Z",
          },
        ],
      },
    },
    new Set(["src/app.ts"]),
  );

  expect(items.map((item) => item.path)).toEqual([
    "docs/agent.md",
    "src/app.ts",
  ]);
  expect(items[0]).toMatchObject({
    change: null,
    threadCounts: { open: 1, resolved: 0, archived: 0 },
    commentCount: 2,
    unread: false,
  });
  expect(items[0]?.latestActivity?.type).toBe("comment_added");
  expect(summarizeReviewQueue(items)).toEqual({
    total: 2,
    seen: 1,
    unread: 1,
    openThreads: 1,
    filesWithOpenThreads: 1,
  });
});

it("hides stale comment-only paths while keeping git review paths", () => {
  const comments = [
    {
      ...makeReviewComment("stale-1", "README.md", "open"),
      threadId: "thread-stale",
    },
    {
      ...makeReviewComment("live-1", "docs/agent.md", "open"),
      threadId: "thread-live",
    },
    {
      ...makeReviewComment("deleted-1", "docs/deleted.md", "open"),
      threadId: "thread-deleted",
    },
  ];
  const items = buildReviewQueueItems(
    [
      {
        path: "docs/deleted.md",
        status: "deleted",
        source: "git",
      },
    ],
    comments,
    {},
    new Set(),
    { knownMissingPaths: new Set(["README.md", "docs/deleted.md"]) },
  );

  expect(items.map((item) => item.path).sort()).toEqual([
    "docs/agent.md",
    "docs/deleted.md",
  ]);
  expect(items.find((item) => item.path === "README.md")).toBeUndefined();
  expect(items.find((item) => item.path === "docs/deleted.md")).toMatchObject({
    change: { status: "deleted" },
    threadCounts: { open: 1, resolved: 0, archived: 0 },
  });
});

it("navigates the prioritized work queue and keeps read receipts low-noise", () => {
  const items = buildReviewQueueItems(
    [
      { path: "deleted.md", status: "deleted", source: "git" },
      { path: "src/app.ts", status: "modified", source: "git" },
    ],
    [makeReviewComment("open-1", "README.md", "open")],
    {},
    new Set(["README.md", "src/app.ts"]),
  );
  expect(nextReviewQueueItemPath(items, null, "next")).toBe("README.md");
  expect(nextReviewQueueItemPath(items, "README.md", "next")).toBe(
    "src/app.ts",
  );
  expect(latestUnreadReviewItemPath(items)).toBe("README.md");
  expect(reviewQueuePosition(items, "src/app.ts")).toMatchObject({
    activePath: "src/app.ts",
    activeIndex: 1,
    reviewableTotal: 2,
  });
  expect(reviewQueuePosition(items, "deleted.md")).toMatchObject({
    activePath: null,
    activeIndex: -1,
    reviewableTotal: 2,
  });
  expect(
    pinActiveReviewQueueItem(items, "src/app.ts").map((item) => item.path),
  ).toEqual(["src/app.ts", "README.md", "deleted.md"]);
  expect(
    activityNeedsHumanAttention({
      id: "read-1",
      threadId: "thread-1",
      type: "thread_read",
      actor: { id: "codex:1", kind: "codex" },
      createdAt: "2026-06-20T00:00:00.000Z",
    }),
  ).toBe(false);
  expect(
    activityNeedsHumanAttention({
      id: "reply-1",
      threadId: "thread-1",
      type: "comment_added",
      actor: { id: "codex:1", kind: "codex" },
      createdAt: "2026-06-20T00:01:00.000Z",
    }),
  ).toBe(true);
});

it("builds review navigation targets without changing thread lifecycle state", () => {
  const comments = [
    {
      ...makeReviewComment("open-1", "docs/a.md", "open"),
      threadId: "thread-a",
      reviewBatchId: "batch-1",
      anchor: {
        surface: "source" as const,
        canonical: { path: "docs/a.md", lineStart: 4 },
      },
    },
    {
      ...makeReviewComment("reply-1", "docs/a.md", "open"),
      threadId: "thread-a",
      source: "codex" as const,
      updatedAt: "2026-06-20T00:03:00.000Z",
      anchor: {
        surface: "source" as const,
        canonical: { path: "docs/a.md", lineStart: 4 },
      },
    },
    makeReviewComment("resolved-1", "docs/b.md", "resolved"),
    {
      ...makeReviewComment("missing-1", "README.md", "open"),
      threadId: "thread-missing-source",
      anchor: {
        surface: "source" as const,
        canonical: { path: "README.md", lineStart: 1 },
      },
    },
  ];
  const drafts = [
    {
      id: "draft-1",
      path: "docs/c.md",
      viewerKind: "markdown" as const,
      anchor: {
        surface: "rendered" as const,
        canonical: { path: "docs/c.md", lineStart: 2 },
      },
      body: "Draft before publish",
      createdAt: "2026-06-20T00:01:00.000Z",
      updatedAt: "2026-06-20T00:01:00.000Z",
    },
    {
      id: "draft-2",
      path: "docs/d.md",
      viewerKind: "text" as const,
      anchor: {
        surface: "diff" as const,
        canonical: { path: "docs/d.md", lineStart: 7 },
        diff: {
          path: "docs/d.md",
          base: "HEAD",
          ref: "working-tree",
          hunkId: "hunk-1",
          side: "new" as const,
          newLineStart: 7,
        },
      },
      body: "Draft in diff",
      createdAt: "2026-06-20T00:02:00.000Z",
      updatedAt: "2026-06-20T00:02:00.000Z",
    },
  ];

  const openTargets = openThreadNavigationTargets(comments);
  expect(openTargets).toHaveLength(2);
  expect(openTargets[0]).toMatchObject({
    threadId: "thread-a",
    commentId: "open-1",
    path: "docs/a.md",
    surface: "source",
  });
  expect(openTargets[1]).toMatchObject({
    threadId: "thread-missing-source",
    commentId: "missing-1",
    path: "README.md",
    surface: "source",
  });
  expect(
    summarizeWorkspaceStatus({
      tree: null,
      openTabCount: 0,
      reviewFileCount: 13,
      openThreadCount: openTargets.length,
      draftCount: 0,
      connectionStatus: "connected",
      activeFile: null,
      metrics: {
        fsEventsReceived: 0,
        gitRefreshes: 0,
        diffRefreshes: 0,
        lastGitRefreshMs: null,
        lastDiffRefreshMs: null,
        pendingGitRefresh: false,
        pendingDiffPaths: 0,
      },
    }).review,
  ).toBe("13 files to review · 2 threads open");
  expect(
    openThreadNavigationTargets(comments, { reviewBatchId: "batch-1" }),
  ).toHaveLength(1);
  expect(draftCommentNavigationTargets(drafts)[0]).toMatchObject({
    draftId: "draft-1",
    commentId: "draft:draft-1",
    surface: "rendered",
  });
  expect(draftCommentNavigationTargets(drafts)[1]).toMatchObject({
    draftId: "draft-2",
    commentId: "draft:draft-2",
    surface: "diff",
  });
  expect(agentReplyNavigationTargets(comments)[0]).toMatchObject({
    threadId: "thread-a",
    commentId: "reply-1",
  });
  expect(commentNavigationTarget(comments[0]!)).toMatchObject({
    id: "comment:open-1",
    threadId: "thread-a",
    commentId: "open-1",
    path: "docs/a.md",
    surface: "source",
    label: "Source comment in a.md",
  });
  expect(
    moveReviewNavigationTarget(openTargets, { path: "docs/z.md" }, "next"),
  ).toBe(openTargets[0]);
});

it("builds contextual review command palette actions", () => {
  const activeComment = {
    ...makeReviewComment("open-1", "docs/a.md", "open"),
    anchor: {
      surface: "source" as const,
      canonical: { path: "docs/a.md", lineStart: 4 },
    },
  };

  expect(
    reviewCommandActions({
      activeComment,
      attentionThreadCount: 2,
      canToggleDiff: true,
      diffEnabled: false,
      openThreadTargetCount: 3,
      reviewItemCount: 4,
      unreadReviewCount: 1,
    }),
  ).toMatchObject([
    {
      id: "return-current-stop",
      label: "Return to current stop",
      detail: "docs/a.md · L4",
      shortcut: "Cmd/Ctrl I",
    },
    {
      id: "toggle-current-thread-status",
      label: "Resolve current stop",
      detail: "docs/a.md · L4",
      shortcut: "Cmd/Ctrl Shift Enter",
    },
    {
      id: "archive-current-thread",
      label: "Archive current stop",
      detail: "docs/a.md · L4",
      shortcut: "Cmd/Ctrl Shift Backspace",
    },
    {
      id: "open-comments",
      label: "Open attention inbox",
      detail: "2 attention threads",
      shortcut: "Cmd/Ctrl Shift C",
    },
    {
      id: "open-latest-unread",
      label: "Open next unseen item",
      shortcut: "Cmd/Ctrl Shift U",
    },
    {
      id: "open-next-review",
      label: "Next review item",
      shortcut: "Cmd/Ctrl Shift J",
    },
    {
      id: "focus-review-queue",
      label: "Focus Review Queue",
    },
    {
      id: "open-next-thread",
      label: "Next open thread",
      shortcut: "Cmd/Ctrl ]",
    },
    {
      id: "open-previous-thread",
      label: "Previous open thread",
      shortcut: "Cmd/Ctrl [",
    },
    {
      id: "toggle-diff",
      label: "Show diff from HEAD",
      shortcut: "Cmd/Ctrl D",
    },
  ]);

  expect(
    reviewCommandActions({
      activeComment: null,
      attentionThreadCount: 0,
      canToggleDiff: false,
      diffEnabled: false,
      openThreadTargetCount: 0,
      reviewItemCount: 0,
      unreadReviewCount: 0,
    }),
  ).toEqual([]);
  expect(
    reviewCommandActions({
      activeComment: makeReviewComment("resolved-1", "docs/a.md", "resolved"),
      attentionThreadCount: 0,
      canToggleDiff: false,
      diffEnabled: false,
      openThreadTargetCount: 0,
      reviewItemCount: 0,
      unreadReviewCount: 0,
    }).map((action) => action.label),
  ).toEqual([
    "Return to current stop",
    "Reopen current stop",
    "Archive current stop",
  ]);
  expect(
    reviewCommandActions({
      activeComment: makeReviewComment("archived-1", "docs/a.md", "archived"),
      attentionThreadCount: 0,
      canToggleDiff: false,
      diffEnabled: false,
      openThreadTargetCount: 0,
      reviewItemCount: 0,
      unreadReviewCount: 0,
    }).map((action) => action.label),
  ).toEqual(["Return to current stop", "Reopen current stop"]);
});

it("derives active comment lifecycle updates for review shortcuts", () => {
  const openThread = makeReviewComment("open-1", "docs/a.md", "open");
  const resolvedThread = makeReviewComment(
    "resolved-1",
    "docs/a.md",
    "resolved",
  );
  const archivedThread = makeReviewComment(
    "archived-1",
    "docs/a.md",
    "archived",
  );

  expect(
    currentThreadLifecycleShortcutStatus(
      openThread,
      "toggle-current-thread-status",
    ),
  ).toBe("resolved");
  expect(
    currentThreadLifecycleShortcutStatus(
      resolvedThread,
      "toggle-current-thread-status",
    ),
  ).toBe("open");
  expect(
    currentThreadLifecycleShortcutStatus(
      archivedThread,
      "toggle-current-thread-status",
    ),
  ).toBe("open");
  expect(
    currentThreadLifecycleShortcutStatus(openThread, "archive-current-thread"),
  ).toBe("archived");
  expect(
    currentThreadLifecycleShortcutStatus(
      archivedThread,
      "archive-current-thread",
    ),
  ).toBeNull();
  expect(
    currentThreadLifecycleShortcutStatus(null, "toggle-current-thread-status"),
  ).toBeNull();
});

it("preserves comment surfaces when building direct comment navigation targets", () => {
  const rendered = {
    ...makeReviewComment("rendered-1", "docs/a.md", "open"),
    viewerKind: "markdown" as const,
    anchor: {
      surface: "rendered" as const,
      canonical: { path: "docs/a.md", lineStart: 4 },
      rendered: { kind: "markdown" as const, blockId: "h-1" },
    },
  };
  const diff = {
    ...makeReviewComment("diff-1", "docs/a.md", "open"),
    anchor: {
      surface: "diff" as const,
      canonical: { path: "docs/a.md", lineStart: 8 },
      diff: {
        path: "docs/a.md",
        base: "HEAD",
        ref: "working-tree",
        hunkId: "hunk-1",
        side: "new" as const,
        newLineStart: 8,
      },
    },
  };

  expect(commentNavigationTarget(rendered)).toMatchObject({
    surface: "rendered",
    label: "Rendered comment in a.md",
    detail: "Line 4 - Review note",
  });
  expect(commentNavigationTarget(diff)).toMatchObject({
    surface: "diff",
    label: "Diff comment in a.md",
    detail: "Line 8 - Review note",
  });
});

it("prefers relevant open threads when jumping from a review queue item", () => {
  const comments = [
    {
      ...makeReviewComment("resolved-1", "docs/a.md", "resolved"),
      threadId: "thread-old",
    },
    {
      ...makeReviewComment("open-1", "docs/a.md", "open"),
      threadId: "thread-open",
      anchor: {
        surface: "diff" as const,
        canonical: { path: "docs/a.md", lineStart: 8 },
      },
    },
  ];
  const items = buildReviewQueueItems([], comments, {}, new Set());

  expect(firstRelevantThreadForReviewItem(items[0]!, comments)).toMatchObject({
    threadId: "thread-open",
    commentId: "open-1",
    surface: "diff",
  });
});

it("treats unread activity as a navigation hint rather than status", () => {
  const resolvedComment = {
    ...makeReviewComment("resolved-1", "docs/a.md", "resolved"),
    anchor: {
      surface: "diff" as const,
      canonical: { path: "docs/a.md", lineStart: 5 },
      diff: {
        path: "docs/a.md",
        base: "HEAD",
        ref: "working-tree",
        hunkId: "hunk-1",
        side: "new" as const,
        newLineStart: 5,
      },
    },
  };
  const items = buildReviewQueueItems(
    [{ path: "docs/a.md", status: "modified", source: "git" }],
    [resolvedComment],
    {
      "resolved-1": {
        inline: [],
        timeline: [
          {
            id: "activity-1",
            threadId: "resolved-1",
            type: "thread_status_changed",
            actor: { id: "codex:1", kind: "codex" },
            createdAt: "2026-06-20T00:04:00.000Z",
          },
        ],
      },
    },
    new Set(["docs/a.md"]),
  );

  expect(latestUnreadActivityTarget(items, [resolvedComment])).toMatchObject({
    path: "docs/a.md",
    threadId: "resolved-1",
    commentId: "resolved-1",
    activityId: "activity-1",
    surface: "diff",
  });
  expect(items[0]?.threadCounts).toEqual({
    open: 0,
    resolved: 1,
    archived: 0,
  });
});

it("uses the activity comment surface for latest unread navigation", () => {
  const root = {
    ...makeReviewComment("root-1", "docs/a.md", "open"),
    threadId: "thread-a",
    anchor: {
      surface: "source" as const,
      canonical: { path: "docs/a.md", lineStart: 1 },
    },
  };
  const renderedReply = {
    ...makeReviewComment("reply-1", "docs/a.md", "open"),
    threadId: "thread-a",
    anchor: {
      surface: "rendered" as const,
      canonical: { path: "docs/a.md", lineStart: 8 },
      rendered: { kind: "markdown" as const, blockId: "intro" },
    },
  };
  const items = buildReviewQueueItems(
    [{ path: "docs/a.md", status: "modified", source: "git" }],
    [root, renderedReply],
    {
      "thread-a": {
        inline: [],
        timeline: [
          {
            id: "activity-1",
            threadId: "thread-a",
            commentId: "reply-1",
            type: "comment_added",
            actor: { id: "codex:1", kind: "codex" },
            createdAt: "2026-06-20T00:04:00.000Z",
          },
        ],
      },
    },
    new Set(["docs/a.md"]),
  );

  expect(latestUnreadActivityTarget(items, [root, renderedReply])).toMatchObject(
    {
      id: "unread:docs/a.md",
      path: "docs/a.md",
      threadId: "thread-a",
      commentId: "reply-1",
      activityId: "activity-1",
      surface: "rendered",
      sortKey: "2026-06-20T00:04:00.000Z",
    },
  );
});

it("loads comment activity targets from authoritative thread state", () => {
  const staleOpenMessage = {
    ...makeReviewComment("thread-open-old", "docs/a.md", "open"),
    threadId: "thread-a",
    body: "Old unresolved note",
    updatedAt: "2026-06-20T00:00:00.000Z",
  };
  const resolvedThreadState = {
    ...makeReviewComment("thread-resolved-new", "docs/a.md", "resolved"),
    threadId: "thread-a",
    body: "Resolved after follow-up",
    updatedAt: "2026-06-20T00:01:00.000Z",
  };
  const openThread = {
    ...makeReviewComment("open-1", "docs/b.md", "open"),
    threadId: "thread-b",
    body: "Needs another look",
    updatedAt: "2026-06-20T00:02:00.000Z",
  };
  const comments = [staleOpenMessage, resolvedThreadState, openThread];

  expect(
    countAttentionCommentThreads(comments, new Set(["docs/a.md", "docs/b.md"])),
  ).toBe(1);
  expect(commentInboxEntryStatus(1)).toBe("attention");
  expect(commentInboxEntryStatus(0)).toBe("open");
  expect(commentInboxEntryState(1)).toEqual({
    query: "",
    status: "attention",
  });
  expect(commentInboxEntryState(0)).toEqual({
    query: "",
    status: "open",
  });
  expect(
    commentInboxOpenState({
      activeComment: openThread,
      activeCommentId: "comment-2",
      attentionThreadCount: 1,
    }),
  ).toEqual({
    activeCommentId: "open-1",
    query: "docs/b.md",
    status: "all",
  });
  expect(
    commentInboxOpenState({
      activeComment: openThread,
      activeCommentId: "comment-2",
      attentionThreadCount: 0,
      query: "custom query",
    }),
  ).toEqual({
    activeCommentId: "open-1",
    query: "custom query",
    status: "all",
  });
  expect(
    commentInboxOpenState({
      activeCommentId: "comment-2",
      attentionThreadCount: 1,
    }),
  ).toEqual({
    activeCommentId: "comment-2",
    query: "",
    status: "attention",
  });
  expect(
    commentActivityThreadTargets({
      comments,
      selectedPath: null,
      commentsPanelOpen: true,
      commentsPanelQuery: "",
      commentsPanelStatus: "open",
      reviewPaths: [],
    }),
  ).toEqual(["thread-b"]);
  expect(
    commentActivityThreadTargets({
      comments,
      selectedPath: null,
      commentsPanelOpen: true,
      commentsPanelQuery: "",
      commentsPanelStatus: "attention",
      unreadReviewPaths: new Set(["docs/b.md"]),
      reviewPaths: [],
    }),
  ).toEqual(["thread-b"]);
  expect(
    commentActivityThreadTargets({
      comments,
      selectedPath: null,
      commentsPanelOpen: true,
      commentsPanelQuery: "",
      commentsPanelStatus: "attention",
      unreadReviewPaths: new Set(),
      reviewPaths: [],
    }),
  ).toEqual([]);
  expect(
    commentActivityThreadTargets({
      comments,
      selectedPath: null,
      commentsPanelOpen: true,
      commentsPanelQuery: "follow-up",
      commentsPanelStatus: "resolved",
      reviewPaths: [],
    }),
  ).toEqual(["thread-a"]);
  expect(
    commentActivityThreadTargets({
      comments,
      selectedPath: "docs/a.md",
      commentsPanelOpen: false,
      commentsPanelQuery: "",
      commentsPanelStatus: "open",
      reviewPaths: [],
    }),
  ).toEqual(["thread-a"]);
});

function makeReviewComment(
  id: string,
  path: string,
  status: "open" | "resolved" | "archived",
) {
  return {
    id,
    path,
    viewerKind: "text" as const,
    anchor: { surface: "source" as const, canonical: { path } },
    body: "Review note",
    status,
    createdAt: "2026-06-20T00:00:00.000Z",
    updatedAt: "2026-06-20T00:00:00.000Z",
  };
}

it("parses unified diff lines for review rendering", () => {
  const parsed = parseUnifiedDiff(
    [
      "diff --git a/README.md b/README.md",
      "index 123..456 100644",
      "--- a/README.md",
      "+++ b/README.md",
      "@@ -2,2 +2,2 @@",
      " context",
      "-old",
      "+new",
    ].join("\n"),
  );

  expect(parsed).toEqual([
    { kind: "meta", text: "diff --git a/README.md b/README.md" },
    { kind: "meta", text: "index 123..456 100644" },
    { kind: "meta", text: "--- a/README.md" },
    { kind: "meta", text: "+++ b/README.md" },
    { kind: "hunk", text: "@@ -2,2 +2,2 @@" },
    { kind: "context", text: "context", oldLine: 2, newLine: 2 },
    { kind: "remove", text: "old", oldLine: 3 },
    { kind: "add", text: "new", newLine: 3 },
  ]);
  expect(buildSideBySideDiffRows(parsed)).toEqual([
    { kind: "meta", text: "diff --git a/README.md b/README.md" },
    { kind: "meta", text: "index 123..456 100644" },
    { kind: "meta", text: "--- a/README.md" },
    { kind: "meta", text: "+++ b/README.md" },
    { kind: "hunk", text: "@@ -2,2 +2,2 @@" },
    {
      kind: "context",
      oldLine: 2,
      oldText: "context",
      newLine: 2,
      newText: "context",
    },
    {
      kind: "changed",
      oldLine: 3,
      oldText: "old",
      newLine: 3,
      newText: "new",
    },
  ]);
});

it("parses full-file diffs without truncating by default", () => {
  const diff = [
    "@@ -1,260 +1,260 @@",
    ...Array.from({ length: 260 }, (_, index) => ` line ${index + 1}`),
  ].join("\n");

  const parsed = parseUnifiedDiff(diff);

  expect(parsed.at(-1)).toEqual({
    kind: "context",
    text: "line 260",
    oldLine: 260,
    newLine: 260,
  });
  expect(parseUnifiedDiff(diff, 2).at(-1)?.text).toBe(
    "... diff truncated after 2 rendered lines",
  );
});

it("builds side-by-side rows for add-only and remove-only diff blocks", () => {
  expect(
    buildSideBySideDiffRows([
      { kind: "remove", text: "gone", oldLine: 4 },
      { kind: "context", text: "still", oldLine: 5, newLine: 4 },
      { kind: "add", text: "new", newLine: 5 },
    ]),
  ).toEqual([
    { kind: "remove", oldLine: 4, oldText: "gone" },
    {
      kind: "context",
      oldLine: 5,
      oldText: "still",
      newLine: 4,
      newText: "still",
    },
    { kind: "add", newLine: 5, newText: "new" },
  ]);
});

it("resolves theme preference from system or explicit choices", () => {
  expect(resolveThemePreference("system", "light")).toBe("light");
  expect(resolveThemePreference("system", "dark")).toBe("dark");
  expect(resolveThemePreference("light", "dark")).toBe("light");
  expect(resolveThemePreference("dark", "light")).toBe("dark");
});

it("cycles theme preference while keeping system as the default option", () => {
  expect(nextThemePreference("system")).toBe("light");
  expect(nextThemePreference("light")).toBe("dark");
  expect(nextThemePreference("dark")).toBe("system");
  expect(themePreferenceLabel("system")).toBe("System");
  expect(isThemePreference("sepia")).toBe(false);
  expect(isThemePreference("dark")).toBe(true);
});

it("clamps side widths for draggable workbench layout", () => {
  expect(clampSidebarWidth(320.4)).toBe(320);
  expect(clampSidebarWidth(minSidebarWidth - 1)).toBe(minSidebarWidth);
  expect(clampSidebarWidth(maxSidebarWidth + 1)).toBe(maxSidebarWidth);
  expect(clampSidebarWidth(Number.NaN)).toBe(defaultSidebarWidth);
  expect(clampInspectorWidth(340.6)).toBe(341);
  expect(clampInspectorWidth(minInspectorWidth - 1)).toBe(minInspectorWidth);
  expect(clampInspectorWidth(maxInspectorWidth + 1)).toBe(maxInspectorWidth);
  expect(clampInspectorWidth(Number.NaN)).toBe(defaultInspectorWidth);
});

it("restores workspace tabs and layout only for the current root and tree", () => {
  const now = 100_000;
  const layout = splitEditorPane(
    setPaneActivePath(initialEditorLayout, "main", "README.md"),
    "main",
    "vertical",
    "right",
  );
  const activeLayout = setPaneActivePath(layout, "pane-1", "docs/guide.md");
  const openTabs = [
    { path: "README.md", viewerKind: "markdown", paneId: "main" },
    { path: "docs/guide.md", viewerKind: "markdown", paneId: "pane-1" },
    { path: "missing.md", viewerKind: "markdown", paneId: "pane-2" },
  ];

  const stored = buildWorkspaceSession(
    "/workspace",
    {
      openTabs,
      layout: activeLayout,
      recentFiles: [
        { path: "README.md", viewerKind: "markdown", lastOpenedAt: now - 1 },
        { path: "missing.md", viewerKind: "markdown", lastOpenedAt: now },
      ],
      inspectorVisible: false,
      sidebarVisible: false,
      sidebarWidth: 640,
      inspectorWidth: 120,
      diffEnabled: true,
    },
    now,
  );
  const restored = restoreWorkspaceSession(
    stored,
    "/workspace",
    new Set(["README.md", "docs/guide.md"]),
    now,
  );

  expect(restored?.openTabs).toEqual([
    { path: "README.md", viewerKind: "markdown", paneId: "main" },
    { path: "docs/guide.md", viewerKind: "markdown", paneId: "pane-1" },
  ]);
  expect(restored?.recentFiles).toEqual([
    { path: "README.md", viewerKind: "markdown", lastOpenedAt: now - 1 },
  ]);
  expect(restored ? flattenPanes(restored.layout) : []).toEqual([
    { id: "main", activePath: "README.md" },
    { id: "pane-1", activePath: "docs/guide.md" },
  ]);
  expect(stored.sidebarVisible).toBe(false);
  expect(restored?.layout.activePaneId).toBe("pane-1");
  expect(restored?.inspectorVisible).toBe(false);
  expect(restored?.sidebarVisible).toBe(false);
  expect(restored?.sidebarWidth).toBe(maxSidebarWidth);
  expect(restored?.inspectorWidth).toBe(minInspectorWidth);
  expect(restored?.diffEnabled).toBe(true);
  expect(restoreWorkspaceSession(stored, "/other", new Set(), now)).toBeNull();
  expect(
    restoreWorkspaceSession(
      stored,
      "/workspace",
      new Set(["README.md"]),
      now + workspaceSessionTtlMs + 1,
    ),
  ).toBeNull();
});

it("resets persisted layout when the last tab is closed but keeps recents", () => {
  const now = 200_000;
  const stored = buildWorkspaceSession(
    "/workspace",
    {
      openTabs: [],
      layout: setPaneActivePath(initialEditorLayout, "main", "README.md"),
      recentFiles: [
        { path: "README.md", viewerKind: "markdown", lastOpenedAt: now },
      ],
      inspectorVisible: true,
    },
    now,
  );

  expect(stored.openTabs).toEqual([]);
  expect(stored.layout).toEqual(initialEditorLayout);
  expect(stored.recentFiles).toEqual([
    { path: "README.md", viewerKind: "markdown", lastOpenedAt: now },
  ]);
});

it("does not persist preview tabs in workspace sessions", () => {
  const stored = buildWorkspaceSession(
    "/workspace",
    {
      openTabs: [
        {
          path: "scratch.md",
          viewerKind: "markdown",
          paneId: "main",
          isPreview: true,
        },
        { path: "README.md", viewerKind: "markdown", paneId: "main" },
      ],
      layout: setPaneActivePath(initialEditorLayout, "main", "scratch.md"),
      recentFiles: [],
      inspectorVisible: true,
    },
    300_000,
  );

  expect(stored.openTabs).toEqual([
    { path: "README.md", viewerKind: "markdown", paneId: "main" },
  ]);
});

it("prompts before restoring sessions at the tab threshold only", () => {
  const baseState = {
    openTabs: Array.from(
      { length: restorePromptTabThreshold - 1 },
      (_, index) => ({
        path: `file-${index}.md`,
        viewerKind: "markdown",
        paneId: "main",
      }),
    ),
    layout: setPaneActivePath(initialEditorLayout, "main", "file-0.md"),
    recentFiles: [],
    inspectorVisible: true,
  };

  expect(shouldPromptForWorkspaceSessionRestore(baseState)).toBe(false);
  expect(
    shouldPromptForWorkspaceSessionRestore({
      ...baseState,
      openTabs: [
        ...baseState.openTabs,
        {
          path: "file-7.md",
          viewerKind: "markdown",
          paneId: "main",
        },
      ],
    }),
  ).toBe(true);
});

it("can reduce a large restored session to only the active tab", () => {
  const layout = setPaneActivePath(initialEditorLayout, "main", "file-2.md");
  const restored = restoreOnlyActiveWorkspaceTab({
    openTabs: [
      { path: "file-1.md", viewerKind: "markdown", paneId: "main" },
      { path: "file-2.md", viewerKind: "markdown", paneId: "main" },
    ],
    layout,
    recentFiles: [],
    inspectorVisible: true,
  });

  expect(restored.openTabs).toEqual([
    { path: "file-2.md", viewerKind: "markdown", paneId: "main" },
  ]);
  expect(flattenPanes(restored.layout)).toEqual([
    { id: "main", activePath: "file-2.md" },
  ]);
});

it("drops legacy focused diff settings from workspace sessions", () => {
  const now = 250_000;
  const stored = parseWorkspaceSession(
    JSON.stringify({
      version: 1,
      root: "/workspace",
      updatedAt: now,
      openTabs: [
        { path: "README.md", viewerKind: "markdown", paneId: "main" },
        { path: "src/app.ts", viewerKind: "code", paneId: "main" },
      ],
      layout: setPaneActivePath(initialEditorLayout, "main", "README.md"),
      recentFiles: [],
      inspectorVisible: true,
      diffFocusByPath: {
        "README.md": true,
        "src/app.ts": false,
        "missing.md": true,
      },
    }),
  );
  const restored = restoreWorkspaceSession(
    stored,
    "/workspace",
    new Set(["README.md", "src/app.ts"]),
    now,
  );

  expect(stored).not.toHaveProperty("diffFocusByPath");
  expect(restored).not.toHaveProperty("diffFocusByPath");
});

it("persists diff mode as workspace state rather than per-file state", () => {
  const stored = buildWorkspaceSession(
    "/workspace",
    {
      openTabs: [
        { path: "README.md", viewerKind: "markdown", paneId: "main" },
        { path: "src/app.ts", viewerKind: "code", paneId: "main" },
      ],
      layout: setPaneActivePath(initialEditorLayout, "main", "README.md"),
      recentFiles: [],
      inspectorVisible: true,
      diffEnabled: true,
    },
    260_000,
  );
  const restored = restoreWorkspaceSession(
    stored,
    "/workspace",
    new Set(["README.md", "src/app.ts"]),
    260_000,
  );

  expect(stored.diffEnabled).toBe(true);
  expect(restored?.diffEnabled).toBe(true);
});

it("tracks recently opened files independently from restored tabs", () => {
  const recent = recordRecentFile(
    [
      { path: "README.md", viewerKind: "markdown", lastOpenedAt: 1 },
      { path: "docs/guide.md", viewerKind: "markdown", lastOpenedAt: 2 },
    ],
    { path: "README.md", viewerKind: "markdown" },
    3,
  );

  expect(recent).toEqual([
    { path: "README.md", viewerKind: "markdown", lastOpenedAt: 3 },
    { path: "docs/guide.md", viewerKind: "markdown", lastOpenedAt: 2 },
  ]);
});

it("parses stored workspace sessions defensively", () => {
  expect(parseWorkspaceSession("{")).toBeNull();
  expect(parseWorkspaceSession(JSON.stringify({ version: 2 }))).toBeNull();
  expect(
    parseWorkspaceSession(
      JSON.stringify(
        buildWorkspaceSession(
          "/workspace",
          {
            openTabs: [
              { path: "README.md", viewerKind: "markdown", paneId: "main" },
            ],
            layout: setPaneActivePath(initialEditorLayout, "main", "README.md"),
            recentFiles: [],
            inspectorVisible: true,
          },
          1,
        ),
      ),
    )?.root,
  ).toBe("/workspace");
});

it("collects file paths from nested tree nodes for session pruning", () => {
  const paths = collectFilePaths([
    {
      id: "docs",
      path: "docs",
      name: "docs",
      kind: "directory",
      parentPath: null,
      children: [
        {
          id: "docs/guide.md",
          path: "docs/guide.md",
          name: "guide.md",
          kind: "file",
          parentPath: "docs",
          viewerKind: "markdown",
        },
      ],
    },
  ]);

  expect([...paths]).toEqual(["docs/guide.md"]);
});

it("scopes persisted workspace sessions by root path", () => {
  expect(workspaceSessionStorageKeyForRoot("/tmp/a project")).toBe(
    "vivi.workspaceSession.v1:%2Ftmp%2Fa%20project",
  );
});

it("restores older workspace sessions with inspector visible by default", () => {
  const raw = JSON.stringify({
    version: 1,
    root: "/workspace",
    updatedAt: 1,
    openTabs: [],
    layout: initialEditorLayout,
    recentFiles: [],
  });

  expect(parseWorkspaceSession(raw)?.inspectorVisible).toBe(true);
  expect(parseWorkspaceSession(raw)?.sidebarVisible).toBe(true);
  expect(parseWorkspaceSession(raw)?.diffEnabled).toBe(false);
  expect(parseWorkspaceSession(raw)).not.toHaveProperty("diffFocusByPath");
});

it("builds search palette items only from file and text search results", () => {
  const files: FileSearchResult[] = [
    {
      path: "reports/index.html",
      name: "index.html",
      viewerKind: "html",
      score: 100,
    },
  ];

  expect(buildFileSearchItems(files).map((item) => item.id)).toEqual([
    "file:reports/index.html",
  ]);
  expect(buildFileSearchItems(files)[0]).toMatchObject({
    source: "search",
  });
  expect(
    buildRecentFileSearchItems([
      { path: "README.md", viewerKind: "markdown", source: "active" },
      { path: "src/app.ts", viewerKind: "code", source: "open" },
      { path: "docs/notes.txt", viewerKind: "text" },
    ]),
  ).toMatchObject([
    {
      kind: "file",
      id: "active:README.md",
      label: "README.md",
      detail: "Active tab · markdown",
      source: "active",
    },
    {
      kind: "file",
      id: "open:src/app.ts",
      label: "src/app.ts",
      detail: "Open tab · code",
      source: "open",
    },
    {
      kind: "file",
      id: "recent:docs/notes.txt",
      label: "docs/notes.txt",
      detail: "Recent · text",
      source: "recent",
    },
  ]);
  expect(
    buildTextSearchItems([
      {
        path: "reports/index.html",
        viewerKind: "html",
        lineNumber: 4,
        lineText: "<h1>Index</h1>",
        matchStart: 4,
        matchLength: 5,
      },
    ]),
  ).toEqual([
    {
      kind: "text",
      id: "text:reports/index.html:4:4",
      path: "reports/index.html",
      label: "reports/index.html",
      detail: "L4 <h1>Index</h1>",
      viewerKind: "html",
      lineNumber: 4,
      lineText: "<h1>Index</h1>",
      matchStart: 4,
      matchLength: 5,
    },
  ]);
  expect(textSearchPreviewSegments("<h1>Index</h1>", 4, 5)).toEqual([
    { text: "<h1>", match: false },
    { text: "Index", match: true },
    { text: "</h1>", match: false },
  ]);
  expect(textSearchPreviewSegments("short", 99, 5)).toEqual([
    { text: "short", match: false },
  ]);
});

it("prepares viewer state when opening a text search result", () => {
  expect(viewerModeForTextSearchTarget({ viewerKind: "markdown" })).toBe(
    "source",
  );
  expect(viewerModeForTextSearchTarget({ viewerKind: "html" })).toBe("source");
  expect(viewerModeForTextSearchTarget({ viewerKind: "code" })).toBeNull();
  expect(codeSelectionForTextSearchTarget({ viewerKind: "code" }, 8)).toEqual({
    start: 8,
    end: 8,
  });
  expect(
    codeSelectionForTextSearchTarget({ viewerKind: "markdown" }, 8),
  ).toBeNull();
});

it("keeps a navigable text search session after opening a result", () => {
  const results = [
    {
      path: "README.md",
      viewerKind: "markdown" as const,
      lineNumber: 2,
      lineText: "Install Vivi",
      matchStart: 8,
      matchLength: 4,
    },
    {
      path: "docs/usage.md",
      viewerKind: "markdown" as const,
      lineNumber: 8,
      lineText: "Run vivi .",
      matchStart: 4,
      matchLength: 4,
    },
  ];

  const session = textSearchSessionForSelection({
    query: " vivi ",
    results,
    path: "docs/usage.md",
    lineNumber: 8,
  });

  expect(session).toMatchObject({
    query: "vivi",
    activeIndex: 1,
  });
  expect(activeTextSearchResult(session)).toMatchObject({
    path: "docs/usage.md",
    lineNumber: 8,
  });
  expect(textSearchPositionLabel(session)).toBe("2 of 2");
  expect(
    activeTextSearchResult(moveTextSearchSession(session, "next")),
  ).toMatchObject({ path: "README.md", lineNumber: 2 });
  expect(
    activeTextSearchResult(moveTextSearchSession(session, "previous")),
  ).toMatchObject({ path: "README.md", lineNumber: 2 });
  expect(
    textSearchSessionForSelection({
      query: "",
      results,
      path: "README.md",
      lineNumber: 2,
    }),
  ).toBeNull();
});

it("filters the tree to changed paths and ranks generated review targets", () => {
  const nodes: FsNode[] = [
    {
      id: "reports",
      path: "reports",
      name: "reports",
      kind: "directory",
      parentPath: null,
      children: [
        {
          id: "reports/index.html",
          path: "reports/index.html",
          name: "index.html",
          kind: "file",
          parentPath: "reports",
          viewerKind: "html",
          mtimeMs: 2,
        },
        {
          id: "reports/raw.bin",
          path: "reports/raw.bin",
          name: "raw.bin",
          kind: "file",
          parentPath: "reports",
          viewerKind: "unsupported",
          mtimeMs: 1,
        },
      ],
    },
  ];

  expect(
    JSON.stringify(filterTreeToPaths(nodes, new Set(["reports/index.html"]))),
  ).toContain("reports/index.html");
  expect(reviewArtifactResults(nodes)[0]?.path).toBe("reports/index.html");
});

it("limits initial tree expansion while keeping important paths visible", () => {
  const nodes: FsNode[] = [
    {
      id: "src",
      path: "src",
      name: "src",
      kind: "directory",
      parentPath: null,
      children: Array.from(
        { length: 20 },
        (_, index): FsNode => ({
          id: `src/file-${index}.ts`,
          path: `src/file-${index}.ts`,
          name: `file-${index}.ts`,
          kind: "file",
          parentPath: "src",
          viewerKind: "code",
        }),
      ),
    },
    {
      id: "reports",
      path: "reports",
      name: "reports",
      kind: "directory",
      parentPath: null,
      children: [
        {
          id: "reports/deep",
          path: "reports/deep",
          name: "deep",
          kind: "directory",
          parentPath: "reports",
          children: [
            {
              id: "reports/deep/summary.html",
              path: "reports/deep/summary.html",
              name: "summary.html",
              kind: "file",
              parentPath: "reports/deep",
              viewerKind: "html",
            },
          ],
        },
      ],
    },
  ];

  const expanded = initialExpandedPaths(nodes, {
    maxAutoExpandedRows: 3,
    forceVisiblePaths: ["reports/deep/summary.html"],
  });

  expect(countTreeNodes(nodes)).toBe(24);
  expect(expanded.has("reports")).toBe(true);
  expect(expanded.has("reports/deep")).toBe(true);
  expect(visibleTreeRows(nodes, expanded)).toBeLessThan(countTreeNodes(nodes));
  expect(
    ensureVisibleAncestors(new Set<string>(), ["reports/deep/summary.html"]),
  ).toEqual(new Set(["reports", "reports/deep"]));

  const bounded = boundedVisibleTreeRows(
    nodes,
    new Set(["src", "reports", "reports/deep"]),
    {
      maxRows: 5,
      forceVisiblePaths: ["reports/deep/summary.html"],
    },
  );

  expect(bounded.totalVisibleRows).toBe(24);
  expect(bounded.omittedRows).toBeGreaterThan(0);
  expect(bounded.rows.map((row) => row.node.path)).toContain(
    "reports/deep/summary.html",
  );
});

it("maps tree keyboard navigation to visible rows and directory actions", () => {
  const rows = [
    {
      depth: 0,
      node: {
        id: "docs",
        path: "docs",
        name: "docs",
        kind: "directory" as const,
        parentPath: null,
      },
    },
    {
      depth: 1,
      node: {
        id: "docs/readme.md",
        path: "docs/readme.md",
        name: "readme.md",
        kind: "file" as const,
        parentPath: "docs",
        viewerKind: "markdown" as const,
      },
    },
    {
      depth: 0,
      node: {
        id: "src",
        path: "src",
        name: "src",
        kind: "directory" as const,
        parentPath: null,
      },
    },
  ];

  expect(treeKeyboardAction(rows, new Set(["docs"]), "docs", "ArrowDown")).toEqual(
    { kind: "focus", path: "docs/readme.md" },
  );
  expect(
    treeKeyboardAction(rows, new Set(["docs"]), "docs/readme.md", "ArrowLeft"),
  ).toEqual({ kind: "focus", path: "docs" });
  expect(treeKeyboardAction(rows, new Set(["docs"]), "docs", "ArrowLeft")).toEqual(
    { kind: "toggle", path: "docs" },
  );
  expect(treeKeyboardAction(rows, new Set(), "src", "ArrowRight")).toEqual({
    kind: "toggle",
    path: "src",
  });
  expect(
    treeKeyboardAction(rows, new Set(["docs"]), "docs/readme.md", "Enter"),
  ).toEqual({ kind: "activate", path: "docs/readme.md" });
  expect(treeKeyboardAction(rows, new Set(["docs"]), null, "End")).toEqual({
    kind: "focus",
    path: "src",
  });
});

it("models source toggles only for rendered viewers", () => {
  expect(defaultViewerMode({ viewerKind: "markdown" })).toBe("rendered");
  expect(defaultViewerMode({ viewerKind: "html" })).toBe("preview");
  expect(supportsSourceToggle({ viewerKind: "json" })).toBe(false);
  expect(nextViewerMode({ viewerKind: "markdown" }, "rendered")).toBe("source");
  expect(nextViewerMode({ viewerKind: "html" }, "source")).toBe("preview");
});

it("models diff support by viewer kind and keeps unsupported extensions visible", () => {
  for (const viewerKind of [
    "markdown",
    "html",
    "code",
    "json",
    "text",
    "mermaid",
    "unsupported",
  ] as const) {
    expect(supportsDiffMode({ viewerKind, encoding: "utf8" })).toBe(true);
  }
  expect(supportsDiffMode({ viewerKind: "image", encoding: "base64" })).toBe(
    true,
  );
  expect(supportsDiffMode({ viewerKind: "binary", encoding: "none" })).toBe(
    false,
  );
  expect(diffSupportForFile({ viewerKind: "json", encoding: "utf8" })).toEqual({
    supported: true,
    renderKind: "source",
  });
  expect(supportsDiffMode({ viewerKind: "json", encoding: "base64" })).toBe(
    false,
  );
  expect(diffUnsupportedViewerKinds).toEqual([]);
});
