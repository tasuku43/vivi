import { expect, it, vi } from "vitest";
import type { FilePayload, FsNode } from "../ui/src/domain/fs-node.js";
import type { FileSearchResult } from "../ui/src/domain/search.js";
import { iconForPath, languageForPath } from "../ui/src/state/file-icons.js";
import {
  clampPaletteSelection,
  movePaletteSelection,
} from "../ui/src/state/command-palette.js";
import {
  filterTreeToPaths,
  fuzzyFileResults,
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
  buildTextSearchItems,
} from "../ui/src/state/search-palette.js";
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
  maxInspectorWidth,
  maxSidebarWidth,
  minInspectorWidth,
  minSidebarWidth,
  shouldCollapseInspector,
} from "../ui/src/state/workbench-layout.js";
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
  summarizeReviewQueue,
} from "../ui/src/state/review-queue.js";
import {
  boundedVisibleTreeRows,
  countTreeNodes,
  ensureVisibleAncestors,
  initialExpandedPaths,
  visibleTreeRows,
} from "../ui/src/state/tree-expansion.js";
import { inspectorTargetLabel } from "../ui/src/features/review-queue/Inspector.js";

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
});

it("labels the inspector target with file and pane identity", () => {
  const file: FilePayload = {
    path: "docs/README.md",
    viewerKind: "markdown",
    encoding: "utf8",
    content: "# Hello",
    etag: "sha256:test",
    size: 7,
    mtimeMs: 1,
  };

  expect(inspectorTargetLabel(file, "pane-3")).toBe("README.md · pane-3");
  expect(inspectorTargetLabel(null, "main")).toBe("No file · main");
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
  expect(keyboardShortcutAction({ ...command, key: "F", shiftKey: true })).toBe(
    "search-text",
  );
  expect(keyboardShortcutAction({ ...command, key: "d" })).toBe("toggle-diff");
  expect(keyboardShortcutAction({ ...command, key: "U", shiftKey: true })).toBe(
    "open-latest-unread",
  );
  expect(keyboardShortcutAction({ ...command, key: "J", shiftKey: true })).toBe(
    "open-next-review",
  );
  expect(keyboardShortcutAction({ ...command, key: "K", shiftKey: true })).toBe(
    "open-previous-review",
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
  ).toEqual({ additions: 2, deletions: 1 });
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
  expect(restored?.layout.activePaneId).toBe("pane-1");
  expect(restored?.inspectorVisible).toBe(false);
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

it("persists focused diff settings by file path in workspace sessions", () => {
  const now = 250_000;
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
      diffFocusByPath: {
        "README.md": true,
        "src/app.ts": false,
        "missing.md": true,
      },
    },
    now,
  );
  const restored = restoreWorkspaceSession(
    stored,
    "/workspace",
    new Set(["README.md", "src/app.ts"]),
    now,
  );

  expect(stored.diffFocusByPath).toEqual({
    "README.md": true,
    "src/app.ts": false,
    "missing.md": true,
  });
  expect(restored?.diffFocusByPath).toEqual({ "README.md": true });
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
  expect(parseWorkspaceSession(raw)?.diffEnabled).toBe(false);
  expect(parseWorkspaceSession(raw)?.diffFocusByPath).toEqual({});
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
    },
  ]);
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
  expect(diffSupportForFile({ viewerKind: "json", encoding: "utf8" })).toEqual({
    supported: true,
    renderKind: "source",
  });
  expect(supportsDiffMode({ viewerKind: "json", encoding: "base64" })).toBe(
    false,
  );
  expect(diffUnsupportedViewerKinds).toEqual([]);
});
