import { Children, isValidElement } from "react";
import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import type {
  DraftReviewComment,
  ViviComment,
} from "../ui/src/domain/comments.js";
import type { FilePayload } from "../ui/src/domain/fs-node.js";
import {
  CodeCommentThread,
  isCommentSubmitShortcut,
} from "../ui/src/features/comments/components/CodeCommentThread.js";
import { CommandPalette } from "../ui/src/features/command-palette/CommandPalette.js";
import {
  activeFileReviewStop,
  FileOutlineControl,
  FileViewer,
} from "../ui/src/features/file-context/components/FileViewer.js";
import {
  ViewerHeaderProvider,
  ViewerToolbar,
  ViewerToolbarLocation,
  viewerHeaderReviewState,
} from "../ui/src/features/file-context/components/ViewerControlButton.js";
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
  diffCommentContextForRange,
  DiffViewer,
  renderedDiffSelectionLineRange,
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

  expect(html).toContain('aria-label="Vivi"');
  expect(html).toContain('aria-label="Current workspace"');
  expect(html).toContain('aria-label="Workspace actions"');
  expect(html).toContain(">vivi</span>");
  expect(html).toContain(">/Users/tasuku/work</span>");
  expect(html).toContain("Theme");
  expect(html).toContain("System");
  expect(html).toContain('aria-label="Open command palette"');
  expect(html).toContain("Command");
  expect(html).toContain("Cmd/Ctrl K");
  expect(html).toContain("Cmd/Ctrl Shift F");
  expect(html).toContain('aria-keyshortcuts="Meta+K Control+K"');
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
  clickAction("Search workspace text");

  expect(actions).toEqual(["shortcuts", "quick-open", "search"]);
  expect(renderToStaticMarkup(topbar)).not.toContain("Open Comments hub");
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

  expect(html).toContain('role="group"');
  expect(html).toContain(
    'aria-label="Open file tabs, 2 tabs, active src/app.ts, 1 preview tab, 1 changed tab"',
  );
  expect(html).toContain('aria-current="true"');
  expect(html).not.toContain('aria-selected="');
  expect(html).toContain('tabindex="0"');
  expect(html).toContain('tabindex="-1"');
  expect(html).toContain('data-tab-path="src/app.ts"');
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

  expect(html).toContain('aria-hidden="true">docs</span>');
  expect(html).toContain('aria-hidden="true">examples</span>');
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
  expect(html).not.toContain("<header");
  expect(html).toContain("Cmd/Ctrl W");
  expect(html).toMatch(
    /<kbd class="[^"]+" aria-label="Command or Control W">Cmd\/Ctrl W<\/kbd>/,
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
  expect(html).toMatch(
    /<kbd class="[^"]+" aria-label="Command or Control Shift Backslash">Cmd\/Ctrl Shift \\<\/kbd>/,
  );
  expect(html).toContain("Toggle Explorer");
  expect(html).toContain("Toggle inspector");
  expect(html).toContain("Cmd/Ctrl Shift U");
  expect(html).toContain("Cmd/Ctrl Shift J");
  expect(html).toContain("Cmd/Ctrl Shift K");
  expect(html).toContain("Cmd/Ctrl Shift M");
  expect(html).toContain("Mark current file reviewed");
  expect(html).not.toContain("Cmd/Ctrl Alt R");
  expect(html).not.toContain("Cmd/Ctrl Alt T");
  expect(html).not.toContain("Cmd/Ctrl Alt M");
  expect(html).not.toContain("Review queue mode");
  expect(html).not.toContain("Comment threads mode");
  expect(html).not.toContain("File map mode");
  expect(html).not.toContain("Cmd/Ctrl Shift R");
  expect(html).not.toContain("Cmd/Ctrl Shift C");
  expect(html).not.toContain("Open Attention / Comments");
  expect(html).not.toContain("Cmd/Ctrl Shift P");
  expect(html).not.toContain("Publish draft review comments");
  expect(html).toContain("Cmd/Ctrl G");
  expect(html).toContain("Cmd/Ctrl Shift G");
  expect(html).toContain("Cmd/Ctrl /");
  expect(html).toContain("Left / Right");
  expect(html).toMatch(
    /<kbd class="[^"]+" aria-label="Left or Right arrow">Left \/ Right<\/kbd>/,
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
  expect(html).toContain(">Active</span>");
  expect(html).toContain(">Open</span>");
  expect(html).toContain(">Recent</span>");
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
  expect(html).toContain(">L4</span>");
  expect(html).toContain("&lt;h1&gt;");
  expect(html).toContain(">Index</mark>");
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
  expect(html).toMatch(/<kbd class="[^"]+">Tab<\/kbd>/);
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
  expect(htmlSource).toContain('class="code-line search-focus"');
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
  expect(html).toContain("text-search-nav-match");
  expect(html).toContain(">needle</mark>");
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
    'aria-label="Open comment thread on line 2 with 2 messages"',
  );
  expect(html).toContain(
    'title="Open comment thread on line 2 with 2 messages"',
  );
  expect(html).toContain('aria-label="Add comment on line 1"');
  expect(html).toContain('aria-label="Comment thread for line 2"');
  expect(html).toContain('class="code-thread-comment open active"');
  expect(html).toContain('aria-current="true"');
  expect(html).toContain('tabindex="-1"');
  expect(html).not.toContain("Current stop");
  expect(html).toContain("2 messages");
  expect(html.indexOf("Check this return")).toBeLessThan(
    html.indexOf("Agreed, keep it explicit"),
  );
  expect(html).toContain('placeholder="Add a follow-up"');
  expect(html).not.toContain("autofocus");
  expect(html).toContain('aria-label="Add follow-up"');
  expect(html).toContain("Continue thread");
  expect(html).not.toContain("Comment composer intent");
  expect(html).not.toContain(">Continue</button>");
  expect(html).toContain(
    'aria-describedby="comment-composer-mode-src-app-ts-2-2 comment-reply-hint-src-app-ts-2-2"',
  );
  expect(html).toContain('aria-keyshortcuts="Meta+Enter Control+Enter"');
  expect(html).toContain(">Resolve</button>");
  expect(html).toContain(">Archive</button>");
  expect(html).toContain(
    'aria-keyshortcuts="Meta+Shift+Enter Control+Shift+Enter"',
  );
  expect(html).toContain(
    'aria-keyshortcuts="Meta+Shift+Backspace Control+Shift+Backspace"',
  );
  expect(html).toContain('title="Resolve (Cmd/Ctrl Shift Enter)"');
  expect(html).toContain('title="Archive (Cmd/Ctrl Shift Backspace)"');
  expect(html).toMatch(
    /<kbd class="[^"]+">Cmd\/Ctrl Enter<\/kbd> to add follow-up/,
  );
  expect(html).toContain("Esc closes");
  expect(html).not.toContain(">Comment<");
});

it("renders a published review batch as one inline thread with all messages", () => {
  const batchComments = Array.from({ length: 5 }, (_, index) => ({
    ...codeLineComment,
    id: `batch-comment-${index + 1}`,
    threadId: "thread-review-batch",
    body: `Published batch message ${index + 1}`,
    createdAt: `2026-01-01T00:0${index}:00.000Z`,
    updatedAt: `2026-01-01T00:0${index}:00.000Z`,
  }));

  const html = renderToStaticMarkup(
    <CodeViewer
      file={codeFile}
      theme="dark"
      selectedRange={null}
      comments={batchComments}
      activeCommentId="batch-comment-1"
      onSelectionChange={() => undefined}
      onOpenComment={() => undefined}
      onCreateComment={() => undefined}
    />,
  );

  expect(html).toContain(
    'aria-label="Open comment thread on line 2 with 5 messages"',
  );
  expect(html).toContain("5 messages");
  expect(html.match(/aria-label="Comment thread for line 2"/g)).toHaveLength(1);
  for (const comment of batchComments) {
    expect(html).toContain(comment.body);
  }
});

it("hides archived code comment threads from inline source markers", () => {
  const archivedComment: ViviComment = {
    ...codeLineComment,
    id: "comment-archived-inline",
    threadId: "thread-archived-inline",
    status: "archived",
    body: "Archived inline feedback should not render.",
    updatedAt: "2026-01-01T00:02:00.000Z",
    archivedAt: "2026-01-01T00:02:00.000Z",
  };
  const html = renderToStaticMarkup(
    <CodeViewer
      file={codeFile}
      theme="dark"
      selectedRange={null}
      comments={[archivedComment]}
      activeCommentId={archivedComment.id}
      onSelectionChange={() => undefined}
      onOpenComment={() => undefined}
      onCreateComment={() => undefined}
    />,
  );

  expect(html).not.toContain("Archived inline feedback should not render.");
  expect(html).not.toContain('class="code-line has-comment');
  expect(html).not.toContain('aria-label="Comment thread for line 2"');
  expect(html).toContain('aria-label="Add comment on line 2"');
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
    'aria-label="Open comment thread on line 2 with 1 message"',
  );
  expect(html).not.toContain(
    'aria-label="Open comment thread on line 2 with 2 messages"',
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
    'aria-label="Open comment thread on line 2 with 2 messages"',
  );
  expect(html).not.toContain("code-comment-thread-row");
  expect(html).not.toContain("Comment thread for line 2");
  expect(html).not.toContain("Current stop");
  expect(html).not.toContain("Continue thread");
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

it("marks the configured actor's inline comments as current user", () => {
  const humanComment: ViviComment = {
    ...codeLineComment,
    id: "human-comment",
    threadId: "thread-1",
    createdBy: {
      id: "human:tasuku",
      kind: "human",
      displayName: "Tasuku",
    },
    author: "Tasuku",
    source: "human",
  };
  const agentComment: ViviComment = {
    ...codeLineComment,
    id: "agent-comment",
    threadId: "thread-1",
    body: "Agent follow-up",
    createdBy: {
      id: "codex:run-1",
      kind: "codex",
      displayName: "Codex",
    },
    author: "Codex",
    source: "codex",
    createdAt: "2026-01-01T00:01:00.000Z",
    updatedAt: "2026-01-01T00:01:00.000Z",
  };
  const html = renderToStaticMarkup(
    <CodeViewer
      file={codeFile}
      theme="dark"
      selectedRange={null}
      comments={[humanComment, agentComment]}
      activeCommentId={agentComment.id}
      currentActorId="human:tasuku"
      onSelectionChange={() => undefined}
      onOpenComment={() => undefined}
      onCreateComment={() => undefined}
    />,
  );

  expect(html).toContain('data-comment-id="human-comment"');
  expect(html).toContain(
    'class="code-thread-comment open current-user" data-comment-id="human-comment"',
  );
  expect(html).toContain("You</span>");
  expect(html).toContain(
    'class="code-thread-comment open active" data-comment-id="agent-comment"',
  );
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
    'aria-label="Open comment thread on line 3 with 1 message"',
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
    threadId: comment.threadId ?? comment.id,
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
        status: "open",
        comments: [comment],
      }}
      draft={draft}
      onCreateComment={() => undefined}
      onClose={() => undefined}
    />,
  );

  expect(html).toMatch(
    /class="[^"]*\bcode-comment-thread\b[^"]*\brendered-comment-thread\b[^"]*"/,
  );
  expect(html).toContain("Lines 3-4");
  expect(html).toContain('placeholder="Add a follow-up"');
  expect(html).toContain("Continue thread");
  expect(html).not.toContain(">Continue</button>");
  expect(html).toMatch(
    /<kbd class="[^"]+">Cmd\/Ctrl Enter<\/kbd> to add follow-up/,
  );
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
    'aria-label="Open comment thread on line 3 with 1 message"',
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

it("renders file location inside the integrated viewer toolbar", () => {
  const calls: string[] = [];
  const file = {
    ...codeFile,
    path: "docs/brief/intro.md",
    viewerKind: "markdown" as const,
  };
  const toolbar = (
    <ViewerHeaderProvider
      value={{
        file,
        onRevealInTree: (path) => calls.push(path ?? ""),
      }}
    >
      <ViewerToolbar>
        <button type="button">Diff from HEAD</button>
      </ViewerToolbar>
    </ViewerHeaderProvider>
  );
  const html = renderToStaticMarkup(toolbar);
  const location = ViewerToolbarLocation({
    file,
    onRevealInTree: (path) => calls.push(path ?? ""),
  });

  expect(html).toContain("viewer-toolbar");
  expect(html).toContain('data-viewer-header="unified"');
  expect(html).toContain("viewer-toolbar-location");
  expect(html).toContain(
    'aria-label="Current file location, docs/brief/intro.md"',
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
  expect(html).not.toContain("Current file kind");
  expect(html).not.toContain("Show in tree");

  const directoryButton = findElement(location, (element) => {
    const props = element.props as { type?: string; children?: ReactNode };
    return props.type === "button" && flattenText(props.children) === "brief";
  });
  (directoryButton.props as { onClick: () => void }).onClick();

  const fileButton = findElement(location, (element) => {
    const props = element.props as { className?: string; children?: ReactNode };
    return (
      props.className?.split(" ").includes("file") &&
      flattenText(props.children) === "intro.md"
    );
  });
  (fileButton.props as { onClick: () => void }).onClick();

  expect(calls).toEqual(["docs/brief", "docs/brief/intro.md"]);
});

it("surfaces the current review stop in the integrated viewer toolbar", () => {
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
  const toolbar = (
    <ViewerHeaderProvider
      value={{
        file,
        activeReviewStop: stop,
        onFocusActiveComment: () => calls.push("focus-stop"),
        onRevealInTree: () => undefined,
      }}
    >
      <ViewerToolbar>
        <button type="button">Diff from HEAD</button>
      </ViewerToolbar>
    </ViewerHeaderProvider>
  );
  const html = renderToStaticMarkup(toolbar);
  const location = ViewerToolbarLocation({
    file,
    activeReviewStop: stop,
    onFocusActiveComment: () => calls.push("focus-stop"),
    onRevealInTree: () => undefined,
  });

  expect(stop).toEqual({
    label: "source · L2",
    preview: "Check this return",
  });
  expect(
    activeFileReviewStop(file, [codeLineComment], "missing-comment"),
  ).toBeNull();
  expect(html).toContain("file-location-review-stop");
  expect(html).toContain('aria-keyshortcuts="Meta+I Control+I"');
  expect(html).toContain(
    'aria-label="Focus current review stop, source · L2, Check this return"',
  );
  expect(html).toContain("Current stop");
  expect(html).toContain("source · L2");
  expect(html).toContain("Check this return");

  const stopButton = findElement(location, (element) => {
    const props = element.props as { className?: string };
    return props.className?.split(" ").includes("file-location-review-stop");
  });
  (stopButton.props as { onClick: () => void }).onClick();

  expect(calls).toEqual(["focus-stop"]);
});

it("keeps current-file review status compact in the viewer toolbar", () => {
  const file = {
    ...codeFile,
    path: "src/app.ts",
  };
  const reviewState = viewerHeaderReviewState("queued");
  const html = renderToStaticMarkup(
    <ViewerHeaderProvider
      value={{
        file,
        reviewState,
        onMarkReviewed: () => undefined,
        onRevealInTree: () => undefined,
      }}
    >
      <ViewerToolbar>
        <button type="button">Diff from HEAD</button>
      </ViewerToolbar>
    </ViewerHeaderProvider>,
  );

  expect(reviewState).toEqual({
    state: "queued",
    label: "Queued",
    title: "Review state: Queued",
    tone: "queued",
  });
  expect(html).toContain("review-state-label");
  expect(html).toContain("queued");
  expect(html).toContain('aria-label="Review state: Queued"');
  expect(html).toContain("Queued");
  expect(html).toContain("Mark as reviewed");
  expect(html).toContain(
    'aria-keyshortcuts="Meta+Shift+M Control+Shift+M"',
  );
  expect(html).not.toContain("Current file</span>");
  expect(html).not.toContain("Review 1 open");
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

it("uses the inline source thread experience for HTML source mode", () => {
  const comment: ViviComment = {
    ...codeLineComment,
    id: "html-source-comment",
    path: "index.html",
    viewerKind: "html",
    anchor: {
      surface: "source",
      canonical: {
        path: "index.html",
        lineStart: 2,
        lineEnd: 2,
        quote: "<p>Body</p>",
      },
    },
  };
  const html = renderToStaticMarkup(
    <HtmlViewer
      file={{
        ...codeFile,
        path: "index.html",
        viewerKind: "html",
        content: "<h1>Title</h1>\n<p>Body</p>\n",
      }}
      allowHtmlScripts={false}
      mode="source"
      comments={[comment]}
      activeCommentId={comment.id}
      onCreateComment={() => undefined}
      onOpenComment={() => undefined}
      onCommentStatusChange={() => undefined}
    />,
  );

  expect(html).toContain("source-comment-surface markdown-source");
  expect(html).toContain('aria-label="HTML view mode"');
  expect(html).toContain(
    'aria-label="Open comment thread on line 2 with 1 message"',
  );
  expect(html).toContain('aria-label="Comment thread for line 2"');
  expect(html).toContain("Check this return");
  expect(html).not.toContain('aria-label="New comment"');
  expect(html).not.toContain("Draft a review comment");
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

it("defers generic diffs for unsupported file types until the diff viewer loads", () => {
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

  expect(html).toContain("Loading preview for artifact.unknown...");
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
      onCommentStatusChange={() => undefined}
    />,
  );

  expect(html).toContain("Review");
  expect(html).toContain("Queued");
  expect(html).toContain("In Review");
  expect(html).toContain("Reviewed");
  expect(html).toContain('class="review-state-summary"');
  expect(html).toContain('class="review-state-section queued"');
  expect(html).toContain('class="review-state-section reviewing"');
  expect(html).toContain('class="review-state-section reviewed"');
  expect(html).toContain('class="review-queue" role="group"');
  expect(html).toContain(
    'aria-label="Review queue, 3 queued, 0 in review, 0 reviewed"',
  );
  expect(html).toContain(
    'aria-describedby="review-queue-interaction-help review-queue-keyboard-help"',
  );
  expect(html).toContain('id="review-queue-keyboard-help"');
  expect(html).toContain(
    "Use Down Arrow, Up Arrow, Home, and End to move between review",
  );
  expect(html).toContain('class="review-queue-item"');
  expect(html).toContain('class="change-open active"');
  expect(html).toContain('aria-current="true"');
  expect(html).toContain('aria-keyshortcuts="ArrowDown ArrowUp Home End"');
  expect(html).toContain('id="review-queue-interaction-help"');
  expect(html).toContain(
    'aria-describedby="review-queue-interaction-help review-queue-keyboard-help review-queue-item-1-description"',
  );
  expect(html).toContain('id="review-queue-item-1-description"');
  expect(html).toContain("unread review activity, from HEAD diff");
  expect(html).toContain("Click or press Enter to preview a review file.");
  expect(html).toContain("Double-click to keep it open as a tab.");
  expect(html).toContain('data-review-index="0"');
  expect(html).toContain('data-review-path="src/app.ts"');
  expect(html).toContain('data-testid="review-queue-item"');
  expect(html).toContain(
    'aria-label="Review queue item, modified src/app.ts, current review file"',
  );
  expect(html).not.toContain("src/app.ts:2");
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
  expect(html).not.toContain("File details");
  expect(html).not.toContain("Open all changed files as tabs");
  expect(html).not.toContain("In this file");
  expect(html).not.toContain("Comments");
  expect(html).not.toContain("export");
  expect(html).not.toContain("start");
  expect(html).not.toContain("Recent events");
  expect(html).not.toContain("Diff</button>");
  expect(html).not.toContain("Review targets");
  expect(html).not.toContain("Changed files");
  expect(html).not.toContain("Next Action");
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

it("keeps legacy active-file thread mode out of the review inspector", () => {
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
      onCommentStatusChange={() => undefined}
    />,
  );

  expect(html).toContain("Review");
  expect(html).toContain("Reviewed");
  expect(html).not.toContain("<strong>1 open thread</strong>");
  expect(html).not.toContain("3 total messages in this file");
  expect(html).not.toContain('class="active-comment-thread open active"');
  expect(html).not.toContain('class="active-comment-thread resolved"');
  expect(html).not.toContain("Current thread");
  expect(html).not.toContain('data-testid="review-comment-thread"');
  expect(html).not.toContain('class="active-comment-thread-actions"');
  expect(html).not.toContain(">Resolve current thread</button>");
  expect(html).not.toContain(">Reopen</button>");
  expect(html).not.toContain(">Archive current thread</button>");
  expect(html).not.toContain("2 open comments");
  expect(html).not.toContain("Current file</span>");
  expect(html).not.toContain("Open 3 total messages in Comments panel");
  expect(html).not.toContain('data-testid="review-open-comments-panel"');
});

it("does not expose legacy active-file thread actions in the review inspector", () => {
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
    onCommentStatusChange: (threadId, status) =>
      updates.push([threadId, status]),
  });

  expect(() =>
    findElement(inspector, (element) => {
      const props = element.props as { children?: ReactNode; type?: string };
      return (
        props.type === "button" &&
        ["Resolve", "Archive"].includes(flattenText(props.children))
      );
    }),
  ).toThrow();
  expect(updates).toEqual([]);
});

it("keeps legacy active-file comment locations out of the review inspector", () => {
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
    />,
  );

  expect(html).not.toContain(
    "Rendered Markdown · block vivi-block-2 · source L3-L4",
  );
  expect(html).not.toContain("Diff new L8-L9");
  expect(html).not.toContain(
    'aria-label="Open thread in README.md, Rendered Markdown · block vivi-block-2 · source L3-L4, markdown rendered, L3-L4, latest: Rendered paragraph needs a clearer transition."',
  );
  expect(html).not.toContain(
    'aria-label="Open thread in README.md, Diff new L8-L9, diff, L8-L9, latest: Diff branch needs a clearer transition."',
  );
  expect(html).not.toContain('class="active-comment-thread-location"');
});

it("does not render active-file comments panel actions in the inspector", () => {
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

  expect(() =>
    findElement(inspector, (element) => {
      const props = element.props as { children?: ReactNode };
      return (
        element.type === "button" &&
        flattenText(props.children).includes("Open in Comments panel")
      );
    }),
  ).toThrow();
});

it("keeps the review queue usable when no review file is selected", () => {
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
    onCommentStatusChange: () => undefined,
  });

  const html = renderToStaticMarkup(inspector);

  expect(html).toContain("Review queue item, modified src/app.ts");
  expect(html).not.toContain('data-testid="review-open-comments-panel"');
  expect(html).not.toContain("Open in Comments panel");
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
  expect(html).not.toContain("Current stop");
  expect(html).toContain(
    '<div class="comment-activity-summary" role="group" aria-label="Thread activity">',
  );
  expect(html).toContain("Claude Code read 12s ago");
  expect(html).toContain("Codex replied 1m ago");
  expect(html).toContain("comment-status open");
  expect(html).toContain(">Open</span>");
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
  expect(html).toContain('aria-label="Save pending draft comment"');
  expect(html).toContain("Add comment on Line 4");
  expect(html).toContain(
    'aria-describedby="comment-composer-mode-src-app-ts-4-4 comment-reply-hint-src-app-ts-4-4"',
  );
  expect(html).toMatch(
    /<kbd class="[^"]+">Cmd\/Ctrl Enter<\/kbd> to save pending draft/,
  );
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

  expect(html).toContain("comment-status resolved");
  expect(html).toContain(">Resolved</span>");
  expect(html).toContain(">Reopen</button>");
  expect(html).not.toContain(">Resolve</button>");
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
  expect(html).toContain(
    '<div class="code-comment-thread-messages" role="group" aria-label="Thread messages" tabindex="0">',
  );
  expect(html).toContain("Check this return");
  expect(html).toContain("Still unpublished in this thread");
  expect(html).toContain("comment-status published");
  expect(html).toContain(">Published</span>");
  expect(html).toContain("Pending draft");
  expect(html).toContain("comment-status draft");
  expect(html).toContain(">Pending</span>");
  expect(html).toContain(">Resolve</button>");
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
  expect(html).toContain(
    'aria-label="Review queue, 1 queued, 1 in review, 0 reviewed"',
  );
  expect(html).toContain("Queued");
  expect(html).toContain("In Review");
  expect(html).toContain("Reviewed");
  expect(html).toContain("has-open-threads active");
  const queueHtml = html.slice(html.indexOf('class="review-queue"'));
  expect(queueHtml.indexOf('data-review-path="src/app.ts"')).toBeLessThan(
    queueHtml.indexOf('data-review-path="docs/agent-handoff.md"'),
  );
  expect(html).toContain("2 open");
  expect(html).toContain("3 total messages");
  expect(html).not.toContain('class="review-stop-summary"');
  expect(html).toContain("Queue stop");
  expect(html).toContain("Next queue stop");
  expect(html).toContain("diff · L7");
  expect(html).toContain(
    "Agent reply needs a human decision before this file is clear.",
  );
  expect(html).toContain(
    'aria-label="Review queue item, comment docs/agent-handoff.md, current review file"',
  );
  expect(html).toContain(
    'aria-describedby="review-queue-interaction-help review-queue-keyboard-help review-queue-item-2-description"',
  );
  expect(html).toContain(
    "unread review activity, 2 open, 3 total messages, Queue stop diff · L7: Agent reply needs a human decision before this file is clear.",
  );
  expect(html).toContain('class="review-state-card queued"');
  expect(html).toContain('class="review-state-card reviewing"');
  expect(html).toContain("2 open");
  expect(html).not.toContain('class="active-comment-thread"');
});

it("does not surface legacy source-changed thread warnings in the review inspector", () => {
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

  expect(html).not.toContain("Source changed");
  expect(html).not.toContain(
    'aria-label="Current file content differs from this comment anchor"',
  );
});

it("does not surface legacy source-missing thread warnings in the review inspector", () => {
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

  expect(html).not.toContain("Source missing");
  expect(html).not.toContain(
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

  expect(html).toContain("No open · 1 total message");
  expect(html).toContain("Resolved after the DSCP paths were checked.");
  expect(html).not.toContain('class="review-stop-summary"');
  expect(html).not.toContain("Queue stop");
  expect(html).not.toContain("Next queue stop");
  expect(html).toContain(
    'aria-label="Review queue, 1 queued, 0 in review, 1 reviewed"',
  );
  expect(html).toContain("read, 1 total message, from HEAD diff");
  expect(html).toContain("<span>Reviewed</span><small>1 reviewed</small>");
});

it("opens Review Queue rows as preview while reserving thread badges for expansion", () => {
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

it("expands Review Queue thread lists from the thread badge only", () => {
  const openComment: ViviComment = {
    ...codeLineComment,
    id: "comment-open-review-row",
    threadId: "thread-open-review-row",
    body: "Open issue still needs a look.",
    status: "open",
  };
  const resolvedComment: ViviComment = {
    ...codeLineComment,
    id: "comment-resolved-review-row",
    threadId: "thread-resolved-review-row",
    body: "Resolved context should remain visible in the file row.",
    status: "resolved",
    updatedAt: "2026-01-01T00:02:00.000Z",
    resolvedAt: "2026-01-01T00:02:00.000Z",
  };
  const archivedComment: ViviComment = {
    ...codeLineComment,
    id: "comment-archived-review-row",
    threadId: "thread-archived-review-row",
    body: "Archived context should read quietly.",
    status: "archived",
    updatedAt: "2026-01-01T00:03:00.000Z",
    archivedAt: "2026-01-01T00:03:00.000Z",
  };
  const rowCalls: string[] = [];
  const threadCalls: string[] = [];
  const inspector = Inspector({
    file: codeFile,
    reviewChanges: [],
    reviewItems: [
      {
        path: "src/app.ts",
        change: { path: "src/app.ts", status: "modified", source: "git" },
        threadCounts: { open: 1, resolved: 1, archived: 1 },
        commentCount: 3,
        unread: false,
      },
    ],
    reviewComments: [openComment, resolvedComment, archivedComment],
    reviewDiffStats: {},
    loadingReviewDiffs: {},
    unreadReviewPaths: new Set(),
    selectedCodeRange: null,
    activePaneId: "main",
    onOpenEventPath: (path) => rowCalls.push(path),
    onConfirmEventPath: () => undefined,
    onOpenComment: (comment) => threadCalls.push(comment.id),
    onOpenNextChanged: () => undefined,
    onOpenPreviousChanged: () => undefined,
    onOpenAllChanged: () => undefined,
    onRevealInTree: () => undefined,
  });

  const row = findElement(inspector, (element) => {
    const props = element.props as { className?: string; children?: ReactNode };
    return (
      props.className?.split(" ").includes("change-open") &&
      flattenText(props.children).includes("app.ts")
    );
  });
  (row.props as { onClick: () => void }).onClick();

  const threadBadge = findElement(inspector, (element) => {
    const props = element.props as { className?: string; children?: ReactNode };
    return (
      props.className === "review-thread-count-toggle" &&
      flattenText(props.children) === "1 open"
    );
  });
  const openThread = findElement(inspector, (element) => {
    const props = element.props as {
      className?: string;
      "aria-label"?: string;
    };
    return (
      props.className?.split(" ").includes("review-thread-hairline-row") &&
      props["aria-label"]?.includes("Open not read by agent thread")
    );
  });
  (openThread.props as { onClick: () => void }).onClick();

  const html = renderToStaticMarkup(inspector);

  expect(rowCalls).toEqual(["src/app.ts"]);
  expect(threadCalls).toEqual(["comment-open-review-row"]);
  expect(threadBadge.props).toMatchObject({
    className: "review-thread-count-toggle",
    htmlFor: "review-queue-item-1-thread-toggle",
  });
  expect(html).toContain('id="review-queue-item-1-thread-toggle"');
  expect(html).toContain('aria-controls="review-queue-item-1-threads"');
  expect(html).toContain("Open issue still needs a look.");
  expect(html).toContain("Resolved context should remain visible");
  expect(html).toContain("Archived context should read quietly.");
  expect(html).toContain('class="review-thread-status-badge not-read"');
  expect(html).not.toContain('class="review-thread-status-badge resolved"');
  expect(html).not.toContain('class="review-thread-status-badge archived"');
});

it("groups pending draft replies under their existing Review Queue thread", () => {
  const openComment: ViviComment = {
    ...codeLineComment,
    id: "comment-open-with-pending-drafts",
    threadId: "thread-open-with-pending-drafts",
    body: "Open issue still needs a look.",
    status: "open",
  };
  const pendingDrafts: DraftReviewComment[] = [
    {
      id: "draft-reply-one",
      threadId: "thread-open-with-pending-drafts",
      path: "src/app.ts",
      viewerKind: "text",
      anchor: codeLineComment.anchor,
      body: "First pending follow-up.",
      source: "human",
      createdAt: "2026-01-01T00:04:00.000Z",
      updatedAt: "2026-01-01T00:04:00.000Z",
    },
    {
      id: "draft-reply-two",
      threadId: "thread-open-with-pending-drafts",
      path: "src/app.ts",
      viewerKind: "text",
      anchor: codeLineComment.anchor,
      body: "Second pending follow-up.",
      source: "human",
      createdAt: "2026-01-01T00:05:00.000Z",
      updatedAt: "2026-01-01T00:05:00.000Z",
    },
  ];
  const publishedDraftIds: string[][] = [];
  const inspector = Inspector({
    file: codeFile,
    reviewChanges: [],
    reviewItems: [
      {
        path: "src/app.ts",
        change: { path: "src/app.ts", status: "modified", source: "git" },
        threadCounts: { open: 1, resolved: 0, archived: 0 },
        commentCount: 1,
        pendingDraftCount: 2,
        pendingDraftIds: pendingDrafts.map((draft) => draft.id),
        unread: false,
      },
    ],
    reviewComments: [openComment],
    draftComments: pendingDrafts,
    reviewDiffStats: {},
    loadingReviewDiffs: {},
    unreadReviewPaths: new Set(),
    selectedCodeRange: null,
    activePaneId: "main",
    onOpenEventPath: () => undefined,
    onConfirmEventPath: () => undefined,
    onOpenNextChanged: () => undefined,
    onOpenPreviousChanged: () => undefined,
    onOpenAllChanged: () => undefined,
    onRevealInTree: () => undefined,
    onPublishDrafts: (ids) => publishedDraftIds.push(ids ?? []),
  });

  const threadBadge = findElement(inspector, (element) => {
    const props = element.props as { className?: string; children?: ReactNode };
    return (
      props.className === "review-thread-count-toggle pending" &&
      flattenText(props.children) === "1 open · 2 pending"
    );
  });
  const threadRow = findElement(inspector, (element) => {
    const props = element.props as {
      className?: string;
      "aria-label"?: string;
    };
    return (
      props.className?.split(" ").includes("review-thread-hairline-row") &&
      props["aria-label"]?.includes("2 pending")
    );
  });
  const publishButton = findElement(inspector, (element) => {
    const props = element.props as {
      className?: string;
      onClick?: () => void;
    };
    return props.className === "review-thread-publish-button";
  });
  (publishButton.props as { onClick: () => void }).onClick();
  const html = renderToStaticMarkup(inspector);

  expect(threadBadge).toBeTruthy();
  expect(flattenText(threadRow.props.children)).toContain("2 pending");
  expect(flattenText(threadRow.props.children)).toContain("return true;");
  expect(flattenText(threadRow.props.children)).not.toContain(
    "Second pending follow-up.",
  );
  expect(html).not.toContain("Open pending item, src/app.ts");
  expect(html).toContain("Publish 2 pending in src/app.ts, L2");
  expect(publishedDraftIds).toEqual([["draft-reply-two", "draft-reply-one"]]);
});

it("groups pending draft-only thread messages as one Review Queue row", () => {
  const pendingDrafts: DraftReviewComment[] = [
    {
      id: "draft-only-one",
      threadId: "draft-thread-lines-28-30",
      path: "src/app.ts",
      viewerKind: "text",
      anchor: codeLineComment.anchor,
      body: "First private note.",
      source: "human",
      createdAt: "2026-01-01T00:04:00.000Z",
      updatedAt: "2026-01-01T00:04:00.000Z",
    },
    {
      id: "draft-only-two",
      threadId: "draft-thread-lines-28-30",
      path: "src/app.ts",
      viewerKind: "text",
      anchor: codeLineComment.anchor,
      body: "Second private note.",
      source: "human",
      createdAt: "2026-01-01T00:05:00.000Z",
      updatedAt: "2026-01-01T00:05:00.000Z",
    },
    {
      id: "draft-only-three",
      threadId: "draft-thread-lines-28-30",
      path: "src/app.ts",
      viewerKind: "text",
      anchor: codeLineComment.anchor,
      body: "Third private note.",
      source: "human",
      createdAt: "2026-01-01T00:06:00.000Z",
      updatedAt: "2026-01-01T00:06:00.000Z",
    },
  ];
  const publishedDraftIds: string[][] = [];
  const inspector = Inspector({
    file: codeFile,
    reviewChanges: [],
    reviewItems: [
      {
        path: "src/app.ts",
        change: { path: "src/app.ts", status: "modified", source: "git" },
        threadCounts: { open: 0, resolved: 0, archived: 0 },
        commentCount: 0,
        pendingDraftCount: 3,
        pendingDraftIds: pendingDrafts.map((draft) => draft.id),
        unread: false,
      },
    ],
    reviewComments: [],
    draftComments: pendingDrafts,
    reviewDiffStats: {},
    loadingReviewDiffs: {},
    unreadReviewPaths: new Set(),
    selectedCodeRange: null,
    activePaneId: "main",
    onOpenEventPath: () => undefined,
    onConfirmEventPath: () => undefined,
    onOpenNextChanged: () => undefined,
    onOpenPreviousChanged: () => undefined,
    onOpenAllChanged: () => undefined,
    onRevealInTree: () => undefined,
    onPublishDrafts: (ids) => publishedDraftIds.push(ids ?? []),
  });

  const threadBadge = findElement(inspector, (element) => {
    const props = element.props as { className?: string; children?: ReactNode };
    return (
      props.className === "review-thread-count-toggle pending" &&
      flattenText(props.children) === "3 pending"
    );
  });
  const threadRow = findElement(inspector, (element) => {
    const props = element.props as {
      className?: string;
      "aria-label"?: string;
    };
    return (
      props.className?.split(" ").includes("review-thread-hairline-row") &&
      props["aria-label"]?.includes("Open pending thread") &&
      props["aria-label"]?.includes("3 pending")
    );
  });
  const publishButton = findElement(inspector, (element) => {
    const props = element.props as {
      className?: string;
      onClick?: () => void;
    };
    return props.className === "review-thread-publish-button";
  });
  (publishButton.props as { onClick: () => void }).onClick();
  const html = renderToStaticMarkup(inspector);

  expect(threadBadge).toBeTruthy();
  expect(flattenText(threadRow.props.children)).toContain("3 pending");
  expect(flattenText(threadRow.props.children)).toContain("return true;");
  expect(flattenText(threadRow.props.children)).not.toContain(
    "Third private note.",
  );
  expect(html.match(/review-thread-hairline-row/g)?.length).toBe(1);
  expect(html).toContain("Publish 3 pending in src/app.ts, L2");
  expect(publishedDraftIds).toEqual([
    ["draft-only-three", "draft-only-two", "draft-only-one"],
  ]);
});

it("groups separate draft-only threads on the same file without splitting their replies", () => {
  const pendingDrafts: DraftReviewComment[] = [
    {
      id: "draft-thread-a-reply",
      threadId: "draft-thread:draft-thread-a-root:source-anchor",
      path: "src/app.ts",
      viewerKind: "text",
      anchor: codeLineComment.anchor,
      body: "Latest reply in first draft thread.",
      source: "human",
      createdAt: "2026-01-01T00:07:00.000Z",
      updatedAt: "2026-01-01T00:07:00.000Z",
    },
    {
      id: "draft-thread-b-reply",
      threadId: "draft-thread:draft-thread-b-root:source-anchor",
      path: "src/app.ts",
      viewerKind: "text",
      anchor: {
        ...codeLineComment.anchor,
        canonical: {
          ...codeLineComment.anchor.canonical,
          lineStart: 3,
          lineEnd: 3,
        },
      },
      body: "Latest reply in second draft thread.",
      source: "human",
      createdAt: "2026-01-01T00:06:00.000Z",
      updatedAt: "2026-01-01T00:06:00.000Z",
    },
    {
      id: "draft-thread-a-root",
      path: "src/app.ts",
      viewerKind: "text",
      anchor: codeLineComment.anchor,
      body: "First draft thread root.",
      source: "human",
      createdAt: "2026-01-01T00:04:00.000Z",
      updatedAt: "2026-01-01T00:04:00.000Z",
    },
    {
      id: "draft-thread-b-root",
      path: "src/app.ts",
      viewerKind: "text",
      anchor: {
        ...codeLineComment.anchor,
        canonical: {
          ...codeLineComment.anchor.canonical,
          lineStart: 3,
          lineEnd: 3,
        },
      },
      body: "Second draft thread root.",
      source: "human",
      createdAt: "2026-01-01T00:05:00.000Z",
      updatedAt: "2026-01-01T00:05:00.000Z",
    },
  ];
  const inspector = Inspector({
    file: codeFile,
    reviewChanges: [],
    reviewItems: [
      {
        path: "src/app.ts",
        change: { path: "src/app.ts", status: "modified", source: "git" },
        threadCounts: { open: 0, resolved: 0, archived: 0 },
        commentCount: 0,
        pendingDraftCount: 4,
        pendingDraftIds: pendingDrafts.map((draft) => draft.id),
        unread: false,
      },
    ],
    reviewComments: [],
    draftComments: pendingDrafts,
    reviewDiffStats: {},
    loadingReviewDiffs: {},
    unreadReviewPaths: new Set(),
    selectedCodeRange: null,
    activePaneId: "main",
    onOpenEventPath: () => undefined,
    onConfirmEventPath: () => undefined,
    onOpenNextChanged: () => undefined,
    onOpenPreviousChanged: () => undefined,
    onOpenAllChanged: () => undefined,
    onRevealInTree: () => undefined,
  });
  const html = renderToStaticMarkup(inspector);

  expect(html.match(/review-thread-hairline-row/g)?.length).toBe(2);
  expect(html).not.toContain("Latest reply in first draft thread.");
  expect(html).not.toContain("Latest reply in second draft thread.");
  expect(html).toContain("Publish 2 pending in src/app.ts, L2");
  expect(html).toContain("Publish 2 pending in src/app.ts, L3");
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

it("keeps document outline out of the review inspector", () => {
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

  expect(html).toContain("Review");
  expect(html).not.toContain("In this file");
  expect(html).not.toContain("2 headings · Setup");
  expect(html).not.toContain('aria-label="Document outline"');
  expect(html).not.toContain('aria-current="location"');
  expect(html).not.toContain('class="h2 active"');
  expect(html).not.toContain("outline-level");
  expect(html).not.toContain(">H1</span>");
  expect(html).not.toContain(">H2</span>");
  expect(html).not.toContain("Current section");
});

it("keeps lightweight code symbols out of the review inspector", () => {
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

  expect(html).toContain("Review");
  expect(html).not.toContain("In this file");
  expect(html).not.toContain("1 symbol");
  expect(html).not.toContain('aria-label="Code symbols"');
  expect(html).not.toContain("export");
  expect(html).not.toContain("start");
  expect(html).not.toContain("L1");
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
    "Resolved threads stay in Comments history; archived threads are hidden from the browser UI.",
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

  expect(html).toContain(
    'aria-label="Review queue, 0 queued, 1 in review, 0 reviewed"',
  );
  expect(html).toContain("In Review");
  expect(html).toContain("Loading Git review");
  expect(html).toContain(
    "open comment threads may appear before changed files",
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
  expect(html).toContain("rendered-change-cards");
  expect(html).toContain("rendered-change-card changed");
  expect(html).toContain("Before · HEAD");
  expect(html).toContain("After · working tree");
  expect(html).toContain("source diff remains canonical");
  expect(html).toContain("Show source hunk");
  expect(html).toContain(
    'aria-label="Show source hunk for Changed rendered block line 1"',
  );
  expect(html).toContain(
    'aria-controls="rendered-change-source-changed-0-1-1"',
  );
  expect(html).toContain('id="rendered-change-source-changed-0-1-1"');
  expect(html).toContain('role="region"');
  expect(html).toContain('hidden="">');
  expect(html).not.toContain("rendered-change-source-row remove");
  expect(html).not.toContain("rendered-change-source-row add");
  expect(html).not.toContain("Focus changes");
  expect(html).not.toContain("diff-line-no");
  expect(html).not.toContain("rendered-diff-pane");
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

  expect(html).toContain("rendered-change-card changed");
  expect(html).toContain("Before · HEAD");
  expect(html).toContain("After · working tree");
  expect(html).toContain("<pre><code");
  expect(html).toContain("console.log(&#39;old&#39;)");
  expect(html).toContain("console.log(&#39;new&#39;)");
  expect(html).toContain("Show source hunk");
  expect(html).toContain(
    'aria-label="Show source hunk for Changed rendered block line 1-3"',
  );
  expect(html).toContain(
    'aria-controls="rendered-change-source-changed-0-1-3-1-3"',
  );
  expect(html).toContain('id="rendered-change-source-changed-0-1-3-1-3"');
  expect(html).toContain('role="region"');
  expect(html).not.toContain("rendered-change-source-row remove");
  expect(html).not.toContain("rendered-change-source-row add");
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
  expect(html).toContain("rendered-change-card added");
  expect(html).toContain("fuga");
  expect(html).toContain("src/ui -&gt; React SPA");
  expect(html).toContain("Show source hunk");
  expect(html).toContain(
    'aria-label="Show source hunk for Added rendered block line 1-5"',
  );
  expect(html).toContain('aria-controls="rendered-change-source-added-0-1-5"');
  expect(html).toContain('id="rendered-change-source-added-0-1-5"');
  expect(html).toContain('role="region"');
  expect(html).not.toContain("rendered-change-source-row add");
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

it("labels rendered diff comment markers from any line in the change card", () => {
  const resolvedRenderedComment: ViviComment = {
    ...codeLineComment,
    id: "rendered-card-resolved-root",
    threadId: "thread-rendered-card-resolved",
    path: "README.md",
    viewerKind: "markdown",
    status: "resolved",
    anchor: {
      surface: "rendered",
      canonical: {
        path: "README.md",
        lineStart: 3,
        lineEnd: 3,
        quote: "new second sentence",
      },
      rendered: {
        kind: "markdown",
        blockId: "paragraph-1",
        sourceLineStart: 2,
        sourceLineEnd: 3,
        textQuote: "New first sentence new second sentence",
      },
    },
    body: "Already checked",
  };
  const resolvedRenderedReply: ViviComment = {
    ...resolvedRenderedComment,
    id: "rendered-card-resolved-reply",
    body: "Follow-up is complete",
    createdAt: "2026-01-01T00:02:00.000Z",
    updatedAt: "2026-01-01T00:02:00.000Z",
  };
  const html = renderToStaticMarkup(
    <DiffViewer
      path="README.md"
      renderKind="markdown"
      comments={[resolvedRenderedComment, resolvedRenderedReply]}
      activeCommentId={resolvedRenderedReply.id}
      diff={{
        path: "README.md",
        status: "available",
        baseLabel: "HEAD",
        compareLabel: "working tree",
        content: [
          "@@ -1,4 +1,4 @@",
          " # Notes",
          "-Old first sentence",
          "-old second sentence",
          "+New first sentence",
          "+new second sentence",
          " trailing",
        ].join("\n"),
      }}
    />,
  );

  expect(html).toContain(
    'aria-label="Open resolved comment thread on line 3 with 2 messages"',
  );
  expect(html).toContain(
    'title="Open resolved comment thread on line 3 with 2 messages"',
  );
  expect(html).toContain('aria-expanded="true"');
  expect(html).toContain("Already checked");
  expect(html).toContain("Follow-up is complete");
  expect(html).toContain('data-comment-id="rendered-card-resolved-reply"');
});

it("keeps source-only comments out of rendered diff card markers", () => {
  const sourceOnlyComment: ViviComment = {
    ...codeLineComment,
    id: "source-only-rendered-card-line",
    threadId: "thread-source-only-rendered-card-line",
    path: "README.md",
    viewerKind: "markdown",
    anchor: {
      surface: "source",
      canonical: {
        path: "README.md",
        lineStart: 3,
        lineEnd: 3,
        quote: "new second sentence",
      },
    },
    body: "This source comment belongs to the source viewer, not the rendered diff card.",
  };
  const html = renderToStaticMarkup(
    <DiffViewer
      path="README.md"
      renderKind="markdown"
      comments={[sourceOnlyComment]}
      diff={{
        path: "README.md",
        status: "available",
        baseLabel: "HEAD",
        compareLabel: "working tree",
        content: [
          "@@ -1,4 +1,4 @@",
          " # Notes",
          "-Old first sentence",
          "-old second sentence",
          "+New first sentence",
          "+new second sentence",
          " trailing",
        ].join("\n"),
      }}
    />,
  );

  expect(html).toContain("rendered-change-card changed");
  expect(html).not.toContain("rendered-diff-comment-marker");
  expect(html).not.toContain(
    'data-comment-id="source-only-rendered-card-line"',
  );
});

it("shows old-side diff comments on removed rendered change cards", () => {
  const removedDiffComment: ViviComment = {
    ...codeLineComment,
    id: "rendered-removed-old-side",
    threadId: "thread-rendered-removed-old-side",
    path: "README.md",
    viewerKind: "markdown",
    anchor: {
      surface: "diff",
      canonical: {
        path: "README.md",
        lineStart: 3,
        lineEnd: 3,
        quote: "removed second sentence",
      },
      diff: {
        path: "README.md",
        base: "HEAD",
        ref: "working tree",
        hunkId: "@@ -2,2 +2,0 @@",
        side: "old",
        oldLineStart: 3,
        oldLineEnd: 3,
      },
    },
    body: "This removed sentence still needs review history.",
  };
  const html = renderToStaticMarkup(
    <DiffViewer
      path="README.md"
      renderKind="markdown"
      comments={[removedDiffComment]}
      activeCommentId={removedDiffComment.id}
      diff={{
        path: "README.md",
        status: "available",
        baseLabel: "HEAD",
        compareLabel: "working tree",
        content: [
          "@@ -2,2 +2,0 @@",
          "-Removed first sentence",
          "-removed second sentence",
        ].join("\n"),
      }}
    />,
  );

  expect(html).toContain("rendered-change-card removed has-comment");
  expect(html).toContain(
    'aria-label="Open comment thread on line 3 with 1 message"',
  );
  expect(html).toContain('aria-expanded="true"');
  expect(html).toContain("This removed sentence still needs review history.");
  expect(html).toContain('data-comment-id="rendered-removed-old-side"');
});

it("uses old-side diff anchors when canonical lines are missing", () => {
  const removedDiffComment: ViviComment = {
    ...codeLineComment,
    id: "rendered-removed-old-side-anchor",
    threadId: "thread-rendered-removed-old-side-anchor",
    path: "README.md",
    viewerKind: "markdown",
    anchor: {
      surface: "diff",
      canonical: {
        path: "README.md",
        quote: "removed second sentence",
      },
      diff: {
        path: "README.md",
        base: "HEAD",
        ref: "working tree",
        hunkId: "@@ -2,2 +2,0 @@",
        side: "old",
        oldLineStart: 3,
        oldLineEnd: 3,
      },
    },
    body: "Old-side anchor should survive without canonical line numbers.",
  };
  const html = renderToStaticMarkup(
    <DiffViewer
      path="README.md"
      renderKind="markdown"
      comments={[removedDiffComment]}
      activeCommentId={removedDiffComment.id}
      diff={{
        path: "README.md",
        status: "available",
        baseLabel: "HEAD",
        compareLabel: "working tree",
        content: [
          "@@ -2,2 +2,0 @@",
          "-Removed first sentence",
          "-removed second sentence",
        ].join("\n"),
      }}
    />,
  );

  expect(html).toContain("rendered-change-card removed has-comment");
  expect(html).toContain('data-comment-id="rendered-removed-old-side-anchor"');
});

it("keeps rendered comments out of old-side removed change cards", () => {
  const renderedComment: ViviComment = {
    ...codeLineComment,
    id: "rendered-comment-on-removed-line",
    threadId: "thread-rendered-comment-on-removed-line",
    path: "README.md",
    viewerKind: "markdown",
    anchor: {
      surface: "rendered",
      canonical: {
        path: "README.md",
        lineStart: 3,
        lineEnd: 3,
        quote: "removed second sentence",
      },
      rendered: {
        kind: "markdown",
        blockId: "paragraph-removed",
        sourceLineStart: 3,
        sourceLineEnd: 3,
        textQuote: "removed second sentence",
      },
    },
    body: "Rendered comments belong to the current rendered surface.",
  };
  const html = renderToStaticMarkup(
    <DiffViewer
      path="README.md"
      renderKind="markdown"
      comments={[renderedComment]}
      diff={{
        path: "README.md",
        status: "available",
        baseLabel: "HEAD",
        compareLabel: "working tree",
        content: [
          "@@ -2,2 +2,0 @@",
          "-Removed first sentence",
          "-removed second sentence",
        ].join("\n"),
      }}
    />,
  );

  expect(html).toContain("rendered-change-card removed");
  expect(html).not.toContain("rendered-change-card removed has-comment");
  expect(html).not.toContain(
    'data-comment-id="rendered-comment-on-removed-line"',
  );
});

it("preserves unified diff metadata for selected diff comment drafts", () => {
  const context = diffCommentContextForRange(
    {
      path: "README.md",
      status: "available",
      baseLabel: "HEAD",
      baseRef: "refs/heads/main",
      compareLabel: "working tree",
      diffHash: "sha256:diff",
      content: [
        "diff --git a/README.md b/README.md",
        "--- a/README.md",
        "+++ b/README.md",
        "@@ -10,1 +20,2 @@",
        "-old removed line",
        "+new line one",
        "+new line two",
      ].join("\n"),
    },
    20,
    21,
  );

  expect(context).toEqual({
    base: "refs/heads/main",
    ref: "working tree",
    hunkId: "@@ -10,1 +20,2 @@",
    diffHash: "sha256:diff",
  });
});

it("keeps rendered diff selection ranges across multiline change cards", () => {
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
          "@@ -1,4 +1,4 @@",
          " # Notes",
          "-Old first sentence",
          "-old second sentence",
          "+New first sentence",
          "+new second sentence",
          " trailing",
        ].join("\n"),
      }}
    />,
  );

  expect(html).toContain('data-current-line="2"');
  expect(html).toContain('data-current-line-end="3"');
  expect(
    renderedDiffSelectionLineRange([
      { dataset: { currentLine: "2", currentLineEnd: "3" } },
      { dataset: { currentLine: "7", currentLineEnd: "8" } },
    ]),
  ).toEqual({ start: 2, end: 8 });
});

it("labels terminal diff comment markers as reopenable", () => {
  const resolvedDiffComment: ViviComment = {
    ...codeLineComment,
    id: "diff-resolved-root",
    threadId: "thread-diff-resolved",
    status: "resolved",
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
    body: "Already resolved",
  };
  const resolvedReply: ViviComment = {
    ...resolvedDiffComment,
    id: "diff-resolved-reply",
    body: "Verification complete",
    createdAt: "2026-01-01T00:02:00.000Z",
    updatedAt: "2026-01-01T00:02:00.000Z",
  };
  const html = renderToStaticMarkup(
    <DiffViewer
      path="src/app.ts"
      renderKind="source"
      comments={[resolvedDiffComment, resolvedReply]}
      activeCommentId={resolvedDiffComment.id}
      diff={{
        path: "src/app.ts",
        status: "available",
        baseLabel: "HEAD",
        compareLabel: "working tree",
        content:
          "@@ -1,3 +1,3 @@\n export function start() {\n+  return true;\n }",
      }}
    />,
  );

  expect(html).toContain(
    'aria-label="Open resolved comment thread on line 2 with 2 messages"',
  );
  expect(html).toContain(
    'title="Open resolved comment thread on line 2 with 2 messages"',
  );
  expect(html).not.toContain(
    'aria-label="Open comment thread on line 2 with 2 messages"',
  );
});

it("prefers open diff comment threads when a line also has terminal history", () => {
  const resolvedDiffComment: ViviComment = {
    ...codeLineComment,
    id: "diff-resolved-root",
    threadId: "thread-diff-resolved",
    status: "resolved",
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
    body: "Resolved history",
  };
  const openDiffComment: ViviComment = {
    ...resolvedDiffComment,
    id: "diff-open-root",
    threadId: "thread-diff-open",
    status: "open",
    body: "Still needs attention",
    createdAt: "2026-01-01T00:03:00.000Z",
    updatedAt: "2026-01-01T00:03:00.000Z",
  };
  const html = renderToStaticMarkup(
    <DiffViewer
      path="src/app.ts"
      renderKind="source"
      comments={[resolvedDiffComment, openDiffComment]}
      diff={{
        path: "src/app.ts",
        status: "available",
        baseLabel: "HEAD",
        compareLabel: "working tree",
        content:
          "@@ -1,3 +1,3 @@\n export function start() {\n+  return true;\n }",
      }}
    />,
  );

  expect(html).toContain(
    'aria-label="Open comment thread on line 2 with 1 message"',
  );
  expect(html).toContain('data-comment-id="diff-open-root"');
  expect(html).not.toContain(
    'aria-label="Open resolved comment thread on line 2 with 1 message"',
  );
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

  expect(html).toContain("rendered-change-card changed");
  expect(html).toContain(
    'aria-label="Rendered change summary: 1 rendered change card, 1 changed, source diff remains canonical"',
  );
  expect(html).toContain("1 changed");
  expect(html).toContain("Before · HEAD");
  expect(html).toContain("After · working tree");
  expect(html).toContain("HTML diff line preview");
  expect(html).toContain("Show source hunk");
  expect(html).toContain(
    'aria-label="Show source hunk for Changed rendered block line 1-2"',
  );
  expect(html).toContain(
    'aria-controls="rendered-change-source-changed-0-1-2-1-2"',
  );
  expect(html).toContain('id="rendered-change-source-changed-0-1-2-1-2"');
  expect(html).toContain('role="region"');
  expect(html).not.toContain("rendered-change-source-row remove");
  expect(html).not.toContain("rendered-change-source-row add");
  expect(html).not.toContain("diff-line-no");
  expect(html).not.toContain("diff-inline-row");
});

it("shows rendered HTML comments on grouped change cards", () => {
  const htmlComment: ViviComment = {
    ...codeLineComment,
    id: "rendered-html-comment",
    threadId: "thread-rendered-html-comment",
    path: "index.html",
    viewerKind: "html",
    anchor: {
      surface: "rendered",
      canonical: {
        path: "index.html",
        lineStart: 7,
        lineEnd: 7,
        quote: "Approve local preview",
      },
      rendered: {
        kind: "html",
        blockId: "review-button",
        sourceLineStart: 7,
        sourceLineEnd: 7,
        textQuote: "Approve local preview",
      },
    },
    body: "The grouped HTML card should keep line 7 comments visible.",
  };
  const html = renderToStaticMarkup(
    <DiffViewer
      path="index.html"
      renderKind="html"
      comments={[htmlComment]}
      activeCommentId={htmlComment.id}
      diff={{
        path: "index.html",
        status: "available",
        baseLabel: "HEAD",
        compareLabel: "working tree",
        content: [
          "@@ -4,4 +4,5 @@",
          ' <main class="review-card">',
          "  <h1>Review Preview</h1>",
          "- <p>Comments map back to source blocks.</p>",
          "+ <p>Rendered HTML comments map back to source blocks.</p>",
          "+ <button>Approve local preview</button>",
          " </main>",
        ].join("\n"),
      }}
    />,
  );

  expect(html).toContain("Changed rendered block · line 6-7");
  expect(html).toContain("rendered-change-card changed has-comment");
  expect(html).toContain('aria-expanded="true"');
  expect(html).toContain(
    "The grouped HTML card should keep line 7 comments visible.",
  );
});

it("groups consecutive rendered HTML diff rows", () => {
  expect(
    buildRenderedHtmlRows([
      { kind: "remove", lineLabel: "1", source: "<h1>Old</h1>" },
      { kind: "remove", lineLabel: "2", source: "<p>Before</p>" },
      { kind: "add", lineLabel: "1", source: "<h1>New</h1>" },
    ]),
  ).toEqual([
    {
      kind: "remove",
      lineLabel: "1-2",
      source: "<h1>Old</h1>\n<p>Before</p>",
    },
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
  expect(html).toContain(">Resolve</button>");
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
  expect(html).toContain('role="region"');
  expect(html).toContain(
    'aria-label="Scrollable CSV table for reports/results.csv"',
  );
  expect(html).toContain('tabindex="0"');
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

  expect(html).toContain('role="tree"');
  expect(html).toContain(
    'aria-label="Live workspace map, 1 root entry, 3 loaded files, 2 review files, 2 unread review files, 2 open files, 2 open threads, 3 comments"',
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
  expect(html).toContain(
    "current review.md · 2 attention · 2 open threads · 2 review files · 2 open tabs",
  );
  expect(html).toContain(
    "attention · 2 open threads · review · changed · open tab",
  );
  expect(html).toContain("attention · current stop · review");
  expect(html).toContain(
    'aria-label="docs, folder, expanded, contains selected file, contains current review stop review.md, 2 open files, 2 review files, 2 unread review files, 2 open threads, 3 comments"',
  );
  expect(html).toContain(
    'aria-label="brief.md, file, selected, changed, review file, unread review activity, open in tab, 2 open threads, 3 comments"',
  );
  expect(html).toContain(
    'aria-label="review.md, file, review file, unread review activity, current review stop"',
  );
  expect(html).toContain(
    'title="Click to preview; double-click to keep open as a tab"',
  );
  expect(html).toContain('tabindex="0"');
  expect(html).toContain(">now</span>");
  expect(html).toContain('title="2 attention items"');
  expect(html).toContain(">!</span>");
  expect(html).toContain(">2</span>");
  expect(html).toContain(">rev 2</span>");
  expect(html).toContain("open");
  expect(html).toContain("2 open threads");
  expect(html).toContain("changed");
  expect(html).toContain(">mod</span>");
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
    'aria-label="docs, folder, expanded, next review stop brief.md, 2 review files, 1 unread review file, 1 open thread"',
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
