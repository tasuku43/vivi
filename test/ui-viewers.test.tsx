import { Children, isValidElement } from "react";
import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import type { ViviComment } from "../ui/src/domain/comments.js";
import type { FilePayload } from "../ui/src/domain/fs-node.js";
import { CodeCommentThread } from "../ui/src/features/comments/components/CodeCommentThread.js";
import { FileViewer } from "../ui/src/features/file-context/components/FileViewer.js";
import { Inspector } from "../ui/src/features/review-queue/Inspector.js";
import { ShortcutHelp } from "../ui/src/shared/components/ShortcutHelp.js";
import {
  Topbar,
  workspaceDisplayName,
  workspaceParentPath,
} from "../ui/src/shared/components/Topbar.js";
import { TreeSidebar } from "../ui/src/shared/components/TreeSidebar.js";
import { WorkspaceRestoreNotice } from "../ui/src/shared/components/WorkspaceRestoreNotice.js";
import {
  CodeViewer,
  extractHighlightedLines,
} from "../ui/src/features/file-context/viewers/CodeViewer.js";
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
import type { CommentDraft } from "../ui/src/state/comments.js";

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
  expect(html).toContain('aria-label="Keyboard shortcuts"');
});

it("summarizes workspace paths for compact topbar display", () => {
  expect(workspaceDisplayName("/Users/tasuku/work/vivi/")).toBe("vivi");
  expect(workspaceParentPath("/Users/tasuku/work/vivi/")).toBe(
    "/Users/tasuku/work",
  );
  expect(workspaceDisplayName(null)).toBe("Local viewer");
  expect(workspaceParentPath(null)).toBe("Waiting for workspace");
});

it("renders the shortcut guide as one bundled reference", () => {
  const html = renderToStaticMarkup(
    <ShortcutHelp open={true} onClose={() => undefined} />,
  );

  expect(html).toContain('aria-label="Keyboard shortcuts"');
  expect(html).toContain("Cmd W");
  expect(html).toContain("Cmd Shift U");
  expect(html).toContain("Cmd /");
  expect(html).toContain("Command palette");
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
  expect(html).toContain('class="code-line selected selection-start"');
  expect(html).toContain('class="code-line selected selection-end"');
  expect(html).toContain('aria-label="Select line 1"');
  expect(html).toContain("Copy ref");
  expect(html).toContain("Copy range");
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
  expect(html).toContain('aria-label="Open comment thread on line 2"');
  expect(html).toContain('aria-label="Add comment on line 1"');
  expect(html).toContain('aria-label="Comment thread for line 2"');
  expect(html).toContain("2 comments");
  expect(html.indexOf("Check this return")).toBeLessThan(
    html.indexOf("Agreed, keep it explicit"),
  );
  expect(html).toContain('placeholder="Reply to thread"');
  expect(html).toContain('aria-label="Add reply"');
  expect(html).not.toContain(">Comment<");
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
  expect(html).toContain('aria-label="Open comment thread on line 3"');
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

  expect(html).toContain('aria-label="Open comment thread on line 3"');
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

it("keeps non-text large files in the safe unsupported state", () => {
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

  expect(html).toContain("larger than the");
  expect(html).not.toContain("partial preview");
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

it("keeps the HTML viewer sandboxed and exposes source mode controls", () => {
  const html = renderToStaticMarkup(
    <HtmlViewer
      file={{ ...codeFile, path: "index.html", viewerKind: "html" }}
      allowHtmlScripts={false}
    />,
  );

  expect(html).toContain("sandboxed · scripts off");
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

it("renders the Review Queue before secondary file helpers in the inspector", () => {
  const html = renderToStaticMarkup(
    <Inspector
      file={codeFile}
      outline={[]}
      reviewChanges={[
        { path: "src/app.ts", status: "modified", source: "git" },
        {
          path: "docs/new.md",
          originalPath: "docs/old.md",
          status: "renamed",
          source: "watcher",
        },
      ]}
      reviewDiffStats={{
        "src/app.ts": { additions: 100, deletions: 32 },
        "docs/new.md": { additions: 4, deletions: 2 },
      }}
      loadingReviewDiffs={{}}
      unreadReviewPaths={new Set(["src/app.ts"])}
      selectedCodeRange={{ start: 2, end: 2 }}
      activePaneId="main"
      onOutlineSelect={() => undefined}
      onOpenEventPath={() => undefined}
      onConfirmEventPath={() => undefined}
      onOpenNextChanged={() => undefined}
      onOpenPreviousChanged={() => undefined}
      onOpenAllChanged={() => undefined}
      onTargetHoverChange={() => undefined}
      onRevealTarget={() => undefined}
      onRevealInTree={() => undefined}
    />,
  );

  expect(html).toContain("Review Queue");
  expect(html.indexOf("Review Queue")).toBeLessThan(
    html.indexOf("In this file"),
  );
  expect(html).toContain("Open next");
  expect(html).toContain("Open previous");
  expect(html).toContain("src/app.ts:2");
  expect(html).toContain("export");
  expect(html).toContain("start");
  expect(html).toContain("+100");
  expect(html).toContain("-32");
  expect(html).toContain("app.ts");
  expect(html).toContain("docs/old.md -&gt; docs/new.md");
  expect(html).toContain("HEAD diff");
  expect(html).toContain("local change");
  expect(html).toContain("modified");
  expect(html).toContain("renamed");
  expect(html).toContain("Details");
  expect(html.indexOf("Review Queue")).toBeLessThan(html.indexOf("Details"));
  expect(html).toContain("Open all changed files as tabs");
  expect(html).not.toContain("Recent events");
  expect(html).not.toContain("Diff</button>");
  expect(html).not.toContain("Review targets");
  expect(html).not.toContain("Changed files");
  expect(html).not.toContain("Diff preview");
});

it("opens Review Queue rows as preview on click and stable tabs on double click", () => {
  const calls: string[] = [];
  const inspector = Inspector({
    file: codeFile,
    outline: [],
    reviewChanges: [{ path: "src/app.ts", status: "modified", source: "git" }],
    reviewDiffStats: {},
    loadingReviewDiffs: {},
    unreadReviewPaths: new Set(),
    selectedCodeRange: null,
    activePaneId: "main",
    onOutlineSelect: () => undefined,
    onOpenEventPath: (path) => calls.push(`preview:${path}`),
    onConfirmEventPath: (path) => calls.push(`normal:${path}`),
    onOpenNextChanged: () => undefined,
    onOpenPreviousChanged: () => undefined,
    onOpenAllChanged: () => undefined,
    onTargetHoverChange: () => undefined,
    onRevealTarget: () => undefined,
    onRevealInTree: () => undefined,
  });

  const button = findElement(inspector, (element) => {
    const props = element.props as { className?: string; children?: ReactNode };
    return (
      props.className === "change-open" &&
      flattenText(props.children).includes("src/app.ts")
    );
  });
  const props = button.props as {
    onClick: () => void;
    onDoubleClick: () => void;
    title: string;
  };

  props.onClick();
  props.onDoubleClick();

  expect(props.title).toBe("Double-click to keep open as a tab");
  expect(calls).toEqual(["preview:src/app.ts", "normal:src/app.ts"]);
});

it("reveals the active file in the tree through an explicit inspector action", () => {
  const calls: string[] = [];
  const inspector = Inspector({
    file: codeFile,
    outline: [],
    reviewChanges: [],
    reviewDiffStats: {},
    loadingReviewDiffs: {},
    unreadReviewPaths: new Set(),
    selectedCodeRange: null,
    activePaneId: "main",
    onOutlineSelect: () => undefined,
    onOpenEventPath: () => undefined,
    onConfirmEventPath: () => undefined,
    onOpenNextChanged: () => undefined,
    onOpenPreviousChanged: () => undefined,
    onOpenAllChanged: () => undefined,
    onTargetHoverChange: () => undefined,
    onRevealTarget: () => undefined,
    onRevealInTree: () => calls.push("reveal"),
  });

  const button = findElement(inspector, (element) => {
    const props = element.props as { className?: string; children?: ReactNode };
    return (
      props.className === "secondary-action inline-action" &&
      flattenText(props.children).includes("Show in Explorer")
    );
  });
  const props = button.props as { onClick: () => void };

  props.onClick();

  expect(calls).toEqual(["reveal"]);
});

it("keeps Markdown and HTML outline available as In this file", () => {
  const html = renderToStaticMarkup(
    <Inspector
      file={{ ...codeFile, path: "README.md", viewerKind: "markdown" }}
      outline={[
        { id: "title", level: 1, text: "Title" },
        { id: "setup", level: 2, text: "Setup" },
      ]}
      reviewChanges={[]}
      reviewDiffStats={{}}
      loadingReviewDiffs={{}}
      unreadReviewPaths={new Set()}
      selectedCodeRange={null}
      activePaneId="main"
      onOutlineSelect={() => undefined}
      onOpenEventPath={() => undefined}
      onConfirmEventPath={() => undefined}
      onOpenNextChanged={() => undefined}
      onOpenPreviousChanged={() => undefined}
      onOpenAllChanged={() => undefined}
      onTargetHoverChange={() => undefined}
      onRevealTarget={() => undefined}
      onRevealInTree={() => undefined}
    />,
  );

  expect(html).toContain("No files to review.");
  expect(html).toContain("In this file");
  expect(html).toContain("Title");
  expect(html).toContain("Setup");
  expect(html).not.toContain("Document outline");
});

it("shows why the Review Queue is unavailable instead of looking empty", () => {
  const html = renderToStaticMarkup(
    <Inspector
      file={null}
      outline={[]}
      reviewChanges={[]}
      reviewUnavailableReason="Git command timed out while reading this workspace."
      reviewDiffStats={{}}
      loadingReviewDiffs={{}}
      unreadReviewPaths={new Set()}
      selectedCodeRange={null}
      activePaneId="main"
      onOutlineSelect={() => undefined}
      onOpenEventPath={() => undefined}
      onConfirmEventPath={() => undefined}
      onOpenNextChanged={() => undefined}
      onOpenPreviousChanged={() => undefined}
      onOpenAllChanged={() => undefined}
      onTargetHoverChange={() => undefined}
      onRevealTarget={() => undefined}
      onRevealInTree={() => undefined}
    />,
  );

  expect(html).toContain("Git review unavailable");
  expect(html).toContain("Git command timed out while reading this workspace.");
  expect(html).not.toContain("No files to review.");
});

it("shows partial Review Queue results as a warning", () => {
  const html = renderToStaticMarkup(
    <Inspector
      file={null}
      outline={[]}
      reviewChanges={[{ path: "README.md", status: "modified", source: "git" }]}
      reviewUnavailableReason="Git untracked scan timed out; showing tracked changes only."
      reviewDiffStats={{}}
      loadingReviewDiffs={{}}
      unreadReviewPaths={new Set()}
      selectedCodeRange={null}
      activePaneId="main"
      onOutlineSelect={() => undefined}
      onOpenEventPath={() => undefined}
      onConfirmEventPath={() => undefined}
      onOpenNextChanged={() => undefined}
      onOpenPreviousChanged={() => undefined}
      onOpenAllChanged={() => undefined}
      onTargetHoverChange={() => undefined}
      onRevealTarget={() => undefined}
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
  expect(html).toContain("Focus changes");
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
