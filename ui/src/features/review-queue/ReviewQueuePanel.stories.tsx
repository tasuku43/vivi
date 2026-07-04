import { useMemo, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
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
  sampleDraftComments,
  sampleFiles,
  sampleReviewChanges,
  sampleReviewDiffStats,
  sampleReviewQueueItems,
  sampleThreadActivities,
  sampleUnreadReviewPaths,
  storyNow,
  unknownCodingAgent,
} from "../../storybook/fixtures/review-lab.js";
import sharedUiStyles from "../../shared/styles/SharedUi.module.css";
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
  onPublishDrafts: noop,
  onAcceptReviewPath: noop,
  onRestoreAcceptedReviewPath: noop,
};

const sampleDraftCommentsWithThreadReply = sampleDraftComments.map((draft) =>
  draft.id === "draft-review-1"
    ? {
        ...draft,
        threadId: "thread-workbench-open",
        body: "Keep this pending follow-up attached to the existing workbench thread.",
      }
    : draft,
);

const meta = {
  title: "Review/Queue States",
  component: Inspector,
  decorators: [
    (Story) => (
      <div
        style={{
          width: 396,
          minHeight: "100vh",
          marginLeft: "auto",
          background: "var(--vivi-color-surface-panel)",
        }}
      >
        <Story />
      </div>
    ),
  ],
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
    await expect(
      canvas.getByRole("region", { name: "Review states" }),
    ).toHaveTextContent("Queued");
    await expect(
      canvas.getByRole("region", { name: "Review states" }),
    ).toHaveTextContent("In Review");
    await expect(
      canvas.getByRole("region", { name: "Review states" }),
    ).toHaveTextContent("Reviewed");
    await expect(canvas.queryByText("Next action")).not.toBeInTheDocument();
    await expect(canvas.queryByText("Lifecycle")).not.toBeInTheDocument();
    await expect(
      canvas.queryByRole("radio", { name: "A Review active work" }),
    ).not.toBeInTheDocument();
    await expect(
      canvas.getByText("In Review", { selector: "summary span" }),
    ).toBeVisible();
    await expect(
      canvas.getByText("Reviewed", { selector: "summary span" }),
    ).toBeVisible();
    await expect(
      canvasElement.querySelector(".review-state-section.reviewed"),
    ).not.toHaveAttribute("open");

    const row = canvas.getByRole("button", {
      name: `Review queue item, modified ${sampleFiles.code.path}, current review file`,
    });
    await expect(row).not.toHaveTextContent("MODIFIED");
    await userEvent.click(row);
    await expect(row).toHaveAttribute(
      "aria-describedby",
      expect.stringContaining("review-queue-item-"),
    );
    const descriptionId = row
      .getAttribute("aria-describedby")
      ?.split(/\s+/)
      .find((id) => id.startsWith("review-queue-item-"));
    await expect(descriptionId).toBeTruthy();
    await expect(
      canvasElement.querySelector(`#${descriptionId}`),
    ).toHaveTextContent("unread review activity");
    await expect(
      canvasElement.querySelector(`#${descriptionId}`),
    ).toHaveTextContent("open");
    await expect(
      canvas.queryByTestId("review-open-comments-panel"),
    ).not.toBeInTheDocument();
  },
};

export const ReviewQueueItemWithPendingDrafts: Story = {
  args: {
    draftComments: sampleDraftCommentsWithThreadReply,
    reviewItems: buildReviewQueueItems(
      sampleReviewChanges,
      sampleComments,
      sampleThreadActivities,
      sampleUnreadReviewPaths,
      {
        completedThreadPaths: sampleCompletedThreadPaths,
        draftComments: sampleDraftCommentsWithThreadReply,
      },
    ),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByLabelText("Pending draft publish actions"),
    ).toHaveTextContent("Publish pending");
    await expect(
      canvas.getByRole("button", {
        name: /Show \d+ open · \d+ pending for/,
      }),
    ).toBeVisible();
    await expect(
      canvas.getByRole("button", {
        name: /Show \d+ pending for/,
      }),
    ).toBeVisible();
  },
};

export const InReviewFileThreadExpansion: Story = {
  render: () => <InReviewThreadExpansionFacade />,
};

export const InReviewFileThreadExpansionInteraction: Story = {
  tags: ["interaction"],
  render: () => <InReviewThreadExpansionFacade />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("region", { name: "Review states" }),
    ).toHaveTextContent("Queued");
    await expect(
      canvas.getByText("In Review", { selector: "summary span" }),
    ).toBeVisible();
    await expect(
      canvas.getByText("Reviewed", { selector: "summary span" }),
    ).toBeVisible();

    await expect(
      canvas.getByText("3", { selector: ".reviewing strong" }),
    ).toBeVisible();
    await expect(canvas.getByText("3 files · 3 pending")).not.toBeVisible();
    await expect(
      canvas.getByRole("button", {
        name: "Show 2 open and 1 pending for docs/product-review.md",
      }),
    ).toHaveTextContent("2 open · 1 pending");
    await expect(
      canvas.getByRole("button", {
        name: "Show 2 pending for CodeCommentThread.tsx",
      }),
    ).toHaveTextContent("2 pending");
    await expect(
      canvas.getByLabelText("Pending draft publish actions"),
    ).toHaveTextContent("Publish pending");

    await userEvent.click(
      canvas.getByRole("button", {
        name: "Review queue item, modified docs/product-review.md, current review file",
      }),
    );
    await expect(
      canvas.getByRole("status", { name: "Opened file" }),
    ).toHaveTextContent("docs/product-review.md");
    await expect(
      canvas.queryByRole("button", {
        name: /Open open item, docs\/product-review\.md, L7/i,
      }),
    ).not.toBeInTheDocument();

    await userEvent.click(
      canvas.getByRole("button", {
        name: "Show 2 open and 1 pending for docs/product-review.md",
      }),
    );

    const firstThread = canvas.getByRole("button", {
      name: /Open open item, docs\/product-review\.md, L7/i,
    });
    await expect(firstThread).toBeVisible();
    await expect(firstThread).toHaveTextContent(
      "Keep this feedback layer visible in the inspector outline story.",
    );
    await expect(firstThread).toHaveTextContent("Open");
    await expect(
      canvas.getByRole("button", {
        name: /Open pending item, docs\/product-review\.md, L18/i,
      }),
    ).toHaveTextContent("Pending");
    await expect(
      canvas.getByRole("button", {
        name: "Publish pending item, docs/product-review.md, L18",
      }),
    ).toBeVisible();
    await expect(
      canvas.getByRole("button", {
        name: /Open open item, docs\/product-review\.md, L31/i,
      }),
    ).toHaveTextContent("Open");

    await userEvent.click(
      canvas.getByRole("button", {
        name: /Open pending item, docs\/product-review\.md, L18/i,
      }),
    );
    await expect(
      canvas.getByRole("status", { name: "Opened thread" }),
    ).toHaveTextContent("docs/product-review.md · L18");
    await expect(
      canvas.getByRole("status", { name: "Opened file" }),
    ).toHaveTextContent("docs/product-review.md");
    await userEvent.click(
      canvas.getByRole("button", {
        name: "Publish pending item, docs/product-review.md, L18",
      }),
    );
    await expect(
      canvas.getByRole("button", {
        name: /Open open item, docs\/product-review\.md, L18/i,
      }),
    ).toHaveTextContent("published just now");
    await expect(
      canvas.getByLabelText("Pending draft publish actions"),
    ).toHaveTextContent("Publish pending");
    await userEvent.click(
      canvas.getByRole("button", {
        name: "Publish all 2 pending",
      }),
    );
    await expect(
      canvas.getByLabelText("Pending draft publish actions"),
    ).toHaveTextContent("Published");
  },
};

export const InReviewReadReceiptPlayground: Story = {
  tags: ["interaction"],
  render: () => <InReviewReadReceiptPlaygroundFacade />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("region", { name: "Review states" }),
    ).toHaveTextContent("In Review");
    await expect(
      canvas.getByRole("button", {
        name: "Show receipt threads for docs/product-review.md",
      }),
    ).toHaveTextContent("2 open · 1 pending");
    await expect(
      canvas.getByRole("button", {
        name: "Publish pending thread docs/product-review.md L18",
      }),
    ).toBeVisible();
    await expect(
      canvas.getByText("Codex replied · unread by you"),
    ).toBeVisible();

    await userEvent.click(
      canvas.getByRole("button", {
        name: "Publish pending thread docs/product-review.md L18",
      }),
    );
    await expect(
      canvas.getByRole("group", {
        name: "1 unread replies, 1 pending threads",
      }),
    ).toBeInTheDocument();
    await expect(
      canvas.getByText("published · not read by agent"),
    ).toBeVisible();
    await expect(
      canvas.getByRole("button", {
        name: "Show receipt threads for docs/product-review.md",
      }),
    ).toHaveTextContent("3 open");
  },
};

export const ReviewQueueItemWithLatestAgentActivity: Story = {
  name: "Queue item shows latest agent activity",
  args: {
    activePath: "docs/agent-handoff.md",
    reviewItems: [
      {
        path: "docs/agent-handoff.md",
        change: null,
        threadCounts: { open: 2, resolved: 0, archived: 0 },
        commentCount: 3,
        latestActivity: {
          id: "activity-story-agent-reply",
          threadId: "thread-story-agent-reply",
          type: "comment_added",
          actor: unknownCodingAgent,
          commentId: "comment-story-agent-reply",
          createdAt: "2026-06-20T09:16:00.000Z",
        },
        unread: true,
      },
      {
        path: "ui/src/features/comments/components/CodeCommentThread.tsx",
        change: null,
        threadCounts: { open: 1, resolved: 0, archived: 0 },
        commentCount: 1,
        unread: false,
      },
    ],
    unreadReviewPaths: new Set(["docs/agent-handoff.md"]),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const agentRow = canvas.getByRole("button", {
      name: "Review queue item, comment docs/agent-handoff.md, current review file",
    });
    await expect(agentRow).toHaveClass("has-agent-reply");
    await expect(
      agentRow.querySelector(".unread-dot.agent-reply"),
    ).toBeInTheDocument();
    await expect(
      canvasElement.querySelector(
        ".change-open.has-open-threads:not(.has-agent-reply) .unread-dot.muted",
      ),
    ).toBeInTheDocument();
    await expect(agentRow).toHaveAccessibleDescription(
      expect.stringContaining("agent reply needs attention"),
    );
  },
};

export const ReviewStateSections: Story = {
  tags: ["interaction"],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(
      canvasElement.querySelector(".panel-title > span:first-child"),
    ).toHaveTextContent("Review");
    await expect(canvas.getByText("3 need action")).toBeInTheDocument();
    await expect(
      canvas.queryByRole("radio", { name: "B Threads conversation" }),
    ).not.toBeInTheDocument();
    await expect(canvas.queryByText("Current file")).not.toBeInTheDocument();
    await expect(canvas.queryByText("In this file")).not.toBeInTheDocument();
    await expect(
      canvas.getByText("Queued", { selector: "summary span" }),
    ).toBeVisible();
    await expect(
      canvas.getByText("In Review", { selector: "summary span" }),
    ).toBeVisible();
    await expect(
      canvas.getByText("Reviewed", { selector: "summary span" }),
    ).toBeVisible();
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

    await expect(
      canvas.getByText("Reviewed", { selector: "summary span" }),
    ).toBeVisible();
    await expect(canvas.getByText("1 reviewed")).toBeVisible();
    await expect(
      canvasElement.querySelector(".hidden-review-history-item"),
    ).not.toBeVisible();

    await userEvent.click(
      canvas.getByText("Reviewed", { selector: "summary span" }),
    );
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
    await expect(canvas.queryByText("pinned from 2/2")).not.toBeInTheDocument();
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
    await expect(
      canvas.getByText("Reviewed", { selector: "summary span" }),
    ).toBeInTheDocument();
    await userEvent.click(
      canvas.getByText("Reviewed", { selector: "summary span" }),
    );
    await expect(canvas.getByText("resolved")).toBeInTheDocument();
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
    await expect(canvas.getByText("No queued files")).toBeInTheDocument();
    await expect(
      canvas.getByText("New HEAD evidence will appear here."),
    ).toBeInTheDocument();
    await expect(canvas.getByText("No active review work")).toBeInTheDocument();
    await expect(
      canvas.getByText("Agent replies and open threads will rise here."),
    ).toBeInTheDocument();
    await expect(canvas.queryByText("No files here.")).not.toBeInTheDocument();
    expect(
      canvasElement.querySelectorAll(
        ".review-state-empty-row .unread-dot.muted",
      ).length,
    ).toBe(2);
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
  play: async ({ canvasElement }) => {
    await expect(
      canvasElement.querySelector(
        '.review-state-section.queued .change-open[data-review-path="server/graphql/schema.graphqls"] .unread-dot.muted',
      ),
    ).toBeInTheDocument();
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
    await expect(
      canvas.queryByRole("radio", { name: "B Threads conversation" }),
    ).not.toBeInTheDocument();
    await expect(
      canvas.getByText("In Review", { selector: "summary span" }),
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
    await expect(
      canvas.getByText("Queued", { selector: "summary span" }),
    ).toBeInTheDocument();
    await expect(
      canvas.queryByText("missing-review.md"),
    ).not.toBeInTheDocument();
    await expect(
      canvas.getByText(sampleReviewQueueItems[0]!.path),
    ).toBeInTheDocument();
  },
};

export const AllRead: Story = {
  args: {
    unreadReviewPaths: new Set(),
    reviewItems: sampleReviewQueueItems.map((item) => ({
      ...item,
      unread: false,
    })),
  },
};

export const MarkReviewedHidesCandidate: Story = {
  tags: ["interaction"],
  args: {
    file: sampleFiles.markdown,
    activePath: sampleFiles.markdown.path,
    comments: [],
    reviewComments: [],
    unreadReviewPaths: new Set(),
  },
  render: (args) => <ReviewedChangeInspector {...args} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByText("1 reviewed")).toBeVisible();
    await expect(
      canvas.queryByRole("button", {
        name: `Review queue item, modified ${sampleFiles.markdown.path}`,
      }),
    ).not.toBeInTheDocument();

    await userEvent.click(
      canvas.getByText("Reviewed", { selector: "summary span" }),
    );
    await expect(canvas.getByText("marked reviewed")).toBeVisible();
    await expect(
      canvas.getByRole("button", {
        name: `Move reviewed change ${sampleFiles.markdown.path} back to the review queue`,
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
    await expect(
      canvas.getByText("Queued", { selector: "summary span" }),
    ).toBeInTheDocument();
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
    await expect(
      canvas.getByText("In Review", { selector: "summary span" }),
    ).toBeInTheDocument();
    await expect(
      canvas.getByText(
        "Loading Git review; open comment threads may appear before changed files.",
      ),
    ).toBeInTheDocument();
  },
};

function ReviewedChangeInspector(args: Story["args"]) {
  const candidateChange: ReviewChangeItem = {
    path: sampleFiles.markdown.path,
    status: "modified",
    source: "git",
  };
  const [acceptedPaths, setAcceptedPaths] = useState<Set<string>>(
    () => new Set([candidateChange.path]),
  );
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

function InReviewThreadExpansionFacade() {
  const [expanded, setExpanded] = useState(false);
  const [openedFile, setOpenedFile] = useState<string | null>(null);
  const [openedThread, setOpenedThread] = useState<string | null>(null);
  const [publishedPendingIds, setPublishedPendingIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [publishedAllPending, setPublishedAllPending] = useState(false);
  const threads = [
    {
      id: "product-l7",
      status: "open",
      statusLabel: "Open",
      location: "L7",
      surface: "Rendered Markdown",
      preview:
        "Keep this feedback layer visible in the inspector outline story.",
      meta: "1 message · updated 18:14",
    },
    {
      id: "product-l18",
      status: "pending",
      statusLabel: "Pending",
      location: "L18",
      surface: "Source",
      preview: "Mention the agent-readable contract before the diff example.",
      meta: "not agent-visible · publishes as open",
    },
    {
      id: "product-l31",
      status: "open",
      statusLabel: "Open",
      location: "L31",
      surface: "Rendered Markdown",
      preview: "Keep the draft visibility note near the reviewer workflow.",
      meta: "1 message · updated 18:22",
    },
  ].map((thread) =>
    thread.status === "pending" && publishedPendingIds.has(thread.id)
      ? {
          ...thread,
          status: "open",
          statusLabel: "Open",
          meta: "published just now · agent-visible",
        }
      : thread,
  );
  const productPendingCount = threads.filter(
    (thread) => thread.status === "pending",
  ).length;
  const draftTrayPendingCount = publishedAllPending ? 0 : 2;
  const pendingCount = productPendingCount + draftTrayPendingCount;

  return (
    <aside
      className={`${sharedUiStyles.inspector} inspector review-thread-pattern-a`}
      aria-label="Review inspector"
    >
      <div
        className={`${sharedUiStyles.panelTitle} panel-title review-panel-title`}
      >
        <span className="review-panel-heading">
          <span>Review</span>
          <strong>
            {pendingCount ? `${pendingCount} pending` : "0 pending"}
          </strong>
        </span>
        <button
          className={`${sharedUiStyles.commandButton} ${sharedUiStyles.commandButtonSecondary} command-button command-button-secondary review-next-action`}
          type="button"
        >
          Next
        </button>
      </div>
      <div className="inspect-body">
        <div className="inspector-review-mode">
          <section className="review-state-summary" aria-label="Review states">
            <span className="review-state-card queued">
              <strong>3</strong>
              <span>Queued</span>
            </span>
            <span className="review-state-card reviewing">
              <strong>3</strong>
              <span>In Review</span>
            </span>
            <span className="review-state-card reviewed">
              <strong>5</strong>
              <span>Reviewed</span>
            </span>
          </section>
          <div
            className="review-queue"
            role="group"
            aria-label="Review queue, 3 queued, 3 in review, 5 reviewed"
          >
            <details className="review-state-section queued" open>
              <summary>
                <span>Queued</span>
                <small>3 files waiting for review</small>
              </summary>
              <div className="review-state-section-list">
                <button
                  className="change-open"
                  type="button"
                  aria-label="Review queue item, modified README.md"
                >
                  <span
                    className={`${sharedUiStyles.muted} unread-dot muted`}
                    aria-hidden="true"
                  />
                  <span className="change-main">
                    <span className="change-heading">
                      <span className="change-kind">MD</span>
                      <b>README.md</b>
                    </span>
                    <small className="review-thread-summary">
                      read git · no open
                    </small>
                  </span>
                  <span className="diff-stat">
                    <span className="diff-add">+8</span>
                    <span className="diff-remove">-2</span>
                  </span>
                </button>
              </div>
            </details>

            <details className="review-state-section reviewing" open>
              <summary>
                <span>In Review</span>
                <small>
                  {pendingCount
                    ? `3 files · ${pendingCount} pending`
                    : "3 files · published"}
                </small>
              </summary>
              {pendingCount ? (
                <div
                  className="review-section-publish-control"
                  aria-label="Pending draft publish actions"
                >
                  <button
                    className="review-publish-action"
                    type="button"
                    aria-label={`Publish all ${pendingCount} pending`}
                    onClick={() => {
                      setPublishedAllPending(true);
                      setPublishedPendingIds((current) => {
                        const next = new Set(current);
                        for (const thread of threads) {
                          if (thread.status === "pending") next.add(thread.id);
                        }
                        return next;
                      });
                    }}
                  >
                    Publish pending
                  </button>
                </div>
              ) : (
                <div
                  className="review-section-publish-control published"
                  aria-label="Pending draft publish actions"
                >
                  Published
                </div>
              )}
              <div className="review-state-section-list">
                <div className="review-thread-expand-file active">
                  <button
                    className="change-open active has-open-threads"
                    type="button"
                    aria-current="true"
                    aria-label="Review queue item, modified docs/product-review.md, current review file"
                    onClick={() => setOpenedFile("docs/product-review.md")}
                  >
                    <span
                      className={`${sharedUiStyles.muted} unread-dot muted`}
                      aria-hidden="true"
                    />
                    <span className="change-main">
                      <span className="change-heading">
                        <span className="change-kind">MD</span>
                        <b>product-review.md</b>
                      </span>
                      <small className="review-thread-summary">
                        {productPendingCount
                          ? "2 open · 1 pending · latest by Tasuku"
                          : "3 open · latest by Tasuku"}
                      </small>
                    </span>
                    <span
                      className="review-thread-count-space"
                      aria-hidden="true"
                    />
                  </button>
                  <button
                    className={`review-thread-count-toggle${productPendingCount ? " pending" : ""}`}
                    type="button"
                    aria-expanded={expanded}
                    aria-controls="storybook-in-review-thread-list"
                    aria-label={
                      productPendingCount
                        ? "Show 2 open and 1 pending for docs/product-review.md"
                        : "Show 3 open for docs/product-review.md"
                    }
                    onClick={() => setExpanded((current) => !current)}
                  >
                    {productPendingCount ? "2 open · 1 pending" : "3 open"}
                  </button>
                  {expanded ? (
                    <div
                      className="review-thread-hairline-list"
                      id="storybook-in-review-thread-list"
                      aria-label="Open review items for docs/product-review.md"
                    >
                      {threads.map((thread) => (
                        <div
                          className="review-thread-hairline-item"
                          key={thread.id}
                        >
                          <button
                            className={`review-thread-hairline-row ${
                              openedThread ===
                              `docs/product-review.md · ${thread.location}`
                                ? "active"
                                : ""
                            }${thread.status === "pending" ? " has-publish-action" : ""}`}
                            type="button"
                            aria-label={`Open ${thread.status} item, docs/product-review.md, ${thread.location}, ${thread.surface}`}
                            onClick={() => {
                              setOpenedFile("docs/product-review.md");
                              setOpenedThread(
                                `docs/product-review.md · ${thread.location}`,
                              );
                            }}
                          >
                            <span className="review-thread-hairline-main">
                              <span className="review-thread-hairline-title">
                                <span>
                                  {thread.location} · {thread.surface}
                                </span>
                                <span
                                  className={`review-thread-status-badge ${thread.status}`}
                                >
                                  {thread.statusLabel}
                                </span>
                              </span>
                              <span className="review-thread-hairline-preview">
                                {thread.preview}
                              </span>
                              <span className="review-thread-hairline-meta">
                                {thread.meta}
                              </span>
                            </span>
                          </button>
                          {thread.status === "pending" ? (
                            <button
                              className="review-thread-publish-button"
                              type="button"
                              aria-label={`Publish pending item, docs/product-review.md, ${thread.location}`}
                              onClick={() => {
                                setPublishedPendingIds((current) => {
                                  const next = new Set(current);
                                  next.add(thread.id);
                                  return next;
                                });
                              }}
                            >
                              Publish
                            </button>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>

                <div className="review-thread-expand-file">
                  <button
                    className="change-open has-open-threads"
                    type="button"
                    aria-label="Review queue item, modified WorkbenchContainer.tsx"
                    onClick={() => setOpenedFile("WorkbenchContainer.tsx")}
                  >
                    <span
                      className="unread-dot agent-reply"
                      aria-hidden="true"
                    />
                    <span className="change-main">
                      <span className="change-heading">
                        <span className="change-kind">TS</span>
                        <b>WorkbenchContainer.tsx</b>
                      </span>
                      <small className="review-thread-summary">
                        Agent replied · needs decision
                      </small>
                    </span>
                    <span
                      className="review-thread-count-space"
                      aria-hidden="true"
                    />
                  </button>
                  <button
                    className="review-thread-count-toggle"
                    type="button"
                    aria-expanded="false"
                    aria-label="Show 1 open for WorkbenchContainer.tsx"
                  >
                    1 open
                  </button>
                </div>

                <div className="review-thread-expand-file">
                  <button
                    className="change-open has-open-threads"
                    type="button"
                    aria-label="Review queue item, modified CodeCommentThread.tsx"
                    onClick={() => setOpenedFile("CodeCommentThread.tsx")}
                  >
                    <span
                      className={`${sharedUiStyles.muted} unread-dot muted`}
                      aria-hidden="true"
                    />
                    <span className="change-main">
                      <span className="change-heading">
                        <span className="change-kind">TS</span>
                        <b>CodeCommentThread.tsx</b>
                      </span>
                      <small className="review-thread-summary">
                        {draftTrayPendingCount
                          ? "2 pending · not agent-visible"
                          : "published · agent-visible"}
                      </small>
                    </span>
                    <span
                      className="review-thread-count-space"
                      aria-hidden="true"
                    />
                  </button>
                  <button
                    className={`review-thread-count-toggle${draftTrayPendingCount ? " pending" : ""}`}
                    type="button"
                    aria-expanded="false"
                    aria-label={
                      draftTrayPendingCount
                        ? "Show 2 pending for CodeCommentThread.tsx"
                        : "Show published for CodeCommentThread.tsx"
                    }
                  >
                    {draftTrayPendingCount ? "2 pending" : "Published"}
                  </button>
                </div>
              </div>
            </details>

            <details className="review-state-section reviewed">
              <summary>
                <span>Reviewed</span>
                <small>5 reviewed</small>
              </summary>
            </details>
          </div>
          <p
            className={`${sharedUiStyles.srOnly} sr-only`}
            role="status"
            aria-label="Opened file"
          >
            {openedFile ?? "No file opened"}
          </p>
          <p
            className={`${sharedUiStyles.srOnly} sr-only`}
            role="status"
            aria-label="Opened thread"
          >
            {openedThread ?? "No thread opened"}
          </p>
        </div>
      </div>
    </aside>
  );
}

type ReadReceiptThreadState =
  | "pending"
  | "not-read"
  | "agent-read"
  | "agent-replied"
  | "human-read"
  | "resolved";

interface ReadReceiptThread {
  id: string;
  path: string;
  kind: string;
  location: string;
  surface: string;
  preview: string;
  actor: string;
  state: ReadReceiptThreadState;
}

const initialReadReceiptThreads: ReadReceiptThread[] = [
  {
    id: "product-l7",
    path: "docs/product-review.md",
    kind: "MD",
    location: "L7",
    surface: "Rendered Markdown",
    preview: "Keep the feedback layer visible in the inspector outline story.",
    actor: "Codex",
    state: "agent-replied",
  },
  {
    id: "product-l18",
    path: "docs/product-review.md",
    kind: "MD",
    location: "L18",
    surface: "Source",
    preview: "Mention the agent-readable contract before the diff example.",
    actor: "Claude Code",
    state: "pending",
  },
  {
    id: "product-l31",
    path: "docs/product-review.md",
    kind: "MD",
    location: "L31",
    surface: "Rendered Markdown",
    preview: "Keep the draft visibility note near the reviewer workflow.",
    actor: "Claude Code",
    state: "agent-read",
  },
  {
    id: "thread-code-l9",
    path: "ui/src/features/comments/components/CodeCommentThread.tsx",
    kind: "TSX",
    location: "L9",
    surface: "Source",
    preview: "Pending follow-up copy for the inline thread composer.",
    actor: "Codex",
    state: "pending",
  },
  {
    id: "thread-workbench-l42",
    path: "ui/src/features/workbench/WorkbenchContainer.tsx",
    kind: "TSX",
    location: "L42",
    surface: "Source",
    preview: "Make the active review stop survive queue movement.",
    actor: "Claude Code",
    state: "not-read",
  },
];

function InReviewReadReceiptPlaygroundFacade() {
  const [threads, setThreads] = useState<ReadReceiptThread[]>(
    () => initialReadReceiptThreads,
  );
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(
    () => new Set(["docs/product-review.md"]),
  );
  const [openedFile, setOpenedFile] = useState("docs/product-review.md");
  const [openedThread, setOpenedThread] = useState("product-l7");

  const visibleThreads = threads.filter((thread) => thread.state !== "resolved");
  const grouped = readReceiptGroups(visibleThreads);
  const pendingCount = visibleThreads.filter(
    (thread) => thread.state === "pending",
  ).length;
  const unreadReplyCount = visibleThreads.filter(
    (thread) => thread.state === "agent-replied",
  ).length;
  const openCount = visibleThreads.filter(
    (thread) => thread.state !== "pending",
  ).length;
  const reviewedCount = threads.filter(
    (thread) => thread.state === "resolved",
  ).length;

  function updateThread(id: string, state: ReadReceiptThreadState) {
    setThreads((current) =>
      current.map((thread) =>
        thread.id === id ? { ...thread, state } : thread,
      ),
    );
    setOpenedThread(id);
  }

  function togglePath(path: string) {
    setExpandedPaths((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
    setOpenedFile(path);
  }

  return (
    <aside
      className={`${sharedUiStyles.inspector} inspector review-thread-pattern-a`}
      aria-label="Review inspector"
    >
      <div
        className={`${sharedUiStyles.panelTitle} panel-title review-panel-title`}
      >
        <span className="review-panel-heading">
          <span>Review</span>
          <strong>{unreadReplyCount} need my read</strong>
        </span>
        <button
          className={`${sharedUiStyles.commandButton} ${sharedUiStyles.commandButtonSecondary} command-button command-button-secondary review-next-action`}
          type="button"
          onClick={() => {
            const nextReply =
              visibleThreads.find((thread) => thread.state === "agent-replied") ??
              visibleThreads.find((thread) => thread.state === "pending") ??
              visibleThreads[0];
            if (nextReply) {
              setOpenedFile(nextReply.path);
              setOpenedThread(nextReply.id);
              setExpandedPaths((current) => new Set(current).add(nextReply.path));
            }
          }}
        >
          Next
        </button>
      </div>
      <div className="inspect-body">
        <div className="inspector-review-mode">
          <section className="review-state-summary" aria-label="Review states">
            <span className="review-state-card queued">
              <strong>1</strong>
              <span>Queued</span>
            </span>
            <span className="review-state-card reviewing">
              <strong>{grouped.length}</strong>
              <span>In Review</span>
            </span>
            <span className="review-state-card reviewed">
              <strong>{reviewedCount}</strong>
              <span>Reviewed</span>
            </span>
          </section>
          <div
            className="review-queue"
            role="group"
            aria-label={`${unreadReplyCount} unread replies, ${pendingCount} pending threads`}
          >
            <details className="review-state-section queued" open>
              <summary>
                <span>Queued</span>
                <small>1 file waiting for review</small>
              </summary>
              <div className="review-state-section-list">
                <button className="change-open" type="button">
                  <span
                    className={`${sharedUiStyles.muted} unread-dot muted`}
                    aria-hidden="true"
                  />
                  <span className="change-main">
                    <span className="change-heading">
                      <span className="change-kind">MD</span>
                      <b>README.md</b>
                    </span>
                    <small className="review-thread-summary">
                      read git · no open
                    </small>
                  </span>
                  <span className="diff-stat">
                    <span className="diff-add">+8</span>
                    <span className="diff-remove">-2</span>
                  </span>
                </button>
              </div>
            </details>

            <details className="review-state-section reviewing" open>
              <summary>
                <span>In Review</span>
                <small>
                  {unreadReplyCount} replies · {pendingCount} pending
                </small>
              </summary>
              <div className="review-state-section-list">
                {grouped.map((group) => {
                  const expanded = expandedPaths.has(group.path);
                  const active = openedFile === group.path;
                  const rowAttention = group.threads.some(
                    (thread) => thread.state === "agent-replied",
                  );
                  const groupPendingCount = group.threads.filter(
                    (thread) => thread.state === "pending",
                  ).length;
                  const groupOpenCount = group.threads.length - groupPendingCount;
                  return (
                    <div
                      className={`review-thread-expand-file${active ? " active" : ""}`}
                      key={group.path}
                    >
                      <button
                        className={`change-open${active ? " active" : ""} has-open-threads${rowAttention ? " has-agent-reply" : ""}`}
                        type="button"
                        aria-current={active ? "true" : undefined}
                        aria-label={`Review queue item, modified ${group.path}${active ? ", current review file" : ""}`}
                        onClick={() => {
                          setOpenedFile(group.path);
                          setExpandedPaths((current) =>
                            new Set(current).add(group.path),
                          );
                        }}
                      >
                        <span
                          className={
                            rowAttention
                              ? "unread-dot agent-reply"
                              : `${sharedUiStyles.muted} unread-dot muted`
                          }
                          aria-hidden="true"
                        />
                        <span className="change-main">
                          <span className="change-heading">
                            <span className="change-kind">{group.kind}</span>
                            <b>{readReceiptBasename(group.path)}</b>
                          </span>
                          <small className="review-thread-summary">
                            {readReceiptGroupSummary(group.threads)}
                          </small>
                        </span>
                        <span
                          className="review-thread-count-space"
                          aria-hidden="true"
                        />
                      </button>
                      <button
                        className={`review-thread-count-toggle${groupPendingCount ? " pending" : ""}${rowAttention ? " reply" : ""}`}
                        type="button"
                        aria-expanded={expanded}
                        aria-label={`Show receipt threads for ${group.path}`}
                        onClick={() => togglePath(group.path)}
                      >
                        {groupOpenCount} open
                        {groupPendingCount ? ` · ${groupPendingCount} pending` : ""}
                      </button>
                      {expanded ? (
                        <div
                          className="review-thread-hairline-list"
                          aria-label={`Receipt thread states for ${group.path}`}
                        >
                          {group.threads.map((thread) => (
                            <div
                              className="review-thread-hairline-item"
                              key={thread.id}
                            >
                              <button
                                className={`review-thread-hairline-row ${
                                  openedThread === thread.id ? "active" : ""
                                }${
                                  thread.state === "pending"
                                    ? " has-publish-action"
                                    : ""
                                }`}
                                type="button"
                                aria-label={`Open ${readReceiptStateLabel(
                                  thread.state,
                                )} item, ${thread.path}, ${thread.location}, ${thread.surface}`}
                                onClick={() => {
                                  setOpenedFile(thread.path);
                                  setOpenedThread(thread.id);
                                }}
                              >
                                <span className="review-thread-hairline-main">
                                  <span className="review-thread-hairline-title">
                                    <span>
                                      {thread.location} · {thread.surface}
                                    </span>
                                    <span
                                      className={`review-thread-status-badge ${readReceiptStatusTone(
                                        thread.state,
                                      )}`}
                                    >
                                      {readReceiptStatusLabel(thread.state)}
                                    </span>
                                  </span>
                                  <span className="review-thread-hairline-preview">
                                    {thread.preview}
                                  </span>
                                  <span className="review-thread-hairline-meta">
                                    {readReceiptMeta(thread)}
                                  </span>
                                </span>
                              </button>
                              {thread.state === "pending" ? (
                               <button
                                  className="review-thread-publish-button"
                                  type="button"
                                  aria-label={`Publish pending thread ${thread.path} ${thread.location}`}
                                  onClick={() => updateThread(thread.id, "not-read")}
                               >
                                  Publish
                               </button>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </details>

            <details className="review-state-section reviewed">
              <summary>
                <span>Reviewed</span>
                <small>{reviewedCount} reviewed</small>
              </summary>
            </details>
          </div>
          <p
            className={`${sharedUiStyles.srOnly} sr-only`}
            role="status"
            aria-label="Opened file"
          >
            {openedFile}
          </p>
          <p
            className={`${sharedUiStyles.srOnly} sr-only`}
            role="status"
            aria-label="Opened thread"
          >
            {openedThread}
          </p>
          <p
            className={`${sharedUiStyles.srOnly} sr-only`}
            role="status"
            aria-label="Receipt counts"
          >
            {unreadReplyCount} unread replies, {pendingCount} pending,{" "}
            {openCount} open
          </p>
        </div>
      </div>
    </aside>
  );
}

function readReceiptGroups(threads: ReadReceiptThread[]) {
  const groups = new Map<
    string,
    { path: string; kind: string; threads: ReadReceiptThread[] }
  >();
  for (const thread of threads) {
    const current = groups.get(thread.path);
    if (current) current.threads.push(thread);
    else {
      groups.set(thread.path, {
        path: thread.path,
        kind: thread.kind,
        threads: [thread],
      });
    }
  }
  return [...groups.values()];
}

function readReceiptBasename(path: string): string {
  return path.split("/").at(-1) ?? path;
}

function readReceiptGroupSummary(threads: ReadReceiptThread[]): string {
  const unreadReplies = threads.filter(
    (thread) => thread.state === "agent-replied",
  ).length;
  const pending = threads.filter((thread) => thread.state === "pending").length;
  const read = threads.filter((thread) => thread.state === "agent-read").length;
  const notRead = threads.filter((thread) => thread.state === "not-read").length;
  if (unreadReplies) return `${unreadReplies} agent reply · needs my read`;
  if (pending) return `${pending} pending · not agent-visible`;
  if (read) return `${read} read receipt · waiting on reply`;
  if (notRead) return "not read by agent · still open";
  return "reply read by you";
}

function readReceiptStateLabel(state: ReadReceiptThreadState): string {
  if (state === "pending") return "pending";
  if (state === "agent-replied") return "unread reply";
  if (state === "agent-read") return "agent-read";
  if (state === "human-read") return "reply-read";
  if (state === "resolved") return "resolved";
  return "not-read";
}

function readReceiptStatusLabel(state: ReadReceiptThreadState): string {
  if (state === "pending") return "Pending";
  if (state === "not-read") return "Not read";
  if (state === "agent-read") return "Agent read";
  if (state === "agent-replied") return "Unread reply";
  if (state === "human-read") return "Reply read";
  if (state === "resolved") return "Resolved";
  return "Open";
}

function readReceiptStatusTone(state: ReadReceiptThreadState): string {
  if (state === "pending") return "pending";
  if (state === "agent-replied") return "reply-unread";
  if (state === "agent-read") return "agent-read";
  if (state === "human-read") return "reply-read";
  if (state === "resolved") return "resolved";
  return "not-read";
}

function readReceiptMeta(thread: ReadReceiptThread): string {
  if (thread.state === "pending") return "not agent-visible · publishes as open";
  if (thread.state === "not-read") return "published · not read by agent";
  if (thread.state === "agent-read")
    return `${thread.actor} read · waiting on reply`;
  if (thread.state === "agent-replied")
    return `${thread.actor} replied · unread by you`;
  if (thread.state === "human-read") return "reply read by you";
  return "resolved · hidden from active queue";
}
