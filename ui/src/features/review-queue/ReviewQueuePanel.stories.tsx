import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
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
const staleThreadOnlyComment = {
  ...sampleComments[0]!,
  id: "stale-thread-only-comment",
  threadId: "stale-thread-only",
  path: "missing-review.md",
  body: "Old note for a file that is no longer in the workspace.",
  status: "open" as const,
};
const resolvedHandoffComment = sampleComments.find(
  (comment) => comment.id === "comment-resolved",
)!;
const resolvedHandoffChange = sampleReviewChanges.find(
  (change) => change.path === resolvedHandoffComment.path,
)!;
const baseArgs = {
  file: sampleFiles.code,
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
  activePaneId: "main",
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

export const ReviewQueueItemWithOpenThreads: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const row = canvas.getByRole("button", {
      name: `modified ${sampleFiles.code.path}, current review file`,
    });
    await userEvent.click(row);
    await expect(row).toHaveAttribute(
      "aria-describedby",
      expect.stringContaining("review-queue-item-1-description"),
    );
    const descriptionId = row
      .getAttribute("aria-describedby")
      ?.split(/\s+/)
      .find((id) => id.startsWith("review-queue-item-"));
    await expect(descriptionId).toBeTruthy();
    await expect(
      canvasElement.querySelector(`#${descriptionId}`),
    ).toHaveTextContent("unseen review work");
    await expect(
      canvasElement.querySelector(`#${descriptionId}`),
    ).toHaveTextContent("open thread");
  },
};

export const ReviewQueueItemWithLatestAgentActivity: Story = {
  args: {
    unreadReviewPaths: new Set([sampleFiles.code.path]),
  },
};

export const ResolvedThreadActivityIsHistory: Story = {
  args: {
    file: sampleFiles.queue,
    activePath: resolvedHandoffComment.path,
    reviewChanges: [resolvedHandoffChange],
    reviewItems: buildReviewQueueItems(
      [resolvedHandoffChange],
      [resolvedHandoffComment],
      sampleThreadActivities,
      new Set(),
    ),
    comments: [],
    reviewComments: [resolvedHandoffComment],
    unreadReviewPaths: new Set(),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("No open threads")).toBeInTheDocument();
    await expect(canvas.getByText("Codex marked resolved")).toBeInTheDocument();
    await expect(canvas.queryByText("Current stop")).not.toBeInTheDocument();
    await expect(canvas.queryByText("Next stop")).not.toBeInTheDocument();
  },
};

export const ActiveFileSourceChangedAnchor: Story = {
  args: {
    comments: [
      {
        ...sampleComments[0]!,
        anchor: {
          ...sampleComments[0]!.anchor,
          canonical: {
            ...sampleComments[0]!.anchor.canonical,
            fileHash: "sha256:older-workbench",
          },
        },
      },
    ],
    reviewComments: sampleComments,
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

export const StaleThreadOnlyPathsHidden: Story = {
  args: {
    reviewItems: buildReviewQueueItems(
      sampleReviewChanges,
      [...sampleComments, staleThreadOnlyComment],
      sampleThreadActivities,
      sampleUnreadReviewPaths,
      { knownMissingPaths: new Set(["missing-review.md"]) },
    ),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Review Queue")).toBeInTheDocument();
    await expect(
      canvas.queryByText("missing-review.md"),
    ).not.toBeInTheDocument();
    await expect(
      canvas.getByText(sampleReviewQueueItems[0]!.path),
    ).toBeInTheDocument();
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

export const LoadingGitReview: Story = {
  args: {
    reviewChanges: [],
    reviewItems: [],
    reviewLoading: true,
    unreadReviewPaths: new Set(),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByText(
        "Loading Git review; open comment threads may appear before changed files.",
      ),
    ).toBeInTheDocument();
    await expect(
      canvas.queryByText("Active queue clear"),
    ).not.toBeInTheDocument();
  },
};
