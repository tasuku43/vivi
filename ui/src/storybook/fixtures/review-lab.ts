import type { TextDiff } from "../../domain/change-review.js";
import type {
  CommentActor,
  CommentThreadActivityEvent,
  DraftReviewComment,
  PublishedReviewBatch,
  ViviComment,
} from "../../domain/comments.js";
import type {
  FilePayload,
  FsNode,
  TreeSnapshot,
} from "../../domain/fs-node.js";
import type { ReviewChangeItem } from "../../state/git-review.js";
import { buildDiffStat, type DiffStat } from "../../state/git-review.js";
import {
  summarizeThreadActivity,
  type CommentActivitySummary,
} from "../../state/comment-activity.js";
import {
  buildReviewQueueItems,
  type ReviewQueueItem,
} from "../../state/review-queue.js";
import type { OpenTab } from "../../state/tabs.js";

export const storyNow = new Date("2026-06-20T09:30:00.000Z").getTime();
export const storyRoot = "/Users/tasuku/work/github.com/tasuku43/vivi";

export const humanTasuku: CommentActor = {
  id: "human:tasuku",
  kind: "human",
  displayName: "Tasuku",
};

export const codexAgent: CommentActor = {
  id: "codex:run-42",
  kind: "codex",
  displayName: "Codex",
};

export const claudeAgent: CommentActor = {
  id: "claude-code:run-7",
  kind: "claude-code",
  displayName: "Claude Code",
};

export const sampleWorkspaceTree: TreeSnapshot = {
  root: storyRoot,
  version: 42,
  nodes: [
    dir("docs", [
      fileNode("docs/product-review.md", "markdown", 7_642),
      fileNode("docs/review-queue.md", "markdown", 3_128),
      fileNode("docs/agent-handoff.md", "markdown", 2_401),
    ]),
    dir("ui", [
      dir("ui/src", [
        dir("ui/src/features", [
          dir("ui/src/features/workbench", [
            fileNode(
              "ui/src/features/workbench/WorkbenchContainer.tsx",
              "code",
              17_826,
            ),
            fileNode(
              "ui/src/features/workbench/WorkbenchView.tsx",
              "code",
              712,
            ),
          ]),
          dir("ui/src/features/comments", [
            fileNode(
              "ui/src/features/comments/components/CommentsPanel.tsx",
              "code",
              4_120,
            ),
            fileNode(
              "ui/src/features/comments/components/DraftReviewTray.tsx",
              "code",
              3_944,
            ),
          ]),
          dir("ui/src/features/file-context", [
            fileNode(
              "ui/src/features/file-context/viewers/DiffViewer.tsx",
              "code",
              15_201,
            ),
            fileNode(
              "ui/src/features/file-context/viewers/MarkdownViewer.tsx",
              "code",
              11_406,
            ),
            fileNode(
              "ui/src/features/file-context/viewers/HtmlViewer.tsx",
              "code",
              8_418,
            ),
          ]),
        ]),
        dir("ui/src/storybook", [
          fileNode("ui/src/storybook/fixtures/review-lab.ts", "code", 8_000),
        ]),
      ]),
    ]),
    dir("server", [
      fileNode("server/comments/comments.go", "code", 19_014),
      fileNode("server/graphql/schema.graphqls", "text", 6_421),
    ]),
    fileNode("README.md", "markdown", 4_502),
    fileNode("review-preview.html", "html", 2_860),
  ],
  stats: {
    durationMs: 14,
    scannedDirectories: 18,
    scannedFiles: 43,
    returnedNodes: 19,
  },
};

export const sampleCodeFile = filePayload(
  "ui/src/features/workbench/WorkbenchContainer.tsx",
  "code",
  [
    'import { useMemo, useState } from "react";',
    'import { FileViewer } from "../file-context/components/FileViewer.js";',
    "",
    "export function WorkbenchContainer() {",
    "  const [commentsPanelOpen, setCommentsPanelOpen] = useState(false);",
    "  const [draftComments, setDraftComments] = useState([]);",
    "  const reviewItems = useMemo(() => buildReviewQueueItems(), []);",
    "",
    "  function publishDraftReviewComments() {",
    "    return client.publishDraftReviewComments({",
    '      actor: { id: "human:tasuku", kind: "human" },',
    "    });",
    "  }",
    "",
    "  return <FileViewer comments={comments} />;",
    "}",
  ].join("\n"),
);

export const sampleMarkdownFile = filePayload(
  "docs/product-review.md",
  "markdown",
  [
    "# Review Surface",
    "",
    "Vivi keeps the human review surface close to the files that changed.",
    "",
    "## Feedback layer",
    "",
    "Comment threads are the shared contract between the browser UI and coding agents.",
    "",
    "## Draft review comments",
    "",
    "Draft comments stay private until the reviewer publishes a batch.",
    "",
    "## Agent loop",
    "",
    "Agents read open threads, reply with context, and mark threads when resolved.",
  ].join("\n"),
);

export const sampleHtmlFile = filePayload(
  "review-preview.html",
  "html",
  [
    "<!doctype html>",
    "<html>",
    "  <head><title>Review Preview</title></head>",
    "  <body>",
    '    <main class="review-card">',
    "      <h1>Review Preview</h1>",
    "      <p>Rendered HTML comments map back to source blocks.</p>",
    "      <button>Approve local preview</button>",
    "    </main>",
    "  </body>",
    "</html>",
  ].join("\n"),
);

export const sampleQueueFile = filePayload(
  "docs/review-queue.md",
  "markdown",
  [
    "# Review Queue",
    "",
    "Files with open threads rise to the top of the queue.",
    "",
    "## Latest activity",
    "",
    "Unread agent replies should be visible without opening every file.",
  ].join("\n"),
);

export const sampleJsonFile = filePayload(
  "reports/summary.json",
  "json",
  JSON.stringify(
    {
      status: "ok",
      generatedBy: "agent",
      checks: ["format", "typecheck", "unit"],
    },
    null,
    2,
  ),
);

export const sampleCsvFile = filePayload(
  "reports/results.csv",
  "text",
  ["name,status,durationMs", "format,pass,320", "typecheck,pass,1180"].join(
    "\n",
  ),
);

export const sampleMermaidFile = filePayload(
  "docs/review-flow.mmd",
  "mermaid",
  ["flowchart LR", "  Agent --> Vivi", "  Vivi --> Reviewer"].join("\n"),
);

export const sampleUnknownTextFile = filePayload(
  "agent-output",
  "text",
  ["status=ok", "next=human-review", "fallback=generic-text"].join("\n"),
);

export const sampleLargeTextFile: FilePayload = {
  ...filePayload(
    "logs/agent-run.log",
    "text",
    ["[start] agent run", "[info] writing generated files"].join("\n"),
  ),
  size: 2_400_000,
  truncated: true,
  maxSizeBytes: 1_048_576,
  previewBytes: 46,
};

export const sampleBinaryFile: FilePayload = {
  path: "agent-cache",
  viewerKind: "binary",
  encoding: "none",
  content: "",
  etag: "sha256:binary-story",
  size: 4096,
  mtimeMs: new Date("2026-06-20T09:00:00.000Z").getTime(),
  mimeType: "application/octet-stream",
};

export const sampleLargeBinaryFile: FilePayload = {
  ...sampleBinaryFile,
  path: "dist/archive.zip",
  etag: "mtime:story:size:4200000",
  size: 4_200_000,
  truncated: true,
  maxSizeBytes: 1_048_576,
};

export const sampleImageFile: FilePayload = {
  path: "assets/vivi-badge.svg",
  viewerKind: "image",
  encoding: "base64",
  content:
    "PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxNjAiIGhlaWdodD0iOTAiIHZpZXdCb3g9IjAgMCAxNjAgOTAiPjxyZWN0IHdpZHRoPSIxNjAiIGhlaWdodD0iOTAiIGZpbGw9IiNmOGZhZmMiLz48cmVjdCB4PSIxOCIgeT0iMTgiIHdpZHRoPSIxMjQiIGhlaWdodD0iNTQiIHJ4PSI4IiBmaWxsPSIjMGYxNzJhIi8+PHRleHQgeD0iODAiIHk9IjUyIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LWZhbWlseT0ibW9ub3NwYWNlIiBmb250LXNpemU9IjIwIiBmaWxsPSIjZmZmIj52aXZpPC90ZXh0Pjwvc3ZnPg==",
  etag: "sha256:image-story",
  size: 358,
  mtimeMs: new Date("2026-06-20T09:00:00.000Z").getTime(),
  mimeType: "image/svg+xml",
};

export const sampleFiles = {
  code: sampleCodeFile,
  markdown: sampleMarkdownFile,
  html: sampleHtmlFile,
  queue: sampleQueueFile,
  json: sampleJsonFile,
  csv: sampleCsvFile,
  mermaid: sampleMermaidFile,
  unknownText: sampleUnknownTextFile,
  largeText: sampleLargeTextFile,
  binary: sampleBinaryFile,
  largeBinary: sampleLargeBinaryFile,
  image: sampleImageFile,
};

export const sampleDiff: TextDiff = {
  path: sampleCodeFile.path,
  status: "available",
  baseLabel: "HEAD",
  baseRef: "HEAD",
  compareLabel: "working tree",
  diffHash: "diff-workbench-42",
  content: [
    "diff --git a/ui/src/features/workbench/WorkbenchContainer.tsx b/ui/src/features/workbench/WorkbenchContainer.tsx",
    "index 1010101..2020202 100644",
    "--- a/ui/src/features/workbench/WorkbenchContainer.tsx",
    "+++ b/ui/src/features/workbench/WorkbenchContainer.tsx",
    "@@ -4,8 +4,12 @@ export function WorkbenchContainer() {",
    "   const [commentsPanelOpen, setCommentsPanelOpen] = useState(false);",
    "-  const [draftComments, setDraftComments] = useState([]);",
    "+  const [draftComments, setDraftComments] = useState<DraftReviewComment[]>([]);",
    "+  const [draftPublishing, setDraftPublishing] = useState(false);",
    "   const reviewItems = useMemo(() => buildReviewQueueItems(), []);",
    " ",
    "+  function publishDraftReviewComments() {",
    "+    return client.publishDraftReviewComments({ actor: humanTasuku });",
    "+  }",
    "   return <FileViewer comments={comments} />;",
    " }",
  ].join("\n"),
};

export const markdownDiff: TextDiff = {
  path: sampleMarkdownFile.path,
  status: "available",
  baseLabel: "HEAD",
  baseRef: "HEAD",
  compareLabel: "working tree",
  diffHash: "diff-markdown-42",
  content: [
    "diff --git a/docs/product-review.md b/docs/product-review.md",
    "index 3030303..4040404 100644",
    "--- a/docs/product-review.md",
    "+++ b/docs/product-review.md",
    "@@ -1,8 +1,12 @@",
    " # Review Surface",
    " ",
    "-Vivi keeps review comments near files.",
    "+Vivi keeps the human review surface close to the files that changed.",
    " ",
    " ## Feedback layer",
    " ",
    "+Comment threads are the shared contract between the browser UI and coding agents.",
    "+",
    " ## Draft review comments",
  ].join("\n"),
};

export const htmlDiff: TextDiff = {
  path: sampleHtmlFile.path,
  status: "available",
  baseLabel: "HEAD",
  compareLabel: "working tree",
  diffHash: "diff-html-42",
  content: [
    "diff --git a/review-preview.html b/review-preview.html",
    "--- a/review-preview.html",
    "+++ b/review-preview.html",
    "@@ -4,6 +4,7 @@",
    '     <main class="review-card">',
    "       <h1>Review Preview</h1>",
    "-      <p>Comments map back to source blocks.</p>",
    "+      <p>Rendered HTML comments map back to source blocks.</p>",
    "+      <button>Approve local preview</button>",
    "     </main>",
  ].join("\n"),
};

export const sampleReviewChanges: ReviewChangeItem[] = [
  { path: sampleCodeFile.path, status: "modified", source: "git" },
  { path: sampleMarkdownFile.path, status: "modified", source: "git" },
  { path: sampleHtmlFile.path, status: "added", source: "git" },
  { path: "docs/agent-handoff.md", status: "modified", source: "git" },
  { path: "server/comments/comments.go", status: "modified", source: "git" },
  { path: "server/graphql/schema.graphqls", status: "modified", source: "git" },
];

export const sampleComments: ViviComment[] = [
  sourceComment({
    id: "comment-workbench-open-1",
    threadId: "thread-workbench-open",
    path: sampleCodeFile.path,
    viewerKind: "text",
    lineStart: 9,
    lineEnd: 12,
    quote: "function publishDraftReviewComments()",
    body: "Please keep publish failures visible in the statusbar and draft tray.",
    source: "human",
    createdBy: humanTasuku,
  }),
  sourceComment({
    id: "comment-workbench-agent-1",
    threadId: "thread-workbench-open",
    path: sampleCodeFile.path,
    viewerKind: "text",
    lineStart: 9,
    lineEnd: 12,
    quote: "function publishDraftReviewComments()",
    body: "I added the publishing flag and kept the draft list intact until the mutation succeeds.",
    source: "codex",
    createdBy: codexAgent,
    createdAt: "2026-06-20T09:12:00.000Z",
    updatedAt: "2026-06-20T09:12:00.000Z",
  }),
  diffComment({
    id: "comment-diff-added",
    threadId: "thread-diff-added",
    lineStart: 10,
    lineEnd: 10,
    body: "Added-line comments should pin to the new side of the diff.",
    quote: "const [draftPublishing, setDraftPublishing] = useState(false);",
  }),
  diffComment({
    id: "comment-diff-removed",
    threadId: "thread-diff-removed",
    lineStart: 5,
    lineEnd: 5,
    side: "old",
    body: "Removed-line feedback is represented in fixtures even though the current inline affordance is new-line focused.",
    quote: "const [draftComments, setDraftComments] = useState([]);",
  }),
  renderedComment({
    id: "comment-md-rendered",
    threadId: "thread-md-rendered",
    path: sampleMarkdownFile.path,
    viewerKind: "markdown",
    kind: "markdown",
    lineStart: 7,
    lineEnd: 7,
    blockId: "p-2",
    selector: "p:nth-of-type(2)",
    textQuote: "Comment threads are the shared contract",
    body: "This sentence captures the feedback layer well; keep it visible in the inspector outline story.",
    reviewBatchId: "review-batch-story-001",
  }),
  renderedComment({
    id: "comment-html-rendered",
    threadId: "thread-html-rendered",
    path: sampleHtmlFile.path,
    viewerKind: "html",
    kind: "html",
    lineStart: 7,
    lineEnd: 7,
    blockId: "html-p-1",
    selector: ".review-card p",
    textQuote: "Rendered HTML comments map back to source blocks.",
    body: "HTML rendered comments should be visible as source-mapped review metadata.",
    reviewBatchId: "review-batch-story-001",
  }),
  sourceComment({
    id: "comment-resolved",
    threadId: "thread-resolved",
    path: "docs/agent-handoff.md",
    viewerKind: "markdown",
    lineStart: 4,
    lineEnd: 5,
    quote: "handoff",
    body: "Resolved after the agent added the comments watch example.",
    status: "resolved",
    source: "human",
    createdBy: humanTasuku,
    resolvedAt: "2026-06-20T09:05:00.000Z",
  }),
  sourceComment({
    id: "comment-archived",
    threadId: "thread-archived",
    path: "server/comments/comments.go",
    viewerKind: "text",
    lineStart: 28,
    lineEnd: 30,
    quote: "appendThreadEvent",
    body: "Archived legacy implementation note.",
    status: "archived",
    source: "human",
    createdBy: humanTasuku,
    archivedAt: "2026-06-20T08:50:00.000Z",
  }),
];

export const sampleDraftComments: DraftReviewComment[] = [
  draftComment({
    id: "draft-review-1",
    path: sampleCodeFile.path,
    viewerKind: "text",
    lineStart: 6,
    lineEnd: 6,
    quote: "const [draftComments, setDraftComments] = useState([]);",
    body: "Type this draft state with DraftReviewComment[] before publish.",
  }),
  draftComment({
    id: "draft-review-2",
    path: sampleMarkdownFile.path,
    viewerKind: "markdown",
    lineStart: 11,
    lineEnd: 11,
    quote: "Draft comments stay private until the reviewer publishes a batch.",
    body: "This is the right place to explain that drafts are hidden from agents.",
  }),
  {
    ...draftComment({
      id: "draft-review-diff",
      path: sampleCodeFile.path,
      viewerKind: "text",
      lineStart: 10,
      lineEnd: 10,
      quote: "const [draftPublishing, setDraftPublishing] = useState(false);",
      body: "Draft marker on an added diff line, ready for batch publish.",
    }),
    anchor: {
      surface: "diff",
      canonical: {
        path: sampleCodeFile.path,
        lineStart: 10,
        lineEnd: 10,
        quote: "const [draftPublishing, setDraftPublishing] = useState(false);",
        fileHash: sampleCodeFile.etag,
      },
      diff: {
        path: sampleCodeFile.path,
        base: "HEAD",
        ref: "working tree",
        hunkId: "@@ -4,8 +4,12 @@",
        side: "new",
        newLineStart: 10,
        newLineEnd: 10,
        diffHash: sampleDiff.diffHash,
        fileHash: sampleCodeFile.etag,
        changeKind: "added",
      },
    },
  },
  {
    ...draftComment({
      id: "draft-review-md-rendered",
      path: sampleMarkdownFile.path,
      viewerKind: "markdown",
      lineStart: 11,
      lineEnd: 11,
      quote: "Draft comments stay private until the reviewer publishes a batch.",
      body: "Rendered Markdown draft anchored to the H2 paragraph before publish.",
    }),
    anchor: {
      surface: "rendered",
      canonical: {
        path: sampleMarkdownFile.path,
        lineStart: 11,
        lineEnd: 11,
        quote: "Draft comments stay private until the reviewer publishes a batch.",
        fileHash: sampleMarkdownFile.etag,
      },
      rendered: {
        kind: "markdown",
        blockId: "p-draft-review",
        selector: "p:nth-of-type(3)",
        textQuote:
          "Draft comments stay private until the reviewer publishes a batch.",
        sourceLineStart: 11,
        sourceLineEnd: 11,
      },
    },
  },
  {
    ...draftComment({
      id: "draft-review-html-rendered",
      path: sampleHtmlFile.path,
      viewerKind: "html",
      lineStart: 7,
      lineEnd: 7,
      quote: "Rendered HTML comments map back to source blocks.",
      body: "Rendered HTML draft should stay private in the tray until publish.",
    }),
    anchor: {
      surface: "rendered",
      canonical: {
        path: sampleHtmlFile.path,
        lineStart: 7,
        lineEnd: 7,
        quote: "Rendered HTML comments map back to source blocks.",
        fileHash: sampleHtmlFile.etag,
      },
      rendered: {
        kind: "html",
        blockId: "html-p-draft",
        selector: ".review-card p",
        textQuote: "Rendered HTML comments map back to source blocks.",
        sourceLineStart: 7,
        sourceLineEnd: 7,
      },
    },
  },
  {
    ...draftComment({
      id: "draft-review-html-diff",
      path: sampleHtmlFile.path,
      viewerKind: "html",
      lineStart: 7,
      lineEnd: 7,
      quote: "Rendered HTML comments map back to source blocks.",
      body: "HTML diff draft on the new preview paragraph.",
    }),
    anchor: {
      surface: "diff",
      canonical: {
        path: sampleHtmlFile.path,
        lineStart: 7,
        lineEnd: 7,
        quote: "Rendered HTML comments map back to source blocks.",
        fileHash: sampleHtmlFile.etag,
      },
      diff: {
        path: sampleHtmlFile.path,
        base: "HEAD",
        ref: "working tree",
        hunkId: "@@ -4,6 +4,7 @@",
        side: "new",
        newLineStart: 7,
        newLineEnd: 7,
        diffHash: htmlDiff.diffHash,
        fileHash: sampleHtmlFile.etag,
        changeKind: "added",
      },
    },
  },
];

export const manyDraftReviewComments: DraftReviewComment[] = [
  ...sampleDraftComments,
  ...Array.from({ length: 16 }, (_, index) =>
    draftComment({
      id: `draft-review-many-${index + 1}`,
      path:
        index % 3 === 0
          ? sampleCodeFile.path
          : index % 3 === 1
            ? sampleMarkdownFile.path
            : sampleHtmlFile.path,
      viewerKind:
        index % 3 === 0 ? "text" : index % 3 === 1 ? "markdown" : "html",
      lineStart: 3 + index,
      lineEnd: 3 + index,
      quote: `draft review fixture ${index + 1}`,
      body: `Queued draft review comment ${index + 1} for tray density checks.`,
    }),
  ),
];

export const samplePublishedReviewBatch: PublishedReviewBatch = {
  reviewBatchId: "review-batch-story-001",
  publishedAt: "2026-06-20T09:14:00.000Z",
  threads: [
    {
      id: "thread-md-rendered",
      path: sampleMarkdownFile.path,
      status: "open",
      reviewBatchId: "review-batch-story-001",
      anchor: sampleComments[4]!.anchor,
      createdAt: "2026-06-20T09:14:00.000Z",
      updatedAt: "2026-06-20T09:14:00.000Z",
      comments: [sampleComments[4]!],
    },
    {
      id: "thread-html-rendered",
      path: sampleHtmlFile.path,
      status: "open",
      reviewBatchId: "review-batch-story-001",
      anchor: sampleComments[5]!.anchor,
      createdAt: "2026-06-20T09:14:00.000Z",
      updatedAt: "2026-06-20T09:14:00.000Z",
      comments: [sampleComments[5]!],
    },
  ],
};

export const sampleActivityEvents: CommentThreadActivityEvent[] = [
  activity(
    "activity-created-workbench",
    "thread-workbench-open",
    "thread_created",
    humanTasuku,
    "2026-06-20T09:10:00.000Z",
  ),
  activity(
    "activity-read-workbench",
    "thread-workbench-open",
    "thread_read",
    claudeAgent,
    "2026-06-20T09:11:00.000Z",
  ),
  activity(
    "activity-reply-workbench",
    "thread-workbench-open",
    "comment_added",
    codexAgent,
    "2026-06-20T09:12:00.000Z",
    {
      commentId: "comment-workbench-agent-1",
    },
  ),
  activity(
    "activity-created-diff",
    "thread-diff-added",
    "thread_created",
    humanTasuku,
    "2026-06-20T09:13:00.000Z",
  ),
  activity(
    "activity-read-md",
    "thread-md-rendered",
    "thread_read",
    claudeAgent,
    "2026-06-20T09:15:00.000Z",
  ),
  activity(
    "activity-resolved",
    "thread-resolved",
    "thread_status_changed",
    codexAgent,
    "2026-06-20T09:05:00.000Z",
    {
      previousStatus: "open",
      status: "resolved",
    },
  ),
];

export const sampleThreadActivities =
  buildThreadActivities(sampleActivityEvents);
export const sampleReviewDiffStats: Record<string, DiffStat | null> = {
  [sampleDiff.path]: buildDiffStat(sampleDiff),
  [markdownDiff.path]: buildDiffStat(markdownDiff),
  [htmlDiff.path]: buildDiffStat(htmlDiff),
  "docs/agent-handoff.md": { additions: 7, deletions: 1 },
  "server/comments/comments.go": { additions: 11, deletions: 5 },
  "server/graphql/schema.graphqls": { additions: 9, deletions: 0 },
};

export const sampleUnreadReviewPaths = new Set<string>([
  sampleCodeFile.path,
  sampleMarkdownFile.path,
]);

export const sampleReviewQueueItems: ReviewQueueItem[] = buildReviewQueueItems(
  sampleReviewChanges,
  sampleComments,
  sampleThreadActivities,
  sampleUnreadReviewPaths,
);

export const sampleTabs: OpenTab[] = [
  {
    path: sampleCodeFile.path,
    viewerKind: "code",
    paneId: "main",
    changed: true,
  },
  { path: sampleMarkdownFile.path, viewerKind: "markdown", paneId: "main" },
  {
    path: sampleHtmlFile.path,
    viewerKind: "html",
    paneId: "main",
    isPreview: true,
  },
];

export const manyReviewComments: ViviComment[] = [
  ...sampleComments,
  ...Array.from({ length: 18 }, (_, index) =>
    sourceComment({
      id: `comment-many-${index + 1}`,
      threadId: `thread-many-${index + 1}`,
      path: `ui/src/features/review-lab/file-${index + 1}.tsx`,
      viewerKind: "text",
      lineStart: 3 + index,
      lineEnd: 3 + index,
      quote: `review fixture ${index + 1}`,
      body: `Fixture comment ${index + 1} covering queue density and scrolling behavior.`,
      status: index % 5 === 0 ? "resolved" : "open",
      createdAt: `2026-06-20T08:${String(10 + index).padStart(2, "0")}:00.000Z`,
      updatedAt: `2026-06-20T08:${String(10 + index).padStart(2, "0")}:00.000Z`,
    }),
  ),
];

export function commentsForPath(
  path: string,
  comments = sampleComments,
): ViviComment[] {
  return comments.filter((comment) => comment.path === path);
}

export function draftsForPath(
  path: string,
  drafts = sampleDraftComments,
): DraftReviewComment[] {
  return drafts.filter((draft) => draft.path === path);
}

export function threadActivityForComments(
  comments: ViviComment[],
): Record<string, CommentActivitySummary> {
  const ids = new Set(
    comments.map((comment) => comment.threadId ?? comment.id),
  );
  return Object.fromEntries(
    Object.entries(sampleThreadActivities).filter(([threadId]) =>
      ids.has(threadId),
    ),
  );
}

function filePayload(
  path: string,
  viewerKind: FilePayload["viewerKind"],
  content: string,
): FilePayload {
  return {
    path,
    viewerKind,
    encoding: "utf8",
    content,
    etag: `etag:${path}:story`,
    size: new TextEncoder().encode(content).byteLength,
    mtimeMs: new Date("2026-06-20T09:00:00.000Z").getTime(),
    mimeType:
      viewerKind === "html"
        ? "text/html"
        : viewerKind === "markdown"
          ? "text/markdown"
          : "text/plain",
  };
}

function dir(path: string, children: FsNode[]): FsNode {
  return {
    id: `dir:${path}`,
    path,
    name: path.split("/").at(-1) ?? path,
    kind: "directory",
    parentPath: parentPath(path),
    children,
    childrenLoaded: true,
    version: 42,
  };
}

function fileNode(
  path: string,
  viewerKind: FsNode["viewerKind"],
  size: number,
): FsNode {
  return {
    id: `file:${path}`,
    path,
    name: path.split("/").at(-1) ?? path,
    kind: "file",
    parentPath: parentPath(path),
    viewerKind,
    size,
    mtimeMs: new Date("2026-06-20T09:00:00.000Z").getTime(),
    hash: `hash:${path}`,
    version: 42,
  };
}

function parentPath(path: string): string | null {
  const index = path.lastIndexOf("/");
  return index > 0 ? path.slice(0, index) : null;
}

function sourceComment(
  input: Partial<ViviComment> & {
    id: string;
    threadId: string;
    path: string;
    viewerKind: ViviComment["viewerKind"];
    lineStart: number;
    lineEnd?: number;
    quote: string;
    body: string;
  },
): ViviComment {
  return {
    status: "open",
    source: "human",
    createdBy: humanTasuku,
    createdAt: "2026-06-20T09:10:00.000Z",
    updatedAt: "2026-06-20T09:10:00.000Z",
    ...input,
    anchor: {
      surface: "source",
      canonical: {
        path: input.path,
        lineStart: input.lineStart,
        lineEnd: input.lineEnd ?? input.lineStart,
        quote: input.quote,
        fileHash: fileHashForPath(input.path),
      },
    },
  };
}

function diffComment(
  input: Partial<ViviComment> & {
    id: string;
    threadId: string;
    lineStart: number;
    lineEnd?: number;
    side?: "old" | "new";
    quote: string;
    body: string;
  },
): ViviComment {
  const side = input.side ?? "new";
  return {
    id: input.id,
    threadId: input.threadId,
    path: sampleCodeFile.path,
    viewerKind: "text",
    body: input.body,
    status: input.status ?? "open",
    source: input.source ?? "human",
    createdBy: input.createdBy ?? humanTasuku,
    createdAt: input.createdAt ?? "2026-06-20T09:13:00.000Z",
    updatedAt: input.updatedAt ?? "2026-06-20T09:13:00.000Z",
    anchor: {
      surface: "diff",
      canonical: {
        path: sampleCodeFile.path,
        lineStart: input.lineStart,
        lineEnd: input.lineEnd ?? input.lineStart,
        quote: input.quote,
        fileHash: sampleCodeFile.etag,
      },
      diff: {
        path: sampleCodeFile.path,
        base: "HEAD",
        ref: "working tree",
        hunkId: "@@ -4,8 +4,12 @@",
        side,
        oldLineStart: side === "old" ? input.lineStart : undefined,
        oldLineEnd:
          side === "old" ? (input.lineEnd ?? input.lineStart) : undefined,
        newLineStart: side === "new" ? input.lineStart : undefined,
        newLineEnd:
          side === "new" ? (input.lineEnd ?? input.lineStart) : undefined,
        diffHash: sampleDiff.diffHash,
        fileHash: sampleCodeFile.etag,
        changeKind: side === "new" ? "added" : "context",
      },
    },
  };
}

function renderedComment(
  input: Partial<ViviComment> & {
    id: string;
    threadId: string;
    path: string;
    viewerKind: ViviComment["viewerKind"];
    kind: "markdown" | "html";
    lineStart: number;
    lineEnd?: number;
    blockId: string;
    selector: string;
    textQuote: string;
    body: string;
  },
): ViviComment {
  return {
    status: "open",
    source: "human",
    createdBy: humanTasuku,
    createdAt: "2026-06-20T09:14:00.000Z",
    updatedAt: "2026-06-20T09:14:00.000Z",
    ...input,
    anchor: {
      surface: "rendered",
      canonical: {
        path: input.path,
        lineStart: input.lineStart,
        lineEnd: input.lineEnd ?? input.lineStart,
        quote: input.textQuote,
        fileHash: fileHashForPath(input.path),
      },
      rendered: {
        kind: input.kind,
        blockId: input.blockId,
        selector: input.selector,
        textQuote: input.textQuote,
        sourceLineStart: input.lineStart,
        sourceLineEnd: input.lineEnd ?? input.lineStart,
      },
    },
  };
}

function draftComment(input: {
  id: string;
  path: string;
  viewerKind: DraftReviewComment["viewerKind"];
  lineStart: number;
  lineEnd?: number;
  quote: string;
  body: string;
}): DraftReviewComment {
  return {
    id: input.id,
    path: input.path,
    viewerKind: input.viewerKind,
    anchor: {
      surface: "source",
      canonical: {
        path: input.path,
        lineStart: input.lineStart,
        lineEnd: input.lineEnd ?? input.lineStart,
        quote: input.quote,
        fileHash: fileHashForPath(input.path),
      },
    },
    body: input.body,
    createdBy: humanTasuku,
    source: "human",
    createdAt: "2026-06-20T09:16:00.000Z",
    updatedAt: "2026-06-20T09:16:00.000Z",
  };
}

function activity(
  id: string,
  threadId: string,
  type: CommentThreadActivityEvent["type"],
  actor: CommentActor,
  createdAt: string,
  rest: Partial<CommentThreadActivityEvent> = {},
): CommentThreadActivityEvent {
  return { id, threadId, type, actor, createdAt, ...rest };
}

function buildThreadActivities(
  events: CommentThreadActivityEvent[],
): Record<string, CommentActivitySummary> {
  const byThread = new Map<string, CommentThreadActivityEvent[]>();
  for (const event of events) {
    byThread.set(event.threadId, [
      ...(byThread.get(event.threadId) ?? []),
      event,
    ]);
  }
  return Object.fromEntries(
    [...byThread.entries()].map(([threadId, threadEvents]) => [
      threadId,
      summarizeThreadActivity(threadEvents, storyNow),
    ]),
  );
}

function fileHashForPath(path: string): string {
  if (path === sampleCodeFile.path) return sampleCodeFile.etag;
  if (path === sampleMarkdownFile.path) return sampleMarkdownFile.etag;
  if (path === sampleHtmlFile.path) return sampleHtmlFile.etag;
  if (path === sampleQueueFile.path) return sampleQueueFile.etag;
  return `etag:${path}:story`;
}
