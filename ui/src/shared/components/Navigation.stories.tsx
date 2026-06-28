import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import type { FsNode } from "../../domain/fs-node.js";
import { replaceDirectoryChildren } from "../../state/files.js";
import {
  sampleTabs,
  sampleWorkspaceTree,
  storyRoot,
} from "../../storybook/fixtures/review-lab.js";
import { OpenTabs } from "./OpenTabs.js";
import { ShortcutHelp } from "./ShortcutHelp.js";
import { Topbar } from "./Topbar.js";
import { TreeSidebar } from "./TreeSidebar.js";
import { WorkspaceStatusbar } from "./WorkspaceStatusbar.js";
import sharedUiStyles from "../styles/SharedUi.module.css";

const meta = {
  title: "Workspace/Navigation Chrome",
  parameters: {
    layout: "fullscreen",
    a11y: { test: "error" },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const activateTab = fn();
const openStaleCommentRouting = fn();
const lazyRevealLoadCalls: string[] = [];

export const TopbarStory: Story = {
  name: "Workspace topbar shows review status",
  render: () => (
    <Topbar
      root={storyRoot}
      themePreference="system"
      openCommentThreadCount={6}
      onThemeCycle={() => undefined}
      onQuickOpen={() => undefined}
      onSearchText={() => undefined}
      onOpenComments={() => undefined}
      onOpenShortcuts={() => undefined}
    />
  ),
};

export const TopbarWithStaleCommentRouting: Story = {
  name: "Topbar routes stale comments to review work",
  render: () => (
    <Topbar
      root={storyRoot}
      themePreference="system"
      openCommentThreadCount={3}
      reviewOpenCommentThreadCount={1}
      onThemeCycle={() => undefined}
      onQuickOpen={() => undefined}
      onSearchText={() => undefined}
      onOpenComments={openStaleCommentRouting}
      onOpenShortcuts={() => undefined}
    />
  ),
  play: async ({ canvasElement }) => {
    openStaleCommentRouting.mockClear();
    const canvas = within(canvasElement);
    const commentsButton = canvas.getByRole("button", {
      name: "Open Comments inbox, 3 open threads, 1 open review thread",
    });
    await expect(commentsButton).toHaveAttribute(
      "title",
      "Open Comments inbox: 3 open threads, 1 open review thread (Cmd/Ctrl+Shift+C)",
    );
    await userEvent.click(commentsButton);
    await expect(openStaleCommentRouting).toHaveBeenCalled();
  },
};

export const SidebarFileTree: Story = {
  name: "Live file tree keeps selected and changed paths visible",
  render: () => (
    <aside
      className={`${sharedUiStyles.sidebar} sidebar`}
      aria-label="File explorer"
      style={{ width: 320, height: "100vh" }}
    >
      <div className={`${sharedUiStyles.panelTitle} panel-title`}>
        <span>Explorer</span>
        <span className={`${sharedUiStyles.pill} pill`}>live</span>
      </div>
      <TreeSidebar
        nodes={sampleWorkspaceTree.nodes}
        selectedPath="ui/src/features/workbench/WorkbenchContainer.tsx"
        changedPaths={
          new Set([
            "ui/src/features/workbench/WorkbenchContainer.tsx",
            "docs/product-review.md",
          ])
        }
        removedPaths={new Set(["server/graphql/schema.graphqls"])}
        onSelect={() => undefined}
        onOpen={() => undefined}
      />
    </aside>
  ),
};

const lazyBreadcrumbRevealTree: FsNode[] = [
  {
    id: "docs",
    path: "docs",
    name: "docs",
    kind: "directory",
    parentPath: null,
    childrenLoaded: false,
  },
  {
    id: "README.md",
    path: "README.md",
    name: "README.md",
    kind: "file",
    parentPath: null,
    viewerKind: "markdown",
    size: 1200,
  },
];

const lazyDocsChildren: FsNode[] = [
  ...Array.from({ length: 28 }, (_, index) =>
    lazyFileNode(
      `docs/${String(index + 1).padStart(2, "0")}-reference.md`,
      "markdown",
    ),
  ),
  {
    id: "docs/ui-mocks",
    path: "docs/ui-mocks",
    name: "ui-mocks",
    kind: "directory",
    parentPath: "docs",
    childrenLoaded: false,
  },
];

const lazyUiMockChildren: FsNode[] = [
  lazyFileNode("docs/ui-mocks/01-classic-explorer.html", "html"),
  lazyFileNode("docs/ui-mocks/02-doc-reader.html", "html"),
  lazyFileNode("docs/ui-mocks/index.html", "html"),
];

function SidebarLazyBreadcrumbRevealDemo() {
  const [nodes, setNodes] = useState(lazyBreadcrumbRevealTree);
  const [loadingDirectoryPaths, setLoadingDirectoryPaths] = useState<
    Set<string>
  >(new Set());

  async function loadDirectory(path: string) {
    lazyRevealLoadCalls.push(path);
    setLoadingDirectoryPaths((items) => new Set(items).add(path));
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    const children =
      path === "docs"
        ? lazyDocsChildren
        : path === "docs/ui-mocks"
          ? lazyUiMockChildren
          : [];
    setNodes((current) => replaceDirectoryChildren(current, path, children));
    setLoadingDirectoryPaths((items) => {
      const next = new Set(items);
      next.delete(path);
      return next;
    });
  }

  return (
    <aside
      className={`${sharedUiStyles.sidebar} sidebar`}
      aria-label="File explorer"
      style={{ width: 320, height: 240 }}
    >
      <div className={`${sharedUiStyles.panelTitle} panel-title`}>
        <span>Explorer</span>
        <span className={`${sharedUiStyles.pill} pill`}>live</span>
      </div>
      <TreeSidebar
        nodes={nodes}
        selectedPath="docs/ui-mocks/02-doc-reader.html"
        revealPath="docs/ui-mocks/02-doc-reader.html"
        loadingDirectoryPaths={loadingDirectoryPaths}
        onLoadDirectory={loadDirectory}
        onSelect={() => undefined}
        onOpen={() => undefined}
      />
    </aside>
  );
}

export const SidebarRevealsLazyBreadcrumbTarget: Story = {
  name: "File tree reveals a lazy-loaded breadcrumb target",
  tags: ["interaction"],
  render: () => {
    lazyRevealLoadCalls.length = 0;
    return <SidebarLazyBreadcrumbRevealDemo />;
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("treeitem", { name: /docs, folder, expanded/i }),
    ).toBeVisible();
    await waitFor(() => {
      expect(lazyRevealLoadCalls).toContain("docs");
      expect(lazyRevealLoadCalls).toContain("docs/ui-mocks");
      expect(lazyRevealLoadCalls.indexOf("docs")).toBeLessThan(
        lazyRevealLoadCalls.indexOf("docs/ui-mocks"),
      );
    });
    const target = canvasElement.querySelector<HTMLElement>(
      '[data-tree-path="docs/ui-mocks/02-doc-reader.html"]',
    );
    const sidebar = canvasElement.querySelector<HTMLElement>(".sidebar");
    expect(target).not.toBeNull();
    expect(sidebar).not.toBeNull();
    await waitFor(() => {
      const targetRect = target!.getBoundingClientRect();
      const sidebarRect = sidebar!.getBoundingClientRect();
      expect(targetRect.top).toBeGreaterThanOrEqual(sidebarRect.top);
      expect(targetRect.bottom).toBeLessThanOrEqual(sidebarRect.bottom);
    });
  },
};

function lazyFileNode(
  path: string,
  viewerKind: FsNode["viewerKind"],
): FsNode {
  return {
    id: path,
    path,
    name: path.split("/").at(-1) ?? path,
    kind: "file",
    parentPath: path.split("/").slice(0, -1).join("/") || null,
    viewerKind,
    size: 1200,
  };
}

export const Tabs: Story = {
  name: "Multiple open files stay visible as tabs",
  render: () => (
    <div style={{ padding: 24 }}>
      <OpenTabs
        tabs={sampleTabs}
        activePath="ui/src/features/workbench/WorkbenchContainer.tsx"
        paneId="main"
        onActivate={activateTab}
        onClose={() => undefined}
        onPromote={() => undefined}
        onCloseOtherTabs={() => undefined}
        onCloseTabsToRight={() => undefined}
        onCloseUnchangedTabs={() => undefined}
        onClosePreviewTabs={() => undefined}
        onDropTab={() => undefined}
        onDragStateChange={() => undefined}
        onManualDragStart={() => undefined}
      />
    </div>
  ),
  play: async ({ canvasElement }) => {
    activateTab.mockClear();
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole("tab", { name: "docs/product-review.md" }),
    );
    await expect(activateTab).toHaveBeenCalledWith("docs/product-review.md");
  },
};

export const ShortcutHelpOverlay: Story = {
  name: "Shortcut help overlay is open",
  render: () => <ShortcutHelp open onClose={() => undefined} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Open next in-review reply")).toBeVisible();
    await expect(canvas.getByText("Return to current thread")).toBeVisible();
    await expect(
      canvas.getByText("Resolve / reopen current thread"),
    ).toBeVisible();
    await expect(canvas.getByText("Archive current thread")).toBeVisible();
  },
};

export const Statusbar: Story = {
  name: "Statusbar summarizes watchers, tabs, and server state",
  render: () => (
    <div
      className={`${sharedUiStyles.appShell} app-shell`}
      style={{ minHeight: 120 }}
    >
      <WorkspaceStatusbar
        status={{
          workspace: "5 watched files · 3 open tabs",
          activeFile: "README.md · rendered",
          review: "6 review files · 7 comments · 3 drafts",
          server: "Server live · waiting for changes",
          serverTone: "live",
          detail: "",
        }}
      />
    </div>
  ),
};
