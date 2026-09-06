import { SidebarSelectionFacade } from "../../storybook/SidebarSelectionFacade.js";
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
import { ReaderWelcome, ReadingHint } from "./ReaderGuidance.js";
import {
  closeOtherOpenTabs,
  closeTabsToRight,
  closeUnchangedTabs,
  closePreviewTabs,
  closeOpenTab,
  promoteOpenTab,
  type OpenTab,
} from "../../state/tabs.js";
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
const lazyRevealLoadCalls: string[] = [];

export const TopbarStory: Story = {
  name: "Workspace topbar shows review status",
  render: () => (
    <Topbar
      root={storyRoot}
      themePreference="system"
      onThemeCycle={() => undefined}
      onQuickOpen={() => undefined}
      onSearchText={() => undefined}
      onOpenShortcuts={() => undefined}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("vivi-brand-icon")).toHaveAttribute(
      "src",
      "/vivi/brand/vivi-icon.svg",
    );
    await expect(
      canvas.queryByRole("button", { name: /Open Comments hub/ }),
    ).not.toBeInTheDocument();
    await expect(
      canvas.getByRole("button", { name: "Open command palette" }),
    ).toBeInTheDocument();
    await expect(
      canvas.getByRole("button", { name: "Search workspace text" }),
    ).toBeInTheDocument();
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

function lazyFileNode(path: string, viewerKind: FsNode["viewerKind"]): FsNode {
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
      canvas.getByRole("button", { name: "docs/product-review.md" }),
    );
    await expect(activateTab).toHaveBeenCalledWith("docs/product-review.md");
  },
};

export const ShortcutHelpOverlay: Story = {
  name: "Shortcut help overlay is open",
  render: () => <ShortcutHelpHarness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = canvas.getByRole("button", {
      name: "Show keyboard shortcuts",
    });
    await userEvent.click(trigger);
    const close = canvas.getByRole("button", {
      name: "Close keyboard shortcuts",
    });
    await waitFor(() => expect(close).toHaveFocus());
    await userEvent.tab();
    await expect(close).toHaveFocus();
    await expect(canvas.getByText("Open next unseen item")).toBeVisible();
    await expect(canvas.getByText("Return to current thread")).toBeVisible();
    await expect(canvas.queryByText(/in-review reply/i)).toBeNull();
    await expect(canvas.queryByText(/resolve \/ reopen/i)).toBeNull();
    await expect(canvas.queryByText(/archive current thread/i)).toBeNull();
    await userEvent.click(close);
    await waitFor(() => expect(trigger).toHaveFocus());
    await userEvent.click(trigger);
    await waitFor(() =>
      expect(
        canvas.getByRole("button", { name: "Close keyboard shortcuts" }),
      ).toHaveFocus(),
    );
  },
};

function ShortcutHelpHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Show keyboard shortcuts
      </button>
      <ShortcutHelp open={open} onClose={() => setOpen(false)} />
    </>
  );
}

export const Statusbar: Story = {
  name: "Quiet status keeps drafts and disconnection visible",
  tags: ["interaction"],
  render: () => <StatusbarExample />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = canvas.getByRole("button", {
      name: "Workspace status details",
    });
    await expect(canvas.getByText("3 drafts · not published")).toBeVisible();
    await expect(
      canvas.queryByRole("region", { name: "Workspace details" }),
    ).not.toBeInTheDocument();
    await userEvent.click(trigger);
    await expect(
      canvas.getByRole("region", { name: "Workspace details" }),
    ).toBeVisible();
    await expect(
      canvas.getByText("5 watched files · 3 open tabs"),
    ).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await expect(trigger).toHaveFocus();
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await userEvent.keyboard("{Enter}");
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await userEvent.click(
      canvas.getByRole("button", { name: "Disconnect fixture" }),
    );
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await expect(
      canvas.getByText("Disconnected · updates paused"),
    ).toBeVisible();
    await expect(canvas.getByText("3 drafts · not published")).toBeVisible();
    await userEvent.click(
      canvas.getByRole("button", { name: "Reconnect fixture" }),
    );
    await expect(canvas.getByText("Live")).toBeVisible();
    await userEvent.click(trigger);
    await expect(canvas.getByText("README.md · rendered")).toBeVisible();
    await expect(canvas.getByText("3 drafts · not published")).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await expect(trigger).toHaveFocus();
    await userEvent.tab({ shift: true });
  },
};

function StatusbarExample() {
  const [offline, setOffline] = useState(false);
  return (
    <div style={{ width: 560, maxWidth: "100%", paddingTop: 260 }}>
      <button onClick={() => setOffline(!offline)}>
        {offline ? "Reconnect fixture" : "Disconnect fixture"}
      </button>
      <WorkspaceStatusbar
        status={{
          workspace: "5 watched files · 3 open tabs",
          activeFile: "README.md · rendered",
          review: "7 feedback items · 1 unavailable file · 3 drafts",
          draftCount: 3,
          unavailableFeedbackCount: 1,
          server: offline
            ? "Disconnected · live updates paused"
            : "Live · waiting for changes",
          serverTone: offline ? "offline" : "live",
          detail: "3 review refreshes · last review 12ms",
        }}
      />
    </div>
  );
}

function HeadingTreeExample() {
  const [selected, setSelected] = useState("docs/01-intro.md");
  const [updated, setUpdated] = useState(false);
  const nodes: FsNode[] = [
    {
      id: "docs",
      path: "docs",
      name: "docs",
      kind: "directory",
      parentPath: null,
      children: [
        [
          "01-intro.md",
          updated ? "新しい導入の見出し" : "読み始めるためのガイド",
        ],
        ["02-guide.md", "読み始めるためのガイド"],
        [
          "03-details.html",
          "初めての利用でも迷わず読み始められる文書体験を設計するための詳しいガイド",
        ],
        ["04-no-heading.md", ""],
        ["05-unavailable.md", null],
      ].map(([name, documentHeading]) => ({
        id: `docs/${name}`,
        path: `docs/${name}`,
        name: name!,
        kind: "file",
        parentPath: "docs",
        viewerKind: name!.endsWith("html") ? "html" : "markdown",
        documentHeading,
      })),
    },
  ];
  return (
    <aside
      aria-label="Document heading explorer"
      style={{ width: 280, minHeight: 480 }}
    >
      <TreeSidebar
        nodes={nodes}
        selectedPath={selected}
        showBadges={false}
        onSelect={setSelected}
        onOpen={setSelected}
      />
      <button onClick={() => setUpdated(true)}>Update selected H1</button>
    </aside>
  );
}
export const DocumentHeadings: Story = {
  name: "File names remain primary with H1 underneath",
  tags: ["interaction"],
  render: () => <HeadingTreeExample />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const paths = () =>
      canvas
        .getAllByRole("treeitem")
        .map((row) => row.getAttribute("data-tree-path"));
    const before = paths();
    const first = canvas.getByRole("treeitem", { name: /01-intro.md/ });
    await userEvent.click(first);
    await expect(first).toHaveAttribute("aria-selected", "true");
    await userEvent.keyboard("{ArrowDown}{Enter}");
    await expect(
      canvas.getByRole("treeitem", { name: /02-guide.md/ }),
    ).toHaveAttribute("aria-selected", "true");
    await userEvent.click(first);
    await userEvent.click(
      canvas.getByRole("button", { name: "Update selected H1" }),
    );
    await expect(canvas.getByText("新しい導入の見出し")).toBeVisible();
    await expect(first).toHaveAttribute("aria-selected", "true");
    await expect(paths()).toEqual(before);
    await expect(canvas.getByText("No H1")).toBeVisible();
    await expect(canvas.getByText("Heading unavailable")).toBeVisible();
  },
};

function QuietTabsExample() {
  const [tabs, setTabs] = useState<OpenTab[]>([
    {
      path: "docs/README.md",
      viewerKind: "markdown",
      paneId: "main",
      isPreview: true,
    },
    {
      path: "notes/README.md",
      viewerKind: "markdown",
      paneId: "main",
      changed: true,
    },
    {
      path: "docs/a-long-document-name-that-remains-identifiable.html",
      viewerKind: "html",
      paneId: "main",
    },
  ]);
  const [active, setActive] = useState<string | null>("docs/README.md");
  function apply(result: { tabs: OpenTab[]; nextActivePath: string | null }) {
    setTabs(result.tabs);
    setActive(result.nextActivePath);
  }
  return (
    <div style={{ maxWidth: 520 }}>
      <OpenTabs
        tabs={tabs}
        activePath={active}
        paneId="main"
        onActivate={setActive}
        onClose={(path) => apply(closeOpenTab(tabs, path, active, "main"))}
        onPromote={(path) => setTabs(promoteOpenTab(tabs, path, "main"))}
        onCloseOtherTabs={() => apply(closeOtherOpenTabs(tabs, active, "main"))}
        onCloseTabsToRight={() => apply(closeTabsToRight(tabs, active, "main"))}
        onCloseUnchangedTabs={() =>
          apply(closeUnchangedTabs(tabs, active, "main"))
        }
        onClosePreviewTabs={() => apply(closePreviewTabs(tabs, active, "main"))}
        onDropTab={() => undefined}
        onDragStateChange={() => undefined}
        onManualDragStart={() => undefined}
      />
      <button>Continue reading</button>
    </div>
  );
}
export const QuietTabActions: Story = {
  name: "Quiet tab actions preserve preview, changed and duplicate files",
  tags: ["interaction"],
  render: () => <QuietTabsExample />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const page = within(canvasElement.ownerDocument.body);
    const trigger = canvas.getByRole("button", { name: "Tab actions" });
    await userEvent.click(trigger);
    await expect(
      page.getByRole("menuitem", { name: "Keep preview open" }),
    ).toHaveFocus();
    await userEvent.keyboard("{End}{Escape}");
    await expect(trigger).toHaveFocus();
    await expect(page.queryByRole("menu")).not.toBeInTheDocument();
    await userEvent.keyboard("{ArrowDown}{Enter}");
    await expect(
      canvas.getByRole("button", { name: "docs/README.md" }),
    ).toHaveAttribute("aria-current", "true");
    await userEvent.click(trigger);
    await expect(
      page.getByRole("menuitem", { name: "Keep preview open" }),
    ).toBeDisabled();
    await userEvent.click(
      page.getByRole("menuitem", { name: "Close unchanged tabs" }),
    );
    await expect(
      canvas.getByRole("button", { name: "notes/README.md changed" }),
    ).toBeVisible();
    await expect(
      canvas.queryByRole("button", { name: "docs/README.md" }),
    ).not.toBeInTheDocument();
    await userEvent.click(trigger);
    await expect(
      page.getByRole("menuitem", { name: "Close other tabs" }),
    ).toBeDisabled();
    await userEvent.click(
      canvas.getByRole("button", { name: "Continue reading" }),
    );
    await expect(page.queryByRole("menu")).not.toBeInTheDocument();
  },
};
const findDocument = fn();
export const ReaderFirstOpen: Story = {
  name: "First open explains reading and starts document search",
  tags: ["interaction"],
  render: () => (
    <div style={{ maxWidth: 720 }}>
      <ReaderWelcome onFind={findDocument} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    findDocument.mockClear();
    const canvas = within(canvasElement);
    await expect(
      canvas.getByText("Double-click a block to leave feedback."),
    ).toBeVisible();
    await userEvent.click(
      canvas.getByRole("button", { name: "Find a document" }),
    );
    await expect(findDocument).toHaveBeenCalledOnce();
  },
};

function SidebarStructureExample() {
  const file = (path: string, documentHeading: string): FsNode => ({
    id: path,
    path,
    name: path.split("/").at(-1)!,
    kind: "file",
    parentPath: path.includes("/")
      ? path.slice(0, path.lastIndexOf("/"))
      : null,
    viewerKind: path.endsWith("html") ? "html" : "markdown",
    documentHeading,
  });
  const nodes: FsNode[] = [
    file("README.md", "ローカル文書を読む"),
    {
      id: "docs",
      path: "docs",
      name: "docs",
      kind: "directory",
      parentPath: null,
      children: [
        file("docs/README.md", "ドキュメントの読み方"),
        {
          id: "docs/guides",
          path: "docs/guides",
          name: "guides",
          kind: "directory",
          parentPath: "docs",
          children: [
            file("docs/guides/01-start.md", "初回レビューを始める"),
            file("docs/guides/02-feedback.html", "下書きから公開まで"),
            {
              id: "docs/guides/advanced",
              path: "docs/guides/advanced",
              name: "advanced",
              kind: "directory",
              parentPath: "docs/guides",
              children: [
                file(
                  "docs/guides/advanced/03-team-review.md",
                  "チームでレビューを引き継ぐための詳しいガイド",
                ),
              ],
            },
          ],
        },
        file("docs/notes.md", ""),
      ],
    },
  ];
  const [selected, setSelected] = useState("docs/guides/01-start.md");
  return (
    <aside
      aria-label="Sidebar structure at initial width"
      style={{ width: 210, minHeight: 520 }}
    >
      <TreeSidebar
        nodes={nodes}
        selectedPath={selected}
        onSelect={setSelected}
        onOpen={setSelected}
        activePaths={new Set(["README.md"])}
        changedPaths={new Set(["docs/guides/02-feedback.html"])}
      />
    </aside>
  );
}

export const SidebarStructure: Story = {
  name: "Folders and hierarchy guides keep document names primary",
  tags: ["interaction"],
  render: () => <SidebarStructureExample />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const row = (path: string) =>
      canvasElement.querySelector<HTMLElement>(`[data-tree-path="${path}"]`)!;
    const deep = row("docs/guides/advanced/03-team-review.md");
    await userEvent.click(deep);
    await expect(deep).toHaveAttribute("aria-selected", "true");
    await expect(row("docs").className).not.toMatch(
      /containsSelection|openInTab/,
    );
    await expect(canvas.queryByText(/Showing .* rows/)).not.toBeInTheDocument();
    await expect(canvas.queryByText(/^OPEN$/)).not.toBeInTheDocument();
    await expect(deep).toHaveAttribute("aria-level", "4");
    await expect(deep.querySelectorAll("[data-tree-guide]")).toHaveLength(3);
    await expect(deep.querySelector("svg")).toBeNull();
    await expect(
      row("docs/guides").querySelector("[data-folder-icon]"),
    ).toHaveAttribute("aria-hidden", "true");
    await userEvent.click(row("docs/guides"));
    await expect(row("docs/guides")).toHaveAttribute("aria-expanded", "false");
    await expect(
      row("docs/guides").querySelector("[data-current-location]"),
    ).not.toBeNull();
    await expect(canvas.queryByText("01-start.md")).not.toBeInTheDocument();
    await userEvent.keyboard("{ArrowRight}{ArrowRight}{Enter}");
    await expect(row("docs/guides/01-start.md")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await waitFor(() => expect(row("docs/guides/01-start.md")).toHaveFocus());
    await userEvent.keyboard("{ArrowLeft}");
    await waitFor(() => expect(row("docs/guides")).toHaveFocus());
    await expect(
      row("README.md").querySelector("[data-tree-guide]"),
    ).toBeNull();
    await expect(canvas.getByText("No H1")).toBeVisible();
  },
};

export const QuietSelectionA: Story = {
  name: "Selection A emphasizes only the current document",
  tags: ["interaction"],
  render: () => <SidebarSelectionFacade />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const selected = canvas.getByRole("treeitem", {
      name: "docs/architecture/15-security-model.md",
    });
    await expect(selected).toHaveAttribute("aria-selected", "true");
    await userEvent.click(selected);
    await userEvent.keyboard("{ArrowDown}");
    const next = canvas.getByRole("treeitem", {
      name: "docs/architecture/16-performance.md",
    });
    await expect(next).toHaveFocus();
    await expect(selected).toHaveAttribute("aria-selected", "true");
    await userEvent.keyboard("{Enter}");
    await expect(next).toHaveAttribute("aria-selected", "true");
    await userEvent.click(
      canvas.getByRole("treeitem", { name: "docs/architecture" }),
    );
    await expect(
      canvas.queryByRole("treeitem", {
        name: "docs/architecture/16-performance.md",
      }),
    ).not.toBeInTheDocument();
    const folder = canvas.getByRole("treeitem", {
      name: "docs/architecture, contains selected document",
    });
    await expect(
      folder.querySelector("[data-current-location]"),
    ).not.toBeNull();
    await userEvent.keyboard("{ArrowRight}{ArrowRight}");
    await expect(
      canvas.getByRole("treeitem", {
        name: "docs/architecture/14-architecture.md",
      }),
    ).toHaveFocus();
    await userEvent.click(
      canvas.getByRole("treeitem", {
        name: "docs/architecture/15-security-model.md",
      }),
    );
  },
};
export const QuietSelectionALight: Story = {
  name: "Selection A stays readable in a wider light sidebar",
  render: () => <SidebarSelectionFacade width={280} light />,
};

export const ReadingTipFirstVisit: Story = {
  tags: ["interaction"],
  beforeEach: () => {
    const previous = localStorage.getItem("vivi.readingHintSeen.v1");
    localStorage.removeItem("vivi.readingHintSeen.v1");
    return () => {
      if (previous === null) localStorage.removeItem("vivi.readingHintSeen.v1");
      else localStorage.setItem("vivi.readingHintSeen.v1", previous);
    };
  },
  render: () => <ReadingTipExample />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("note")).toBeVisible();
    await userEvent.click(
      canvas.getByRole("button", { name: "Dismiss reading tip" }),
    );
    await expect(canvas.queryByRole("note")).not.toBeInTheDocument();
    await userEvent.click(
      canvas.getByRole("button", { name: "Return to reader fixture" }),
    );
    await expect(canvas.queryByRole("note")).not.toBeInTheDocument();
  },
};
function ReadingTipExample() {
  const [visit, setVisit] = useState(0);
  return (
    <div>
      <ReadingHint key={visit} />
      <button onClick={() => setVisit(visit + 1)}>
        Return to reader fixture
      </button>
    </div>
  );
}
