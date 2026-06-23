import { Children, isValidElement } from "react";
import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import type { ViviComment } from "../ui/src/domain/comments.js";
import type { FilePayload } from "../ui/src/domain/fs-node.js";
import {
  CodeCommentThread,
  isCommentSubmitShortcut,
} from "../ui/src/features/comments/components/CodeCommentThread.js";
import {
  CommentsPanel,
  commentInboxKeyboardTarget,
} from "../ui/src/features/comments/components/CommentsPanel.js";
import { DraftReviewTray } from "../ui/src/features/comments/components/DraftReviewTray.js";
import { CommandPalette } from "../ui/src/features/command-palette/CommandPalette.js";
import {
  activeFileReviewStop,
  FileLocationBar,
  FileOutlineControl,
  FileViewer,
} from "../ui/src/features/file-context/components/FileViewer.js";
import {
  Inspector,
  reviewQueueKeyboardTarget,
} from "../ui/src/features/review-queue/Inspector.js";
import {
  ShortcutHelp,
  shortcutA11yLabel,
} from "../ui/src/shared/components/ShortcutHelp.js";
import {
  Topbar,
  workspaceDisplayName,
  workspaceParentPath,
} from "../ui/src/shared/components/Topbar.js";
import { OpenTabs } from "../ui/src/shared/components/OpenTabs.js";
import { TreeSidebar } from "../ui/src/shared/components/TreeSidebar.js";
import {
  WorkspaceStatusbar,
  workspaceStatusbarLabel,
} from "../ui/src/shared/components/WorkspaceStatusbar.js";
import { WorkspaceRestoreNotice } from "../ui/src/shared/components/WorkspaceRestoreNotice.js";
import {
  CodeViewer,
  extractHighlightedLines,
} from "../ui/src/features/file-context/viewers/CodeViewer.js";
import { BinaryMetadataViewer } from "../ui/src/features/file-context/viewers/BinaryMetadataViewer.js";
import {
  CsvViewer,
  parseDelimitedText,
} from "../ui/src/features/file-context/viewers/CsvViewer.js";
import {
  buildRenderedDiffBlocks,
  buildFocusedRenderedDiffRows,
  buildFocusedSourceDiffRows,
  buildRenderedDiffRows,
  buildRenderedHtmlRows,
  DiffViewer,
} from "../ui/src/features/file-context/viewers/DiffViewer.js";
import { HtmlViewer } from "../ui/src/features/file-context/viewers/HtmlViewer.js";
import { ImageViewer } from "../ui/src/features/file-context/viewers/ImageViewer.js";
import { JsonViewer } from "../ui/src/features/file-context/viewers/JsonViewer.js";
import { MarkdownViewer } from "../ui/src/features/file-context/viewers/MarkdownViewer.js";
import {
  hasCustomMermaidStyle,
  MermaidViewer,
} from "../ui/src/features/file-context/viewers/MermaidViewer.js";
import { TextViewer } from "../ui/src/features/file-context/viewers/TextViewer.js";
import {
  reviewActorForConfig,
  TextSearchNavigationBar,
} from "../ui/src/features/workbench/WorkbenchContainer.js";
import type { CommentDraft } from "../ui/src/state/comments.js";
import { summarizeThreadActivity } from "../ui/src/state/comment-activity.js";

const codeFile: FilePayload = {
  path: "src/app.ts",
  viewerKind: "code",
  encoding: "utf8",
  content: "export function start() {\n  return true;\n}\n",
  etag: "sha256:test",
  size: 42,
  mtimeMs: 1,
};

const codeLineComment: ViviComment = {
  id: "comment-1",
  path: "src/app.ts",
  viewerKind: "text",
  anchor: {
    surface: "source",
    canonical: {
      path: "src/app.ts",
      lineStart: 2,
      lineEnd: 2,
      quote: "return true;",
      fileHash: "sha256:test",
    },
  },
  body: "Check this return",
  status: "open",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const codeLineReply: ViviComment = {
  ...codeLineComment,
  id: "comment-2",
  body: "Agreed, keep it explicit",
  createdAt: "2026-01-01T00:01:00.000Z",
  updatedAt: "2026-01-01T00:01:00.000Z",
};

const markdownFile: FilePayload = {
  path: "README.md",
  viewerKind: "markdown",
  encoding: "utf8",
  content: "# Title\n\nParagraph text\n",
  etag: "sha256:markdown",
  size: 24,
  mtimeMs: 1,
};

it("renders the topbar as brand, workspace identity, and distinct actions", () => {
  const html = renderToStaticMarkup(
    <Topbar
      root="/Users/tasuku/work/vivi"
      themePreference="system"
      onThemeCycle={() => undefined}
      onQuickOpen={() => undefined}
      onSearchText={() => undefined}
      onOpenShortcuts={() => undefined}
    />,
  );

  expect(html).toContain('class="topbar-brand"');
  expect(html).toContain('class="workspace-strip"');
  expect(html).toContain('aria-label="Workspace actions"');
  expect(html).toContain('class="workspace-name">vivi</span>');
  expect(html).toContain('class="workspace-parent">/Users/tasuku/work</span>');
  expect(html).toContain("command-button-primary");
  expect(html).toContain("command-button-secondary");
  expect(html).toContain("Theme");
  expect(html).toContain("System");
  expect(html).toContain('aria-label="Open command palette"');
  expect(html).toContain("Command");
  expect(html).toContain("Cmd/Ctrl K");
  expect(html).toContain("Cmd/Ctrl Shift C");
  expect(html).toContain("Cmd/Ctrl Shift F");
  expect(html).toContain('aria-keyshortcuts="Meta+K Control+K"');
  expect(html).toContain('aria-keyshortcuts="Meta+Shift+C Control+Shift+C"');
  expect(html).toContain('aria-keyshortcuts="Meta+Shift+F Control+Shift+F"');
  expect(html).toContain('aria-label="Keyboard shortcuts"');
  expect(html).toContain('aria-label="Search workspace text"');
  expect(html).toContain("Search workspace text (Cmd/Ctrl+Shift+F)");
  expect(html).toContain("Keyboard shortcuts (Cmd/Ctrl+/)");
});

it("opens topbar overlays from native button clicks", () => {
  const actions: string[] = [];
  const topbar = Topbar({
    root: "/Users/tasuku/work/vivi",
    themePreference: "system",
    onThemeCycle: () => actions.push("theme"),
    onQuickOpen: () => actions.push("quick-open"),
    onSearchText: () => actions.push("search"),
    onOpenComments: () => actions.push("comments"),
    onOpenShortcuts: () => actions.push("shortcuts"),
  });

  const clickAction = (label: string) => {
    const button = findElement(topbar, (element) => {
      const props = element.props as { "aria-label"?: string };
      return props["aria-label"] === label;
    });
    const props = button.props as { onClick: () => void };
    props.onClick();
  };

  clickAction("Keyboard shortcuts");
  clickAction("Open command palette");
  clickAction("Open Comments inbox, no open threads");
  clickAction("Search workspace text");

  expect(actions).toEqual(["shortcuts", "quick-open", "comments", "search"]);
});

it("prioritizes attention-needed comments in the topbar entry point", () => {
  const html = renderToStaticMarkup(
    <Topbar
      root="/Users/tasuku/work/vivi"
      themePreference="dark"
      openCommentThreadCount={6}
      commentAttentionCount={2}
      onThemeCycle={() => undefined}
      onQuickOpen={() => undefined}
      onSearchText={() => undefined}
      onOpenComments={() => undefined}
      onOpenShortcuts={() => undefined}
    />,
  );

  expect(html).toContain("Attention");
  expect(html).toContain('class="comment-count-badge">2</span>');
  expect(html).toContain("needs-attention");
  expect(html).toContain(
    'aria-label="Open Attention inbox, 2 comment threads need attention"',
  );
  expect(html).toContain(
    'title="Open Attention inbox: 2 comment threads need attention (Cmd/Ctrl+Shift+C)"',
  );
});

it("keeps the comments topbar entry explicit when nothing needs attention", () => {
  const html = renderToStaticMarkup(
    <Topbar
      root="/Users/tasuku/work/vivi"
      themePreference="dark"
      openCommentThreadCount={1}
      commentAttentionCount={0}
      onThemeCycle={() => undefined}
      onQuickOpen={() => undefined}
      onSearchText={() => undefined}
      onOpenComments={() => undefined}
      onOpenShortcuts={() => undefined}
    />,
  );

  expect(html).toContain("Comments");
  expect(html).toContain('class="comment-count-badge">1</span>');
  expect(html).toContain('aria-label="Open Comments inbox, 1 open thread"');
  expect(html).toContain(
    'title="Open Comments inbox: 1 open thread (Cmd/Ctrl+Shift+C)"',
  );
});

it("clarifies when fewer comments are in the review queue", () => {
  const html = renderToStaticMarkup(
    <Topbar
      root="/Users/tasuku/work/vivi"
      themePreference="dark"
      openCommentThreadCount={3}
      reviewOpenCommentThreadCount={1}
      commentAttentionCount={0}
      onThemeCycle={() => undefined}
      onQuickOpen={() => undefined}
      onSearchText={() => undefined}
      onOpenComments={() => undefined}
      onOpenShortcuts={() => undefined}
    />,
  );

  expect(html).toContain("Comments");
  expect(html).toContain('class="comment-count-badge">3</span>');
  expect(html).toContain(
    'aria-label="Open Comments inbox, 3 open threads, 1 open review thread"',
  );
  expect(html).toContain(
    'title="Open Comments inbox: 3 open threads, 1 open review thread (Cmd/Ctrl+Shift+C)"',
  );
});

it("does not make zero review-thread comments sound like an empty Review Queue", () => {
  const html = renderToStaticMarkup(
    <Topbar
      root="/Users/tasuku/work/vivi"
      themePreference="dark"
      openCommentThreadCount={2}
      reviewOpenCommentThreadCount={0}
      commentAttentionCount={0}
      onThemeCycle={() => undefined}
      onQuickOpen={() => undefined}
      onSearchText={() => undefined}
      onOpenComments={() => undefined}
      onOpenShortcuts={() => undefined}
    />,
  );

  expect(html).toContain(
    'aria-label="Open Comments inbox, 2 open threads, no open review threads"',
  );
  expect(html).not.toContain("0 in review queue");
});

it("renders workspace status as a readable local-review instrument", () => {
  const status = {
    workspace: "Watching 42 files · 3 tabs open",
    activeFile: "brief.md · preview · rendered",
    review: "4 files to review · 2 threads open · 1 draft",
    server: "Updating review + 2 diffs",
    serverTone: "pending" as const,
    detail: "3 review refreshes · last review 12ms",
  };
  const html = renderToStaticMarkup(<WorkspaceStatusbar status={status} />);

  expect(workspaceStatusbarLabel(status)).toBe(
    "Workspace status · Workspace: Watching 42 files · 3 tabs open · Current file: brief.md · preview · rendered · Review: 4 files to review · 2 threads open · 1 draft · Live updates: Updating review + 2 diffs",
  );
  expect(html).toContain(
    'aria-label="Workspace status · Workspace: Watching 42 files · 3 tabs open · Current file: brief.md · preview · rendered · Review: 4 files to review · 2 threads open · 1 draft · Live updates: Updating review + 2 diffs"',
  );
  expect(html).toContain("Workspace");
  expect(html).toContain("Current");
  expect(html).toContain("Review");
  expect(html).toContain("Live");
  expect(html).toContain(
    'aria-label="Workspace: Watching 42 files · 3 tabs open"',
  );
  expect(html).toContain(
    'aria-label="Current file: brief.md · preview · rendered"',
  );
  expect(html).toContain(
    'aria-label="Review: 4 files to review · 2 threads open · 1 draft"',
  );
  expect(html).toContain(
    'aria-label="Live updates: Updating review + 2 diffs"',
  );
  expect(html).toContain('aria-live="polite"');
  expect(html).toContain('class="status-dot pending"');
  expect(html).toContain('title="3 review refreshes · last review 12ms"');
});

it("summarizes workspace paths for compact topbar display", () => {
  expect(workspaceDisplayName("/Users/tasuku/work/vivi/")).toBe("vivi");
  expect(workspaceParentPath("/Users/tasuku/work/vivi/")).toBe(
    "/Users/tasuku/work",
  );
  expect(workspaceDisplayName(null)).toBe("Local viewer");
  expect(workspaceParentPath(null)).toBe("Waiting for workspace");
});

it("renders open files as an accessible tab set", () => {
  const html = renderToStaticMarkup(
    <OpenTabs
      tabs={[
        { path: "README.md", viewerKind: "markdown", paneId: "main" },
        {
          path: "src/app.ts",
          viewerKind: "code",
          paneId: "main",
          changed: true,
          isPreview: true,
        },
      ]}
      activePath="src/app.ts"
      paneId="main"
      onActivate={() => undefined}
      onClose={() => undefined}
      onPromote={() => undefined}
      onCloseOtherTabs={() => undefined}
      onCloseTabsToRight={() => undefined}
      onCloseUnchangedTabs={() => undefined}
      onClosePreviewTabs={() => undefined}
      onDropTab={() => undefined}
      onDragStateChange={() => undefined}
      onManualDragStart={() => undefined}
    />,
  );

  expect(html).toContain('role="tablist"');
  expect(html).toContain(
    'aria-label="Open file tabs, 2 tabs, active src/app.ts, 1 preview tab, 1 changed tab"',
  );
  expect(html).toContain('role="tab"');
  expect(html).toContain('aria-selected="true"');
  expect(html).toContain('aria-selected="false"');
  expect(html).toContain('tabindex="0"');
  expect(html).toContain('tabindex="-1"');
  expect(html).toContain('data-tab-path="src/app.ts"');
  expect(html).toContain('class="tab-shell active changed preview"');
  expect(html).toContain('class="tab" type="button" role="tab"');
  expect(html).toContain('class="tab-close" type="button"');
  expect(html).toContain('aria-label="Tab management"');
  expect(html).toContain("Keep tab");
  expect(html).toContain("Close others");
  expect(html).toContain("Close right");
  expect(html).toContain("Close clean");
  expect(html).toContain("Close previews");
  expect(html).toContain("Keep this preview open as a normal tab");
  expect(html).toContain("preview");
  expect(html).toContain("changed");
});

it("shows parent context only for duplicate tab names", () => {
  const html = renderToStaticMarkup(
    <OpenTabs
      tabs={[
        { path: "docs/README.md", viewerKind: "markdown", paneId: "main" },
        {
          path: "examples/README.md",
          viewerKind: "markdown",
          paneId: "main",
        },
        { path: "src/app.ts", viewerKind: "code", paneId: "main" },
      ]}
      activePath="docs/README.md"
      paneId="main"
      onActivate={() => undefined}
      onClose={() => undefined}
      onPromote={() => undefined}
      onCloseOtherTabs={() => undefined}
      onCloseTabsToRight={() => undefined}
      onCloseUnchangedTabs={() => undefined}
      onClosePreviewTabs={() => undefined}
      onDropTab={() => undefined}
      onDragStateChange={() => undefined}
      onManualDragStart={() => undefined}
    />,
  );

  expect(html).toContain('class="tab-shell active duplicate-name"');
  expect(html).toContain(
    '<span class="tab-context" aria-hidden="true">docs</span>',
  );
  expect(html).toContain(
    '<span class="tab-context" aria-hidden="true">examples</span>',
  );
  expect(html).toContain('title="docs/README.md"');
  expect(html).toContain('aria-label="examples/README.md"');
  expect(html).toContain("app.ts");
  expect(html).not.toContain(">src<");
});

it("renders the shortcut guide as one bundled reference", () => {
  const html = renderToStaticMarkup(
    <ShortcutHelp open={true} onClose={() => undefined} />,
  );

  expect(html).toContain('aria-label="Keyboard shortcuts"');
  expect(html).toContain('aria-modal="true"');
  expect(html).toContain('aria-labelledby="shortcut-help-title"');
  expect(html).toContain('aria-describedby="shortcut-help-description"');
  expect(html).toContain('aria-label="Close keyboard shortcuts"');
  expect(html).toContain('<dl class="shortcut-list">');
  expect(html).toContain("Cmd/Ctrl W");
  expect(html).toContain(
    '<kbd aria-label="Command or Control W">Cmd/Ctrl W</kbd>',
  );
  expect(html).toContain("Cmd/Ctrl E");
  expect(html).toContain("Cmd/Ctrl I");
  expect(html).toContain("Return to current thread");
  expect(html).toContain("Cmd/Ctrl Shift Enter");
  expect(html).toContain("Resolve / reopen current thread");
  expect(html).toContain("Cmd/Ctrl Shift Backspace");
  expect(html).toContain("Archive current thread");
  expect(html).not.toContain("Focus current inline thread");
  expect(html).toContain("Cmd/Ctrl B");
  expect(html).toContain("Cmd/Ctrl Shift \\");
  expect(html).toContain(
    '<kbd aria-label="Command or Control Shift Backslash">Cmd/Ctrl Shift \\</kbd>',
  );
  expect(html).toContain("Toggle Explorer");
  expect(html).toContain("Toggle inspector");
  expect(html).toContain("Cmd/Ctrl Shift U");
  expect(html).toContain("Cmd/Ctrl Shift J");
  expect(html).toContain("Cmd/Ctrl Shift K");
  expect(html).not.toContain("Cmd/Ctrl Shift R");
  expect(html).toContain("Cmd/Ctrl Shift C");
  expect(html).toContain("Open Attention / Comments");
  expect(html).toContain("Cmd/Ctrl G");
  expect(html).toContain("Cmd/Ctrl Shift G");
  expect(html).toContain("Cmd/Ctrl /");
  expect(html).toContain("Left / Right");
  expect(html).toContain(
    '<kbd aria-label="Left or Right arrow">Left / Right</kbd>',
  );
  expect(html).toContain('<h3 id="shortcut-group-tabs">Tabs</h3>');
  expect(html).toContain('<h3 id="shortcut-group-find">Find</h3>');
  expect(html).toContain('<h3 id="shortcut-group-review">Review</h3>');
  expect(html).toContain('<h3 id="shortcut-group-viewer">Viewer</h3>');
  expect(html).toContain('<h3 id="shortcut-group-layout">Layout</h3>');
  expect(html).toContain('<h3 id="shortcut-group-palette">Palette</h3>');
  expect(html).not.toContain("Run action");
});

it("names symbolic shortcut keys for assistive tech", () => {
  expect(shortcutA11yLabel("Cmd/Ctrl /")).toBe("Command or Control Slash");
  expect(shortcutA11yLabel("Cmd/Ctrl ]")).toBe(
    "Command or Control Right bracket",
  );
  expect(shortcutA11yLabel("Cmd/Ctrl [ / ] \\")).toBe(
    "Command or Control Left bracket Slash Right bracket Backslash",
  );
  expect(shortcutA11yLabel("Left / Right")).toBe("Left or Right arrow");
});

it("keeps the default command palette search-oriented", () => {
  const html = renderToStaticMarkup(
    <CommandPalette
      open
      mode="file"
      query="readme"
      fileResults={[
        {
          path: "README.md",
          name: "README.md",
          viewerKind: "markdown",
          score: 1,
        },
      ]}
      fileLoading={false}
      textResults={[]}
      textLoading={false}
      actions={[]}
      onQueryChange={() => undefined}
      onModeChange={() => undefined}
      onClose={() => undefined}
      onOpenPath={() => undefined}
    />,
  );

  expect(html).toContain("Quick open");
  expect(html).toContain("Command palette");
  expect(html).toContain("Files");
  expect(html).toContain("Text");
  expect(html).toContain("README.md");
  expect(html).toContain('role="tablist"');
  expect(html).toContain('aria-label="Search mode"');
  expect(html).toContain('aria-label="Quick open query"');
  expect(html).toContain('aria-label="Quick open results"');
  expect(html).toContain('data-palette-mode="file"');
  expect(html).toContain('data-palette-mode="text"');
  expect(html).toContain('tabindex="0"');
  expect(html).toContain('tabindex="-1"');
  expect(html).toContain("Cmd/Ctrl Enter");
  expect(html).toContain("Cmd/Ctrl K");
  expect(html).toContain("Cmd/Ctrl Shift F");
  expect(html).not.toContain("Actions");
  expect(html).not.toContain("run action");
  expect(html).not.toContain("Run action");
});

it("opens the command palette on recent files before the user types", () => {
  const html = renderToStaticMarkup(
    <CommandPalette
      open
      mode="file"
      query=""
      fileResults={[
        {
          path: "search-result.md",
          name: "search-result.md",
          viewerKind: "markdown",
          score: 1,
        },
      ]}
      recentFiles={[
        { path: "README.md", viewerKind: "markdown", source: "active" },
        { path: "src/app.ts", viewerKind: "code", source: "open" },
        { path: "docs/notes.txt", viewerKind: "text" },
      ]}
      fileLoading={false}
      textResults={[]}
      textLoading={false}
      actions={[]}
      onQueryChange={() => undefined}
      onModeChange={() => undefined}
      onClose={() => undefined}
      onOpenPath={() => undefined}
    />,
  );

  expect(html).toContain("README.md");
  expect(html).toContain("src/app.ts");
  expect(html).toContain("docs/notes.txt");
  expect(html).toContain("Active tab · markdown");
  expect(html).toContain("Open tab · code");
  expect(html).toContain("Recent · text");
  expect(html).toContain('<span class="palette-type">Active</span>');
  expect(html).toContain('<span class="palette-type">Open</span>');
  expect(html).toContain('<span class="palette-type">Recent</span>');
  expect(html.indexOf("README.md")).toBeLessThan(html.indexOf("src/app.ts"));
  expect(html.indexOf("src/app.ts")).toBeLessThan(
    html.indexOf("docs/notes.txt"),
  );
  expect(html).not.toContain("search-result.md");
  expect(html).not.toContain("No matching files.");
});

it("shows an empty recent-files hint before quick-open search starts", () => {
  const html = renderToStaticMarkup(
    <CommandPalette
      open
      mode="file"
      query=""
      fileResults={[]}
      recentFiles={[]}
      fileLoading={false}
      textResults={[]}
      textLoading={false}
      actions={[]}
      onQueryChange={() => undefined}
      onModeChange={() => undefined}
      onClose={() => undefined}
      onOpenPath={() => undefined}
    />,
  );

  expect(html).toContain("No recent files yet.");
  expect(html).not.toContain("No matching files.");
});

it("labels command palette loading states by search scope", () => {
  const fileHtml = renderToStaticMarkup(
    <CommandPalette
      open
      mode="file"
      query="workbench"
      fileResults={[]}
      fileLoading
      textResults={[]}
      textLoading={false}
      actions={[]}
      onQueryChange={() => undefined}
      onModeChange={() => undefined}
      onClose={() => undefined}
      onOpenPath={() => undefined}
    />,
  );
  const textHtml = renderToStaticMarkup(
    <CommandPalette
      open
      mode="text"
      query="xt_DSCP"
      fileResults={[]}
      fileLoading={false}
      textResults={[]}
      textLoading
      actions={[]}
      onQueryChange={() => undefined}
      onModeChange={() => undefined}
      onClose={() => undefined}
      onOpenPath={() => undefined}
    />,
  );

  expect(fileHtml).toContain("Searching file names...");
  expect(fileHtml).toContain('aria-live="polite"');
  expect(textHtml).toContain("Searching workspace text...");
  expect(textHtml).toContain('aria-live="polite"');
});

it("highlights matching text inside text search results", () => {
  const html = renderToStaticMarkup(
    <CommandPalette
      open
      mode="text"
      query="Index"
      fileResults={[]}
      fileLoading={false}
      textResults={[
        {
          path: "reports/index.html",
          viewerKind: "html",
          lineNumber: 4,
          lineText: "<h1>Index</h1>",
          matchStart: 4,
          matchLength: 5,
        },
      ]}
      textLoading={false}
      actions={[]}
      onQueryChange={() => undefined}
      onModeChange={() => undefined}
      onClose={() => undefined}
      onOpenPath={() => undefined}
    />,
  );

  expect(html).toContain("reports/index.html");
  expect(html).toContain("palette-line-prefix");
  expect(html).toContain("&lt;h1&gt;");
  expect(html).toContain('<mark class="palette-search-match">Index</mark>');
  expect(html).toContain("&lt;/h1&gt;");
});

it("renders command palette actions for review navigation", () => {
  const html = renderToStaticMarkup(
    <CommandPalette
      open
      mode="action"
      query=""
      fileResults={[]}
      fileLoading={false}
      textResults={[]}
      textLoading={false}
      actions={[
        {
          id: "return-current-stop",
          label: "Return to current thread",
          detail: "src/app.ts · L2",
          shortcut: "Cmd/Ctrl I",
        },
        {
          id: "next-open-thread",
          label: "Next open thread",
          detail: "Move to the next unresolved review thread",
          shortcut: "Cmd/Ctrl ]",
        },
        {
          id: "next-draft-comment",
          label: "Next draft comment",
          detail: "Review unpublished draft comments",
        },
        {
          id: "show-diff",
          label: "Show diff",
          detail: "Switch the active viewer to diff from HEAD",
        },
      ]}
      onQueryChange={() => undefined}
      onModeChange={() => undefined}
      onClose={() => undefined}
      onOpenPath={() => undefined}
      onRunAction={() => undefined}
    />,
  );

  expect(html).toContain("Actions");
  expect(html).toContain("Return to current thread");
  expect(html).toContain("src/app.ts · L2");
  expect(html).toContain("Cmd/Ctrl I");
  expect(html).toContain("Next open thread");
  expect(html).toContain("Next draft comment");
  expect(html).toContain("Show diff");
  expect(html).toContain("Run action");
  expect(html).toContain("Filter actions");
  expect(html).toContain("Switch mode");
  expect(html).toContain("<kbd>Tab</kbd>");
  expect(html).not.toContain("Preview");
  expect(html).not.toContain("Keep open");
});

it("explains restored workspace tabs and offers a fresh start", () => {
  const html = renderToStaticMarkup(
    <WorkspaceRestoreNotice
      tabCount={3}
      onDismiss={() => undefined}
      onStartFresh={() => undefined}
    />,
  );

  expect(html).toContain("Restored 3 tabs");
  expect(html).toContain("from your last local session");
  expect(html).toContain("Start fresh");
  expect(html).toContain('aria-label="Dismiss restored tabs notice"');
});

it("renders code with stable line numbers and selected ranges", () => {
  const html = renderToStaticMarkup(
    <CodeViewer
      file={codeFile}
      theme="dark"
      selectedRange={{ start: 1, end: 2 }}
      onSelectionChange={() => undefined}
    />,
  );

  expect(html).toContain('aria-label="Code viewer for src/app.ts"');
  expect(html).toContain('aria-label="Code viewer controls for src/app.ts"');
  expect(html).not.toContain('class="code-pro-title"');
  expect(html).toContain('class="code-line selected selection-start"');
  expect(html).toContain('class="code-line selected selection-end"');
  expect(html).toContain('aria-label="Select line 1"');
  expect(html).toContain("Copy ref");
  expect(html).toContain("Copy range");
});

it("marks text search landing lines across source viewers", () => {
  const codeHtml = renderToStaticMarkup(
    <CodeViewer
      file={codeFile}
      theme="dark"
      selectedRange={null}
      focusLineNumber={2}
      focusRevision={1}
      onSelectionChange={() => undefined}
    />,
  );
  const markdownHtml = renderToStaticMarkup(
    <MarkdownViewer
      file={markdownFile}
      mode="source"
      focusLineNumber={3}
      focusRevision={1}
    />,
  );
  const htmlSource = renderToStaticMarkup(
    <HtmlViewer
      file={{
        ...codeFile,
        path: "index.html",
        viewerKind: "html",
        content: "<h1>Title</h1>\n<p>Body</p>\n",
      }}
      allowHtmlScripts={false}
      mode="source"
      focusLineNumber={2}
      focusRevision={1}
    />,
  );
  const textHtml = renderToStaticMarkup(
    <TextViewer
      file={{
        ...codeFile,
        path: "notes.txt",
        viewerKind: "text",
        content: "alpha\nneedle\nomega\n",
      }}
      focusLineNumber={2}
      focusRevision={1}
    />,
  );

  expect(codeHtml).toContain('class="code-line search-focus"');
  expect(markdownHtml).toContain('class="code-line search-focus"');
  expect(htmlSource).toContain('class="commented-source-line search-focus"');
  expect(textHtml).toContain('class="commented-source-line search-focus"');
});

it("renders text search navigation as a compact reader control", () => {
  const html = renderToStaticMarkup(
    <TextSearchNavigationBar
      query="needle"
      position="2 of 4"
      result={{
        path: "notes.txt",
        viewerKind: "text",
        lineNumber: 12,
        lineText: "<h2>needle in notes</h2>",
        matchStart: 4,
        matchLength: 6,
      }}
      onPrevious={() => undefined}
      onNext={() => undefined}
      onClose={() => undefined}
    />,
  );

  expect(html).toContain('aria-label="Text search navigation"');
  expect(html).toContain("&quot;needle&quot;");
  expect(html).toContain("2 of 4");
  expect(html).toContain("Line 12");
  expect(html).toContain("&lt;h2&gt;");
  expect(html).toContain('<mark class="text-search-nav-match">needle</mark>');
  expect(html).toContain(" in notes&lt;/h2&gt;");
  expect(html).toContain("Previous");
  expect(html).toContain("Next");
  expect(html).toContain("Clear");
});

it("renders code line comments as an inline thread with replies", () => {
  const html = renderToStaticMarkup(
    <CodeViewer
      file={codeFile}
      theme="dark"
      selectedRange={null}
      comments={[codeLineReply, codeLineComment]}
      activeCommentId={codeLineComment.id}
      onSelectionChange={() => undefined}
      onOpenComment={() => undefined}
      onCreateComment={() => undefined}
    />,
  );

  expect(html).toContain('class="code-line has-comment active-comment"');
  expect(html).toContain(`data-comment-id="${codeLineComment.id}"`);
  expect(html).toContain(`data-comment-id="${codeLineReply.id}"`);
  expect(html).toContain('class="code-line-comment-action"');
  expect(html).toContain(
    'aria-label="Open comment thread on line 2 with 2 messages; open to reply"',
  );
  expect(html).toContain(
    'title="Open comment thread on line 2 with 2 messages; open to reply"',
  );
  expect(html).toContain('aria-label="Add comment on line 1"');
  expect(html).toContain('aria-label="Comment thread for line 2"');
  expect(html).toContain('class="code-thread-comment open active"');
  expect(html).toContain('aria-current="true"');
  expect(html).toContain('tabindex="-1"');
  expect(html).toContain("Current stop");
  expect(html).toContain("2 messages");
  expect(html.indexOf("Check this return")).toBeLessThan(
    html.indexOf("Agreed, keep it explicit"),
  );
  expect(html).toContain('placeholder="Reply to thread"');
  expect(html).not.toContain("autofocus");
  expect(html).toContain('aria-label="Add reply"');
  expect(html).toContain(
    'aria-describedby="comment-reply-hint-src-app-ts-2-2"',
  );
  expect(html).toContain('aria-keyshortcuts="Meta+Enter Control+Enter"');
  expect(html).toContain("Resolve current thread");
  expect(html).toContain("Archive current thread");
  expect(html).toContain(
    'aria-keyshortcuts="Meta+Shift+Enter Control+Shift+Enter"',
  );
  expect(html).toContain(
    'aria-keyshortcuts="Meta+Shift+Backspace Control+Shift+Backspace"',
  );
  expect(html).toContain(
    'title="Resolve current thread (Cmd/Ctrl Shift Enter)"',
  );
  expect(html).toContain(
    'title="Archive current thread (Cmd/Ctrl Shift Backspace)"',
  );
  expect(html).toContain("<kbd>Cmd/Ctrl Enter</kbd> to send");
  expect(html).toContain("Esc closes");
  expect(html).not.toContain(">Comment<");
});

it("keeps diff comments out of source line comment markers", () => {
  const diffComment = {
    ...codeLineComment,
    id: "comment-diff-1",
    threadId: "thread-diff",
    anchor: {
      ...codeLineComment.anchor,
      surface: "diff" as const,
      diff: {
        path: codeFile.path,
        base: "HEAD",
        ref: "working tree",
        hunkId: "@@ -1,3 +1,3 @@",
        side: "new" as const,
        newLineStart: 2,
        newLineEnd: 2,
      },
    },
    body: "Diff-only message",
  };
  const diffReply = {
    ...diffComment,
    id: "comment-diff-2",
    body: "Second diff-only message",
    createdAt: "2026-01-01T00:02:00.000Z",
    updatedAt: "2026-01-01T00:02:00.000Z",
  };

  const html = renderToStaticMarkup(
    <CodeViewer
      file={codeFile}
      theme="dark"
      selectedRange={null}
      comments={[codeLineComment, diffComment, diffReply]}
      activeCommentId={codeLineComment.id}
      onSelectionChange={() => undefined}
      onOpenComment={() => undefined}
      onCreateComment={() => undefined}
    />,
  );

  expect(html).toContain(
    'aria-label="Open comment thread on line 2 with 1 message; open to reply"',
  );
  expect(html).not.toContain(
    'aria-label="Open comment thread on line 2 with 2 messages; open to reply"',
  );
  expect(html).toContain("Check this return");
  expect(html).not.toContain("Diff-only message");
  expect(html).not.toContain("Second diff-only message");
});

it("can keep the current stop highlighted without expanding the source thread", () => {
  const html = renderToStaticMarkup(
    <CodeViewer
      file={codeFile}
      theme="dark"
      selectedRange={null}
      comments={[codeLineReply, codeLineComment]}
      activeCommentId={codeLineComment.id}
      expandActiveCommentThread={false}
      onSelectionChange={() => undefined}
      onOpenComment={() => undefined}
      onCreateComment={() => undefined}
    />,
  );

  expect(html).toContain('class="code-line has-comment active-comment"');
  expect(html).toContain(`data-comment-id="${codeLineComment.id}"`);
  expect(html).toContain(
    'aria-label="Open comment thread on line 2 with 2 messages; open to reply"',
  );
  expect(html).not.toContain("code-comment-thread-row");
  expect(html).not.toContain("Comment thread for line 2");
  expect(html).not.toContain("Current stop");
  expect(html).not.toContain("Reply to thread");
});

it("keeps inline comment submit on Cmd/Ctrl Enter while Shift Enter stays editable", () => {
  expect(isCommentSubmitShortcut({ key: "Enter", metaKey: true })).toBe(true);
  expect(isCommentSubmitShortcut({ key: "Enter", ctrlKey: true })).toBe(true);
  expect(isCommentSubmitShortcut({ key: "Enter" })).toBe(false);
  expect(isCommentSubmitShortcut({ key: "Enter", shiftKey: true })).toBe(false);
  expect(
    isCommentSubmitShortcut({ key: "Enter", metaKey: true, shiftKey: true }),
  ).toBe(false);
  expect(
    isCommentSubmitShortcut({ key: "Enter", ctrlKey: true, shiftKey: true }),
  ).toBe(false);
  expect(isCommentSubmitShortcut({ key: "Enter", metaKey: false })).toBe(false);
  expect(isCommentSubmitShortcut({ key: "Enter", ctrlKey: false })).toBe(false);
  expect(isCommentSubmitShortcut({ key: "a", metaKey: true })).toBe(false);
});

it("projects diff-surface comments onto source code comment threads", () => {
  const diffSurfaceComment: ViviComment = {
    ...codeLineComment,
    id: "diff-surface-comment",
    anchor: {
      surface: "diff",
      canonical: {
        path: "src/app.ts",
        lineStart: 2,
        lineEnd: 2,
        quote: "return true;",
        fileHash: "sha256:test",
      },
      diff: {
        path: "src/app.ts",
        base: "HEAD",
        ref: "working tree",
        hunkId: "@@ -1,3 +1,3 @@",
        side: "new",
        newLineStart: 2,
        newLineEnd: 2,
      },
    },
    body: "Only visible in diff mode",
  };

  const html = renderToStaticMarkup(
    <CodeViewer
      file={codeFile}
      theme="dark"
      selectedRange={null}
      comments={[diffSurfaceComment]}
      activeCommentId={diffSurfaceComment.id}
      onSelectionChange={() => undefined}
      onOpenComment={() => undefined}
      onCreateComment={() => undefined}
    />,
  );

  expect(html).toContain("Only visible in diff mode");
  expect(html).toContain("1 message");
  expect(html).toContain('class="code-line-comment-count">1</span>');
});

it("renders a range comment thread after the final selected code line", () => {
  const rangeComment: ViviComment = {
    ...codeLineComment,
    id: "range-comment",
    anchor: {
      surface: "source",
      canonical: {
        path: "src/app.ts",
        lineStart: 1,
        lineEnd: 2,
        quote: "export function start() {\n  return true;",
        fileHash: "sha256:test",
      },
    },
    body: "This applies to the full branch",
  };
  const html = renderToStaticMarkup(
    <CodeViewer
      file={codeFile}
      theme="dark"
      selectedRange={{ start: 1, end: 2 }}
      comments={[rangeComment]}
      activeCommentId={rangeComment.id}
      onSelectionChange={() => undefined}
      onOpenComment={() => undefined}
      onCreateComment={() => undefined}
    />,
  );

  expect(html).toContain("Lines 1-2");
  expect(html).toContain('aria-label="Comment thread for lines 1-2"');
  expect(html).toContain(
    'class="code-line selected selection-start has-comment active-comment"',
  );
  expect(html).toContain(
    'class="code-line selected selection-end has-comment active-comment"',
  );
  expect(html.indexOf('data-line="2"')).toBeLessThan(
    html.indexOf('aria-label="Comment thread for lines 1-2"'),
  );
  expect(
    html.indexOf('aria-label="Comment thread for lines 1-2"'),
  ).toBeLessThan(html.indexOf('data-line="3"'));
});

it("uses the inline source thread experience for Markdown source mode", () => {
  const comment: ViviComment = {
    ...codeLineComment,
    id: "markdown-source-comment",
    path: "README.md",
    viewerKind: "markdown",
    anchor: {
      surface: "source",
      canonical: {
        path: "README.md",
        lineStart: 3,
        lineEnd: 3,
        quote: "Paragraph text",
      },
    },
  };
  const html = renderToStaticMarkup(
    <MarkdownViewer
      file={markdownFile}
      mode="source"
      comments={[comment]}
      activeCommentId={comment.id}
      onCreateComment={() => undefined}
      onOpenComment={() => undefined}
      onCommentStatusChange={() => undefined}
    />,
  );

  expect(html).toContain("source-comment-surface markdown-source");
  expect(html).toContain('aria-label="Markdown viewer controls for README.md"');
  expect(html).not.toContain("<strong>README.md</strong>");
  expect(html).toContain(
    'aria-label="Open comment thread on line 3 with 1 message; open to reply"',
  );
  expect(html).toContain('aria-label="Comment thread for line 3"');
  expect(html).toContain("Check this return");
  expect(html).not.toContain('aria-label="New comment"');
});

it("renders a replyable document thread with the code-thread width contract", () => {
  const comment: ViviComment = {
    ...codeLineComment,
    id: "markdown-rendered-thread",
    path: "README.md",
    viewerKind: "markdown",
    anchor: {
      surface: "rendered",
      canonical: {
        path: "README.md",
        lineStart: 3,
        lineEnd: 4,
        quote: "Paragraph text",
      },
      rendered: {
        kind: "markdown",
        blockId: "vivi-block-2",
        sourceLineStart: 3,
        sourceLineEnd: 4,
      },
    },
  };
  const draft: CommentDraft = {
    path: comment.path,
    viewerKind: "markdown",
    anchor: comment.anchor,
  };
  const html = renderToStaticMarkup(
    <CodeCommentThread
      className="rendered-comment-thread"
      thread={{
        key: "README.md:vivi-block-2",
        path: "README.md",
        lineStart: 3,
        lineEnd: 4,
        comments: [comment],
      }}
      draft={draft}
      onCreateComment={() => undefined}
      onClose={() => undefined}
    />,
  );

  expect(html).toContain('class="code-comment-thread rendered-comment-thread"');
  expect(html).toContain("Lines 3-4");
  expect(html).toContain('placeholder="Reply to thread"');
  expect(html).toContain("<kbd>Cmd/Ctrl Enter</kbd> to send");
  expect(html).toContain("Check this return");
});

it("projects a rendered Markdown comment onto its canonical source line", () => {
  const comment: ViviComment = {
    ...codeLineComment,
    id: "markdown-rendered-comment",
    path: "README.md",
    viewerKind: "markdown",
    anchor: {
      surface: "rendered",
      canonical: {
        path: "README.md",
        lineStart: 3,
        lineEnd: 3,
        quote: "Paragraph text",
      },
      rendered: {
        kind: "markdown",
        blockId: "vivi-block-2",
        textQuote: "Paragraph text",
        sourceLineStart: 3,
        sourceLineEnd: 3,
      },
    },
  };
  const html = renderToStaticMarkup(
    <MarkdownViewer file={markdownFile} mode="source" comments={[comment]} />,
  );

  expect(html).toContain(
    'aria-label="Open comment thread on line 3 with 1 message; open to reply"',
  );
  expect(html).toContain('class="code-line has-comment"');
});

it("extracts shiki line spans without losing nested syntax spans", () => {
  expect(
    extractHighlightedLines(
      '<pre><code><span class="line"><span style="color:red">const</span> x</span>\n<span class="line">y</span></code></pre>',
    ),
  ).toEqual(['<span style="color:red">const</span> x', "y"]);
});

it("renders large text files as explicit partial previews", () => {
  const html = renderToStaticMarkup(
    <FileViewer
      file={{
        ...codeFile,
        path: "logs/build.log",
        viewerKind: "text",
        encoding: "utf8",
        content: "first chunk",
        size: 10_000,
        truncated: true,
        maxSizeBytes: 10,
        previewBytes: 10,
      }}
      allowHtmlScripts={false}
      theme="dark"
      selectedCodeRange={null}
      onCodeSelectionChange={() => undefined}
    />,
  );

  expect(html).toContain("partial preview");
  expect(html).toContain("first chunk");
  expect(html).toContain("larger than the 10 B rich preview limit");
});

it("keeps non-text large files in the safe metadata state", () => {
  const html = renderToStaticMarkup(
    <FileViewer
      file={{
        ...codeFile,
        path: "index.html",
        viewerKind: "html",
        encoding: "none",
        content: "",
        size: 10_000,
        truncated: true,
        maxSizeBytes: 10,
      }}
      allowHtmlScripts={false}
      theme="dark"
      selectedCodeRange={null}
      onCodeSelectionChange={() => undefined}
    />,
  );

  expect(html).toContain("metadata only");
  expect(html).toContain("10 B");
  expect(html).toContain("Preview limit");
  expect(html).not.toContain("partial preview");
});

it("renders binary metadata without loading unsafe content", () => {
  const html = renderToStaticMarkup(
    <BinaryMetadataViewer
      file={{
        ...codeFile,
        path: "agent-cache",
        viewerKind: "binary",
        encoding: "none",
        content: "",
        size: 4096,
        mimeType: "application/octet-stream",
      }}
      theme="dark"
    />,
  );

  expect(html).toContain("metadata only");
  expect(html).toContain("application/octet-stream");
  expect(html).toContain("Vivi did not load file contents");
  expect(html).not.toContain("This file type is not supported yet.");
});

it("shows an explicit removed-file state instead of stale content", () => {
  const html = renderToStaticMarkup(
    <FileViewer
      file={{ ...codeFile, path: "docs/deleted.md", viewerKind: "markdown" }}
      removed={true}
      allowHtmlScripts={false}
      theme="dark"
      selectedCodeRange={null}
      onCodeSelectionChange={() => undefined}
      onCloseRemoved={() => undefined}
    />,
  );

  expect(html).toContain("Removed from disk");
  expect(html).toContain("docs/deleted.md");
  expect(html).toContain("Close tab");
  expect(html).not.toContain("export function start");
});

it("renders a central file location bar that can reveal path segments", () => {
  const calls: string[] = [];
  const file = {
    ...codeFile,
    path: "docs/brief/intro.md",
    viewerKind: "markdown" as const,
  };
  const locationBar = FileLocationBar({
    file,
    onRevealInTree: (path) => calls.push(path ?? ""),
  });
  const html = renderToStaticMarkup(locationBar);

  expect(html).toContain(
    'aria-label="Current file location, brief / intro.md, full path docs/brief/intro.md"',
  );
  expect(html).toContain(
    'aria-label="Reveal folder docs/brief, segment 2 of 3, in the sidebar tree"',
  );
  expect(html).toContain(
    'aria-label="Current file intro.md, segment 3 of 3, reveal docs/brief/intro.md in the sidebar tree"',
  );
  expect(html).toContain('aria-current="page"');
  expect(html).toContain("docs");
  expect(html).toContain("brief");
  expect(html).toContain("intro.md");
  expect(html).toContain("Current file kind, Markdown");
  expect(html).not.toContain("Show in tree");

  const directoryButton = findElement(locationBar, (element) => {
    const props = element.props as { type?: string; children?: ReactNode };
    return props.type === "button" && flattenText(props.children) === "brief";
  });
  (directoryButton.props as { onClick: () => void }).onClick();

  const fileButton = findElement(locationBar, (element) => {
    const props = element.props as { className?: string; children?: ReactNode };
    return (
      props.className === "file" && flattenText(props.children) === "intro.md"
    );
  });
  (fileButton.props as { onClick: () => void }).onClick();

  expect(calls).toEqual(["docs/brief", "docs/brief/intro.md"]);
});

it("surfaces the current review stop in the central file location bar", () => {
  const calls: string[] = [];
  const file = {
    ...codeFile,
    path: "src/app.ts",
  };
  const stop = activeFileReviewStop(
    file,
    [
      { ...codeLineComment, id: "comment-other", path: "docs/other.md" },
      codeLineComment,
    ],
    codeLineComment.id,
  );
  const locationBar = FileLocationBar({
    file,
    activeReviewStop: stop,
    onFocusActiveComment: () => calls.push("focus-stop"),
    onRevealInTree: () => undefined,
  });
  const html = renderToStaticMarkup(locationBar);

  expect(stop).toEqual({
    label: "source · L2",
    preview: "Check this return",
  });
  expect(
    activeFileReviewStop(file, [codeLineComment], "missing-comment"),
  ).toBeNull();
  expect(html).toContain('class="file-location-review-stop"');
  expect(html).toContain('aria-keyshortcuts="Meta+I Control+I"');
  expect(html).toContain(
    'aria-label="Focus current review stop, source · L2, Check this return"',
  );
  expect(html).toContain("Current stop");
  expect(html).toContain("source · L2");
  expect(html).toContain("Check this return");

  const stopButton = findElement(locationBar, (element) => {
    const props = element.props as { className?: string };
    return props.className === "file-location-review-stop";
  });
  (stopButton.props as { onClick: () => void }).onClick();

  expect(calls).toEqual(["focus-stop"]);
});

it("keeps the HTML viewer sandboxed and exposes source mode controls", () => {
  const html = renderToStaticMarkup(
    <HtmlViewer
      file={{ ...codeFile, path: "index.html", viewerKind: "html" }}
      allowHtmlScripts={false}
    />,
  );

  expect(html).toContain("sandboxed · scripts off");
  expect(html).not.toContain("<strong>index.html</strong>");
  expect(html).toContain("Preview");
  expect(html).toContain("Source");
  expect(html).toContain('sandbox="allow-scripts"');
  expect(html).toContain("/preview/html?path=index.html");
  expect(html).toContain("theme=dark");
});

it("dispatches JSON files through a tree view with source fallback", () => {
  const html = renderToStaticMarkup(
    <JsonViewer
      file={{
        ...codeFile,
        path: "data/sample.json",
        viewerKind: "json",
        content: '{"ok":true,"items":[1]}',
      }}
    />,
  );

  expect(html).toContain("data/sample.json");
  expect(html).toContain("JSON tree");
  expect(html).toContain("items");
});

it("renders JSON diffs as source line diffs", () => {
  const html = renderToStaticMarkup(
    <JsonViewer
      file={{
        ...codeFile,
        path: "data/sample.json",
        viewerKind: "json",
        content: '{"ok":true}\n',
      }}
      diffEnabled
      diff={{
        path: "data/sample.json",
        status: "available",
        baseLabel: "HEAD",
        compareLabel: "working tree",
        content: '@@ -1,3 +1,3 @@\n {\n-  "ok": false\n+  "ok": true\n }',
      }}
    />,
  );

  expect(html).toContain('aria-label="Diff from HEAD for data/sample.json"');
  expect(html).toContain("diff-inline-row remove");
  expect(html).toContain("diff-inline-row add");
  expect(html).toContain('"ok": false');
  expect(html).toContain('"ok": true');
  expect(html).not.toContain("json-tree");
});

it("renders text and delimited diffs inside their viewer surfaces", () => {
  const textHtml = renderToStaticMarkup(
    <TextViewer
      file={{
        ...codeFile,
        path: "logs/build.log",
        viewerKind: "text",
        content: "done\n",
      }}
      diffEnabled
      diff={{
        path: "logs/build.log",
        status: "available",
        baseLabel: "HEAD",
        compareLabel: "working tree",
        content: "@@ -1,1 +1,1 @@\n-fail\n+done",
      }}
    />,
  );
  const csvHtml = renderToStaticMarkup(
    <CsvViewer
      file={{
        ...codeFile,
        path: "reports/results.csv",
        viewerKind: "text",
        content: "name,status\nhtml,ok\n",
      }}
      diffEnabled
      diff={{
        path: "reports/results.csv",
        status: "available",
        baseLabel: "HEAD",
        compareLabel: "working tree",
        content: "@@ -1,2 +1,2 @@\n name,status\n-html,fail\n+html,ok",
      }}
    />,
  );

  expect(textHtml).toContain('aria-label="Diff from HEAD for logs/build.log"');
  expect(textHtml).toContain("diff-inline-row remove");
  expect(textHtml).toContain("diff-inline-row add");
  expect(textHtml).not.toContain("plain-text wrap");
  expect(csvHtml).toContain(
    'aria-label="Diff from HEAD for reports/results.csv"',
  );
  expect(csvHtml).toContain("html,fail");
  expect(csvHtml).toContain("html,ok");
  expect(csvHtml).not.toContain("csv-table-wrap");
});

it("renders Mermaid diffs as source line diffs", () => {
  const html = renderToStaticMarkup(
    <MermaidViewer
      file={{
        ...codeFile,
        path: "docs/flow.mmd",
        viewerKind: "mermaid",
        content: "flowchart TD\nA-->B\n",
      }}
      diffEnabled
      diff={{
        path: "docs/flow.mmd",
        status: "available",
        baseLabel: "HEAD",
        compareLabel: "working tree",
        content: "@@ -1,2 +1,2 @@\n flowchart TD\n-A-->B\n+A-->C",
      }}
    />,
  );

  expect(html).toContain('aria-label="Diff from HEAD for docs/flow.mmd"');
  expect(html).toContain("A--&gt;B");
  expect(html).toContain("A--&gt;C");
  expect(html).not.toContain("mermaid-render-surface");
});

it("renders image diffs as binary or source diff status in the image viewer", () => {
  const html = renderToStaticMarkup(
    <ImageViewer
      file={{
        ...codeFile,
        path: "assets/logo.png",
        viewerKind: "image",
        encoding: "base64",
        content: "iVBORw0KGgo=",
        mimeType: "image/png",
      }}
      diffEnabled
      diff={{
        path: "assets/logo.png",
        status: "binary",
        baseLabel: "HEAD",
        compareLabel: "working tree",
        content: "",
        reason: "Binary diff is not shown in Vivi.",
      }}
    />,
  );

  expect(html).toContain('aria-label="Diff from HEAD for assets/logo.png"');
  expect(html).toContain("Binary");
  expect(html).toContain("Binary diff is not shown in Vivi.");
  expect(html).not.toContain("image-stage");
});

it("renders generic diffs for unsupported file types", () => {
  const html = renderToStaticMarkup(
    <FileViewer
      file={{
        ...codeFile,
        path: "artifact.unknown",
        viewerKind: "unsupported",
        content: "new\n",
      }}
      allowHtmlScripts={false}
      theme="dark"
      selectedCodeRange={null}
      diffEnabled
      diff={{
        path: "artifact.unknown",
        status: "available",
        baseLabel: "HEAD",
        compareLabel: "working tree",
        content: "@@ -1,1 +1,1 @@\n-old\n+new",
      }}
      onCodeSelectionChange={() => undefined}
    />,
  );

  expect(html).toContain('aria-label="Diff from HEAD for artifact.unknown"');
  expect(html).toContain("diff-inline-row remove");
  expect(html).toContain("diff-inline-row add");
  expect(html).not.toContain("This file type is not supported yet.");
});

it("keeps the inspector focused on review queue, comments, and file details", () => {
  const html = renderToStaticMarkup(
    <Inspector
      file={codeFile}
      reviewChanges={[
        { path: "src/app.ts", status: "modified", source: "git" },
        { path: "docs/mode-only.md", status: "modified", source: "git" },
        {
          path: "docs/new.md",
          originalPath: "docs/old.md",
          status: "renamed",
          source: "watcher",
        },
      ]}
      reviewDiffStats={{
        "src/app.ts": { additions: 100, deletions: 32 },
        "docs/mode-only.md": {
          additions: 0,
          deletions: 0,
          metadataOnly: true,
        },
        "docs/new.md": { additions: 4, deletions: 2 },
      }}
      loadingReviewDiffs={{}}
      unreadReviewPaths={new Set(["src/app.ts"])}
      selectedCodeRange={{ start: 2, end: 2 }}
      activePath="src/app.ts"
      activePaneId="main"
      onOpenEventPath={() => undefined}
      onConfirmEventPath={() => undefined}
      onOpenNextUnread={() => undefined}
      onOpenNextChanged={() => undefined}
      onOpenPreviousChanged={() => undefined}
      onOpenAllChanged={() => undefined}
      onRevealInTree={() => undefined}
      onOpenComments={() => undefined}
      onCommentStatusChange={() => undefined}
    />,
  );

  expect(html).toContain("Review Queue");
  expect(html.indexOf("Review Queue")).toBeLessThan(html.indexOf("Comments"));
  expect(html).toContain("Next");
  expect(html).toContain("Previous");
  expect(html).toContain("Unseen");
  expect(html).toContain("Meta+Shift+U Control+Shift+U");
  expect(html).toContain("<strong>2/3</strong> files seen");
  expect(html).toContain("1 unseen");
  expect(html).toContain('aria-valuetext="2 of 3 review files seen, 1 unseen"');
  expect(html).toContain("viewing 1/3");
  expect(html).toContain('class="review-queue" role="list"');
  expect(html).toContain(
    'aria-label="Review queue, 2 of 3 review files seen, 1 unseen"',
  );
  expect(html).toContain(
    'aria-describedby="review-queue-interaction-help review-queue-keyboard-help"',
  );
  expect(html).toContain('id="review-queue-keyboard-help"');
  expect(html).toContain(
    "Use Down Arrow, Up Arrow, Home, and End to move between review",
  );
  expect(html).toContain(
    'class="review-queue-item" role="listitem" aria-posinset="1" aria-setsize="3"',
  );
  expect(html).toContain('class="change-open active"');
  expect(html).toContain('aria-current="true"');
  expect(html).toContain('aria-keyshortcuts="ArrowDown ArrowUp Home End"');
  expect(html).toContain('id="review-queue-interaction-help"');
  expect(html).toContain(
    'aria-describedby="review-queue-interaction-help review-queue-keyboard-help review-queue-item-1-description"',
  );
  expect(html).toContain('id="review-queue-item-1-description"');
  expect(html).toContain("unseen review work, from HEAD diff");
  expect(html).toContain("Click or press Enter to preview a review file.");
  expect(html).toContain("Double-click to keep it open as a tab.");
  expect(html).toContain('data-review-index="0"');
  expect(html).toContain('data-review-path="src/app.ts"');
  expect(html).toContain('data-testid="review-queue-item"');
  expect(html).toContain(
    'aria-label="Review queue item, modified src/app.ts, current review file"',
  );
  expect(html).toContain("src/app.ts:2");
  expect(html).toContain("+100");
  expect(html).toContain("-32");
  expect(html).toContain("metadata");
  expect(html).not.toContain("+0");
  expect(html).not.toContain("-0");
  expect(html).toContain("app.ts");
  expect(html).toContain("mode-only.md");
  expect(html).toContain("docs/old.md -&gt; docs/new.md");
  expect(html).toContain("HEAD diff");
  expect(html).toContain("local change");
  expect(html).toContain('class="change-path-line"');
  expect(html).toContain('class="change-path-text"');
  expect(html).toContain('title="src/app.ts"');
  expect(html).toContain("modified");
  expect(html).toContain("renamed");
  expect(html).toContain("Details");
  expect(html.indexOf("Review Queue")).toBeLessThan(html.indexOf("Details"));
  expect(html).toContain("Open all changed files as tabs");
  expect(html).toContain("In this file");
  expect(html).toContain("export");
  expect(html).toContain("start");
  expect(html).not.toContain("Recent events");
  expect(html).not.toContain("Diff</button>");
  expect(html).not.toContain("Review targets");
  expect(html).not.toContain("Changed files");
  expect(html).not.toContain("Diff preview");
});

it("maps review queue arrow keys to stable review rows", () => {
  expect(reviewQueueKeyboardTarget("ArrowDown", -1, 3)).toBe(0);
  expect(reviewQueueKeyboardTarget("ArrowDown", 0, 3)).toBe(1);
  expect(reviewQueueKeyboardTarget("ArrowDown", 2, 3)).toBe(2);
  expect(reviewQueueKeyboardTarget("ArrowUp", 2, 3)).toBe(1);
  expect(reviewQueueKeyboardTarget("ArrowUp", 0, 3)).toBe(0);
  expect(reviewQueueKeyboardTarget("Home", 2, 3)).toBe(0);
  expect(reviewQueueKeyboardTarget("End", 0, 3)).toBe(2);
  expect(reviewQueueKeyboardTarget("Enter", 0, 3)).toBeNull();
  expect(reviewQueueKeyboardTarget("End", -1, 3)).toBeNull();
  expect(reviewQueueKeyboardTarget("ArrowDown", -1, 0)).toBeNull();
});

it("summarizes active-file review focus without mixing drafts into open threads", () => {
  const html = renderToStaticMarkup(
    <Inspector
      file={codeFile}
      reviewChanges={[]}
      reviewDiffStats={{}}
      loadingReviewDiffs={{}}
      unreadReviewPaths={new Set()}
      comments={[
        { ...codeLineComment, threadId: "thread-1" },
        {
          ...codeLineComment,
          id: "comment-2",
          threadId: "thread-1",
          body: "Second message in same thread",
          createdAt: "2026-01-01T00:01:00.000Z",
          updatedAt: "2026-01-01T00:01:00.000Z",
        },
        {
          ...codeLineComment,
          id: "comment-3",
          threadId: "thread-2",
          status: "resolved",
        },
      ]}
      draftComments={[
        {
          id: "draft-1",
          path: "src/app.ts",
          viewerKind: "code",
          anchor: codeLineComment.anchor,
          body: "Unpublished note",
          source: "human",
          createdAt: "2026-01-01T00:02:00.000Z",
          updatedAt: "2026-01-01T00:02:00.000Z",
        },
      ]}
      activeCommentId="comment-2"
      selectedCodeRange={null}
      activePaneId="main"
      onOpenEventPath={() => undefined}
      onConfirmEventPath={() => undefined}
      onOpenNextChanged={() => undefined}
      onOpenPreviousChanged={() => undefined}
      onOpenAllChanged={() => undefined}
      onRevealInTree={() => undefined}
      onOpenComments={() => undefined}
      onCommentStatusChange={() => undefined}
    />,
  );

  expect(html).toContain("Active File");
  expect(html).toContain("1 open thread");
  expect(html).toContain("<strong>1</strong> open");
  expect(html).toContain("<strong>1</strong> drafts");
  expect(html).toContain("<strong>1</strong> history");
  expect(html).toContain("<strong>1 open thread</strong>");
  expect(html).toContain("3 total messages in this file");
  expect(html).toContain('class="active-comment-thread open active"');
  expect(html).toContain('class="active-comment-thread resolved"');
  expect(html).toContain('aria-current="true"');
  expect(html).toContain("Current thread");
  expect(html).toContain("2 messages");
  expect(html).toContain('class="active-comment-thread-preview"');
  expect(html).toContain("Second message in same thread");
  expect(html).toContain("Check this return");
  expect(html).toContain(
    "current thread, Source L2, source, L2, latest: Second message in same thread",
  );
  expect(html).toContain("source");
  expect(html).toContain("L2");
  expect(html).toContain(
    '<div class="active-file-actions" aria-label="Active file actions">',
  );
  expect(html).toContain("Open 3 total messages in Comments panel");
  expect(html).toContain('class="review-focus-action comments-panel-action"');
  expect(html).toContain('data-testid="review-open-comments-panel"');
  expect(html).toContain('data-testid="review-comment-thread"');
  expect(html).toContain('data-comment-thread-id="thread-1"');
  expect(html).toContain('aria-label="Thread actions for src/app.ts, L2"');
  expect(html).toContain('class="active-comment-thread-actions"');
  expect(html).toContain(">Resolve current thread</button>");
  expect(html).toContain(">Reopen</button>");
  expect(html).toContain(">Archive current thread</button>");
  expect(html).toContain(
    'aria-keyshortcuts="Meta+Shift+Enter Control+Shift+Enter"',
  );
  expect(html).toContain(
    'aria-keyshortcuts="Meta+Shift+Backspace Control+Shift+Backspace"',
  );
  expect(html).toContain(
    'title="Resolve current thread (Cmd/Ctrl Shift Enter)"',
  );
  expect(html).toContain(
    'title="Archive current thread (Cmd/Ctrl Shift Backspace)"',
  );
  expect(html).not.toContain("2 open comments");
  expect(html).toContain("Drafts stay private until published");
});

it("updates active-file comment thread status from the inspector", () => {
  const updates: Array<[string, string]> = [];
  const inspector = Inspector({
    file: codeFile,
    reviewChanges: [],
    reviewDiffStats: {},
    loadingReviewDiffs: {},
    unreadReviewPaths: new Set(),
    comments: [{ ...codeLineComment, threadId: "thread-1" }],
    selectedCodeRange: null,
    activePaneId: "main",
    onOpenEventPath: () => undefined,
    onConfirmEventPath: () => undefined,
    onOpenNextChanged: () => undefined,
    onOpenPreviousChanged: () => undefined,
    onOpenAllChanged: () => undefined,
    onRevealInTree: () => undefined,
    onOpenComments: () => undefined,
    onCommentStatusChange: (threadId, status) =>
      updates.push([threadId, status]),
  });

  const resolveButton = findElement(inspector, (element) => {
    const props = element.props as { children?: ReactNode; type?: string };
    return props.type === "button" && flattenText(props.children) === "Resolve";
  });
  const archiveButton = findElement(inspector, (element) => {
    const props = element.props as { children?: ReactNode; type?: string };
    return props.type === "button" && flattenText(props.children) === "Archive";
  });

  (resolveButton.props as { onClick: () => void }).onClick();
  (archiveButton.props as { onClick: () => void }).onClick();

  expect(updates).toEqual([
    ["thread-1", "resolved"],
    ["thread-1", "archived"],
  ]);
});

it("shows precise active-file comment locations in the inspector", () => {
  const renderedComment: ViviComment = {
    ...codeLineComment,
    id: "markdown-rendered-thread",
    threadId: "thread-rendered",
    path: "README.md",
    viewerKind: "markdown",
    anchor: {
      surface: "rendered",
      canonical: {
        path: "README.md",
        lineStart: 3,
        lineEnd: 4,
        quote: "Paragraph text",
      },
      rendered: {
        kind: "markdown",
        blockId: "vivi-block-2",
        sourceLineStart: 3,
        sourceLineEnd: 4,
      },
    },
    body: "Rendered paragraph needs a clearer transition.",
  };
  const diffComment: ViviComment = {
    ...codeLineComment,
    id: "markdown-diff-thread",
    threadId: "thread-diff",
    path: "README.md",
    viewerKind: "markdown",
    anchor: {
      surface: "diff",
      canonical: {
        path: "README.md",
        lineStart: 8,
        lineEnd: 9,
        quote: "new branch",
      },
      diff: {
        path: "README.md",
        base: "HEAD",
        ref: "working tree",
        hunkId: "@@ -4,1 +8,2 @@",
        side: "new",
        newLineStart: 8,
        newLineEnd: 9,
      },
    },
    body: "Diff branch needs a clearer transition.",
    updatedAt: "2026-01-01T00:02:00.000Z",
  };
  const html = renderToStaticMarkup(
    <Inspector
      file={markdownFile}
      reviewChanges={[]}
      reviewDiffStats={{}}
      loadingReviewDiffs={{}}
      unreadReviewPaths={new Set()}
      comments={[renderedComment, diffComment]}
      selectedCodeRange={null}
      activePaneId="main"
      onOpenEventPath={() => undefined}
      onConfirmEventPath={() => undefined}
      onOpenNextChanged={() => undefined}
      onOpenPreviousChanged={() => undefined}
      onOpenAllChanged={() => undefined}
      onRevealInTree={() => undefined}
      onOpenComments={() => undefined}
    />,
  );

  expect(html).toContain(
    "Rendered Markdown · block vivi-block-2 · source L3-L4",
  );
  expect(html).toContain("Diff new L8-L9");
  expect(html).toContain(
    'aria-label="Open thread in README.md, Rendered Markdown · block vivi-block-2 · source L3-L4, markdown rendered, L3-L4, latest: Rendered paragraph needs a clearer transition."',
  );
  expect(html).toContain(
    'aria-label="Open thread in README.md, Diff new L8-L9, diff, L8-L9, latest: Diff branch needs a clearer transition."',
  );
  expect(html).toContain('class="active-comment-thread-location"');
});

it("disables the inspector comments panel action when the panel is unavailable", () => {
  const inspector = Inspector({
    file: codeFile,
    reviewChanges: [],
    reviewDiffStats: {},
    loadingReviewDiffs: {},
    unreadReviewPaths: new Set(),
    comments: [{ ...codeLineComment, threadId: "thread-1" }],
    selectedCodeRange: null,
    activePaneId: "main",
    onOpenEventPath: () => undefined,
    onConfirmEventPath: () => undefined,
    onOpenNextChanged: () => undefined,
    onOpenPreviousChanged: () => undefined,
    onOpenAllChanged: () => undefined,
    onRevealInTree: () => undefined,
  });

  const button = findElement(inspector, (element) => {
    const props = element.props as { children?: ReactNode };
    return (
      element.type === "button" &&
      flattenText(props.children).includes("Open in Comments panel")
    );
  });
  const props = button.props as {
    "aria-label"?: string;
    className?: string;
    disabled?: boolean;
    title?: string;
  };

  expect(props.disabled).toBe(true);
  expect(props.className).toBe("review-focus-action comments-panel-action");
  expect(props.title).toBe("Comments panel is not available in this view");
  expect(props["aria-label"]).toBe(
    "Comments panel is not available in this view",
  );
});

it("explains that the comments panel action needs a selected review file", () => {
  const queuedChange = {
    path: "src/app.ts",
    source: "git" as const,
    status: "modified" as const,
  };
  const inspector = Inspector({
    file: null,
    reviewChanges: [queuedChange],
    reviewDiffStats: {},
    loadingReviewDiffs: {},
    unreadReviewPaths: new Set([queuedChange.path]),
    comments: [],
    selectedCodeRange: null,
    activePaneId: "main",
    onOpenEventPath: () => undefined,
    onConfirmEventPath: () => undefined,
    onOpenNextChanged: () => undefined,
    onOpenPreviousChanged: () => undefined,
    onOpenAllChanged: () => undefined,
    onRevealInTree: () => undefined,
    onOpenComments: () => undefined,
    onCommentStatusChange: () => undefined,
  });

  const button = findElement(inspector, (element) => {
    const props = element.props as { "data-testid"?: string };
    return props["data-testid"] === "review-open-comments-panel";
  });
  const props = button.props as {
    "aria-label"?: string;
    disabled?: boolean;
    title?: string;
  };

  expect(props.disabled).toBe(true);
  expect(props.title).toBe("Select a review file to view comments");
  expect(props["aria-label"]).toBe("Select a review file to view comments");
});

it("renders comment activity in inline thread headers without changing lifecycle status", () => {
  const html = renderToStaticMarkup(
    <CodeCommentThread
      thread={{
        key: "thread-1",
        path: "src/app.ts",
        lineStart: 2,
        lineEnd: 2,
        status: "open",
        comments: [
          { ...codeLineComment, threadId: "thread-1" },
          { ...codeLineReply, threadId: "thread-1" },
        ],
      }}
      draft={{
        threadId: "thread-1",
        path: "src/app.ts",
        viewerKind: "text",
        anchor: codeLineComment.anchor,
      }}
      activity={summarizeThreadActivity(
        [
          {
            id: "activity-1",
            threadId: "thread-1",
            type: "thread_read",
            actor: {
              id: "claude-code:run-1",
              kind: "claude-code",
              displayName: "Claude Code",
            },
            createdAt: "2026-06-20T00:00:48.000Z",
          },
          {
            id: "activity-2",
            threadId: "thread-1",
            type: "comment_added",
            actor: {
              id: "codex:run-1",
              kind: "codex",
              displayName: "Codex",
            },
            createdAt: "2026-06-20T00:00:00.000Z",
          },
        ],
        new Date("2026-06-20T00:01:00.000Z").getTime(),
      )}
      activeCommentId="comment-2"
      onClose={() => undefined}
    />,
  );

  expect(html).toContain('class="code-thread-comment open active"');
  expect(html).toContain('aria-current="true"');
  expect(html).toContain("Current stop");
  expect(html).toContain("Claude Code read 12s ago");
  expect(html).toContain("Codex replied 1m ago");
  expect(html).toContain('class="comment-status open">Open</span>');
  expect(html).not.toContain("read</span></span>");
});

it("autofocuses new inline comments without focusing existing reply threads", () => {
  const html = renderToStaticMarkup(
    <CodeCommentThread
      thread={{
        key: "src/app.ts:4-4",
        path: "src/app.ts",
        lineStart: 4,
        lineEnd: 4,
        status: "open",
        comments: [],
      }}
      draft={{
        path: "src/app.ts",
        viewerKind: "text",
        anchor: {
          surface: "source",
          canonical: {
            path: "src/app.ts",
            lineStart: 4,
            lineEnd: 4,
          },
        },
      }}
      onClose={() => undefined}
    />,
  );

  expect(html).toContain('aria-label="New line comment"');
  expect(html).toContain('aria-label="Save private draft comment"');
  expect(html).toContain("<kbd>Cmd/Ctrl Enter</kbd> to save private draft");
  expect(html).toContain("autofocus");
});

it("uses the configured review actor for browser-authored drafts", () => {
  expect(
    reviewActorForConfig({
      root: "/work/repo",
      allowHtmlScripts: false,
      maxFileSizeBytes: 1024,
      reviewActor: {
        id: "gui-reviewer",
        kind: "human",
        displayName: "gui-reviewer",
      },
    }),
  ).toEqual({
    id: "gui-reviewer",
    kind: "human",
    displayName: "gui-reviewer",
  });
  expect(
    reviewActorForConfig({
      root: "/work/repo",
      allowHtmlScripts: false,
      maxFileSizeBytes: 1024,
    }),
  ).toBeUndefined();
});

it("renders inline thread actions from the latest published thread status", () => {
  const html = renderToStaticMarkup(
    <CodeCommentThread
      thread={{
        key: "thread-1",
        path: "src/app.ts",
        lineStart: 2,
        lineEnd: 2,
        status: "resolved",
        comments: [
          {
            ...codeLineComment,
            threadId: "thread-1",
            status: "open",
            updatedAt: "2026-06-20T00:00:00.000Z",
          },
          {
            ...codeLineReply,
            threadId: "thread-1",
            status: "resolved",
            updatedAt: "2026-06-20T00:01:00.000Z",
          },
        ],
      }}
      draft={{
        threadId: "thread-1",
        path: "src/app.ts",
        viewerKind: "text",
        anchor: codeLineComment.anchor,
      }}
      onClose={() => undefined}
    />,
  );

  expect(html).toContain('class="comment-status resolved">Resolved</span>');
  expect(html).toContain("Reopen thread");
  expect(html).not.toContain("Resolve thread");
});

it("renders draft and published messages in the same inline thread", () => {
  const html = renderToStaticMarkup(
    <CodeCommentThread
      thread={{
        key: "thread-1",
        path: "src/app.ts",
        lineStart: 2,
        lineEnd: 2,
        status: "open",
        comments: [
          { ...codeLineComment, threadId: "thread-1" },
          {
            ...codeLineReply,
            id: "draft:draft-1",
            draftId: "draft-1",
            draft: true,
            threadId: "thread-1",
            body: "Still unpublished in this thread",
          },
        ],
      }}
      draft={{
        threadId: "thread-1",
        path: "src/app.ts",
        viewerKind: "text",
        anchor: codeLineComment.anchor,
      }}
      onClose={() => undefined}
    />,
  );

  expect(html).toContain("2 messages");
  expect(html).toContain("Check this return");
  expect(html).toContain("Still unpublished in this thread");
  expect(html).toContain('class="comment-status published">Published</span>');
  expect(html).toContain('class="comment-status draft">Draft</span>');
  expect(html).toContain("Resolve thread");
});

it("renders the empty draft review tray as a compact tab only", () => {
  const html = renderToStaticMarkup(<DraftReviewTray drafts={[]} />);

  expect(html).toContain("draft-review-tab empty");
  expect(html).toContain(">Drafts <strong>0</strong>");
  expect(html).toContain(
    'aria-label="Open Draft Review tray, no unpublished comments"',
  );
  expect(html).toContain("<strong>0</strong>");
  expect(html).not.toContain("draft-review-panel");
  expect(html).not.toContain("No draft comments.");
});

it("renders draft review tray editing, success, and publish failure states", () => {
  const draft = {
    id: "draft-1",
    path: "src/app.ts",
    viewerKind: "text" as const,
    anchor: codeLineComment.anchor,
    body: "Keep this draft visible on publish failure",
    source: "human" as const,
    createdAt: "2026-06-20T00:00:00.000Z",
    updatedAt: "2026-06-20T00:00:00.000Z",
  };
  const renderedDraft = {
    ...draft,
    id: "draft-2",
    path: "README.md",
    viewerKind: "markdown" as const,
    anchor: {
      ...draft.anchor,
      surface: "rendered" as const,
      rendered: {
        kind: "markdown" as const,
        blockId: "p-intro",
        textQuote: "Intro copy",
      },
    },
  };

  const editingHtml = renderToStaticMarkup(
    <DraftReviewTray
      drafts={[draft, renderedDraft]}
      initialEditingDraftId={draft.id}
    />,
  );
  expect(editingHtml).toContain("textarea");
  expect(editingHtml).toContain("Private drafts");
  expect(editingHtml).toContain(
    'aria-label="Close Draft Review tray, 2 unpublished comments kept private until publish"',
  );
  expect(editingHtml).toContain(
    'title="2 unpublished comments kept private until publish"',
  );
  expect(editingHtml).toContain("Keep this draft visible on publish failure");
  expect(editingHtml).toContain(
    'aria-label="Open private draft in src/app.ts, source, L2, kept private until publish"',
  );
  expect(editingHtml).toContain(
    'title="Open private draft in src/app.ts, source, L2, kept private until publish"',
  );
  expect(editingHtml).toContain('id="draft-edit-hint-draft-1"');
  expect(editingHtml).toContain("This draft remains private until published.");
  expect(editingHtml).toContain(
    'aria-label="Edit private draft comment for src/app.ts"',
  );
  expect(editingHtml).toContain('aria-describedby="draft-edit-hint-draft-1"');
  expect(editingHtml).toContain("Publish review comments");
  expect(editingHtml).toContain(
    "Publish 2 draft comments as 2 open threads across 2 files",
  );
  expect(editingHtml).toContain("2 open threads");
  expect(editingHtml).toContain("across 2 files");
  expect(editingHtml).toContain("visible to agents as active review work");
  expect(editingHtml).toContain("markdown rendered");
  expect(editingHtml).toContain("source");

  const sameThreadHtml = renderToStaticMarkup(
    <DraftReviewTray
      drafts={[
        { ...draft, threadId: "thread-a" },
        {
          ...draft,
          id: "draft-2",
          threadId: "thread-a",
          body: "Second note in the same unpublished thread",
          createdAt: "2026-06-20T00:01:00.000Z",
          updatedAt: "2026-06-20T00:01:00.000Z",
        },
      ]}
    />,
  );
  expect(sameThreadHtml).toContain("2 unpublished comments");
  expect(sameThreadHtml).toContain("1 open thread");
  expect(sameThreadHtml).not.toContain("2 open threads");

  const failedHtml = renderToStaticMarkup(
    <DraftReviewTray
      drafts={[draft]}
      publishError="The selected target thread is no longer open."
    />,
  );
  expect(failedHtml).toContain("Publish failed. Drafts were kept.");
  expect(failedHtml).toContain("The selected target thread is no longer open.");
  expect(failedHtml).toContain("Keep this draft visible on publish failure");

  const publishingHtml = renderToStaticMarkup(
    <DraftReviewTray drafts={[draft]} publishing />,
  );
  expect(publishingHtml).toContain("Publishing...");
  expect(publishingHtml).toContain("Publishing draft review comments");
  expect(publishingHtml).toContain("disabled");

  const emptyOpenHtml = renderToStaticMarkup(
    <DraftReviewTray drafts={[]} initialOpen />,
  );
  expect(emptyOpenHtml).toContain("No draft comments to publish");
  expect(emptyOpenHtml).toContain("No unpublished comments");
  expect(emptyOpenHtml).toContain("disabled");

  const successHtml = renderToStaticMarkup(
    <DraftReviewTray drafts={[]} publishedBatchId="review-batch-test-1" />,
  );
  expect(successHtml).toContain("Published review batch review-batch-test-1");
  expect(successHtml).toContain("visible to agents");
});

it("renders draft review items with their full surface context", () => {
  const draft = {
    id: "draft-1",
    path: "README.md",
    viewerKind: "markdown" as const,
    anchor: {
      ...codeLineComment.anchor,
      surface: "rendered" as const,
      rendered: {
        kind: "markdown" as const,
        blockId: "p-intro",
        textQuote: "Intro copy",
      },
    },
    body: "Rendered draft",
    source: "human" as const,
    createdAt: "2026-06-20T00:00:00.000Z",
    updatedAt: "2026-06-20T00:00:00.000Z",
  };
  const html = renderToStaticMarkup(
    <DraftReviewTray drafts={[draft]} initialOpen />,
  );

  expect(html).toContain("README.md");
  expect(html).toContain("markdown rendered");
  expect(html).toContain("Rendered draft");
});

it("renders comment activity in workspace comments rows", () => {
  const html = renderToStaticMarkup(
    <CommentsPanel
      open
      comments={[
        { ...codeLineComment, threadId: "thread-1" },
        {
          ...codeLineComment,
          id: "comment-2",
          threadId: "thread-1",
          body: "Agent reply is visible as the latest thread message.",
          source: "codex",
          createdBy: {
            id: "codex:run-1",
            kind: "codex",
            displayName: "Codex",
          },
          createdAt: "2026-01-01T00:01:00.000Z",
          updatedAt: "2026-01-01T00:01:00.000Z",
        },
      ]}
      query=""
      statusFilter="open"
      activeCommentId="comment-2"
      threadActivities={{
        "thread-1": summarizeThreadActivity(
          [
            {
              id: "activity-1",
              threadId: "thread-1",
              type: "comment_added",
              actor: {
                id: "codex:run-1",
                kind: "codex",
                displayName: "Codex",
              },
              createdAt: "2026-06-20T00:00:00.000Z",
            },
          ],
          new Date("2026-06-20T00:01:00.000Z").getTime(),
        ),
      }}
      onQueryChange={() => undefined}
      onStatusFilterChange={() => undefined}
      onClose={() => undefined}
      onOpenComment={() => undefined}
      onStatusChange={() => undefined}
    />,
  );

  expect(html).toContain("Review Inbox");
  expect(html).toContain("1 thread · 2 messages");
  expect(html).toContain('aria-label="Current review stop"');
  expect(html).toContain("Current stop");
  expect(html).toContain("Source L2 · L2 · source");
  expect(html).toContain("Visible below");
  expect(html).toContain(
    'aria-label="Return to current thread, src/app.ts, Source L2, L2"',
  );
  expect(html).toContain(">Return</button>");
  expect(html).toContain(
    'aria-describedby="comments-panel-result-summary comments-panel-keyboard-help"',
  );
  expect(html).toContain('id="comments-panel-keyboard-help"');
  expect(html).toContain(
    "Press Down Arrow from search to move into visible comment threads.",
  );
  expect(html).toContain("Up Arrow from the first thread to return to search.");
  expect(html).toContain(
    'id="comments-panel-result-summary" aria-live="polite"',
  );
  expect(html).toContain('role="list"');
  expect(html).toContain('aria-describedby="comments-panel-keyboard-help"');
  expect(html).toContain('aria-label="Comment threads, 1 thread · 2 messages"');
  expect(html).toContain(
    'class="global-comment-listitem" role="listitem" aria-posinset="1" aria-setsize="1"',
  );
  expect(html).toContain('aria-label="Comment status filters"');
  expect(html).toContain("All 1");
  expect(html).toContain("Open 1");
  expect(html).toContain('aria-label="Show 1 open thread"');
  expect(html).toContain('aria-pressed="true"');
  expect(html).toContain('aria-pressed="false"');
  expect(html).toContain("2 messages");
  expect(html).toContain(
    'aria-label="Open thread in src/app.ts, current thread, Source L2, L2, source, 2 messages, latest by Codex"',
  );
  expect(html).toContain("global-comment-row open active");
  expect(html).toContain('aria-current="true"');
  expect(html).toContain('aria-keyshortcuts="ArrowDown ArrowUp Home End"');
  expect(html).toContain('data-comment-thread-id="thread-1"');
  expect(html).toContain("Current thread");
  expect(html).toContain("Source L2");
  expect(html).toContain('data-comment-id="comment-2"');
  expect(html).toContain("Latest by Codex");
  expect(html).toContain("Agent reply is visible as the latest thread message");
  expect(html).toContain("Codex replied 1m ago");
  expect(html).toContain("source");
  expect(html).toContain("global-comment-thread-foot");
  expect(html).toContain("global-comment-open-hint");
  expect(html).toContain("Open feedback");
  expect(html).toContain('aria-label="Thread actions for src/app.ts, L2"');
  expect(html).toContain(">Resolve current thread</button>");
  expect(html).toContain(">Archive current thread</button>");
  expect(html).toContain(
    'aria-keyshortcuts="Meta+Shift+Enter Control+Shift+Enter"',
  );
  expect(html).toContain(
    'aria-keyshortcuts="Meta+Shift+Backspace Control+Shift+Backspace"',
  );
  expect(html).toContain(
    'title="Resolve current thread (Cmd/Ctrl Shift Enter)"',
  );
  expect(html).toContain(
    'title="Archive current thread (Cmd/Ctrl Shift Backspace)"',
  );
  expect(html).toContain("Open");
});

it("marks workspace comment rows when the open file changed since the anchor", () => {
  const staleComment: ViviComment = {
    ...codeLineComment,
    anchor: {
      ...codeLineComment.anchor,
      canonical: {
        ...codeLineComment.anchor.canonical,
        fileHash: "sha256:older",
      },
    },
  };
  const html = renderToStaticMarkup(
    <CommentsPanel
      open
      comments={[staleComment]}
      currentFile={codeFile}
      query=""
      statusFilter="open"
      onQueryChange={() => undefined}
      onStatusFilterChange={() => undefined}
      onClose={() => undefined}
      onOpenComment={() => undefined}
    />,
  );

  expect(html).toContain("Source changed");
  expect(html).toContain(
    'aria-label="Current file content differs from this comment anchor"',
  );
});

it("marks workspace comment rows when the source path is missing", () => {
  const missingComment: ViviComment = {
    ...codeLineComment,
    path: "README.md",
    anchor: {
      ...codeLineComment.anchor,
      canonical: {
        ...codeLineComment.anchor.canonical,
        path: "README.md",
      },
    },
  };
  const html = renderToStaticMarkup(
    <CommentsPanel
      open
      comments={[missingComment]}
      knownMissingPaths={new Set(["README.md"])}
      query=""
      statusFilter="open"
      onQueryChange={() => undefined}
      onStatusFilterChange={() => undefined}
      onClose={() => undefined}
      onOpenComment={() => undefined}
    />,
  );

  expect(html).toContain("Source missing");
  expect(html).toContain(
    'aria-label="This comment points to a path that is not present in the current workspace tree"',
  );
});

it("maps comments inbox arrow keys to stable thread rows", () => {
  expect(commentInboxKeyboardTarget("ArrowDown", -1, 3)).toBe(0);
  expect(commentInboxKeyboardTarget("ArrowDown", 0, 3)).toBe(1);
  expect(commentInboxKeyboardTarget("ArrowDown", 2, 3)).toBe(2);
  expect(commentInboxKeyboardTarget("ArrowUp", 2, 3)).toBe(1);
  expect(commentInboxKeyboardTarget("ArrowUp", 0, 3)).toBe("search");
  expect(commentInboxKeyboardTarget("Home", 2, 3)).toBe(0);
  expect(commentInboxKeyboardTarget("End", 0, 3)).toBe(2);
  expect(commentInboxKeyboardTarget("Enter", 0, 3)).toBeNull();
  expect(commentInboxKeyboardTarget("End", -1, 3)).toBeNull();
  expect(commentInboxKeyboardTarget("ArrowDown", -1, 0)).toBeNull();
});

it("opens the latest comment when a workspace comment row is activated", () => {
  const opened: string[] = [];
  const panel = CommentsPanel({
    open: true,
    comments: [
      { ...codeLineComment, threadId: "thread-1" },
      {
        ...codeLineComment,
        id: "comment-latest",
        threadId: "thread-1",
        body: "Latest reply is the navigation target.",
        createdAt: "2026-01-01T00:01:00.000Z",
        updatedAt: "2026-01-01T00:02:00.000Z",
      },
    ],
    query: "",
    statusFilter: "open",
    onQueryChange: () => undefined,
    onStatusFilterChange: () => undefined,
    onClose: () => undefined,
    onOpenComment: (comment) => opened.push(comment.id),
  });

  const row = findElement(panel, (element) => {
    const props = element.props as {
      className?: string;
      "aria-label"?: string;
    };
    return (
      props.className?.split(" ").includes("global-comment-row") &&
      props["aria-label"]?.startsWith("Open thread in src/app.ts") === true
    );
  });
  const props = row.props as {
    onClick: () => void;
    children?: ReactNode;
  };

  props.onClick();

  expect(flattenText(props.children)).toContain("Open feedback");
  expect(opened).toEqual(["comment-latest"]);
});

it("updates thread status from the workspace comments action rail", () => {
  const updates: Array<[string, string]> = [];
  const panel = CommentsPanel({
    open: true,
    comments: [{ ...codeLineComment, threadId: "thread-1" }],
    query: "",
    statusFilter: "open",
    onQueryChange: () => undefined,
    onStatusFilterChange: () => undefined,
    onClose: () => undefined,
    onOpenComment: () => undefined,
    onStatusChange: (threadId, status) => updates.push([threadId, status]),
  });

  const resolveButton = findElement(panel, (element) => {
    const props = element.props as {
      "aria-label"?: string;
      children?: ReactNode;
      title?: string;
      type?: string;
    };
    return props.type === "button" && flattenText(props.children) === "Resolve";
  });
  const archiveButton = findElement(panel, (element) => {
    const props = element.props as {
      "aria-label"?: string;
      children?: ReactNode;
      title?: string;
      type?: string;
    };
    return props.type === "button" && flattenText(props.children) === "Archive";
  });
  const resolveProps = resolveButton.props as {
    "aria-label"?: string;
    onClick: () => void;
    title?: string;
  };
  const archiveProps = archiveButton.props as {
    "aria-label"?: string;
    onClick: () => void;
    title?: string;
  };

  expect(resolveProps["aria-label"]).toBe("Resolve comment for src/app.ts, L2");
  expect(resolveProps.title).toBe("Resolve comment for src/app.ts, L2");
  expect(archiveProps["aria-label"]).toBe("Archive comment for src/app.ts, L2");
  expect(archiveProps.title).toBe("Archive comment for src/app.ts, L2");

  resolveProps.onClick();
  archiveProps.onClick();

  expect(updates).toEqual([
    ["thread-1", "resolved"],
    ["thread-1", "archived"],
  ]);
});

it("offers reopen from resolved workspace comment threads", () => {
  const html = renderToStaticMarkup(
    <CommentsPanel
      open
      comments={[
        {
          ...codeLineComment,
          id: "resolved-comment",
          threadId: "thread-resolved",
          status: "resolved",
        },
      ]}
      query=""
      statusFilter="resolved"
      onQueryChange={() => undefined}
      onStatusFilterChange={() => undefined}
      onClose={() => undefined}
      onOpenComment={() => undefined}
      onStatusChange={() => undefined}
    />,
  );

  expect(html).toContain(">Reopen</button>");
  expect(html).toContain(">Archive</button>");
  expect(html).toContain('aria-label="Reopen comment for src/app.ts, L2"');
  expect(html).toContain('aria-label="Archive comment for src/app.ts, L2"');
  expect(html).not.toContain(">Resolve</button>");
});

it("returns to the exact active comment from the workspace comment current stop", () => {
  const opened: string[] = [];
  const updates: Array<[string, string]> = [];
  const panel = CommentsPanel({
    open: true,
    comments: [
      { ...codeLineComment, threadId: "thread-1" },
      {
        ...codeLineComment,
        id: "comment-latest",
        threadId: "thread-1",
        body: "Latest reply is newer than the current stop.",
        createdAt: "2026-01-01T00:01:00.000Z",
        updatedAt: "2026-01-01T00:02:00.000Z",
      },
    ],
    query: "",
    statusFilter: "resolved",
    activeCommentId: codeLineComment.id,
    onQueryChange: () => undefined,
    onStatusFilterChange: () => undefined,
    onClose: () => undefined,
    onOpenComment: (comment) => opened.push(comment.id),
    onStatusChange: (threadId, status) => updates.push([threadId, status]),
  });

  const returnButton = findElement(panel, (element) => {
    const props = element.props as {
      "aria-label"?: string;
      children?: ReactNode;
    };
    return (
      props["aria-label"] ===
        "Return to current thread, src/app.ts, Source L2, L2" &&
      flattenText(props.children) === "Return"
    );
  });

  (returnButton.props as { onClick: () => void }).onClick();

  expect(opened).toEqual([codeLineComment.id]);

  const resolveButton = findElement(panel, (element) => {
    const props = element.props as {
      children?: ReactNode;
      title?: string;
      type?: string;
    };
    return (
      props.type === "button" &&
      flattenText(props.children) === "Resolve current thread" &&
      props.title === "Resolve current thread (Cmd/Ctrl Shift Enter)"
    );
  });
  const archiveButton = findElement(panel, (element) => {
    const props = element.props as {
      children?: ReactNode;
      title?: string;
      type?: string;
    };
    return (
      props.type === "button" &&
      flattenText(props.children) === "Archive current thread" &&
      props.title === "Archive current thread (Cmd/Ctrl Shift Backspace)"
    );
  });

  (resolveButton.props as { onClick: () => void }).onClick();
  (archiveButton.props as { onClick: () => void }).onClick();

  expect(
    flattenText((panel.props as { children?: ReactNode }).children),
  ).toContain("Hidden by current filter");
  expect(updates).toEqual([
    ["thread-1", "resolved"],
    ["thread-1", "archived"],
  ]);
});

it("treats comments inbox filters as pressed state controls", () => {
  const selected: string[] = [];
  const panel = CommentsPanel({
    open: true,
    comments: [{ ...codeLineComment, threadId: "thread-1" }],
    query: "",
    statusFilter: "attention",
    unreadReviewPaths: new Set(["src/app.ts"]),
    onQueryChange: () => undefined,
    onStatusFilterChange: (status) => selected.push(status),
    onClose: () => undefined,
    onOpenComment: () => undefined,
  });

  const attentionFilter = findElement(panel, (element) => {
    const props = element.props as {
      "aria-label"?: string;
      "aria-pressed"?: boolean;
    };
    return props["aria-label"] === "Show 1 attention thread";
  });
  const openFilter = findElement(panel, (element) => {
    const props = element.props as {
      "aria-label"?: string;
    };
    return props["aria-label"] === "Show 1 open thread";
  });

  expect(
    (attentionFilter.props as { "aria-pressed": boolean })["aria-pressed"],
  ).toBe(true);
  expect(
    (openFilter.props as { "aria-pressed": boolean })["aria-pressed"],
  ).toBe(false);

  (openFilter.props as { onClick: () => void }).onClick();

  expect(selected).toEqual(["open"]);
});

it("shows surface-specific anchor context in workspace comment rows", () => {
  const renderedComment: ViviComment = {
    ...codeLineComment,
    id: "rendered-comment-1",
    threadId: "rendered-thread-1",
    path: "README.md",
    viewerKind: "markdown",
    anchor: {
      surface: "rendered",
      canonical: {
        path: "README.md",
        lineStart: 3,
        lineEnd: 4,
        quote: "Paragraph text",
      },
      rendered: {
        kind: "markdown",
        blockId: "vivi-block-2",
        sourceLineStart: 3,
        sourceLineEnd: 4,
      },
    },
    body: "Rendered paragraph needs a clearer transition.",
  };
  const diffComment: ViviComment = {
    ...codeLineComment,
    id: "diff-comment-1",
    threadId: "diff-thread-1",
    anchor: {
      surface: "diff",
      canonical: {
        path: "src/app.ts",
        lineStart: 20,
        lineEnd: 21,
        quote: "new line one\nnew line two",
      },
      diff: {
        path: "src/app.ts",
        base: "HEAD",
        ref: "working tree",
        hunkId: "@@ -10,1 +20,2 @@",
        side: "new",
        newLineStart: 20,
        newLineEnd: 21,
      },
    },
    body: "New branch needs an explicit empty-state guard.",
    updatedAt: "2026-01-01T00:02:00.000Z",
  };
  const html = renderToStaticMarkup(
    <CommentsPanel
      open
      comments={[renderedComment, diffComment]}
      query=""
      statusFilter="all"
      onQueryChange={() => undefined}
      onStatusFilterChange={() => undefined}
      onClose={() => undefined}
      onOpenComment={() => undefined}
    />,
  );
  const searchHtml = renderToStaticMarkup(
    <CommentsPanel
      open
      comments={[renderedComment, diffComment]}
      query="source L3"
      statusFilter="all"
      onQueryChange={() => undefined}
      onStatusFilterChange={() => undefined}
      onClose={() => undefined}
      onOpenComment={() => undefined}
    />,
  );

  expect(html).toContain("markdown rendered");
  expect(html).toContain(
    "Rendered Markdown · block vivi-block-2 · source L3-L4",
  );
  expect(html).toContain("Block vivi-block-2, source L3-L4");
  expect(html).toContain("diff");
  expect(html).toContain("Diff new L20-L21");
  expect(html).toContain("New diff L20-L21");
  expect(html).toContain(
    "Open thread in README.md, Rendered Markdown · block vivi-block-2 · source L3-L4, L3-L4, markdown rendered, Block vivi-block-2, source L3-L4",
  );
  expect(html).toContain(
    "Open thread in src/app.ts, Diff new L20-L21, L20-L21, diff, New diff L20-L21",
  );
  expect(searchHtml).toContain("Matched location");
  expect(searchHtml).toContain(
    '<mark class="global-comment-search-hit">source L3</mark>-L4',
  );
  expect(searchHtml).toContain("1 thread · 1 message");
  expect(searchHtml).not.toContain("New diff L20-L21");
});

it("shows the matched comment context while searching the review inbox", () => {
  const html = renderToStaticMarkup(
    <CommentsPanel
      open
      comments={[
        { ...codeLineComment, threadId: "thread-1", author: "Human" },
        { ...codeLineReply, threadId: "thread-1" },
      ]}
      query="check"
      statusFilter="all"
      onQueryChange={() => undefined}
      onStatusFilterChange={() => undefined}
      onClose={() => undefined}
      onOpenComment={() => undefined}
    />,
  );

  expect(html).toContain("Matched Human");
  expect(html).toContain("Check this return");
  expect(html).toContain(
    '<mark class="global-comment-search-hit">Check</mark>',
  );
  expect(html).toContain('matched Human, Check this return"');
  expect(html).toContain('data-comment-id="comment-2"');
});

it("shows path matches while searching the review inbox", () => {
  const html = renderToStaticMarkup(
    <CommentsPanel
      open
      comments={[{ ...codeLineComment, threadId: "thread-1" }]}
      query="src/app"
      statusFilter="all"
      onQueryChange={() => undefined}
      onStatusFilterChange={() => undefined}
      onClose={() => undefined}
      onOpenComment={() => undefined}
    />,
  );

  expect(html).toContain("Matched path");
  expect(html).toContain("src/app.ts");
  expect(html).toContain(
    '<mark class="global-comment-search-hit">src/app</mark>.ts',
  );
  expect(html).toContain('matched path, src/app.ts"');
});

it("scopes comments inbox filter counts to the current search", () => {
  const otherOpenComment: ViviComment = {
    ...codeLineComment,
    id: "comment-other-open",
    threadId: "thread-other-open",
    path: "docs/guide.md",
    anchor: {
      ...codeLineComment.anchor,
      canonical: {
        ...codeLineComment.anchor.canonical,
        path: "docs/guide.md",
      },
    },
    body: "Open feedback in another file.",
  };
  const otherResolvedComment: ViviComment = {
    ...otherOpenComment,
    id: "comment-other-resolved",
    threadId: "thread-other-resolved",
    status: "resolved",
    body: "Resolved feedback in another file.",
  };
  const html = renderToStaticMarkup(
    <CommentsPanel
      open
      comments={[
        { ...codeLineComment, threadId: "thread-1" },
        otherOpenComment,
        otherResolvedComment,
      ]}
      query="src/app"
      statusFilter="all"
      onQueryChange={() => undefined}
      onStatusFilterChange={() => undefined}
      onClose={() => undefined}
      onOpenComment={() => undefined}
    />,
  );

  expect(html).toContain("2 open · 1 resolved · 0 archived");
  expect(html).toContain("All 1");
  expect(html).toContain("Open 1");
  expect(html).toContain('aria-label="Show all 1 thread"');
  expect(html).toContain('aria-label="Show 1 open thread"');
  expect(html).toContain('aria-label="Show 0 resolved threads"');
  expect(html).toContain("1 thread · 1 message");
  expect(html).toContain("src/app.ts");
  expect(html).not.toContain("docs/guide.md");
});

it("keeps searched status empty states distinct from no search matches", () => {
  const resolvedComment: ViviComment = {
    ...codeLineComment,
    threadId: "thread-resolved",
    status: "resolved",
  };
  const html = renderToStaticMarkup(
    <CommentsPanel
      open
      comments={[resolvedComment]}
      query="src/app"
      statusFilter="open"
      onQueryChange={() => undefined}
      onStatusFilterChange={() => undefined}
      onClose={() => undefined}
      onOpenComment={() => undefined}
    />,
  );

  expect(html).toContain("No matching open threads");
  expect(html).toContain("Try another status filter or broaden your search.");
  expect(html).not.toContain("No threads match this search");
  expect(html).toContain("All 1");
  expect(html).toContain("Resolved 1");
});

it("keeps late comment search matches visible in the review inbox snippet", () => {
  const lateMatchComment = {
    ...codeLineComment,
    threadId: "thread-1",
    author: "Human",
    body: `${"intro ".repeat(40)}keep this exact needle visible with context after it`,
  };
  const html = renderToStaticMarkup(
    <CommentsPanel
      open
      comments={[lateMatchComment, { ...codeLineReply, threadId: "thread-1" }]}
      query="needle"
      statusFilter="all"
      onQueryChange={() => undefined}
      onStatusFilterChange={() => undefined}
      onClose={() => undefined}
      onOpenComment={() => undefined}
    />,
  );

  expect(html).toContain("Matched Human");
  expect(html).toContain(
    '<mark class="global-comment-search-hit">needle</mark>',
  );
  expect(html).toContain("context after it");
});

it("surfaces attention-needed comment threads first in the review inbox", () => {
  const olderAttentionThread = {
    ...codeLineComment,
    id: "attention-1",
    threadId: "thread-attention",
    path: "docs/needs-human.md",
    anchor: {
      ...codeLineComment.anchor,
      canonical: {
        ...codeLineComment.anchor.canonical,
        path: "docs/needs-human.md",
      },
    },
    body: "Agent reply needs a human decision.",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  const newerOpenThread = {
    ...codeLineComment,
    id: "newer-1",
    threadId: "thread-newer",
    path: "src/app.ts",
    body: "Newer open thread without unseen activity.",
    updatedAt: "2026-01-01T00:05:00.000Z",
  };
  const html = renderToStaticMarkup(
    <CommentsPanel
      open
      comments={[newerOpenThread, olderAttentionThread]}
      query=""
      statusFilter="open"
      unreadReviewPaths={new Set(["docs/needs-human.md"])}
      onQueryChange={() => undefined}
      onStatusFilterChange={() => undefined}
      onClose={() => undefined}
      onOpenComment={() => undefined}
    />,
  );

  expect(html).toContain("1 attention thread");
  expect(html).toContain("Attention 1");
  expect(html).toContain("All 2");
  expect(html).toContain("Open 2");
  expect(html).toContain("Needs attention");
  expect(html).toContain("Next review stop");
  expect(html).toContain("Unseen review activity");
  expect(html.indexOf("docs/needs-human.md")).toBeLessThan(
    html.indexOf("src/app.ts"),
  );
  expect(html).toContain("global-comment-row open needs-attention");
  expect(html).toContain(
    "Open thread in docs/needs-human.md, Source L2, L2, source, 1 message, latest by Unknown, next review stop, unseen review activity, needs attention",
  );

  const attentionHtml = renderToStaticMarkup(
    <CommentsPanel
      open
      comments={[newerOpenThread, olderAttentionThread]}
      query=""
      statusFilter="attention"
      unreadReviewPaths={new Set(["docs/needs-human.md"])}
      onQueryChange={() => undefined}
      onStatusFilterChange={() => undefined}
      onClose={() => undefined}
      onOpenComment={() => undefined}
    />,
  );

  expect(attentionHtml).toContain("1 thread · 1 message · 1 attention thread");
  expect(attentionHtml).toContain("docs/needs-human.md");
  expect(attentionHtml).not.toContain("src/app.ts");
});

it("uses the latest authoritative status for comments inbox threads", () => {
  const comments = [
    { ...codeLineComment, threadId: "thread-1", status: "open" as const },
    {
      ...codeLineComment,
      id: "comment-2",
      threadId: "thread-1",
      body: "Resolved after the follow-up.",
      status: "resolved" as const,
      createdAt: "2026-01-01T00:01:00.000Z",
      updatedAt: "2026-01-01T00:02:00.000Z",
    },
  ];
  const openHtml = renderToStaticMarkup(
    <CommentsPanel
      open
      comments={comments}
      query=""
      statusFilter="open"
      onQueryChange={() => undefined}
      onStatusFilterChange={() => undefined}
      onClose={() => undefined}
      onOpenComment={() => undefined}
    />,
  );
  const resolvedHtml = renderToStaticMarkup(
    <CommentsPanel
      open
      comments={comments}
      query=""
      statusFilter="resolved"
      onQueryChange={() => undefined}
      onStatusFilterChange={() => undefined}
      onClose={() => undefined}
      onOpenComment={() => undefined}
    />,
  );

  expect(openHtml).toContain("No open threads");
  expect(openHtml).toContain(
    "Resolved and archived threads remain available in the history filters.",
  );
  expect(openHtml).toContain("All 1");
  expect(openHtml).toContain("Resolved 1");
  expect(resolvedHtml).toContain("1 thread · 2 messages");
  expect(resolvedHtml).toContain("Resolved");
  expect(resolvedHtml).toContain("Resolved feedback");
  expect(resolvedHtml).toContain("Resolved after the follow-up.");
});

it("uses comments inbox empty states as review guidance", () => {
  const attentionHtml = renderToStaticMarkup(
    <CommentsPanel
      open
      comments={[codeLineComment]}
      query=""
      statusFilter="attention"
      unreadReviewPaths={new Set()}
      onQueryChange={() => undefined}
      onStatusFilterChange={() => undefined}
      onClose={() => undefined}
      onOpenComment={() => undefined}
    />,
  );
  const searchHtml = renderToStaticMarkup(
    <CommentsPanel
      open
      comments={[codeLineComment]}
      query="missing phrase"
      statusFilter="all"
      onQueryChange={() => undefined}
      onStatusFilterChange={() => undefined}
      onClose={() => undefined}
      onOpenComment={() => undefined}
    />,
  );

  expect(attentionHtml).toContain("No threads need attention");
  expect(attentionHtml).toContain(
    "Open threads with unseen activity will appear here.",
  );
  expect(searchHtml).toContain("No threads match this search");
  expect(searchHtml).toContain(
    "Try a path, quoted text, or a phrase from the comment body.",
  );
});

it("renders comment activity in Review Queue and inspector comment summaries", () => {
  const activity = summarizeThreadActivity(
    [
      {
        id: "activity-1",
        threadId: "thread-1",
        type: "thread_status_changed",
        actor: {
          id: "human:tasuku",
          kind: "human",
          displayName: "Tasuku",
        },
        previousStatus: "open",
        status: "resolved",
        createdAt: "2026-06-20T00:00:30.000Z",
      },
    ],
    new Date("2026-06-20T00:01:00.000Z").getTime(),
  );
  const handoffComment: ViviComment = {
    ...codeLineComment,
    id: "handoff-comment-1",
    threadId: "thread-handoff",
    path: "docs/agent-handoff.md",
    anchor: {
      surface: "diff",
      canonical: {
        path: "docs/agent-handoff.md",
        lineStart: 7,
        lineEnd: 7,
        quote: "needs a human decision",
      },
      diff: {
        path: "docs/agent-handoff.md",
        base: "HEAD",
        ref: "working-tree",
        hunkId: "handoff-hunk",
        side: "new",
        newLineStart: 7,
        newLineEnd: 7,
      },
    },
    body: "Agent reply needs a human decision before this file is clear.",
    updatedAt: "2026-06-20T00:02:00.000Z",
  };
  const html = renderToStaticMarkup(
    <Inspector
      file={codeFile}
      reviewChanges={[
        { path: "src/app.ts", status: "modified", source: "git" },
      ]}
      reviewItems={[
        {
          path: "src/app.ts",
          change: { path: "src/app.ts", status: "modified", source: "git" },
          threadCounts: { open: 0, resolved: 1, archived: 0 },
          commentCount: 1,
          latestActivity: activity.timeline[0],
          unread: false,
        },
        {
          path: "docs/agent-handoff.md",
          change: null,
          threadCounts: { open: 2, resolved: 0, archived: 0 },
          commentCount: 3,
          unread: true,
        },
      ]}
      reviewDiffStats={{}}
      loadingReviewDiffs={{}}
      unreadReviewPaths={new Set()}
      comments={[{ ...codeLineComment, threadId: "thread-1" }]}
      reviewComments={[
        { ...codeLineComment, threadId: "thread-1" },
        handoffComment,
      ]}
      threadActivities={{ "thread-1": activity }}
      selectedCodeRange={null}
      activePath="docs/agent-handoff.md"
      activePaneId="main"
      onOpenEventPath={() => undefined}
      onConfirmEventPath={() => undefined}
      onOpenNextChanged={() => undefined}
      onOpenPreviousChanged={() => undefined}
      onOpenAllChanged={() => undefined}
      onRevealInTree={() => undefined}
    />,
  );

  expect(html).toContain("Tasuku marked resolved");
  expect(html).toContain("agent-handoff.md");
  expect(html).toContain("pinned from 2/2");
  expect(html).not.toContain("viewing 2/2");
  expect(html).toContain("has-open-threads active");
  const queueHtml = html.slice(html.indexOf('class="review-queue"'));
  expect(
    queueHtml.indexOf('data-review-path="docs/agent-handoff.md"'),
  ).toBeLessThan(queueHtml.indexOf('data-review-path="src/app.ts"'));
  expect(html).toContain("2 open threads");
  expect(html).toContain("3 total messages");
  expect(html).toContain('class="review-stop-summary"');
  expect(html).toContain("Current stop");
  expect(html).toContain("Next stop");
  expect(html).toContain("diff · L7");
  expect(html).toContain(
    "Agent reply needs a human decision before this file is clear.",
  );
  expect(html).toContain(
    'aria-label="Review queue item, comment docs/agent-handoff.md, current review file"',
  );
  expect(html).toContain(
    'aria-describedby="review-queue-interaction-help review-queue-keyboard-help review-queue-item-1-description"',
  );
  expect(html).toContain(
    "unseen review work, 2 open threads, 3 total messages, Current stop diff · L7: Agent reply needs a human decision before this file is clear.",
  );
  expect(html).toContain(
    "<strong>1/2</strong> files seen · 1 unseen · 2 open threads",
  );
  expect(html).toContain("Review Queue");
  expect(html).toContain("1 open thread");
});

it("marks active file comment threads when the file changed since the anchor", () => {
  const staleComment: ViviComment = {
    ...codeLineComment,
    anchor: {
      ...codeLineComment.anchor,
      canonical: {
        ...codeLineComment.anchor.canonical,
        fileHash: "sha256:older",
      },
    },
  };
  const html = renderToStaticMarkup(
    <Inspector
      file={codeFile}
      reviewChanges={[]}
      reviewItems={[]}
      reviewDiffStats={{}}
      loadingReviewDiffs={{}}
      unreadReviewPaths={new Set()}
      comments={[staleComment]}
      selectedCodeRange={null}
      activePath="src/app.ts"
      activePaneId="main"
      onOpenEventPath={() => undefined}
      onConfirmEventPath={() => undefined}
      onOpenNextChanged={() => undefined}
      onOpenPreviousChanged={() => undefined}
      onOpenAllChanged={() => undefined}
      onRevealInTree={() => undefined}
    />,
  );

  expect(html).toContain("Source changed");
  expect(html).toContain(
    'aria-label="Current file content differs from this comment anchor"',
  );
});

it("marks active comment threads when the source path is missing", () => {
  const missingComment: ViviComment = {
    ...codeLineComment,
    path: "README.md",
    anchor: {
      ...codeLineComment.anchor,
      canonical: {
        ...codeLineComment.anchor.canonical,
        path: "README.md",
      },
    },
  };
  const html = renderToStaticMarkup(
    <Inspector
      file={null}
      reviewChanges={[]}
      reviewItems={[]}
      reviewDiffStats={{}}
      loadingReviewDiffs={{}}
      unreadReviewPaths={new Set()}
      comments={[missingComment]}
      knownMissingCommentPaths={new Set(["README.md"])}
      selectedCodeRange={null}
      activePath={null}
      activePaneId="main"
      onOpenEventPath={() => undefined}
      onConfirmEventPath={() => undefined}
      onOpenNextChanged={() => undefined}
      onOpenPreviousChanged={() => undefined}
      onOpenAllChanged={() => undefined}
      onRevealInTree={() => undefined}
    />,
  );

  expect(html).toContain("Source missing");
  expect(html).toContain(
    'aria-label="This comment points to a path that is not present in the current workspace tree"',
  );
});

it("keeps resolved-only Review Queue files out of next-stop guidance", () => {
  const resolvedComment: ViviComment = {
    ...codeLineComment,
    id: "resolved-comment-1",
    threadId: "thread-resolved",
    status: "resolved",
    body: "Resolved after the DSCP paths were checked.",
    updatedAt: "2026-01-01T00:02:00.000Z",
    resolvedAt: "2026-01-01T00:02:00.000Z",
  };
  const html = renderToStaticMarkup(
    <Inspector
      file={codeFile}
      reviewChanges={[
        { path: "src/app.ts", status: "modified", source: "git" },
      ]}
      reviewItems={[
        {
          path: "src/app.ts",
          change: { path: "src/app.ts", status: "modified", source: "git" },
          threadCounts: { open: 0, resolved: 1, archived: 0 },
          commentCount: 1,
          unread: false,
        },
      ]}
      reviewDiffStats={{}}
      loadingReviewDiffs={{}}
      unreadReviewPaths={new Set()}
      comments={[resolvedComment]}
      reviewComments={[resolvedComment]}
      threadActivities={{}}
      selectedCodeRange={null}
      activePath="src/app.ts"
      activePaneId="main"
      onOpenEventPath={() => undefined}
      onConfirmEventPath={() => undefined}
      onOpenNextChanged={() => undefined}
      onOpenPreviousChanged={() => undefined}
      onOpenAllChanged={() => undefined}
      onRevealInTree={() => undefined}
    />,
  );

  expect(html).toContain("No open threads · 1 total message");
  expect(html).toContain("Resolved after the DSCP paths were checked.");
  expect(html).not.toContain('class="review-stop-summary"');
  expect(html).not.toContain("Current stop");
  expect(html).not.toContain("Next stop");
  expect(html).toContain("seen, 1 total message, from HEAD diff");
});

it("opens Review Queue rows as preview on click and stable tabs on double click", () => {
  const calls: string[] = [];
  const inspector = Inspector({
    file: codeFile,
    reviewChanges: [{ path: "src/app.ts", status: "modified", source: "git" }],
    reviewDiffStats: {},
    loadingReviewDiffs: {},
    unreadReviewPaths: new Set(),
    selectedCodeRange: null,
    activePaneId: "main",
    onOpenEventPath: (path) => calls.push(`preview:${path}`),
    onConfirmEventPath: (path) => calls.push(`normal:${path}`),
    onOpenNextChanged: () => undefined,
    onOpenPreviousChanged: () => undefined,
    onOpenAllChanged: () => undefined,
    onRevealInTree: () => undefined,
  });

  const button = findElement(inspector, (element) => {
    const props = element.props as { className?: string; children?: ReactNode };
    return (
      props.className?.split(" ").includes("change-open") &&
      flattenText(props.children).includes("app.ts")
    );
  });
  const props = button.props as {
    onClick: () => void;
    onDoubleClick: () => void;
    title: string;
    "aria-describedby": string;
    "aria-keyshortcuts": string;
    "aria-label": string;
    "data-review-path": string;
    "data-testid": string;
  };

  props.onClick();
  props.onDoubleClick();

  expect(props.title).toBe(
    "Click to preview; double-click to keep open as a tab",
  );
  expect(props["aria-describedby"]).toBe(
    "review-queue-interaction-help review-queue-keyboard-help review-queue-item-1-description",
  );
  expect(props["aria-keyshortcuts"]).toBe("ArrowDown ArrowUp Home End");
  expect(props["aria-label"]).toBe(
    "Review queue item, modified src/app.ts, current review file",
  );
  expect(props["data-review-path"]).toBe("src/app.ts");
  expect(props["data-testid"]).toBe("review-queue-item");
  expect(calls).toEqual(["preview:src/app.ts", "normal:src/app.ts"]);
});

it("omits explicit inspector reveal when Review Queue already navigates files", () => {
  const html = renderToStaticMarkup(
    <Inspector
      file={codeFile}
      reviewChanges={[]}
      reviewDiffStats={{}}
      loadingReviewDiffs={{}}
      unreadReviewPaths={new Set()}
      selectedCodeRange={null}
      activePaneId="main"
      onOpenEventPath={() => undefined}
      onConfirmEventPath={() => undefined}
      onOpenNextChanged={() => undefined}
      onOpenPreviousChanged={() => undefined}
      onOpenAllChanged={() => undefined}
      onRevealInTree={() => undefined}
    />,
  );

  expect(html).not.toContain("Show in Explorer");
});

it("keeps Markdown and HTML outline available from the file viewer", () => {
  const html = renderToStaticMarkup(
    <FileOutlineControl
      file={{ ...codeFile, path: "README.md", viewerKind: "markdown" }}
      defaultOpen
      outline={[
        { id: "title", level: 1, text: "Title", lineStart: 1 },
        { id: "setup", level: 2, text: "Setup", lineStart: 3 },
      ]}
      selectedCodeRange={null}
      onOutlineSelect={() => undefined}
    />,
  );

  expect(html).toContain("In this file");
  expect(html).toContain('aria-haspopup="dialog"');
  expect(html).toContain(
    'aria-label="Open in-file navigation for README.md, 2 headings"',
  );
  expect(html).toContain("<small>2</small>");
  expect(html).toContain("outline-level");
  expect(html).toContain(">H1</span>");
  expect(html).toContain(">H2</span>");
  expect(html).toContain(">L1</span>");
  expect(html).toContain(">L3</span>");
});

it("summarizes code symbols and selected range in the local outline trigger", () => {
  const html = renderToStaticMarkup(
    <FileOutlineControl
      file={codeFile}
      outline={[]}
      selectedCodeRange={{ start: 1, end: 2 }}
      onOutlineSelect={() => undefined}
    />,
  );

  expect(html).toContain(
    'aria-label="Open in-file navigation for src/app.ts, 1 symbol, selection src/app.ts:1-2"',
  );
  expect(html).toContain("<small>1</small>");
});

it("renders document outline in the right inspector", () => {
  const html = renderToStaticMarkup(
    <Inspector
      file={markdownFile}
      reviewChanges={[]}
      reviewDiffStats={{}}
      loadingReviewDiffs={{}}
      unreadReviewPaths={new Set()}
      comments={[]}
      selectedCodeRange={null}
      outline={[
        { id: "title", level: 1, text: "Title", lineStart: 1 },
        { id: "setup", level: 2, text: "Setup", lineStart: 3 },
      ]}
      activeOutlineId="setup"
      activePaneId="main"
      onOpenEventPath={() => undefined}
      onConfirmEventPath={() => undefined}
      onOpenNextChanged={() => undefined}
      onOpenPreviousChanged={() => undefined}
      onOpenAllChanged={() => undefined}
      onRevealInTree={() => undefined}
      onOutlineSelect={() => undefined}
    />,
  );

  expect(html).toContain("In this file");
  expect(html).toContain("2 headings · Setup");
  expect(html).toContain('aria-label="Document outline"');
  expect(html).toContain('aria-current="location"');
  expect(html).toContain('class="h2 active"');
  expect(html).toContain("outline-level");
  expect(html).toContain(">H1</span>");
  expect(html).toContain(">H2</span>");
  expect(html).toContain(">L1</span>");
  expect(html).toContain(">L3</span>");
  expect(html).toContain("Current section");
  expect(html).toContain("Title");
  expect(html).toContain("Setup");
});

it("renders lightweight code symbols in the right inspector", () => {
  const html = renderToStaticMarkup(
    <Inspector
      file={codeFile}
      reviewChanges={[]}
      reviewDiffStats={{}}
      loadingReviewDiffs={{}}
      unreadReviewPaths={new Set()}
      comments={[]}
      selectedCodeRange={null}
      activePaneId="main"
      onOpenEventPath={() => undefined}
      onConfirmEventPath={() => undefined}
      onOpenNextChanged={() => undefined}
      onOpenPreviousChanged={() => undefined}
      onOpenAllChanged={() => undefined}
      onRevealInTree={() => undefined}
    />,
  );

  expect(html).toContain("In this file");
  expect(html).toContain("1 symbol");
  expect(html).toContain('aria-label="Code symbols"');
  expect(html).toContain("export");
  expect(html).toContain("start");
  expect(html).toContain("L1");
});

it("shows why the Review Queue is unavailable instead of looking empty", () => {
  const html = renderToStaticMarkup(
    <Inspector
      file={null}
      reviewChanges={[]}
      reviewUnavailableReason="Git command timed out while reading this workspace."
      reviewDiffStats={{}}
      loadingReviewDiffs={{}}
      unreadReviewPaths={new Set()}
      selectedCodeRange={null}
      activePaneId="main"
      onOpenEventPath={() => undefined}
      onConfirmEventPath={() => undefined}
      onOpenNextChanged={() => undefined}
      onOpenPreviousChanged={() => undefined}
      onOpenAllChanged={() => undefined}
      onRevealInTree={() => undefined}
    />,
  );

  expect(html).toContain("Git review unavailable");
  expect(html).toContain("Git command timed out while reading this workspace.");
  expect(html).not.toContain("No files to review.");
});

it("explains an empty Review Queue as active review work being clear", () => {
  const html = renderToStaticMarkup(
    <Inspector
      file={null}
      reviewChanges={[]}
      reviewDiffStats={{}}
      loadingReviewDiffs={{}}
      unreadReviewPaths={new Set()}
      selectedCodeRange={null}
      activePaneId="main"
      onOpenEventPath={() => undefined}
      onConfirmEventPath={() => undefined}
      onOpenNextChanged={() => undefined}
      onOpenPreviousChanged={() => undefined}
      onOpenAllChanged={() => undefined}
      onRevealInTree={() => undefined}
    />,
  );

  expect(html).toContain('aria-label="Review queue empty"');
  expect(html).toContain("Active queue clear");
  expect(html).toContain(
    "No Git changes or open comment threads need review right now.",
  );
  expect(html).toContain(
    "Resolved and archived threads stay in Comments history.",
  );
  expect(html).not.toContain("No files to review.");
});

it("keeps the Review Queue in a loading state while Git review is loading", () => {
  const html = renderToStaticMarkup(
    <Inspector
      file={null}
      reviewChanges={[]}
      reviewLoading
      reviewDiffStats={{}}
      loadingReviewDiffs={{}}
      unreadReviewPaths={new Set()}
      selectedCodeRange={null}
      activePaneId="main"
      onOpenEventPath={() => undefined}
      onConfirmEventPath={() => undefined}
      onOpenNextChanged={() => undefined}
      onOpenPreviousChanged={() => undefined}
      onOpenAllChanged={() => undefined}
      onRevealInTree={() => undefined}
    />,
  );

  expect(html).toContain("Loading Git review");
  expect(html).toContain(
    "open comment threads may appear before changed files",
  );
  expect(html).not.toContain("Active queue clear");
});

it("does not mark comment-only Review Queue results complete while Git review is loading", () => {
  const html = renderToStaticMarkup(
    <Inspector
      file={null}
      reviewChanges={[]}
      reviewItems={[
        {
          path: "net/netfilter/xt_RATEEST.c",
          change: null,
          threadCounts: { open: 1, resolved: 0, archived: 0 },
          commentCount: 3,
          unread: false,
        },
      ]}
      reviewLoading
      reviewDiffStats={{}}
      loadingReviewDiffs={{}}
      unreadReviewPaths={new Set()}
      selectedCodeRange={null}
      activePath="net/netfilter/xt_RATEEST.c"
      activePaneId="main"
      onOpenEventPath={() => undefined}
      onConfirmEventPath={() => undefined}
      onOpenNextChanged={() => undefined}
      onOpenPreviousChanged={() => undefined}
      onOpenAllChanged={() => undefined}
      onRevealInTree={() => undefined}
    />,
  );

  expect(html).toContain("<strong>1/1</strong> files seen");
  expect(html).toContain("loading changed files");
  expect(html).toContain(
    'aria-valuetext="1 of 1 loaded review files seen, loading changed files"',
  );
  expect(html).toContain(
    'aria-label="Review queue, 1 of 1 loaded review files seen, loading changed files"',
  );
  expect(html).not.toContain("all seen");
  expect(html).not.toContain("all review files seen");
});

it("shows partial Review Queue results as a warning", () => {
  const html = renderToStaticMarkup(
    <Inspector
      file={null}
      reviewChanges={[{ path: "README.md", status: "modified", source: "git" }]}
      reviewUnavailableReason="Git untracked scan timed out; showing tracked changes only."
      reviewDiffStats={{}}
      loadingReviewDiffs={{}}
      unreadReviewPaths={new Set()}
      selectedCodeRange={null}
      activePaneId="main"
      onOpenEventPath={() => undefined}
      onConfirmEventPath={() => undefined}
      onOpenNextChanged={() => undefined}
      onOpenPreviousChanged={() => undefined}
      onOpenAllChanged={() => undefined}
      onRevealInTree={() => undefined}
    />,
  );

  expect(html).toContain("Git review warning");
  expect(html).toContain(
    "Git untracked scan timed out; showing tracked changes only.",
  );
  expect(html).toContain("README.md");
  expect(html).not.toContain("Git review unavailable");
});

function findElement(
  node: ReactNode,
  predicate: (element: ReactElement) => boolean,
): ReactElement {
  const match = findElementOrNull(node, predicate);
  if (!match) throw new Error("element not found");
  return match;
}

function findElementOrNull(
  node: ReactNode,
  predicate: (element: ReactElement) => boolean,
): ReactElement | null {
  if (isValidElement(node)) {
    if (predicate(node)) return node;
    const props = node.props as { children?: ReactNode };
    for (const child of Children.toArray(props.children)) {
      const match = findElementOrNull(child, predicate);
      if (match) return match;
    }
  }
  return null;
}

function flattenText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (!isValidElement(node)) {
    return Children.toArray(node).map(flattenText).join("");
  }
  const props = node.props as { children?: ReactNode };
  return Children.toArray(props.children).map(flattenText).join("");
}

it("renders HEAD diffs inside the file viewer surface", () => {
  const html = renderToStaticMarkup(
    <DiffViewer
      path="README.md"
      renderKind="markdown"
      diff={{
        path: "README.md",
        status: "available",
        baseLabel: "HEAD",
        compareLabel: "working tree",
        content: "@@ -1,2 +1,2 @@\n-# Old title\n+# New title\n body",
      }}
    />,
  );

  expect(html).toContain('aria-label="Diff from HEAD for README.md"');
  expect(html).toContain("Diff from HEAD");
  expect(html).toContain('<h1 id="old-title">Old title</h1>');
  expect(html).toContain('<h1 id="new-title">New title</h1>');
  expect(html).toContain("rendered-markdown-diff");
  expect(html).toContain("rendered-markdown-diff-block remove");
  expect(html).toContain("rendered-markdown-diff-block add");
  expect(html).not.toContain("Focus changes");
  expect(html).not.toContain("diff-line-no");
  expect(html).not.toContain("rendered-diff-pane");
  expect(html).not.toContain("@@ -1,2 +1,2 @@");
});

it("renders Markdown diffs as intact rendered blocks", () => {
  const html = renderToStaticMarkup(
    <DiffViewer
      path="README.md"
      renderKind="markdown"
      diff={{
        path: "README.md",
        status: "available",
        baseLabel: "HEAD",
        compareLabel: "working tree",
        content: [
          "@@ -1,3 +1,3 @@",
          "-```ts",
          "-console.log('old')",
          "-```",
          "+```ts",
          "+console.log('new')",
          "+```",
        ].join("\n"),
      }}
    />,
  );

  expect(html).toContain("rendered-markdown-diff-block remove");
  expect(html).toContain("rendered-markdown-diff-block add");
  expect(html).toContain("<pre><code");
  expect(html).toContain("console.log('old')");
  expect(html).toContain("console.log('new')");
});

it("keeps additions inside surrounding Markdown code fences", () => {
  const html = renderToStaticMarkup(
    <DiffViewer
      path="README.md"
      renderKind="markdown"
      diff={{
        path: "README.md",
        status: "available",
        baseLabel: "HEAD",
        compareLabel: "working tree",
        content: [
          "@@ -1,4 +1,5 @@",
          " ```text",
          " src/cli -> process args",
          "+fuga",
          " src/ui -> React SPA",
          " ```",
        ].join("\n"),
      }}
    />,
  );

  expect(html).toContain("<pre><code");
  expect(html).toContain("src/cli -&gt; process args");
  expect(html).toContain("rendered-markdown-code-line add");
  expect(html).toContain(">fuga</span>");
  expect(html).toContain("src/ui -&gt; React SPA");
  expect(html).toContain("</span>\n<span");
  expect(html).not.toContain("<p>fuga</p>");
});

it("keeps inline Markdown code inline in rendered diffs", () => {
  const html = renderToStaticMarkup(
    <DiffViewer
      path="README.md"
      renderKind="markdown"
      diff={{
        path: "README.md",
        status: "available",
        baseLabel: "HEAD",
        compareLabel: "working tree",
        content:
          "@@ -1,1 +1,1 @@\n-This uses `old-code` inline.\n+This uses `new-code` inline.",
      }}
    />,
  );

  expect(html).toContain("<p>This uses <code>old-code</code> inline.</p>");
  expect(html).toContain("<p>This uses <code>new-code</code> inline.</p>");
  expect(html).not.toContain("diff-line-no");
});

it("renders HTML diffs as rendered snippets without line numbers", () => {
  const html = renderToStaticMarkup(
    <DiffViewer
      path="index.html"
      renderKind="html"
      diff={{
        path: "index.html",
        status: "available",
        baseLabel: "HEAD",
        compareLabel: "working tree",
        content:
          "@@ -1,2 +1,2 @@\n-<h1>Old</h1>\n-<p>Before</p>\n+<h1>New</h1>\n+<p>After</p>",
      }}
    />,
  );

  expect(html).toContain("rendered-html-diff-block remove");
  expect(html).toContain("rendered-html-diff-block add");
  expect(html).toContain("HTML diff preview");
  expect(html).not.toContain("diff-line-no");
  expect(html).not.toContain("diff-inline-row");
});

it("groups consecutive rendered HTML diff rows", () => {
  expect(
    buildRenderedHtmlRows([
      { kind: "remove", lineLabel: "1", source: "<h1>Old</h1>" },
      { kind: "remove", lineLabel: "2", source: "<p>Before</p>" },
      { kind: "add", lineLabel: "1", source: "<h1>New</h1>" },
    ]),
  ).toEqual([
    { kind: "remove", lineLabel: "1", source: "<h1>Old</h1>\n<p>Before</p>" },
    { kind: "add", lineLabel: "1", source: "<h1>New</h1>" },
  ]);
});

it("groups rendered Markdown diff rows by block", () => {
  expect(
    buildRenderedDiffRows([
      { kind: "remove", text: "```ts", oldLine: 1 },
      { kind: "remove", text: "const before = true;", oldLine: 2 },
      { kind: "remove", text: "```", oldLine: 3 },
      { kind: "add", text: "```ts", newLine: 1 },
      { kind: "add", text: "const after = true;", newLine: 2 },
      { kind: "add", text: "```", newLine: 3 },
    ]),
  ).toMatchObject([
    {
      kind: "remove",
      lineLabel: "1-3",
      source: "```ts\nconst before = true;\n```",
    },
    {
      kind: "add",
      lineLabel: "1-3",
      source: "```ts\nconst after = true;\n```",
    },
  ]);
});

it("focuses source diffs around changed lines", () => {
  expect(
    buildFocusedSourceDiffRows(
      [
        { kind: "context", text: "far before", oldLine: 1, newLine: 1 },
        { kind: "context", text: "near before", oldLine: 2, newLine: 2 },
        { kind: "remove", text: "old", oldLine: 3 },
        { kind: "add", text: "new", newLine: 3 },
        { kind: "context", text: "near after", oldLine: 4, newLine: 4 },
        { kind: "context", text: "far after", oldLine: 5, newLine: 5 },
      ],
      1,
    ),
  ).toMatchObject([
    { kind: "gap", text: "1 unchanged line hidden" },
    { kind: "context", text: "near before" },
    { kind: "remove", text: "old" },
    { kind: "add", text: "new" },
    { kind: "context", text: "near after" },
    { kind: "gap", text: "1 unchanged line hidden" },
  ]);
});

it("focuses rendered diffs by surrounding block", () => {
  expect(
    buildFocusedRenderedDiffRows(
      [
        { kind: "context", lineLabel: "1", source: "# Far before" },
        { kind: "context", lineLabel: "2", source: "Near before" },
        { kind: "add", lineLabel: "3", source: "Changed" },
        { kind: "context", lineLabel: "4", source: "Near after" },
        { kind: "context", lineLabel: "5", source: "Far after" },
      ],
      1,
    ),
  ).toMatchObject([
    { kind: "gap", source: "1 unchanged block hidden" },
    { kind: "context", source: "Near before" },
    { kind: "add", source: "Changed" },
    { kind: "context", source: "Near after" },
    { kind: "gap", source: "1 unchanged block hidden" },
  ]);
});

it("renders source diffs as inline line rows", () => {
  const html = renderToStaticMarkup(
    <DiffViewer
      path="src/app.ts"
      renderKind="source"
      diff={{
        path: "src/app.ts",
        status: "available",
        baseLabel: "HEAD",
        compareLabel: "working tree",
        content:
          "diff --git a/src/app.ts b/src/app.ts\nindex 0000000..0000000\n--- a/src/app.ts\n+++ b/src/app.ts\n@@ -62,2 +62,2 @@\n-old line\n+new line",
      }}
    />,
  );

  expect(html).toContain("diff-inline-row remove");
  expect(html).toContain("diff-inline-row add");
  expect(html).toContain(">62</span><code>old line</code>");
  expect(html).toContain(">62</span><code>new line</code>");
  expect(html).not.toContain("diff --git");
  expect(html).not.toContain("index 0000000");
  expect(html).not.toContain("--- a/src/app.ts");
  expect(html).not.toContain("@@ -62,2 +62,2 @@");
});

it("renders diff comments as source-style inline threads after the selected new-line range", () => {
  const diffComment: ViviComment = {
    ...codeLineComment,
    id: "diff-comment-1",
    threadId: "diff-thread-1",
    anchor: {
      surface: "diff",
      canonical: {
        path: "src/app.ts",
        lineStart: 20,
        lineEnd: 21,
        quote: "new line one\nnew line two",
        fileHash: "sha256:test",
      },
      diff: {
        path: "src/app.ts",
        base: "HEAD",
        ref: "working tree",
        hunkId: "@@ -10,1 +20,2 @@",
        side: "new",
        newLineStart: 20,
        newLineEnd: 21,
        diffHash: "sha256:diff",
        fileHash: "sha256:test",
        changeKind: "added",
      },
    },
    body: "Review the new two-line block",
  };

  const html = renderToStaticMarkup(
    <DiffViewer
      path="src/app.ts"
      renderKind="source"
      file={codeFile}
      activeCommentId="diff-comment-1"
      comments={[diffComment]}
      diff={{
        path: "src/app.ts",
        status: "available",
        baseLabel: "HEAD",
        compareLabel: "working tree",
        baseRef: "HEAD",
        diffHash: "sha256:diff",
        content:
          "diff --git a/src/app.ts b/src/app.ts\n--- a/src/app.ts\n+++ b/src/app.ts\n@@ -10,1 +20,2 @@\n-old removed line\n+new line one\n+new line two",
      }}
    />,
  );

  expect(html).toContain("diff-inline-row add has-comment");
  expect(html).toContain("code-comment-thread-row");
  expect(html).toContain("Lines 20-21");
  expect(html).toContain("Review the new two-line block");
  expect(html).toContain("Resolve current thread");
  expect(html).not.toContain("Add comment on line 10");
  expect(html.indexOf("new line two")).toBeLessThan(
    html.indexOf("code-comment-thread-row"),
  );
});

it("groups unified diff lines into rendered change blocks", () => {
  expect(
    buildRenderedDiffBlocks([
      { kind: "hunk", text: "@@ -1 +1 @@" },
      { kind: "remove", text: "# Old", oldLine: 1 },
      { kind: "add", text: "# New", newLine: 1 },
    ]),
  ).toEqual([{ hunk: "@@ -1 +1 @@", removed: "# Old\n", added: "# New\n" }]);
});

it("renders CSV files as a bounded review table", () => {
  expect(parseDelimitedText('name,value\n"hello, world",2\n').rows).toEqual([
    ["hello, world", "2"],
  ]);

  const html = renderToStaticMarkup(
    <CsvViewer
      file={{
        ...codeFile,
        path: "reports/results.csv",
        viewerKind: "text",
        content: "name,value\nok,true\n",
      }}
    />,
  );

  expect(html).toContain("reports/results.csv");
  expect(html).toContain("<th>name</th>");
  expect(html).toContain("<td>true</td>");
});

it("renders a bounded tree with a large-workspace hint", () => {
  const largeChildren = Array.from({ length: 1000 }, (_, index) => ({
    id: `src/file-${index}.ts`,
    path: `src/file-${index}.ts`,
    name: `file-${index}.ts`,
    kind: "file" as const,
    parentPath: "src",
    viewerKind: "code" as const,
  }));
  const html = renderToStaticMarkup(
    <TreeSidebar
      nodes={[
        {
          id: "src",
          path: "src",
          name: "src",
          kind: "directory",
          parentPath: null,
          children: largeChildren,
        },
      ]}
      selectedPath="src/file-999.ts"
      revealPath="src/file-999.ts"
      revealRevision={1}
      onSelect={() => undefined}
      onOpen={() => undefined}
    />,
  );

  expect(html).toContain("Rendering 801 of 1001 visible rows");
  expect(html).toContain("file-999.ts");
  expect(html).not.toContain("file-998.ts");
});

it("keeps changed tree paths collapsed until explicitly revealed", () => {
  const largeChildren = Array.from({ length: 1000 }, (_, index) => ({
    id: `src/file-${index}.ts`,
    path: `src/file-${index}.ts`,
    name: `file-${index}.ts`,
    kind: "file" as const,
    parentPath: "src",
    viewerKind: "code" as const,
  }));
  const html = renderToStaticMarkup(
    <TreeSidebar
      nodes={[
        {
          id: "src",
          path: "src",
          name: "src",
          kind: "directory",
          parentPath: null,
          children: largeChildren,
        },
      ]}
      selectedPath="src/file-999.ts"
      changedPaths={new Set(["src/file-999.ts"])}
      onSelect={() => undefined}
      onOpen={() => undefined}
    />,
  );

  expect(html).toContain('data-tree-path="src"');
  expect(html).not.toContain("file-999.ts");
});

it("surfaces review work, comments, unread state, and open tabs in the tree", () => {
  const html = renderToStaticMarkup(
    <TreeSidebar
      nodes={[
        {
          id: "docs",
          path: "docs",
          name: "docs",
          kind: "directory",
          parentPath: null,
          children: [
            {
              id: "docs/brief.md",
              path: "docs/brief.md",
              name: "brief.md",
              kind: "file",
              parentPath: "docs",
              viewerKind: "markdown",
            },
            {
              id: "docs/appendix.md",
              path: "docs/appendix.md",
              name: "appendix.md",
              kind: "file",
              parentPath: "docs",
              viewerKind: "markdown",
            },
            {
              id: "docs/review.md",
              path: "docs/review.md",
              name: "review.md",
              kind: "file",
              parentPath: "docs",
              viewerKind: "markdown",
            },
          ],
        },
      ]}
      selectedPath="docs/brief.md"
      changedPaths={new Set(["docs/brief.md"])}
      reviewPaths={new Set(["docs/brief.md", "docs/review.md"])}
      unreadReviewPaths={new Set(["docs/brief.md", "docs/review.md"])}
      activePaths={new Set(["docs/brief.md", "docs/appendix.md"])}
      currentStopPath="docs/review.md"
      commentCountsByPath={{ "docs/brief.md": 3 }}
      openThreadCountsByPath={{ "docs/brief.md": 2 }}
      onSelect={() => undefined}
      onOpen={() => undefined}
    />,
  );

  expect(html).toContain(
    "tree-row dir has-review-work has-unread-work open-in-tab contains-selection",
  );
  expect(html).toContain("tree-row file selected changed has-review-work");
  expect(html).toContain("contains-current-stop");
  expect(html).toContain(
    "tree-row file has-review-work has-unread-work current-review-stop",
  );
  expect(html).toContain('role="tree"');
  expect(html).toContain(
    'aria-label="Live workspace map, 1 root entry, 3 loaded files, 2 review files, 2 unseen review files, 2 open files, 2 open threads, 3 comments"',
  );
  expect(html).toContain('id="workspace-tree-interaction-help"');
  expect(html).toContain('aria-describedby="workspace-tree-interaction-help"');
  expect(html).toContain("Click a file to preview it.");
  expect(html).toContain(
    "Double-click or press Enter to keep it open as a tab.",
  );
  expect(html).toContain('role="treeitem"');
  expect(html).toContain('aria-expanded="true"');
  expect(html).toContain('aria-level="2"');
  expect(html).toContain('aria-selected="true"');
  expect(html).toContain('class="tree-main"');
  expect(html).toContain('class="tree-review-reason"');
  expect(html).toContain(
    "current review.md · 2 attention · 2 open threads · 2 review files · 2 open tabs",
  );
  expect(html).toContain(
    "attention · 2 open threads · review · changed · open tab",
  );
  expect(html).toContain("attention · current stop · review");
  expect(html).toContain(
    'aria-label="docs, folder, expanded, contains selected file, contains current review stop review.md, 2 open files, 2 review files, 2 unseen review files, 2 open threads, 3 comments"',
  );
  expect(html).toContain(
    'aria-label="brief.md, file, selected, changed, review file, unseen review work, open in tab, 2 open threads, 3 comments"',
  );
  expect(html).toContain(
    'aria-label="review.md, file, review file, unseen review work, current review stop"',
  );
  expect(html).toContain(
    'title="Click to preview; double-click to keep open as a tab"',
  );
  expect(html).toContain('tabindex="0"');
  expect(html).toContain("tree-unread-dot");
  expect(html).toContain("tree-badge attention");
  expect(html).toContain("tree-badge current");
  expect(html).toContain(">now</span>");
  expect(html).toContain('title="2 attention items"');
  expect(html).toContain(">!</span>");
  expect(html).toContain(">2</span>");
  expect(html).toContain(">rev 2</span>");
  expect(html).toContain("open");
  expect(html).toContain("2 open threads");
  expect(html).toContain("changed");
  expect(html).toContain(">mod</span>");
  expect(html).not.toContain("tree-badge thread");
  expect(html).not.toContain("tree-badge comment");
});

it("labels tree size as root entries and loaded files", () => {
  const html = renderToStaticMarkup(
    <TreeSidebar
      nodes={[
        {
          id: "README.md",
          path: "README.md",
          name: "README.md",
          kind: "file",
          parentPath: null,
          viewerKind: "markdown",
        },
        {
          id: "src",
          path: "src",
          name: "src",
          kind: "directory",
          parentPath: null,
        },
      ]}
      selectedPath={null}
      onSelect={() => undefined}
      onOpen={() => undefined}
    />,
  );

  expect(html).toContain(
    'aria-label="Live workspace map, 2 root entries, 1 loaded file"',
  );
});

it("names the next review stop in tree folders when there is no current stop", () => {
  const html = renderToStaticMarkup(
    <TreeSidebar
      nodes={[
        {
          id: "docs",
          path: "docs",
          name: "docs",
          kind: "directory",
          parentPath: null,
          children: [
            {
              id: "docs/brief.md",
              path: "docs/brief.md",
              name: "brief.md",
              kind: "file",
              parentPath: "docs",
              viewerKind: "markdown",
            },
            {
              id: "docs/review.md",
              path: "docs/review.md",
              name: "review.md",
              kind: "file",
              parentPath: "docs",
              viewerKind: "markdown",
            },
          ],
        },
      ]}
      selectedPath={null}
      reviewPaths={new Set(["docs/brief.md", "docs/review.md"])}
      unreadReviewPaths={new Set(["docs/brief.md"])}
      openThreadCountsByPath={{ "docs/review.md": 1 }}
      onSelect={() => undefined}
      onOpen={() => undefined}
    />,
  );

  expect(html).toContain(
    "next brief.md · attention · 1 open thread · 2 review files",
  );
  expect(html).toContain(
    'aria-label="docs, folder, expanded, next review stop brief.md, 2 review files, 1 unseen review file, 1 open thread"',
  );
});

it("renders Mermaid diagrams with the official Mermaid runtime", () => {
  expect(hasCustomMermaidStyle("graph TD\nclassDef hot fill:#f00")).toBe(true);

  const html = renderToStaticMarkup(
    <MermaidViewer
      file={{
        ...codeFile,
        path: "docs/flow.mmd",
        viewerKind: "mermaid",
        content: "graph TD\nA[Start] --> B[Done]\n",
      }}
    />,
  );

  expect(html).toContain("Mermaid preview");
  expect(html).toContain("Rendering Mermaid diagram");
  expect(html).toContain("mermaid-render-target");
  expect(html).not.toContain("mermaid-svg");
});
