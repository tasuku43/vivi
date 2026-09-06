import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { useState } from "react";
import { Inspector } from "./Inspector.js";
import type { ReviewQueueItem } from "../../state/review-queue.js";

const now = Date.parse("2026-09-06T10:00:00Z");
const recent: ReviewQueueItem[] = [
  {
    path: "docs/product/00-product-thesis.md",
    change: null,
    unread: false,
    commentCount: 0,
    activityReason: "Presented by agent",
    lastActivityAt: now - 120000,
  },
  {
    path: "docs/guide.md",
    change: null,
    unread: false,
    commentCount: 0,
    activityReason: "Updated",
    lastActivityAt: now - 840000,
  },
  {
    path: "README.md",
    change: null,
    unread: false,
    commentCount: 1,
    activityReason: "Read by agent",
    lastActivityAt: now - 1740000,
  },
];
const feedback: ReviewQueueItem[] = [
  {
    path: "docs/acceptance.md",
    change: null,
    unread: true,
    commentCount: 2,
    lastActivityAt: now - 3600000,
  },
  {
    path: "docs/review.md",
    change: null,
    unread: false,
    commentCount: 0,
    pendingDraftCount: 1,
    pendingDraftIds: ["draft-1"],
    lastActivityAt: now - 7200000,
  },
  {
    path: "docs/proposal.md",
    change: null,
    unread: false,
    commentCount: 0,
    pendingInputCount: 1,
  },
];
const meta = {
  title: "Workspace/For You",
  component: Inspector,
  decorators: [
    (Story) => (
      <div
        style={{
          width: 320,
          height: 720,
          background: "var(--vivi-color-surface-panel)",
        }}
      >
        <Story />
      </div>
    ),
  ],
  args: {
    file: null,
    reviewChanges: [],
    reviewItems: [...feedback, ...recent],
    reviewDiffStats: {},
    loadingReviewDiffs: {},
    unreadReviewPaths: new Set(),
    selectedCodeRange: null,
    activePaneId: "main",
    now,
    documentHeadings: {
      "docs/product/00-product-thesis.md": "A quiet place to read",
      "docs/guide.md": "Working with your agent",
      "README.md": "Vivi",
      "docs/acceptance.md": "UX acceptance criteria",
      "docs/review.md": "Review notes",
      "docs/proposal.md": "A simpler workflow",
    },
    onOpenEventPath: fn(),
    onConfirmEventPath: fn(),
    onOpenNextChanged: fn(),
    onOpenPreviousChanged: fn(),
    onOpenAllChanged: fn(),
    onRevealInTree: fn(),
    onDismissRecent: fn(),
    onPublishDrafts: fn(),
    onOpenDocument: fn(),
  },
  parameters: { layout: "centered", a11y: { test: "error" } },
} satisfies Meta<typeof Inspector>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Mixed: Story = {};
export const Empty: Story = { args: { reviewItems: [] } };
export const RecentOnly: Story = { args: { reviewItems: recent } };
export const Loading: Story = {
  args: { reviewItems: [], reviewLoading: true },
};
export const Unavailable: Story = {
  args: {
    reviewItems: [],
    unavailableFeedbackItems: [
      { path: "old/styles.css", publishedCount: 2, draftCount: 1 },
    ],
  },
};
export const Interaction: Story = {
  tags: ["interaction"],
  render: function Interactive(args) {
    const [items, setItems] = useState(args.reviewItems ?? []);
    return (
      <Inspector
        {...args}
        reviewItems={items}
        onDismissRecent={(path) => {
          args.onDismissRecent?.(path);
          setItems(items.filter((item) => item.path !== path));
        }}
      />
    );
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("tab", { name: /For you/ })).toBeVisible();
    await expect(canvas.queryByRole("radio")).not.toBeInTheDocument();
    await expect(
      canvas.queryByRole("button", { name: "Hide docs/acceptance.md for now" }),
    ).not.toBeInTheDocument();
    const row = canvas.getByRole("button", {
      name: /Review queue item, comment docs\/guide.md/,
    });
    await userEvent.click(row);
    await expect(args.onOpenEventPath).toHaveBeenCalledWith("docs/guide.md");
    await userEvent.keyboard("{ArrowDown}");
    await expect(
      canvas.getByRole("button", {
        name: /Review queue item, comment README.md/,
      }),
    ).toHaveFocus();
    await userEvent.click(
      canvas.getByRole("button", { name: "Hide docs/guide.md for now" }),
    );
    await expect(args.onDismissRecent).toHaveBeenCalledWith("docs/guide.md");
    // The row stays stable while focus/pointer are inside the list.
    await expect(row).toBeVisible();
    await userEvent.click(canvas.getByRole("tab", { name: "Document" }));
    await expect(row).not.toBeInTheDocument();
    await expect(
      canvas.getByRole("region", { name: "Feedback" }),
    ).toBeVisible();
  },
};
