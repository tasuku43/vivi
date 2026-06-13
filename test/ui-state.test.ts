import { expect, it } from "vitest";
import type { FilePayload, FsNode } from "../src/domain/fs-node.js";
import { iconForPath, languageForPath } from "../src/ui/state/file-icons.js";
import { fuzzyFileResults } from "../src/ui/state/files.js";
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
