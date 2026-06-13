import { expect, it } from "vitest";
import type { FilePayload, FsNode } from "../src/domain/fs-node.js";
import { iconForPath, languageForPath } from "../src/ui/state/file-icons.js";
import {
  clampPaletteSelection,
  movePaletteSelection,
} from "../src/ui/state/command-palette.js";
import {
  filterTreeToPaths,
  fuzzyFileResults,
  reviewArtifactResults,
} from "../src/ui/state/files.js";
import {
  buildSideBySideDiffRows,
  changeStatusLabel,
  diffStatusLabel,
  mergeReviewChanges,
  parseUnifiedDiff,
} from "../src/ui/state/git-review.js";
import {
  buildPaletteItems,
  filterCommandActions,
  type CommandAction,
} from "../src/ui/state/command-actions.js";
import {
  flattenPanes,
  initialEditorLayout,
  setPaneActivePath,
  splitEditorPane,
} from "../src/ui/state/editor-layout.js";
import {
  closeOpenTab,
  markTabChanged,
  moveOpenTab,
  upsertOpenTab,
} from "../src/ui/state/tabs.js";
import {
  isThemePreference,
  nextThemePreference,
  resolveThemePreference,
  themePreferenceLabel,
} from "../src/ui/state/theme.js";
import {
  buildWorkspaceSession,
  collectFilePaths,
  parseWorkspaceSession,
  recordRecentFile,
  restoreWorkspaceSession,
  workspaceSessionStorageKeyForRoot,
  workspaceSessionTtlMs,
} from "../src/ui/state/workspace-session.js";
import {
  defaultViewerMode,
  nextViewerMode,
  supportsSourceToggle,
} from "../src/ui/state/viewer-mode.js";
import { summarizeReviewEvents } from "../src/ui/state/review-events.js";
import {
  boundedVisibleTreeRows,
  countTreeNodes,
  ensureVisibleAncestors,
  initialExpandedPaths,
  visibleTreeRows,
} from "../src/ui/state/tree-expansion.js";
import { inspectorTargetLabel } from "../src/ui/components/Inspector.js";

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

it("maps common file paths to IDE-style icons and highlight languages", () => {
  expect(iconForPath("config.yaml", "code")).toBe("YAML");
  expect(languageForPath("config.yaml", "code")).toBe("yaml");
  expect(iconForPath("src/app.ts", "code")).toBe("TS");
  expect(languageForPath("src/app.ts", "code")).toBe("typescript");
  expect(iconForPath("data/sample.json", "json")).toBe("{}");
  expect(languageForPath("data/sample.json", "json")).toBe("json");
  expect(iconForPath("Dockerfile", "code")).toBe("DOCK");
  expect(languageForPath("Dockerfile", "code")).toBe("dockerfile");
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

it("moves command palette selection with keyboard wrapping", () => {
  expect(clampPaletteSelection(0, 0)).toBe(-1);
  expect(clampPaletteSelection(8, 3)).toBe(2);
  expect(movePaletteSelection(0, 3, 1)).toBe(1);
  expect(movePaletteSelection(2, 3, 1)).toBe(0);
  expect(movePaletteSelection(0, 3, -1)).toBe(2);
  expect(movePaletteSelection(-1, 3, 1)).toBe(1);
});

it("merges Git working tree changes with live review events", () => {
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
    changes: [{ path: "reports/new.csv", status: "added" }],
  });

  expect(merged).toEqual([
    {
      originalPath: "docs/old.md",
      path: "docs/new.md",
      status: "renamed",
      source: "watcher",
    },
    { path: "old.log", status: "deleted", source: "watcher" },
    { path: "README.md", status: "modified", source: "watcher" },
    { path: "reports/new.csv", status: "added", source: "git" },
  ]);
  expect(changeStatusLabel("renamed")).toBe("Renamed");
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
    "pathlens.workspaceSession.v1:%2Ftmp%2Fa%20project",
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
});

it("builds command palette items from read-only actions and files", () => {
  const actions: CommandAction[] = [
    {
      id: "toggle-inspector",
      label: "Toggle inspector",
      detail: "Toggle right inspector",
      keywords: ["right", "metadata"],
    },
    {
      id: "close-tab",
      label: "Close tab",
      detail: "No active tab",
      keywords: ["tab"],
      disabled: true,
    },
  ];
  const nodes: FsNode[] = [
    {
      id: "reports/index.html",
      path: "reports/index.html",
      name: "index.html",
      kind: "file",
      parentPath: null,
      viewerKind: "html",
    },
  ];

  expect(filterCommandActions(actions, "inspect")[0]?.id).toBe(
    "toggle-inspector",
  );
  expect(
    buildPaletteItems(nodes, actions, "index").map((item) => item.id),
  ).toContain("file:reports/index.html");
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
