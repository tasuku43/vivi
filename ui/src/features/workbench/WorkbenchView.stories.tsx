import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import type { ViviComment } from "../../domain/comments.js";
import type { FilePayload } from "../../domain/fs-node.js";
import { ReviewWorkbenchStory } from "../../storybook/ReviewWorkbenchStory.js";
import {
  commentsForPath,
  htmlDiff,
  manyDraftReviewComments,
  manyReviewComments,
  markdownDiff,
  sampleComments,
  sampleDiff,
  sampleDraftComments,
  sampleFiles,
  samplePublishedReviewBatch,
  sampleReviewChanges,
  sampleReviewDiffStats,
  sampleReviewQueueItems,
  sampleTabs,
  sampleThreadActivities,
  sampleUnreadReviewPaths,
} from "../../storybook/fixtures/review-lab.js";
import { buildReviewQueueItems } from "../../state/review-queue.js";

const meta = {
  title: "Screens/Workbench",
  component: ReviewWorkbenchStory,
  parameters: {
    layout: "fullscreen",
    a11y: { test: "error" },
  },
} satisfies Meta<typeof ReviewWorkbenchStory>;

export default meta;
type Story = StoryObj<typeof meta>;

const alternateWorkbenchLineComment: ViviComment = {
  id: "comment-workbench-row-target",
  threadId: "thread-workbench-row-target",
  path: sampleFiles.code.path,
  viewerKind: "text",
  anchor: {
    surface: "source",
    canonical: {
      path: sampleFiles.code.path,
      lineStart: 5,
      lineEnd: 5,
      quote:
        "const [commentsPanelOpen, setCommentsPanelOpen] = useState(false);",
      fileHash: "sha256:workbench-story-row-target",
    },
  },
  body: "Row clicks should switch open threads without the outside-dismiss listener immediately closing the new thread.",
  source: "human",
  status: "open",
  createdAt: "2026-06-20T09:20:00.000Z",
  updatedAt: "2026-06-20T09:20:00.000Z",
};

const resolvedWorkbenchHistoryComment: ViviComment = {
  id: "comment-workbench-resolved-history",
  threadId: "thread-workbench-resolved-history",
  path: sampleFiles.code.path,
  viewerKind: "text",
  anchor: {
    surface: "source",
    canonical: {
      path: sampleFiles.code.path,
      lineStart: 12,
      lineEnd: 12,
      quote: "const [commentsPanelStatus, setCommentsPanelStatus] =",
      fileHash: "sha256:workbench-story-resolved-history",
    },
  },
  body: "Resolved history should remain visible when this file's messages are opened from the inspector.",
  source: "human",
  status: "resolved",
  createdAt: "2026-06-20T09:18:00.000Z",
  updatedAt: "2026-06-20T09:19:00.000Z",
  resolvedAt: "2026-06-20T09:19:00.000Z",
};

const missingReadmeFile: FilePayload = {
  path: "README.md",
  viewerKind: "markdown",
  encoding: "utf8",
  content: "",
  etag: "sha256:missing-readme-story",
  size: 0,
  mtimeMs: new Date("2026-06-20T09:00:00.000Z").getTime(),
};

export const EmptyWorkspace: Story = {
  args: {
    state: "empty",
    file: null,
    comments: [],
    draftComments: [],
    reviewChanges: [],
    reviewItems: [],
    unreadReviewPaths: new Set(),
  },
};

export const WorkspaceWithFileTreeAndSelectedFile: Story = {
  tags: ["interaction"],
  parameters: {
    a11y: { test: "todo" },
  },
  args: {
    file: sampleFiles.code,
    activeCommentId: "comment-workbench-open-1",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Explorer")).toBeInTheDocument();
    await expect(
      canvas.getByRole("tab", { name: /WorkbenchContainer.tsx/ }),
    ).toBeInTheDocument();
    await expect(canvas.getByText("Review Queue")).toBeInTheDocument();
    const attentionButton = canvas.getByRole("button", {
      name: /Open Comments hub/,
    });
    await userEvent.click(attentionButton);
    const commentFilters = within(
      canvas.getByRole("group", { name: "Comment status filters" }),
    );
    await expect(
      commentFilters.getByRole("button", { name: /Show .* attention thread/ }),
    ).toHaveAttribute("aria-pressed", "true");
  },
};

export const ReviewPathsLoading: Story = {
  args: {
    file: sampleFiles.code,
    reviewItems: [],
    reviewChanges: [],
    reviewLoading: true,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("live ...")).toBeInTheDocument();
    await expect(
      canvas.getByLabelText("Showing the live tree while review paths load"),
    ).toBeInTheDocument();
  },
};

export const ReviewQueueFocused: Story = {
  args: {
    file: sampleFiles.queue,
    viewerMode: "rendered",
    inspectorTitle: "Review Queue is the primary right-inspector work list.",
  },
};

export const CompactInspectorCanReopenReviewQueue: Story = {
  tags: ["interaction"],
  parameters: {
    a11y: { test: "todo" },
  },
  args: {
    file: sampleFiles.queue,
    viewerMode: "rendered",
    compactInspector: true,
    draftComments: [],
    inspectorTitle:
      "Narrow workbench keeps an explicit route back to the Review Queue.",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const focusReviewQueue = canvas.getByRole("button", {
      name: "Focus Review Queue",
    });

    await userEvent.click(focusReviewQueue);
    const inspector = canvas.getByRole("complementary", {
      name: "Review inspector",
    });
    await expect(within(inspector).getByText("Review Queue")).toBeVisible();

    const focusedReviewItem = canvasElement.ownerDocument
      .activeElement as HTMLElement | null;

    expect(focusedReviewItem?.classList.contains("change-open")).toBe(true);

    await userEvent.click(
      canvas.getByRole("button", { name: "Collapse inspector" }),
    );

    const expandInspector = canvas.getByRole("button", {
      name: "Expand inspector",
    });
    const expandRect = expandInspector.getBoundingClientRect();
    const expandHit = canvasElement.ownerDocument.elementFromPoint(
      expandRect.left + expandRect.width / 2,
      expandRect.top + expandRect.height / 2,
    );

    await expect(expandInspector).toBeVisible();
    expect(
      expandHit instanceof HTMLElement
        ? expandHit.closest('button[aria-label="Expand inspector"]')
        : null,
    ).not.toBeNull();
    await expect(
      canvas.queryByRole("button", { name: "Collapse inspector" }),
    ).not.toBeInTheDocument();

    await userEvent.click(expandInspector);

    await expect(
      canvas.getByRole("button", { name: "Collapse inspector" }),
    ).toBeVisible();
    const reopenedInspector = canvas.getByRole("complementary", {
      name: "Review inspector",
    });
    await expect(
      within(reopenedInspector).getByText("Review Queue"),
    ).toBeVisible();

    const firstReviewItem = canvasElement.querySelector<HTMLElement>(
      ".review-queue .change-open",
    );
    expect(firstReviewItem).not.toBeNull();
    if (firstReviewItem) {
      const itemRect = firstReviewItem.getBoundingClientRect();
      const itemHit = canvasElement.ownerDocument.elementFromPoint(
        itemRect.left + itemRect.width / 2,
        itemRect.top + itemRect.height / 2,
      );

      expect(
        itemHit instanceof HTMLElement
          ? itemHit.closest(".review-queue .change-open")
          : null,
      ).not.toBeNull();
    }
  },
};

export const FileWithOpenComments: Story = {
  args: {
    file: sampleFiles.code,
    activeCommentId: "comment-workbench-open-1",
    inlineComment: sampleComments[0],
  },
};

export const FileWithDraftComments: Story = {
  tags: ["interaction"],
  parameters: {
    a11y: { test: "todo" },
  },
  args: {
    file: sampleFiles.code,
    activeCommentId: "draft:draft-review-1",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole("radio", { name: "B Threads conversation" }),
    );
    const inspector = within(
      canvas.getByRole("complementary", { name: "Review inspector" }),
    );
    await expect(
      inspector.getByLabelText("Active file draft comments"),
    ).toBeVisible();
    await expect(inspector.getAllByText("Private draft")[0]).toBeVisible();
    await expect(
      inspector.getAllByRole("button", { name: /Open private draft in/ })[0],
    ).toBeVisible();
  },
};

export const DraftAndOpenThreadMixedState: Story = {
  args: {
    file: sampleFiles.code,
    activeCommentId: "draft:draft-review-1",
    inlineComment: sampleComments[0],
    draftComments: sampleDraftComments,
    commentsPanelOpen: true,
    commentsPanelStatus: "open",
  },
};

export const DraftCommentsReadyToPublish: Story = {
  args: {
    file: sampleFiles.markdown,
    viewerMode: "rendered",
    draftComments: sampleDraftComments,
    inspectorTitle:
      "Comments hub collects private drafts and keeps the Publish review comments CTA visible.",
  },
};

export const DraftCommentsPublishing: Story = {
  args: {
    file: sampleFiles.code,
    draftComments: sampleDraftComments,
    draftPublishing: true,
  },
};

export const MarkdownRenderedDraftComment: Story = {
  args: {
    file: sampleFiles.markdown,
    viewerMode: "rendered",
    draftComments: sampleDraftComments,
    activeCommentId: "draft:draft-review-md-rendered",
  },
};

export const HtmlRenderedDraftComment: Story = {
  args: {
    file: sampleFiles.html,
    viewerMode: "preview",
    draftComments: sampleDraftComments,
    activeCommentId: "draft:draft-review-html-rendered",
  },
};

export const HtmlDiffDraftComment: Story = {
  args: {
    file: sampleFiles.html,
    viewerMode: "source",
    diff: htmlDiff,
    diffEnabled: true,
    draftComments: sampleDraftComments,
    activeCommentId: "draft:draft-review-html-diff",
  },
};

export const DraftPublishFailure: Story = {
  args: {
    file: sampleFiles.code,
    draftComments: sampleDraftComments,
    draftPublishError: "The selected target thread is no longer open.",
    inspectorTitle:
      "Publish failed, but drafts remain editable in the tray and out of agent worklists.",
  },
};

export const PublishedReviewBatchWithMultipleOpenThreads: Story = {
  args: {
    file: sampleFiles.markdown,
    viewerMode: "rendered",
    comments: sampleComments.filter(
      (comment) =>
        comment.reviewBatchId === samplePublishedReviewBatch.reviewBatchId ||
        comment.path === sampleFiles.markdown.path,
    ),
    draftComments: [],
    publishedBatchId: samplePublishedReviewBatch.reviewBatchId,
    inspectorTitle: `Published batch ${samplePublishedReviewBatch.reviewBatchId} spans Markdown and HTML threads.`,
  },
};

export const ManyDraftReviewComments: Story = {
  args: {
    file: sampleFiles.html,
    viewerMode: "source",
    draftComments: manyDraftReviewComments,
    inspectorTitle:
      "Many draft review comments keep the tray scrollable before publish.",
  },
};

export const AgentActivityVisible: Story = {
  args: {
    file: sampleFiles.code,
    activeCommentId: "comment-workbench-agent-1",
    commentsPanelOpen: true,
    commentsPanelQuery: "WorkbenchContainer",
  },
};

export const AgentReplyVisible: Story = {
  args: {
    file: sampleFiles.code,
    activeCommentId: "comment-workbench-agent-1",
    inlineComment: sampleComments[1],
  },
};

export const DiffReviewMode: Story = {
  args: {
    file: sampleFiles.code,
    diff: sampleDiff,
    diffEnabled: true,
    activeCommentId: "comment-diff-added",
  },
};

export const HtmlPreviewReviewMode: Story = {
  args: {
    file: sampleFiles.html,
    viewerMode: "preview",
    diff: htmlDiff,
    diffEnabled: true,
    activeCommentId: "comment-html-rendered",
    inspectorTitle:
      "Storybook covers HTML review chrome and rendered HTML diff comments; full /preview/html loading stays in E2E.",
  },
};

export const MarkdownRenderedReviewMode: Story = {
  args: {
    file: sampleFiles.markdown,
    viewerMode: "rendered",
    diff: markdownDiff,
    activeCommentId: "comment-md-rendered",
  },
};

export const ManyFilesManyComments: Story = {
  args: {
    file: sampleFiles.code,
    comments: manyReviewComments,
    reviewItems: buildReviewQueueItems(
      sampleReviewChanges,
      manyReviewComments,
      sampleThreadActivities,
      sampleUnreadReviewPaths,
    ),
    commentsPanelOpen: true,
    commentsPanelStatus: "open",
  },
};

export const LoadingState: Story = {
  args: {
    state: "loading",
    file: sampleFiles.code,
    reviewItems: [],
    reviewLoading: true,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Loading review files")).toBeInTheDocument();
    await expect(canvas.queryByText("0 review files")).not.toBeInTheDocument();
  },
};

export const PendingFileLoadState: Story = {
  args: {
    file: null,
    pendingFilePath: sampleFiles.code.path,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByText(`Loading preview for ${sampleFiles.code.path}...`),
    ).toBeInTheDocument();
    await expect(
      canvas.queryByText("Select a file from the tree."),
    ).not.toBeInTheDocument();
  },
};

export const ErrorState: Story = {
  args: {
    state: "error",
    file: sampleFiles.code,
    viewerError: "TypeError: Failed to fetch",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Preview unavailable")).toBeInTheDocument();
    await expect(
      canvas.getByText(
        "Vivi could not load this preview. Select the file again after the server is ready.",
      ),
    ).toBeInTheDocument();
    await expect(canvas.queryByText("TypeError: Failed to fetch")).toBeNull();
  },
};

export const MissingSourceErrorState: Story = {
  args: {
    state: "error",
    file: missingReadmeFile,
    viewerError:
      "Error: stat /Users/tasuku/work/github.com/torvalds/linux/README.md: no such file or directory",
    viewerSourceMissing: true,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Source missing")).toBeInTheDocument();
    await expect(
      canvas.getByText(
        "README.md is not present in this workspace. The comment is still available so you can resolve, archive, or re-anchor it.",
      ),
    ).toBeInTheDocument();
    await expect(canvas.queryByText(/\/Users\/tasuku/)).toBeNull();
  },
};

export const MissingSourceRecoversFromReviewQueue: Story = {
  tags: ["interaction"],
  parameters: {
    a11y: { test: "todo" },
  },
  args: {
    state: "error",
    file: missingReadmeFile,
    viewerError:
      "Error: stat /Users/tasuku/work/github.com/torvalds/linux/README.md: no such file or directory",
    viewerSourceMissing: true,
    reviewQueueOpenFile: sampleFiles.code,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Source missing")).toBeInTheDocument();

    const inspector = canvas.getByRole("complementary", {
      name: "Review inspector",
    });
    await userEvent.click(
      within(inspector).getByRole("button", {
        name: /ui\/src\/features\/workbench\/WorkbenchContainer\.tsx/,
      }),
    );

    await expect(canvas.queryByText("Source missing")).not.toBeInTheDocument();
    await expect(
      canvas.getByRole("tab", { name: /WorkbenchContainer\.tsx/ }),
    ).toBeInTheDocument();
    await expect(
      canvas.getByText(/const \[commentsPanelOpen, setCommentsPanelOpen\]/),
    ).toBeInTheDocument();
  },
};

export const ReviewQueueOpenKeepsWorkspaceChrome: Story = {
  tags: ["interaction"],
  parameters: {
    a11y: { test: "todo" },
  },
  args: {
    state: "error",
    file: missingReadmeFile,
    viewerError:
      "Error: stat /Users/tasuku/work/github.com/torvalds/linux/README.md: no such file or directory",
    viewerSourceMissing: true,
    reviewQueueOpenFile: sampleFiles.code,
    tabs: [
      ...sampleTabs,
      {
        path: "net/netfilter/xt_DSCP.c",
        viewerKind: "code",
        paneId: "main",
        isPreview: true,
      },
      {
        path: "include/uapi/linux/netfilter_ipv4/ipt_ECN.h",
        viewerKind: "code",
        paneId: "main",
      },
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const inspector = canvas.getByRole("complementary", {
      name: "Review inspector",
    });

    await userEvent.click(
      within(inspector).getByRole("button", {
        name: /ui\/src\/features\/workbench\/WorkbenchContainer\.tsx/,
      }),
    );

    const sidebar = canvas.getByRole("complementary", {
      name: "File explorer",
    });
    sidebar.scrollTop = 36;
    sidebar.dispatchEvent(new Event("scroll"));
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );

    const topbar = canvasElement.querySelector<HTMLElement>(".topbar");
    const explorerTitle = canvas
      .getByText("Explorer")
      .closest<HTMLElement>(".panel-title");
    const tabs = canvasElement.querySelector<HTMLElement>(".tabs");

    expect(topbar).not.toBeNull();
    expect(explorerTitle).not.toBeNull();
    expect(tabs).not.toBeNull();
    if (!topbar || !explorerTitle || !tabs) return;

    const topbarRect = topbar.getBoundingClientRect();
    const explorerRect = explorerTitle.getBoundingClientRect();
    const tabsRect = tabs.getBoundingClientRect();

    expect(explorerRect.top).toBeGreaterThanOrEqual(topbarRect.bottom - 1);
    expect(explorerRect.height).toBeGreaterThanOrEqual(40);
    expect(tabsRect.height).toBeGreaterThanOrEqual(38);
    expect(tabsRect.height).toBeLessThanOrEqual(40);
    await expect(
      canvas.getByRole("tab", { name: /WorkbenchContainer\.tsx/ }),
    ).toBeVisible();
  },
};

export const DisconnectedState: Story = {
  args: {
    state: "disconnected",
    file: sampleFiles.markdown,
    viewerMode: "rendered",
  },
};

export const CommentsPanelOpen: Story = {
  args: {
    file: sampleFiles.code,
    commentsPanelOpen: true,
    commentsPanelStatus: "all",
  },
};

export const CommentsPanelOpensInlineThread: Story = {
  tags: ["interaction"],
  parameters: {
    a11y: { test: "todo" },
  },
  args: {
    file: sampleFiles.code,
    comments: [...sampleComments, alternateWorkbenchLineComment],
    commentsPanelOpen: true,
    commentsPanelStatus: "open",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const commentsPanel = canvas.getByRole("complementary", {
      name: "Comments",
    });
    await userEvent.click(
      within(commentsPanel).getByRole("button", {
        name: "Open thread in ui/src/features/workbench/WorkbenchContainer.tsx, Source L9-L12, L9-L12, source, 2 messages, latest by Codex",
      }),
    );

    await expect(
      canvas.queryByRole("complementary", { name: "Comments" }),
    ).not.toBeInTheDocument();
    await expect(
      canvas.getByLabelText(/Comment thread for lines 9-12/i),
    ).toBeInTheDocument();
    let composerBoxes = canvas.getAllByRole("textbox", {
      name: "New line comment",
    });
    await expect(composerBoxes).toHaveLength(1);
    await expect(
      composerBoxes.some((textbox) => textbox === document.activeElement),
    ).toBe(false);
    await expect(canvas.getByText("New thread on Lines 9-12")).toBeVisible();

    const rowTarget = canvasElement.querySelector<HTMLElement>(
      '.code-line.has-comment[data-line="5"]',
    );
    expect(rowTarget).not.toBeNull();
    if (rowTarget) {
      await userEvent.click(rowTarget);
    }
    await expect(
      canvas.getByLabelText(/Comment thread for line 5/i),
    ).toBeInTheDocument();
    composerBoxes = canvas.getAllByRole("textbox", {
      name: "New line comment",
    });
    await expect(composerBoxes).toHaveLength(2);
    await expect(
      composerBoxes.some((textbox) => textbox === document.activeElement),
    ).toBe(false);

    await userEvent.click(
      canvas.getByRole("button", { name: "Open command palette" }),
    );
    await expect(
      canvas.getByRole("dialog", { name: "Quick open" }),
    ).toBeInTheDocument();
    await expect(
      canvas.getByRole("textbox", { name: "Quick open query" }),
    ).toHaveFocus();
  },
};

export const InspectorOpensScopedCommentHistory: Story = {
  tags: ["interaction"],
  parameters: {
    a11y: { test: "todo" },
  },
  args: {
    file: sampleFiles.code,
    comments: [resolvedWorkbenchHistoryComment],
    activeCommentId: null,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const inspector = canvas.getByRole("complementary", {
      name: "Review inspector",
    });

    await userEvent.click(
      within(inspector).getByRole("button", {
        name: "Open 1 total message in Comments panel",
      }),
    );

    const commentsPanel = canvas.getByRole("complementary", {
      name: "Comments",
    });
    await expect(
      within(commentsPanel).getByRole("button", { name: "Show all 1 thread" }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      within(commentsPanel).getByText(
        "Resolved history should remain visible when this file's messages are opened from the inspector.",
      ),
    ).toBeVisible();
  },
};

export const CommandPaletteOpen: Story = {
  args: {
    file: sampleFiles.code,
    commandPaletteOpen: true,
  },
};

export const ShortcutHelpOpen: Story = {
  args: {
    file: sampleFiles.markdown,
    viewerMode: "rendered",
    shortcutHelpOpen: true,
  },
};

export const FileWithOnlyMarkdownComments: Story = {
  args: {
    file: sampleFiles.markdown,
    viewerMode: "source",
    comments: commentsForPath(sampleFiles.markdown.path),
  },
};

export const FileWithOnlyHtmlComments: Story = {
  args: {
    file: sampleFiles.html,
    viewerMode: "source",
    comments: commentsForPath(sampleFiles.html.path),
  },
};
