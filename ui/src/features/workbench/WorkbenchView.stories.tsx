import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
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
  args: {
    file: sampleFiles.queue,
    viewerMode: "rendered",
    compactInspector: true,
    inspectorTitle:
      "Narrow workbench keeps an explicit route back to the Review Queue.",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const focusReviewQueue = canvas.getByRole("button", {
      name: "Focus Review Queue",
    });

    await userEvent.click(focusReviewQueue);
    await expect(canvas.getByText("Review Queue")).toBeVisible();

    const focusedReviewItem =
      canvasElement.ownerDocument.activeElement as HTMLElement | null;

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
    expect(expandHit).toBe(expandInspector);
    await expect(
      canvas.queryByRole("button", { name: "Collapse inspector" }),
    ).not.toBeInTheDocument();

    await userEvent.click(expandInspector);

    await expect(
      canvas.getByRole("button", { name: "Collapse inspector" }),
    ).toBeVisible();
    await expect(canvas.getByText("Review Queue")).toBeVisible();

    const firstReviewItem =
      canvasElement.querySelector<HTMLElement>(".review-queue .change-open");
    expect(firstReviewItem).not.toBeNull();
    if (firstReviewItem) {
      const itemRect = firstReviewItem.getBoundingClientRect();
      const itemHit = canvasElement.ownerDocument.elementFromPoint(
        itemRect.left + itemRect.width / 2,
        itemRect.top + itemRect.height / 2,
      );

      expect(itemHit).toBe(firstReviewItem);
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
  args: {
    file: sampleFiles.code,
    activeCommentId: "draft:draft-review-1",
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
      "Draft Review tray is open and the Publish review comments CTA is visible.",
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
  },
};

export const ErrorState: Story = {
  args: {
    state: "error",
    file: sampleFiles.code,
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
  args: {
    file: sampleFiles.code,
    commentsPanelOpen: true,
    commentsPanelStatus: "attention",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole("button", {
        name: /Open thread in .*WorkbenchContainer\.tsx/i,
      }),
    );

    await expect(
      canvas.queryByRole("complementary", { name: "Comments" }),
    ).not.toBeInTheDocument();
    await expect(
      canvas.getByLabelText(/Comment thread for lines 9-12/i),
    ).toBeInTheDocument();
    await expect(
      canvas.getByRole("textbox", { name: "Reply to thread" }),
    ).toBeInTheDocument();
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
