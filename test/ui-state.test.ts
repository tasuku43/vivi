import { readdirSync, readFileSync, statSync } from "node:fs";
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
  filterRecentReviewChanges,
  gitPartialTimeoutReason,
  latestUnreadReviewPath,
  mergeReviewChanges,
  nextReviewQueuePath,
  parseUnifiedDiff,
  reviewQueueSourceLabel,
  type ReviewChangeItem,
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
import { reviewCommandActions } from "../ui/src/state/review-command-actions.js";
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
  colorTokenNames,
  colorTokenVar,
} from "../ui/src/state/color-tokens.js";
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
import {
  fileReviewAttentionForQueue,
  isFileReviewActivityEvent,
  recentReviewEvents,
  recordReviewEvent,
  summarizeReviewEvents,
} from "../ui/src/state/review-events.js";
import {
  compactReviewAttention,
  nextReviewAttentionExpiryDelay,
  recentReviewAttentionPaths,
  reviewActivityWindowMs,
  touchReviewAttention,
} from "../ui/src/state/review-attention.js";
import { keyboardShortcutAction } from "../ui/src/state/shortcuts.js";
import {
  buildReviewQueueItems,
  latestUnreadReviewItemPath,
  nextReviewQueueItemPathAfterCompletion,
  nextReviewQueueItemPath,
  pinActiveReviewQueueItem,
  reviewQueuePosition,
  reviewQueueSignalCounts,
  summarizeReviewQueue,
  syncUnreadReviewPaths,
} from "../ui/src/state/review-queue.js";
import {
  commentActivityThreadTargets,
  commentNavigationTarget,
  countAttentionCommentThreads,
  draftCommentNavigationTargets,
  firstRelevantThreadForReviewItem,
  inlineThreadFocusCommentId,
  moveReviewNavigationTarget,
  feedbackNavigationTargets,
  reviewQueueOpenTransition,
} from "../ui/src/state/review-navigation.js";
import { activeCommentRendersInViewerThread } from "../ui/src/state/comments.js";
import {
  boundedVisibleTreeRows,
  countTreeNodes,
  ensureVisibleAncestors,
  initialExpandedPaths,
  visibleTreeRows,
} from "../ui/src/state/tree-expansion.js";
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

it("does not let a late preview response downgrade a normal tab", () => {
  const file: FilePayload = {
    path: "README.md",
    viewerKind: "markdown",
    encoding: "utf8",
    content: "# Hello",
    etag: "sha256:test",
    size: 7,
    mtimeMs: 1,
  };

  const normal = upsertOpenTab([], file, "main", "normal");
  const afterLatePreview = upsertOpenTab(normal, file, "main", "preview");

  expect(afterLatePreview[0]?.isPreview).not.toBe(true);
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
  expect(transition.paletteOpen).toBe(false);
  expect(transition.shortcutHelpOpen).toBe(false);
  expect(transition.error).toBeNull();
});

it("detects when active comments are already rendered inside the viewer", () => {
  const sourceComment = {
    anchor: {
      surface: "source" as const,
      canonical: { lineStart: 4 },
    },
  };
  const renderedComment = {
    anchor: {
      surface: "rendered" as const,
      canonical: {},
    },
  };
  const renderedHtmlComment = {
    anchor: {
      surface: "rendered" as const,
      canonical: { lineStart: 4 },
      rendered: { kind: "html" as const },
    },
  };

  expect(
    activeCommentRendersInViewerThread({
      comment: sourceComment,
      diffEnabled: false,
      viewerKind: "html",
      viewerMode: "source",
    }),
  ).toBe(true);
  expect(
    activeCommentRendersInViewerThread({
      comment: sourceComment,
      diffEnabled: false,
      viewerKind: "html",
      viewerMode: "preview",
    }),
  ).toBe(true);
  expect(
    activeCommentRendersInViewerThread({
      comment: renderedHtmlComment,
      diffEnabled: false,
      viewerKind: "html",
      viewerMode: "preview",
    }),
  ).toBe(true);
  expect(
    activeCommentRendersInViewerThread({
      comment: sourceComment,
      diffEnabled: false,
      viewerKind: "code",
      viewerMode: "source",
    }),
  ).toBe(true);
  expect(
    activeCommentRendersInViewerThread({
      comment: sourceComment,
      diffEnabled: false,
      viewerKind: "markdown",
      viewerMode: "source",
    }),
  ).toBe(true);
  expect(
    activeCommentRendersInViewerThread({
      comment: renderedComment,
      diffEnabled: false,
      viewerKind: "markdown",
      viewerMode: "rendered",
    }),
  ).toBe(true);
  expect(
    activeCommentRendersInViewerThread({
      comment: sourceComment,
      diffEnabled: true,
      viewerKind: "html",
      viewerMode: "source",
    }),
  ).toBe(false);
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
    treeRefreshParentPath: "",
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
    treeRefreshParentPath: "src",
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
    feedbackCount: 2,
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
  expect(summary.review).toBe("2 feedback items · 1 draft");
  expect(summary.server).toBe("Live · waiting for file changes");
  expect(summary.serverTone).toBe("live");
  expect(summary.detail).toBe("1 review refresh · last review 18ms");
});

it("does not repeat preview when an HTML preview is in a preview tab", () => {
  const summary = summarizeWorkspaceStatus({
    tree: null,
    openTabCount: 1,
    reviewFileCount: 0,
    feedbackCount: 0,
    draftCount: 0,
    connectionStatus: "connected",
    activeFile: {
      path: "index.html",
      isPreview: true,
      viewerMode: "preview",
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

  expect(summary.activeFile).toBe("index.html · preview");
});

it("keeps feedback independent while change evidence is loading", () => {
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
    openTabCount: 1,
    reviewFileCount: 0,
    reviewLoading: true,
    feedbackCount: 2,
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
  });

  expect(summary.review).toBe("2 feedback items");
  expect(summary.review).not.toContain("review");
  expect(summary.server).toBe("Live · waiting for file changes");
  expect(summary.serverTone).toBe("live");
});

it("reports feedback whose source file is unavailable", () => {
  const summary = summarizeWorkspaceStatus({
    tree: null,
    openTabCount: 1,
    reviewFileCount: 0,
    feedbackCount: 0,
    unavailableFeedbackCount: 1,
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
  });

  expect(summary.review).toBe("1 unavailable file");
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
    feedbackCount: 0,
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
  expect(summary.review).toBe("No feedback");
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
    feedbackCount: 2,
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
    feedbackCount: 0,
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

it("keeps the active tab selected when an inactive tab closes", () => {
  const result = closeOpenTab(
    [
      { path: "README.md", viewerKind: "markdown", paneId: "main" },
      { path: "index.html", viewerKind: "html", paneId: "main" },
    ],
    "README.md",
    "index.html",
  );

  expect(result).toEqual({
    tabs: [{ path: "index.html", viewerKind: "html", paneId: "main" }],
    nextActivePath: "index.html",
  });
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
  expect(
    keyboardShortcutAction({ ...command, key: "\\", shiftKey: true }),
  ).toBe("toggle-inspector");
  expect(keyboardShortcutAction({ ...command, key: "i" })).toBe(
    "focus-current-inline-thread",
  );
  expect(
    keyboardShortcutAction({ ...command, key: "Enter", shiftKey: true }),
  ).toBeNull();
  expect(
    keyboardShortcutAction({ ...command, key: "Backspace", shiftKey: true }),
  ).toBeNull();
  expect(
    keyboardShortcutAction({ ...command, key: "C", shiftKey: true }),
  ).toBeNull();
  expect(
    keyboardShortcutAction({ ...command, key: "M", shiftKey: true }),
  ).toBeNull();
  expect(keyboardShortcutAction({ ...command, key: "U", shiftKey: true })).toBe(
    "open-latest-unseen",
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
  expect(
    keyboardShortcutAction({ ...command, key: "P", shiftKey: true }),
  ).toBeNull();
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

it("finds unloaded ancestors needed to reveal lazy paths", () => {
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

it("finds nested unloaded ancestors for a single lazy path reveal", () => {
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
    unloadedAncestorDirectoryPaths(nodes, ["docs/ui-mocks/02-doc-reader.html"]),
  ).toEqual(["docs", "docs/ui-mocks"]);
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
  expect(
    paletteModeKeyboardAction(["file", "text"], "file", "ArrowRight"),
  ).toBe("text");
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

it("uses Git evidence for recently observed or previously opened Review Queue changes", () => {
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
  const watcherState = summarizeReviewEvents(reviewEvents);
  const allChanges = mergeReviewChanges(watcherState, {
    available: true,
    changes: [
      { path: "reports/new.csv", status: "added" },
      { path: "src/app.ts", status: "modified" },
      { path: "README.md", status: "modified" },
      { path: "docs/new.md", status: "added" },
      { path: "docs/guide.md", status: "modified" },
    ],
  });
  const merged = filterRecentReviewChanges(
    allChanges,
    watcherState,
    new Set(["docs/guide.md"]),
  );

  expect(allChanges).toHaveLength(5);

  expect(merged).toEqual([
    { path: "docs/guide.md", status: "modified", source: "git" },
    { path: "docs/new.md", status: "added", source: "git" },
    { path: "README.md", status: "modified", source: "git" },
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

it("keeps watcher-only file additions when Git returns tracked changes only", () => {
  const watcherState = summarizeReviewEvents([
    {
      id: "new-file",
      event: {
        type: "add",
        path: "docs/new.md",
        kind: "file",
        version: 2,
      },
      receivedAt: 700,
    },
    {
      id: "tracked-change",
      event: { type: "change", path: "README.md", version: 1 },
      receivedAt: 600,
    },
  ]);

  expect(
    mergeReviewChanges(watcherState, {
      available: true,
      reason: gitPartialTimeoutReason,
      changes: [{ path: "README.md", status: "modified" }],
    }),
  ).toEqual([
    { path: "docs/new.md", status: "added", source: "watcher" },
    { path: "README.md", status: "modified", source: "git" },
  ]);
});

it("expires old Review Queue activity on schedule", () => {
  const events = [
    {
      id: "old",
      event: { type: "change" as const, path: "docs/old.md", version: 1 },
      receivedAt: 100,
    },
    {
      id: "recent",
      event: { type: "change" as const, path: "docs/recent.md", version: 2 },
      receivedAt: 350,
    },
  ];

  expect(recentReviewEvents(events, 500, 300).map((item) => item.id)).toEqual([
    "recent",
  ]);
  const clock = events.reduce(
    (state, event) =>
      touchReviewAttention(state, event.event.path, event.receivedAt),
    {},
  );
  expect(nextReviewAttentionExpiryDelay(clock, 500, 300)).toBe(151);
  expect(nextReviewAttentionExpiryDelay(clock, 651, 300)).toBeNull();
});

it("keeps every producer in one path-based thirty-minute activity clock", () => {
  const event = {
    id: "observed",
    event: { type: "change" as const, path: "docs/observed.md", version: 1 },
    receivedAt: 1_000,
  };
  const clock = touchReviewAttention(
    touchReviewAttention({}, event.event.path, event.receivedAt),
    "docs/opened.md",
    2_000,
  );

  expect(reviewActivityWindowMs).toBe(30 * 60 * 1000);
  expect(
    recentReviewEvents([event], event.receivedAt + reviewActivityWindowMs),
  ).toEqual([event]);
  expect(
    recentReviewEvents([event], event.receivedAt + reviewActivityWindowMs + 1),
  ).toEqual([]);
  expect(
    recentReviewAttentionPaths(clock, 2_000 + reviewActivityWindowMs),
  ).toEqual(new Set(["docs/opened.md"]));
  expect(
    recentReviewAttentionPaths(clock, 2_000 + reviewActivityWindowMs + 1),
  ).toEqual(new Set());
  expect(touchReviewAttention(clock, "docs/opened.md", 1_500)).toBe(clock);
  expect(compactReviewAttention(clock, 2_301, 300)).toEqual({});
});

it("rejects future attention timestamps and keeps browser timers bounded", () => {
  const now = 10_000;
  const farFuture = now + 365 * 24 * 60 * 60 * 1000;

  expect(touchReviewAttention({}, "docs/skewed.md", farFuture, now)).toEqual({
    "docs/skewed.md": now,
  });
  expect(
    touchReviewAttention(
      { "docs/skewed.md": farFuture },
      "docs/skewed.md",
      now - 10,
      now,
    ),
  ).toEqual({ "docs/skewed.md": now - 10 });
  expect(
    recentReviewAttentionPaths({ "docs/skewed.md": farFuture }, now),
  ).toEqual(new Set());
  expect(compactReviewAttention({ "docs/skewed.md": farFuture }, now)).toEqual(
    {},
  );
  expect(
    nextReviewAttentionExpiryDelay({ "docs/skewed.md": farFuture }, now),
  ).toBeNull();
  expect(
    nextReviewAttentionExpiryDelay({ "docs/current.md": now }, now, farFuture),
  ).toBe(2_147_483_647);
});

it("keeps feedback in the queue after its file change is no longer recent", () => {
  const watcherState = summarizeReviewEvents([
    {
      id: "recent",
      event: { type: "change", path: "docs/recent.md", version: 2 },
      receivedAt: 500,
    },
  ]);
  const changes = filterRecentReviewChanges(
    mergeReviewChanges(watcherState, {
      available: true,
      changes: [
        { path: "docs/recent.md", status: "modified" },
        { path: "docs/old-feedback.md", status: "modified" },
      ],
    }),
    watcherState,
  );
  const items = buildReviewQueueItems(
    changes,
    [
      {
        ...makeReviewComment("open-old", "docs/old-feedback.md", "open"),
        threadId: "thread-open-old",
      },
    ],
    {},
    new Set(["docs/old-feedback.md"]),
    { unseenFeedbackPaths: new Set(["docs/old-feedback.md"]) },
  );

  expect(items.map((item) => item.path)).toEqual([
    "docs/old-feedback.md",
    "docs/recent.md",
  ]);
  expect(items[0]).toMatchObject({
    change: null,
  });
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

it("keeps unread review path state stable when review items are unchanged", () => {
  const knownPaths = new Set(["README.md", "src/app.ts"]);
  const current = ["src/app.ts", "README.md"];
  const unchanged = syncUnreadReviewPaths(
    current,
    [{ path: "README.md" }, { path: "src/app.ts" }],
    knownPaths,
  );

  expect(unchanged).toBe(current);
  expect([...knownPaths].sort()).toEqual(["README.md", "src/app.ts"]);

  const withNewPath = syncUnreadReviewPaths(
    unchanged,
    [{ path: "README.md" }, { path: "docs/new.md" }],
    knownPaths,
  );

  expect(withNewPath).toEqual(["docs/new.md", "README.md"]);
  expect(withNewPath).not.toBe(current);
  expect([...knownPaths].sort()).toEqual(["README.md", "docs/new.md"]);
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

it("pins unseen feedback without reviving legacy terminal threads", () => {
  const comments = [
    {
      ...makeReviewComment("agent-only", "docs/a.md", "open"),
      threadId: "thread-agent-only",
      source: "codex" as const,
      createdBy: { id: "codex:run-1", kind: "codex" as const },
      anchor: {
        surface: "source" as const,
        canonical: { path: "docs/a.md", lineStart: 1 },
      },
    },
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
    new Set(["docs/agent.md"]),
    { unseenFeedbackPaths: new Set(["docs/agent.md"]) },
  );

  expect(items.map((item) => item.path)).toEqual([
    "docs/agent.md",
    "src/app.ts",
  ]);
  expect(items[0]).toMatchObject({
    change: null,
    commentCount: 2,
    unread: true,
  });
  expect(items[0]?.latestActivity).toBeUndefined();
  expect(summarizeReviewQueue(items)).toEqual({
    total: 2,
    seen: 1,
    unread: 1,
  });
});

it("keeps feedback and drafts for every browser-commentable file kind", () => {
  const comments = [
    {
      ...makeReviewComment("open-doc", "docs/review.html", "open"),
      threadId: "thread-doc",
    },
    {
      ...makeReviewComment("open-css", "ui/styles/review.css", "open"),
      threadId: "thread-css",
    },
  ];

  const items = buildReviewQueueItems(
    [],
    comments,
    {},
    new Set(["docs/review.html"]),
    {
      unseenFeedbackPaths: new Set([
        "docs/review.html",
        "ui/styles/review.css",
      ]),
      draftComments: [
        {
          id: "draft-legacy-code",
          path: "ui/src/review.ts",
          viewerKind: "text",
          anchor: {
            surface: "source",
            canonical: { path: "ui/src/review.ts", lineStart: 1, lineEnd: 1 },
          },
          body: "Legacy source draft",
          createdAt: "2026-06-20T00:01:00.000Z",
          updatedAt: "2026-06-20T00:01:00.000Z",
        },
      ],
    },
  );

  expect(items.map((item) => item.path)).toEqual([
    "docs/review.html",
    "ui/src/review.ts",
    "ui/styles/review.css",
  ]);
});

it("builds the queue from recent activity independently of git changes", () => {
  const now = Date.parse("2026-06-20T00:30:00.000Z");
  const recentActivityByPath = {
    "notes/older.txt": now - 2_000,
    "src/newer.ts": now - 1_000,
  };
  const recent = buildReviewQueueItems([], [], {}, new Set(), {
    recentActivityByPath,
  });

  expect(recent.map((item) => item.path)).toEqual([
    "src/newer.ts",
    "notes/older.txt",
  ]);
  expect(recent[0]).toMatchObject({
    change: null,
    lastActivityAt: now - 1_000,
  });

  const feedback = {
    ...makeReviewComment("feedback-1", "docs/feedback.md", "resolved"),
    threadId: "thread-feedback",
    createdBy: { id: "human:tasuku", kind: "human" as const },
  };
  expect(
    buildReviewQueueItems([], [feedback], {}, new Set(), {
      recentActivityByPath: { "docs/feedback.md": now },
    }).map((item) => item.path),
  ).toEqual(["docs/feedback.md"]);
  expect(buildReviewQueueItems([], [feedback], {}, new Set())).toEqual([]);
});

it("retains every watcher path observed inside the shared activity window", () => {
  const now = 100_000;
  const events = Array.from({ length: 41 }, (_, index) => ({
    type: "change" as const,
    path: `docs/file-${index}.md`,
    kind: "file" as const,
    version: index + 1,
  })).reduce(
    (items, event, index) => recordReviewEvent(items, event, now + index),
    [] as ReturnType<typeof recordReviewEvent>,
  );

  expect(events).toHaveLength(41);
  expect(summarizeReviewEvents(events).changedPaths.size).toBe(41);
});

it("compacts watcher churn and excludes directories and rename ghosts", () => {
  const directoryAdd = {
    type: "add" as const,
    path: "docs/new-directory",
    kind: "directory" as const,
    version: 1,
  };
  expect(isFileReviewActivityEvent(directoryAdd)).toBe(false);
  expect(
    isFileReviewActivityEvent({
      type: "change",
      path: "docs/file.md",
      version: 2,
    }),
  ).toBe(true);

  const churn = Array.from({ length: 10_000 }, (_, index) => ({
    type: "change" as const,
    path: "docs/file.md",
    version: index + 1,
  })).reduce(
    (items, event, index) => recordReviewEvent(items, event, 100_000 + index),
    [] as ReturnType<typeof recordReviewEvent>,
  );
  expect(churn).toHaveLength(1);

  const renameEvents = [
    {
      type: "unlink" as const,
      path: "docs/old.md",
      kind: "file" as const,
      version: 1,
    },
    {
      type: "add" as const,
      path: "docs/new.md",
      kind: "file" as const,
      version: 2,
    },
    {
      type: "change" as const,
      path: "docs/new.md",
      version: 3,
    },
  ].reduce(
    (items, event, index) => recordReviewEvent(items, event, 200_000 + index),
    [] as ReturnType<typeof recordReviewEvent>,
  );
  const renameState = summarizeReviewEvents(renameEvents);
  expect(
    fileReviewAttentionForQueue(
      { "docs/old.md": 200_000, "docs/new.md": 200_001 },
      renameState,
    ),
  ).toEqual({ "docs/new.md": 200_001 });

  const renameAfterLaterEditEvents = [
    {
      type: "unlink" as const,
      path: "docs/before.md",
      kind: "file" as const,
      version: 20,
    },
    {
      type: "add" as const,
      path: "docs/after.md",
      kind: "file" as const,
      version: 21,
    },
  ].reduce(
    (items, event, index) => recordReviewEvent(items, event, 250_000 + index),
    [] as ReturnType<typeof recordReviewEvent>,
  );
  const renameAfterLaterEditState = summarizeReviewEvents(
    recordReviewEvent(
      renameAfterLaterEditEvents,
      { type: "change", path: "docs/after.md", version: 22 },
      253_001,
    ),
  );
  expect(mergeReviewChanges(renameAfterLaterEditState, null)).toEqual([
    {
      path: "docs/after.md",
      originalPath: "docs/before.md",
      status: "renamed",
      source: "watcher",
    },
  ]);
  const renameAfterAtomicReplaceEvents = [...renameAfterLaterEditEvents];
  const afterAtomicUnlink = recordReviewEvent(
    renameAfterAtomicReplaceEvents,
    {
      type: "unlink",
      path: "docs/after.md",
      kind: "file",
      version: 26,
    },
    260_000,
  );
  expect(
    mergeReviewChanges(
      summarizeReviewEvents(
        recordReviewEvent(
          afterAtomicUnlink,
          {
            type: "add",
            path: "docs/after.md",
            kind: "file",
            version: 27,
          },
          260_001,
        ),
      ),
      null,
    ),
  ).toEqual([
    {
      path: "docs/after.md",
      originalPath: "docs/before.md",
      status: "renamed",
      source: "watcher",
    },
  ]);
  expect(
    mergeReviewChanges(
      summarizeReviewEvents(
        recordReviewEvent(
          renameAfterLaterEditEvents,
          {
            type: "unlink",
            path: "docs/after.md",
            kind: "file",
            version: 24,
          },
          270_000,
        ),
      ),
      null,
    ),
  ).toEqual([
    {
      path: "docs/after.md",
      status: "deleted",
      source: "watcher",
    },
  ]);

  const renameBackEvents = [
    {
      type: "unlink" as const,
      path: "docs/original.md",
      kind: "file" as const,
      version: 28,
    },
    {
      type: "add" as const,
      path: "docs/transient.md",
      kind: "file" as const,
      version: 29,
    },
    {
      type: "unlink" as const,
      path: "docs/transient.md",
      kind: "file" as const,
      version: 30,
    },
    {
      type: "add" as const,
      path: "docs/original.md",
      kind: "file" as const,
      version: 31,
    },
  ].reduce(
    (items, event, index) => recordReviewEvent(items, event, 450_000 + index),
    [] as ReturnType<typeof recordReviewEvent>,
  );
  const renameBackState = summarizeReviewEvents(renameBackEvents);
  expect(
    fileReviewAttentionForQueue(
      {
        "docs/original.md": 450_003,
        "docs/transient.md": 450_002,
      },
      renameBackState,
    ),
  ).toEqual({ "docs/original.md": 450_003 });
  expect(mergeReviewChanges(renameBackState, null)).toEqual([
    {
      path: "docs/original.md",
      status: "added",
      source: "watcher",
    },
  ]);

  const directoryUnlinkEvents = recordReviewEvent(
    [],
    {
      type: "unlink",
      path: "docs/removed-directory",
      kind: "directory",
      version: 4,
    },
    300_000,
  );
  expect(directoryUnlinkEvents).toEqual([]);
  expect(
    summarizeReviewEvents([
      {
        id: "legacy-directory-event",
        event: {
          type: "unlink",
          path: "docs/removed-directory",
          kind: "directory",
          version: 4,
        },
        receivedAt: 300_000,
      },
    ]).removedPaths,
  ).toEqual(new Set());

  const renameChainEvents = [
    {
      type: "unlink" as const,
      path: "docs/a.md",
      kind: "file" as const,
      version: 5,
    },
    {
      type: "add" as const,
      path: "docs/b.md",
      kind: "file" as const,
      version: 6,
    },
    {
      type: "unlink" as const,
      path: "docs/b.md",
      kind: "file" as const,
      version: 7,
    },
    {
      type: "add" as const,
      path: "docs/c.md",
      kind: "file" as const,
      version: 8,
    },
  ].reduce(
    (items, event, index) => recordReviewEvent(items, event, 400_000 + index),
    [] as ReturnType<typeof recordReviewEvent>,
  );
  const renameChainState = summarizeReviewEvents(renameChainEvents);
  expect(renameChainState.renamePairs).toEqual([
    {
      fromPath: "docs/a.md",
      toPath: "docs/c.md",
      receivedAt: 400_003,
      intermediatePaths: ["docs/b.md"],
    },
  ]);
  expect(mergeReviewChanges(renameChainState, null)).toEqual([
    {
      path: "docs/c.md",
      originalPath: "docs/a.md",
      status: "renamed",
      source: "watcher",
    },
  ]);
  expect(
    mergeReviewChanges(
      summarizeReviewEvents(
        recordReviewEvent(
          renameChainEvents,
          { type: "change", path: "docs/c.md", version: 23 },
          403_003,
        ),
      ),
      null,
    ),
  ).toEqual([
    {
      path: "docs/c.md",
      originalPath: "docs/a.md",
      status: "renamed",
      source: "watcher",
    },
  ]);
  expect(
    mergeReviewChanges(
      summarizeReviewEvents(
        recordReviewEvent(
          renameChainEvents,
          {
            type: "unlink",
            path: "docs/c.md",
            kind: "file",
            version: 25,
          },
          420_000,
        ),
      ),
      null,
    ),
  ).toEqual([
    {
      path: "docs/c.md",
      status: "deleted",
      source: "watcher",
    },
  ]);

  const replaceInPlaceEvents = [
    {
      type: "unlink" as const,
      path: "docs/saved.md",
      kind: "file" as const,
      version: 9,
    },
    {
      type: "add" as const,
      path: "docs/saved.md",
      kind: "file" as const,
      version: 10,
    },
  ].reduce(
    (items, event, index) => recordReviewEvent(items, event, 500_000 + index),
    [] as ReturnType<typeof recordReviewEvent>,
  );
  expect(
    mergeReviewChanges(summarizeReviewEvents(replaceInPlaceEvents), null),
  ).toEqual([
    {
      path: "docs/saved.md",
      status: "added",
      source: "watcher",
    },
  ]);
});

it("counts review queue files by signal without duplicating directory state", () => {
  const counts = reviewQueueSignalCounts([
    {
      path: "docs/product/brief.md",
      change: {
        path: "docs/product/brief.md",
        status: "modified",
        source: "git",
      },
      commentCount: 0,
      unread: true,
    },
    {
      path: "docs/review.html",
      change: null,
      commentCount: 1,
      pendingDraftCount: 2,
      unread: false,
    },
  ]);

  expect(counts).toEqual({ all: 2, unread: 1, drafts: 1, changed: 1 });
});

it("treats draft review comments as pending in-review work", () => {
  const items = buildReviewQueueItems(
    [{ path: "src/app.ts", status: "modified", source: "git" }],
    [],
    {},
    new Set(),
    {
      draftComments: [
        {
          id: "draft-1",
          path: "docs/product-review.md",
          viewerKind: "markdown",
          anchor: {
            surface: "source",
            canonical: {
              path: "docs/product-review.md",
              lineStart: 18,
              lineEnd: 18,
            },
          },
          body: "Mention the agent-readable contract before publish.",
          createdAt: "2026-06-20T00:01:00.000Z",
          updatedAt: "2026-06-20T00:01:00.000Z",
        },
      ],
    },
  );

  expect(items.map((item) => item.path)).toEqual([
    "docs/product-review.md",
    "src/app.ts",
  ]);
  expect(items[0]).toMatchObject({
    change: null,
    pendingDraftCount: 1,
    pendingDraftIds: ["draft-1"],
  });
});

it("uses agent reads, not replies, as Review Queue recency", () => {
  const comments = [
    {
      ...makeReviewComment("agent-open", "docs/agent.md", "open"),
      threadId: "thread-agent",
    },
    {
      ...makeReviewComment("quiet-open", "docs/quiet.md", "open"),
      threadId: "thread-quiet",
    },
    {
      ...makeReviewComment("human-open", "docs/human.md", "open"),
      threadId: "thread-human",
    },
  ];
  const items = buildReviewQueueItems(
    [
      { path: "docs/agent.md", status: "modified", source: "git" },
      { path: "docs/quiet.md", status: "modified", source: "git" },
      { path: "docs/human.md", status: "modified", source: "git" },
    ],
    comments,
    {
      "thread-agent": {
        inline: ["Codex replied 1m ago"],
        timeline: [
          {
            id: "activity-agent-reply",
            threadId: "thread-agent",
            type: "comment_added",
            actor: { id: "codex:1", kind: "codex" },
            createdAt: "2026-06-20T00:03:00.000Z",
          },
        ],
      },
      "thread-quiet": {
        inline: ["Codex read 2m ago"],
        timeline: [
          {
            id: "activity-agent-read",
            threadId: "thread-quiet",
            type: "thread_read",
            actor: { id: "codex:1", kind: "codex" },
            createdAt: "2026-06-20T00:02:00.000Z",
          },
        ],
      },
      "thread-human": {
        inline: ["Tasuku replied 3m ago"],
        timeline: [
          {
            id: "activity-human-reply",
            threadId: "thread-human",
            type: "comment_added",
            actor: { id: "human:tasuku", kind: "human" },
            createdAt: "2026-06-20T00:01:00.000Z",
          },
        ],
      },
    },
    new Set(),
  );

  expect(
    items.find((item) => item.path === "docs/agent.md")?.latestActivity,
  ).toBeUndefined();
  expect(
    items.find((item) => item.path === "docs/quiet.md")?.latestActivity,
  ).toMatchObject({ id: "activity-agent-read", type: "thread_read" });
  expect(
    items.find((item) => item.path === "docs/human.md")?.latestActivity,
  ).toBeUndefined();
});

it("keeps recent changes visible alongside pending drafts", () => {
  const changes: ReviewChangeItem[] = [
    { path: "docs/accepted.md", status: "modified", source: "git" },
    { path: "docs/reviewing.md", status: "modified", source: "git" },
  ];

  expect(
    buildReviewQueueItems(changes, [], {}, new Set()).map((item) => item.path),
  ).toEqual(["docs/accepted.md", "docs/reviewing.md"]);

  const itemsWithPendingDraft = buildReviewQueueItems(
    changes,
    [],
    {},
    new Set(),
    {
      draftComments: [
        {
          id: "accepted-pending",
          path: "docs/accepted.md",
          viewerKind: "markdown",
          anchor: {
            surface: "source",
            canonical: {
              path: "docs/accepted.md",
              lineStart: 4,
              lineEnd: 4,
            },
          },
          body: "This saved draft still needs an explicit Publish.",
          createdAt: "2026-07-01T00:00:00.000Z",
          updatedAt: "2026-07-01T00:00:00.000Z",
        },
      ],
    },
  );

  expect(itemsWithPendingDraft[0]).toMatchObject({
    path: "docs/accepted.md",
    pendingDraftCount: 1,
    pendingDraftIds: ["accepted-pending"],
  });
});

it("does not let legacy terminal thread state suppress recent activity", () => {
  const changes: ReviewChangeItem[] = [
    { path: "docs/resolved.md", status: "modified", source: "git" },
    { path: "docs/candidate.md", status: "modified", source: "git" },
  ];
  expect(
    buildReviewQueueItems(changes, [], {}, new Set()).map((item) => item.path),
  ).toEqual(["docs/resolved.md", "docs/candidate.md"]);

  const itemsWithReopenedThread = buildReviewQueueItems(
    changes,
    [
      {
        ...makeReviewComment("reopened-1", "docs/resolved.md", "open"),
        threadId: "thread-reopened",
      },
    ],
    {},
    new Set(["docs/resolved.md"]),
    { unseenFeedbackPaths: new Set(["docs/resolved.md"]) },
  );

  expect(itemsWithReopenedThread.map((item) => item.path)).toEqual([
    "docs/resolved.md",
    "docs/candidate.md",
  ]);
  expect(itemsWithReopenedThread[0]).toMatchObject({
    change: changes[0],
  });
});

it("hides every source path known missing from the active review queue", () => {
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
    new Set(["docs/agent.md"]),
    {
      knownMissingPaths: new Set(["README.md", "docs/deleted.md"]),
      unseenFeedbackPaths: new Set([
        "README.md",
        "docs/agent.md",
        "docs/deleted.md",
      ]),
    },
  );

  expect(items.map((item) => item.path).sort()).toEqual(["docs/agent.md"]);
  expect(items.find((item) => item.path === "README.md")).toBeUndefined();
  expect(items.find((item) => item.path === "docs/deleted.md")).toBeUndefined();
});

it("navigates the prioritized work queue and keeps read receipts low-noise", () => {
  const items = buildReviewQueueItems(
    [
      { path: "deleted.md", status: "deleted", source: "git" },
      { path: "src/app.ts", status: "modified", source: "git" },
    ],
    [makeReviewComment("open-1", "README.md", "open")],
    {},
    new Set(["README.md"]),
    { unseenFeedbackPaths: new Set(["README.md"]) },
  );
  expect(nextReviewQueueItemPath(items, null, "next")).toBe("README.md");
  expect(nextReviewQueueItemPath(items, "README.md", "next")).toBe(
    "src/app.ts",
  );
  expect(nextReviewQueueItemPathAfterCompletion(items, "README.md")).toBe(
    "src/app.ts",
  );
  expect(nextReviewQueueItemPathAfterCompletion(items, "src/app.ts")).toBe(
    "README.md",
  );
  expect(
    nextReviewQueueItemPathAfterCompletion([items[0]!], "README.md"),
  ).toBeNull();
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
});

it("builds feedback navigation targets without exposing legacy lifecycle state", () => {
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

  const feedbackTargets = feedbackNavigationTargets(comments);
  expect(feedbackTargets).toHaveLength(3);
  expect(feedbackTargets[0]).toMatchObject({
    threadId: "thread-a",
    commentId: "open-1",
    path: "docs/a.md",
    surface: "source",
  });
  expect(feedbackTargets[1]).toMatchObject({
    threadId: "resolved-1",
    commentId: "resolved-1",
    path: "docs/b.md",
    surface: "source",
  });
  expect(feedbackTargets[2]).toMatchObject({
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
      feedbackCount: feedbackTargets.length,
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
  ).toBe("3 feedback items");
  expect(
    feedbackNavigationTargets(comments, { reviewBatchId: "batch-1" }),
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
  expect(commentNavigationTarget(comments[0]!)).toMatchObject({
    id: "comment:open-1",
    threadId: "thread-a",
    commentId: "open-1",
    path: "docs/a.md",
    surface: "source",
    label: "Source comment in a.md",
  });
  expect(
    moveReviewNavigationTarget(feedbackTargets, { path: "docs/z.md" }, "next"),
  ).toBe(feedbackTargets[0]);
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
      canToggleDiff: true,
      diffEnabled: false,
      feedbackTargetCount: 3,
      reviewItemCount: 4,
      unseenReviewCount: 1,
    }),
  ).toMatchObject([
    {
      id: "return-current-stop",
      label: "Return to current thread",
      detail: "docs/a.md · L4",
      shortcut: "Cmd/Ctrl I",
    },
    {
      id: "open-latest-unseen",
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
      label: "Next feedback",
      shortcut: "Cmd/Ctrl ]",
    },
    {
      id: "open-previous-thread",
      label: "Previous feedback",
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
      canToggleDiff: false,
      diffEnabled: false,
      feedbackTargetCount: 0,
      reviewItemCount: 0,
      unseenReviewCount: 0,
    }),
  ).toEqual([]);
  expect(
    reviewCommandActions({
      activeComment: makeReviewComment("resolved-1", "docs/a.md", "resolved"),
      canToggleDiff: false,
      diffEnabled: false,
      feedbackTargetCount: 0,
      reviewItemCount: 0,
      unseenReviewCount: 0,
    }).map((action) => action.label),
  ).toEqual(["Return to current thread"]);
  expect(
    reviewCommandActions({
      activeComment: makeReviewComment("archived-1", "docs/a.md", "archived"),
      canToggleDiff: false,
      diffEnabled: false,
      feedbackTargetCount: 0,
      reviewItemCount: 0,
      unseenReviewCount: 0,
    }).map((action) => action.label),
  ).toEqual(["Return to current thread"]);
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

it("opens the first positioned feedback when legacy statuses coexist", () => {
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
  const items = buildReviewQueueItems(
    [],
    comments,
    {},
    new Set(["docs/a.md"]),
    { unseenFeedbackPaths: new Set(["docs/a.md"]) },
  );

  expect(firstRelevantThreadForReviewItem(items[0]!, comments)).toMatchObject({
    threadId: "thread-old",
    commentId: "resolved-1",
    surface: "source",
  });
});

it("uses scheduled inline comment ids instead of stale active comment state", () => {
  expect(inlineThreadFocusCommentId(null, "comment-next")).toBe("comment-next");
  expect(inlineThreadFocusCommentId("comment-current", "comment-next")).toBe(
    "comment-next",
  );
  expect(inlineThreadFocusCommentId("comment-current")).toBe("comment-current");
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
  ).toBe(2);
  expect(
    commentActivityThreadTargets({
      comments,
      selectedPath: null,
      reviewPaths: [],
    }),
  ).toEqual([]);
  expect(
    commentActivityThreadTargets({
      comments,
      selectedPath: null,
      reviewPaths: ["docs/b.md"],
    }),
  ).toEqual(["thread-b"]);
  expect(
    commentActivityThreadTargets({
      comments,
      selectedPath: "docs/a.md",
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

it("keeps color token definitions aligned across light and dark themes", () => {
  const css = readFileSync(
    new URL("../ui/src/styles.css", import.meta.url),
    "utf8",
  );
  const darkThemeBlock = cssBlockForSelector(css, ":root");
  const lightThemeBlock = cssBlockForSelector(css, ':root[data-theme="light"]');

  for (const tokenName of colorTokenNames) {
    expect(darkThemeBlock).toContain(`--${tokenName}:`);
    expect(lightThemeBlock).toContain(`--${tokenName}:`);
  }
});

it("keeps color usage on semantic token names", () => {
  const css = readFileSync(
    new URL("../ui/src/styles.css", import.meta.url),
    "utf8",
  );
  const darkThemeBlock = cssBlockForSelector(css, ":root");
  const retiredAliasPattern =
    /--(?:bg|panel|panel-2|text|muted|line|accent|warn|code|chrome|soft-line|accent-soft|accent-faint|accent-line|accent-strong|accent-glow|comment-tint|comment-tint-active|comment-line|comment-text|diff-add|diff-remove|overlay|palette|shadow|subtle|error|good)\b/;

  expect(darkThemeBlock).not.toMatch(retiredAliasPattern);

  for (const filePath of sourceFilesForColorTokenAudit()) {
    expect(readFileSync(filePath, "utf8"), filePath).not.toMatch(
      retiredAliasPattern,
    );
  }

  expect(colorTokenVar("vivi-color-accent")).toBe("var(--vivi-color-accent)");
});

function cssBlockForSelector(css: string, selector: string): string {
  const selectorIndex = css.indexOf(selector);
  expect(selectorIndex).toBeGreaterThanOrEqual(0);

  const blockStart = css.indexOf("{", selectorIndex);
  expect(blockStart).toBeGreaterThanOrEqual(0);

  let depth = 0;
  for (let index = blockStart; index < css.length; index += 1) {
    const char = css[index];
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth === 0) return css.slice(blockStart + 1, index);
  }

  throw new Error(`CSS block for ${selector} was not closed`);
}

function sourceFilesForColorTokenAudit(): string[] {
  const root = new URL("../ui/src/", import.meta.url);
  const sourceFiles: string[] = [];
  const visit = (directory: URL) => {
    for (const entry of readdirSync(directory)) {
      const entryUrl = new URL(entry, `${directory.href}/`);
      const stat = statSync(entryUrl);
      if (stat.isDirectory()) {
        visit(entryUrl);
        continue;
      }
      if (/\.(css|ts|tsx)$/.test(entry)) sourceFiles.push(entryUrl.pathname);
    }
  };

  visit(root);
  return sourceFiles;
}

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
      reviewAttention: {
        "README.md": now - 1,
        "missing.md": now,
      },
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
  expect(restored?.reviewAttention).toEqual({ "README.md": now - 1 });
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

it("migrates recent files into the shared attention clock", () => {
  const now = 100_000;
  const stored = parseWorkspaceSession(
    JSON.stringify({
      version: 1,
      root: "/workspace",
      updatedAt: now,
      openTabs: [],
      layout: initialEditorLayout,
      recentFiles: [
        {
          path: "README.md",
          viewerKind: "markdown",
          lastOpenedAt: now - 1_000,
        },
      ],
      inspectorVisible: true,
    }),
  );
  const restored = restoreWorkspaceSession(
    stored,
    "/workspace",
    new Set(["README.md"]),
    now,
  );

  expect(stored?.reviewAttention).toBeUndefined();
  expect(restored?.reviewAttention).toEqual({ "README.md": now - 1_000 });
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
      children: Array.from({ length: 20 }, (_, index): FsNode => ({
        id: `src/file-${index}.ts`,
        path: `src/file-${index}.ts`,
        name: `file-${index}.ts`,
        kind: "file",
        parentPath: "src",
        viewerKind: "code",
      })),
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

  expect(
    treeKeyboardAction(rows, new Set(["docs"]), "docs", "ArrowDown"),
  ).toEqual({ kind: "focus", path: "docs/readme.md" });
  expect(
    treeKeyboardAction(rows, new Set(["docs"]), "docs/readme.md", "ArrowLeft"),
  ).toEqual({ kind: "focus", path: "docs" });
  expect(
    treeKeyboardAction(rows, new Set(["docs"]), "docs", "ArrowLeft"),
  ).toEqual({ kind: "toggle", path: "docs" });
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
