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
  codexAgent,
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
  title: "Workspace/Workbench States",
  component: ReviewWorkbenchStory,
  parameters: {
    layout: "fullscreen",
    a11y: { test: "error" },
  },
} satisfies Meta<typeof ReviewWorkbenchStory>;

export default meta;
type Story = StoryObj<typeof meta>;

const getOpenTabButton = (
  canvasElement: HTMLElement,
  path: string,
): HTMLElement | null =>
  canvasElement.querySelector<HTMLElement>(`[data-tab-path="${path}"]`);

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
      quote: "const [reviewQueueOpen, setReviewQueueOpen] =",
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
  args: {
    file: sampleFiles.code,
    activeCommentId: "comment-workbench-open-1",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Explorer")).toBeInTheDocument();
    await expect(
      getOpenTabButton(
        canvasElement,
        "ui/src/features/workbench/WorkbenchContainer.tsx",
      ),
    ).toBeInTheDocument();
    await expect(
      canvasElement.querySelector(".inspector .panel-title > span:first-child"),
    ).toHaveTextContent("Review");
    await expect(
      canvas.queryByRole("button", { name: /Open Comments hub/ }),
    ).not.toBeInTheDocument();
    await expect(
      canvas.getByRole("button", { name: "Open command palette" }),
    ).toBeInTheDocument();
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
  name: "Compact inspector can reopen the review queue",
  tags: ["interaction"],
  args: {
    file: sampleFiles.queue,
    viewerMode: "rendered",
    compactInspector: true,
    draftComments: [],
    reviewItems: sampleReviewQueueItems.map((item) =>
      item.path === sampleFiles.code.path
        ? {
            ...item,
            latestActivity: {
              id: "activity-compact-agent-reply",
              threadId: "thread-workbench-open",
              type: "comment_added" as const,
              actor: codexAgent,
              commentId: "comment-workbench-agent-1",
              createdAt: "2026-06-20T09:28:00.000Z",
            },
            unread: true,
          }
        : item,
    ),
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
    await expect(
      within(inspector).getByText("Queued", { selector: "summary span" }),
    ).toBeVisible();

    const focusedReviewItem = canvasElement.ownerDocument
      .activeElement as HTMLElement | null;

    expect(focusedReviewItem?.classList.contains("change-open")).toBe(true);

    await expect(
      within(inspector).queryByRole("group", { name: "Inspector mode" }),
    ).not.toBeInTheDocument();
    await expect(
      within(inspector).getByText("In Review", { selector: "summary span" }),
    ).toBeVisible();
    await expect(
      inspector
        .querySelector(
          '.change-open.has-agent-reply[data-review-path="ui/src/features/workbench/WorkbenchContainer.tsx"]',
        )
        ?.querySelector(".unread-dot.agent-reply"),
    ).toBeInTheDocument();
    await expect(
      within(inspector).getByText("Reviewed", { selector: "summary span" }),
    ).toBeVisible();

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
      within(reopenedInspector).getByText("Queued", {
        selector: "summary span",
      }),
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
  },
};

export const FileWithDraftComments: Story = {
  tags: ["interaction"],
  args: {
    file: sampleFiles.code,
    activeCommentId: "draft:draft-review-1",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.queryByLabelText("Floating comment preview"),
    ).not.toBeInTheDocument();
    const inspector = within(
      canvas.getByRole("complementary", { name: "Review inspector" }),
    );
    await expect(
      inspector.queryByRole("radio", { name: "B Threads conversation" }),
    ).not.toBeInTheDocument();
  },
};

export const DraftAndOpenThreadMixedState: Story = {
  args: {
    file: sampleFiles.code,
    activeCommentId: "draft:draft-review-1",
    draftComments: sampleDraftComments,
  },
};

export const DraftCommentsReadyToPublish: Story = {
  args: {
    file: sampleFiles.markdown,
    viewerMode: "rendered",
    draftComments: sampleDraftComments,
    inspectorTitle:
      "Review inspector collects pending drafts and keeps the Publish review comments CTA visible.",
  },
};

export const DraftCommentsPublishing: Story = {
  args: {
    file: sampleFiles.code,
    draftComments: sampleDraftComments,
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
  },
};

export const AgentReplyVisible: Story = {
  args: {
    file: sampleFiles.code,
    activeCommentId: "comment-workbench-agent-1",
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

export const InspectorThreadClickOpensRenderedMarkdownThread: Story = {
  name: "Inspector thread click opens rendered Markdown thread",
  tags: ["interaction"],
  args: {
    file: sampleFiles.markdown,
    viewerMode: "rendered",
    activeCommentId: null,
    draftComments: [],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.queryByRole("article", {
        name: "Comment thread for line 7",
      }),
    ).not.toBeInTheDocument();

    const inspector = within(
      canvas.getByRole("complementary", { name: "Review inspector" }),
    );
    const markdownReviewItem = canvasElement
      .querySelector<HTMLElement>('[data-review-path="docs/product-review.md"]')
      ?.closest<HTMLElement>(".review-queue-item");
    expect(markdownReviewItem).not.toBeNull();
    if (!markdownReviewItem) return;
    const threadToggle = markdownReviewItem?.querySelector<HTMLElement>(
      'label[for^="review-queue-item-"][class~="review-thread-count-toggle"]',
    );
    expect(threadToggle).not.toBeNull();
    if (!threadToggle) return;
    await userEvent.click(threadToggle);

    const threadRow = markdownReviewItem.querySelector<HTMLElement>(
      ".review-thread-hairline-row",
    );
    expect(threadRow).not.toBeNull();
    if (!threadRow) return;
    expect(threadRow.getAttribute("aria-label")).toMatch(
      /Open Open thread in docs\/product-review\.md/,
    );
    await userEvent.click(threadRow);

    const thread = canvas.getByRole("article", {
      name: "Comment thread for line 7",
    });
    await expect(
      within(thread).getByText(/This sentence captures the feedback layer/),
    ).toBeVisible();
    await expect(
      within(thread).getByPlaceholderText("Add a follow-up"),
    ).toBeVisible();
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
  name: "Missing source recovers from the review queue",
  tags: ["interaction"],
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
      getOpenTabButton(
        canvasElement,
        "ui/src/features/workbench/WorkbenchContainer.tsx",
      ),
    ).toBeInTheDocument();
    await expect(
      canvas.getByText(/const \[reviewQueueOpen, setReviewQueueOpen\]/),
    ).toBeInTheDocument();
  },
};

export const ReviewQueueOpenKeepsWorkspaceChrome: Story = {
  name: "Open review queue keeps workspace chrome visible",
  tags: ["interaction"],
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

    const topbar = canvas.getByLabelText("Vivi").closest<HTMLElement>("header");
    const explorerTitle = canvas
      .getByText("Explorer")
      .closest<HTMLElement>(".panel-title");
    const tabs = canvas
      .getByRole("group", { name: /Open file tabs/ })
      .closest<HTMLElement>("div");

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
      getOpenTabButton(
        canvasElement,
        "ui/src/features/workbench/WorkbenchContainer.tsx",
      ),
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

export const ViewerHeaderSummarizesScopedCommentHistory: Story = {
  name: "Viewer header summarizes scoped comment history",
  tags: ["interaction"],
  args: {
    file: sampleFiles.code,
    comments: [resolvedWorkbenchHistoryComment],
    draftComments: [],
    activeCommentId: null,
    reviewItems: [],
    reviewStateByPath: { [sampleFiles.code.path]: "reviewed" },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const inspector = canvas.getByRole("complementary", {
      name: "Review inspector",
    });

    const reviewState = canvasElement.querySelector(
      ".file-location-segment .review-state-label",
    );
    await expect(reviewState).toBeInTheDocument();
    await expect(reviewState).toHaveTextContent("Reviewed");
    await expect(reviewState).toHaveAttribute(
      "aria-label",
      "Review state: Reviewed",
    );
    await expect(
      within(inspector).queryByRole("button", {
        name: /Open .* Comments panel/,
      }),
    ).not.toBeInTheDocument();
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
