import type { Meta, StoryObj } from "@storybook/react-vite";
import { buildReviewQueueItems } from "../../state/review-queue.js";
import {
  manyReviewComments,
  sampleComments,
  sampleFiles,
  sampleReviewChanges,
  sampleReviewDiffStats,
  sampleReviewQueueItems,
  sampleThreadActivities,
  sampleUnreadReviewPaths,
} from "../../storybook/fixtures/review-lab.js";
import { Inspector } from "./Inspector.js";

const noop = () => undefined;
const baseArgs = {
  file: sampleFiles.code,
  outline: [],
  reviewChanges: sampleReviewChanges,
  reviewItems: sampleReviewQueueItems,
  reviewDiffStats: sampleReviewDiffStats,
  loadingReviewDiffs: {},
  unreadReviewPaths: sampleUnreadReviewPaths,
  comments: sampleComments.filter(
    (comment) => comment.path === sampleFiles.code.path,
  ),
  draftComments: [],
  threadActivities: sampleThreadActivities,
  selectedCodeRange: { start: 9, end: 12 },
  onOutlineSelect: noop,
  onOpenEventPath: noop,
  onConfirmEventPath: noop,
  onOpenNextChanged: noop,
  onOpenPreviousChanged: noop,
  onOpenAllChanged: noop,
  onRevealInTree: noop,
  onOpenComments: noop,
};

const meta = {
  title: "Review/Review Queue/Inspector",
  component: Inspector,
  parameters: {
    layout: "fullscreen",
    a11y: { test: "error" },
  },
  args: baseArgs,
} satisfies Meta<typeof Inspector>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ReviewQueueItemWithOpenThreads: Story = {};

export const ReviewQueueItemWithLatestAgentActivity: Story = {
  args: {
    unreadReviewPaths: new Set([sampleFiles.code.path]),
  },
};

export const PublishedOpenThreads: Story = {
  args: {
    file: sampleFiles.markdown,
    comments: sampleComments.filter(
      (comment) => comment.reviewBatchId === "review-batch-story-001",
    ),
  },
};

export const AllSeen: Story = {
  args: {
    unreadReviewPaths: new Set(),
    reviewItems: sampleReviewQueueItems.map((item) => ({
      ...item,
      unread: false,
    })),
  },
};

export const ManyFiles: Story = {
  args: {
    reviewChanges: Array.from({ length: 18 }, (_, index) => ({
      path: `src/features/feature-${index + 1}.ts`,
      status: "modified" as const,
      source: "git" as const,
    })),
    reviewItems: buildReviewQueueItems(
      Array.from({ length: 18 }, (_, index) => ({
        path: `src/features/feature-${index + 1}.ts`,
        status: "modified" as const,
        source: "git" as const,
      })),
      manyReviewComments,
      sampleThreadActivities,
      new Set(["src/features/feature-1.ts", "src/features/feature-2.ts"]),
    ),
  },
};

export const LoadingReviewDiffs: Story = {
  args: {
    loadingReviewDiffs: {
      [sampleFiles.code.path]: true,
      [sampleFiles.markdown.path]: true,
    },
    reviewDiffStats: {},
  },
};

export const GitReviewUnavailable: Story = {
  args: {
    reviewChanges: [],
    reviewItems: [],
    reviewUnavailableReason: "No git repository found under the selected root.",
    unreadReviewPaths: new Set(),
  },
};
