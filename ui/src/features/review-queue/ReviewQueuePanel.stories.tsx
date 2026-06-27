import { useMemo, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fireEvent, userEvent, within } from "storybook/test";
import type { ReviewChangeItem } from "../../state/git-review.js";
import { summarizeThreadActivity } from "../../state/comment-activity.js";
import {
  gitReviewTimeoutGuidance,
  gitTimeoutReason,
} from "../../state/git-review-refresh.js";
import { buildReviewQueueItems } from "../../state/review-queue.js";
import {
  manyReviewComments,
  sampleComments,
  sampleCompletedThreadPaths,
  sampleFiles,
  sampleReviewChanges,
  sampleReviewDiffStats,
  sampleReviewQueueItems,
  sampleThreadActivities,
  sampleUnreadReviewPaths,
  storyNow,
  unknownCodingAgent,
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
  reviewComments: sampleComments,
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
  onAcceptReviewPath: noop,
  onRestoreAcceptedReviewPath: noop,
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
    const nextAction = canvas.getByRole("region", {
      name: "Recommended review action",
    });
    await expect(nextAction).toHaveTextContent("Next action");
    await expect(nextAction).toHaveTextContent(
      "Verify the current open thread",
    );
    await expect(
      within(nextAction).getByRole("button", { name: "Open comments" }),
    ).toBeVisible();
    await expect(nextAction).toHaveTextContent("Active review work");

    const row = canvas.getByRole("button", {
      name: `Review queue item, modified ${sampleFiles.code.path}, current review file`,
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
    await expect(
      canvas.queryByTestId("review-open-comments-panel"),
    ).not.toBeInTheDocument();
  },
};

export const ReviewQueueItemWithLatestAgentActivity: Story = {
  args: {
    unreadReviewPaths: new Set([sampleFiles.code.path]),
  },
};

export const InspectorModeSwitching: Story = {
  tags: ["interaction"],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const storyWindow = canvasElement.ownerDocument.defaultView ?? window;

    await expect(canvas.getByText("Queue")).toBeInTheDocument();
    await expect(canvas.getByText("3 need action")).toBeInTheDocument();
    await expect(
      canvas.getByRole("radio", { name: "A Review active work" }),
    ).toHaveAttribute("aria-keyshortcuts", "Meta+Alt+R Control+Alt+R");
    const lifecycle = canvas.getByRole("group", {
      name: "Review target lifecycle",
    });
    await expect(lifecycle).toHaveTextContent("Detected");
    await expect(lifecycle).toHaveTextContent("Seen");
    await expect(lifecycle).toHaveTextContent("In review");
    await expect(lifecycle).toHaveTextContent("Done history");
    await expect(canvas.queryByText("Current file")).not.toBeInTheDocument();
    await expect(canvas.getByText("In this file")).not.toBeVisible();

    await userEvent.click(
      canvas.getByRole("radio", { name: "B Threads conversation" }),
    );
    await expect(canvas.getByText("Threads")).toBeVisible();
    await expect(canvas.getByText("3 open")).toBeVisible();
    await expect(canvas.getByText("Current thread: diff L10")).toBeVisible();
    await expect(canvas.getByRole("tab", { name: "Open" })).toBeVisible();
    await expect(canvas.getByRole("tab", { name: "Drafts" })).toBeVisible();
    await expect(canvas.getByRole("tab", { name: "History" })).toBeVisible();
    await expect(canvas.getByText("This file")).toBeVisible();
    await expect(canvas.getByText("Queue context")).toBeVisible();
    await expect(canvas.getByText("Queue")).not.toBeVisible();
    await expect(canvas.getByText("In this file")).not.toBeVisible();

    fireEvent.keyDown(storyWindow, {
      altKey: true,
      key: "m",
      metaKey: true,
    });
    await expect(canvas.getByText("Reader")).toBeVisible();
    await expect(canvas.getByText("Code · 4 symbols")).toBeVisible();
    await expect(canvas.getByText("In this file")).toBeVisible();
    await expect(canvas.getByText("queue files")).toBeVisible();
    await expect(canvas.getByText("This file")).not.toBeVisible();
    await expect(canvas.getByText("Queue")).not.toBeVisible();

    fireEvent.keyDown(storyWindow, {
      altKey: true,
      key: "r",
      metaKey: true,
    });
    await expect(canvas.getByText("Queue")).toBeVisible();
  },
};

export const HiddenHistoryDisclosure: Story = {
  tags: ["interaction"],
  args: {
    file: sampleFiles.queue,
    activePath: resolvedHandoffComment.path,
    reviewChanges: [resolvedHandoffChange],
    reviewItems: buildReviewQueueItems(
      [resolvedHandoffChange],
      [resolvedHandoffComment],
      sampleThreadActivities,
      new Set(),
      { completedThreadPaths: new Set([resolvedHandoffComment.path]) },
    ),
    comments: [resolvedHandoffComment],
    reviewComments: [resolvedHandoffComment],
    unreadReviewPaths: new Set(),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByText("Hidden from queue")).toBeVisible();
    await expect(
      canvas.getByRole("group", { name: "Review target lifecycle" }),
    ).toHaveTextContent("Done history");
    await expect(canvas.getByText("1 done")).toBeVisible();
    await expect(
      canvasElement.querySelector(".hidden-review-history-item"),
    ).not.toBeVisible();

    await userEvent.click(canvas.getByText("Hidden from queue"));
    await expect(
      canvasElement.querySelector(".hidden-review-history-item"),
    ).toBeVisible();
  },
};

export const ReviewQueueNoActiveFile: Story = {
  args: {
    file: null,
    activePath: null,
    comments: [],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("button", {
        name: `Review queue item, modified ${sampleFiles.code.path}`,
      }),
    ).toBeInTheDocument();
    await expect(
      canvas.queryByTestId("review-open-comments-panel"),
    ).not.toBeInTheDocument();
    await expect(
      canvas.queryByText("Open in Comments panel"),
    ).not.toBeInTheDocument();
  },
};

export const ActiveReviewFilePinnedFromQueuePosition: Story = {
  args: {
    activePath: sampleReviewQueueItems[1]!.path,
    reviewItems: sampleReviewQueueItems.slice(0, 2),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("pinned from 2/2")).toBeInTheDocument();
    const activeRow = canvas.getByRole("button", {
      name: `modified ${sampleReviewQueueItems[1]!.path}, current review file`,
    });
    await expect(activeRow).toHaveAttribute("aria-current", "true");
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
      { completedThreadPaths: new Set([resolvedHandoffComment.path]) },
    ),
    comments: [],
    reviewComments: [resolvedHandoffComment],
    unreadReviewPaths: new Set(),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("No open threads")).toBeInTheDocument();
    await expect(canvas.getByText("Codex marked resolved")).toBeInTheDocument();
    await expect(canvas.queryByText("Queue stop")).not.toBeInTheDocument();
    await expect(canvas.queryByText("Next queue stop")).not.toBeInTheDocument();
  },
};

export const ResolvedThreadActivityFromUnknownActor: Story = {
  args: {
    file: sampleFiles.queue,
    activePath: resolvedHandoffComment.path,
    reviewChanges: [resolvedHandoffChange],
    reviewItems: buildReviewQueueItems(
      [resolvedHandoffChange],
      [resolvedHandoffComment],
      {
        "thread-resolved": summarizeThreadActivity(
          [
            {
              id: "activity-unknown-coding-agent",
              threadId: "thread-resolved",
              type: "thread_status_changed",
              actor: unknownCodingAgent,
              previousStatus: "open",
              status: "resolved",
              createdAt: "2026-06-20T09:05:00.000Z",
            },
          ],
          storyNow,
        ),
      },
      new Set(),
      { completedThreadPaths: new Set([resolvedHandoffComment.path]) },
    ),
    comments: [],
    reviewComments: [resolvedHandoffComment],
    unreadReviewPaths: new Set(),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByText("coding-agent marked resolved"),
    ).toBeInTheDocument();
    await expect(canvas.queryByText("Unknown agent")).not.toBeInTheDocument();
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

export const ActiveThreadActions: Story = {
  tags: ["interaction"],
  args: {
    activeCommentId: "comment-workbench-open-1",
    onCommentStatusChange: noop,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole("radio", { name: "B Threads conversation" }),
    );
    expect(
      canvas.getAllByRole("button", { name: "Resolve" }).length,
    ).toBeGreaterThan(0);
    await expect(
      canvas.getByRole("button", { name: "Resolve current thread" }),
    ).toBeInTheDocument();
    await expect(
      canvas.getByRole("button", { name: "Archive current thread" }),
    ).toBeInTheDocument();
  },
};

export const ActiveThreadSourceMissingAnchor: Story = {
  args: {
    file: null,
    activePath: null,
    comments: [staleThreadOnlyComment],
    knownMissingCommentPaths: new Set(["missing-review.md"]),
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

export const AcceptChangeHidesCandidate: Story = {
  tags: ["interaction"],
  args: {
    file: sampleFiles.markdown,
    activePath: sampleFiles.markdown.path,
    comments: [],
    reviewComments: [],
    unreadReviewPaths: new Set(),
  },
  render: (args) => <AcceptChangeInspector {...args} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByText("Review current file")).toBeVisible();
    await userEvent.click(
      canvas.getByRole("button", { name: "Accept change" }),
    );

    await expect(canvas.getByText("Hidden from queue")).toBeVisible();
    await expect(canvas.getByText("1 done")).toBeVisible();
    await expect(
      canvas.queryByText("Review current file"),
    ).not.toBeInTheDocument();

    await userEvent.click(canvas.getByText("Hidden from queue"));
    await expect(canvas.getByText("accepted as-is")).toBeVisible();
    await expect(
      canvas.getByRole("button", {
        name: `Restore accepted change ${sampleFiles.markdown.path} to the review queue`,
      }),
    ).toBeVisible();
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

export const GitReviewTimeoutUnavailable: Story = {
  args: {
    reviewChanges: [],
    reviewItems: [],
    reviewUnavailableReason: gitTimeoutReason,
    unreadReviewPaths: new Set(),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("status", { name: "Git review unavailable" }),
    ).toBeInTheDocument();
    await expect(canvas.getByText(gitTimeoutReason)).toBeInTheDocument();
    await expect(
      canvas.getByText(gitReviewTimeoutGuidance),
    ).toBeInTheDocument();
  },
};

export const GitReviewTrackedOnlyWarning: Story = {
  args: {
    reviewUnavailableReason:
      "Git untracked scan timed out; showing tracked changes only.",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Review Queue")).toBeInTheDocument();
    await expect(
      canvas.getByText(
        "Git review warning: Git untracked scan timed out; showing tracked changes only.",
      ),
    ).toBeInTheDocument();
    await expect(
      canvas.getByRole("button", {
        name: `modified ${sampleFiles.code.path}, current review file`,
      }),
    ).toBeInTheDocument();
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

export const LoadingGitReviewWithOpenThreads: Story = {
  args: {
    file: null,
    activePath: sampleFiles.code.path,
    reviewChanges: [],
    reviewItems: buildReviewQueueItems(
      [],
      sampleComments.filter(
        (comment) => comment.path === sampleFiles.code.path,
      ),
      sampleThreadActivities,
      new Set(),
    ),
    comments: [],
    reviewComments: sampleComments.filter(
      (comment) => comment.path === sampleFiles.code.path,
    ),
    reviewLoading: true,
    unreadReviewPaths: new Set(),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("loading changed files")).toBeInTheDocument();
    await expect(canvas.queryByText("all seen")).not.toBeInTheDocument();
    await expect(
      canvas.getByText(
        "Loading Git review; open comment threads may appear before changed files.",
      ),
    ).toBeInTheDocument();
  },
};

function AcceptChangeInspector(args: Story["args"]) {
  const candidateChange: ReviewChangeItem = {
    path: sampleFiles.markdown.path,
    status: "modified",
    source: "git",
  };
  const [acceptedPaths, setAcceptedPaths] = useState<Set<string>>(new Set());
  const acceptedReviewChanges = acceptedPaths.has(candidateChange.path)
    ? [candidateChange]
    : [];
  const reviewItems = useMemo(
    () =>
      buildReviewQueueItems([candidateChange], [], {}, new Set(), {
        acceptedPaths,
      }),
    [acceptedPaths],
  );

  return (
    <Inspector
      {...baseArgs}
      {...args}
      acceptedReviewChanges={acceptedReviewChanges}
      reviewChanges={[candidateChange]}
      reviewItems={reviewItems}
      onAcceptReviewPath={(path) =>
        setAcceptedPaths((paths) => new Set(paths).add(path))
      }
      onRestoreAcceptedReviewPath={(path) =>
        setAcceptedPaths((paths) => {
          const next = new Set(paths);
          next.delete(path);
          return next;
        })
      }
    />
  );
}
