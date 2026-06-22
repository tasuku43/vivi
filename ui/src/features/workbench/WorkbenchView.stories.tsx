import type { Meta, StoryObj } from "@storybook/react-vite";
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
  args: {
    file: sampleFiles.code,
    activeCommentId: "comment-workbench-open-1",
  },
};

export const ReviewQueueFocused: Story = {
  args: {
    file: sampleFiles.queue,
    viewerMode: "rendered",
    inspectorTitle: "Review Queue is the primary right-inspector work list.",
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
