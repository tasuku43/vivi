import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import type { ReviewChangeItem } from "../../state/git-review.js";
import type { ReviewQueueItem } from "../../state/review-queue.js";
import {
  sampleComments,
  sampleDraftComments,
  sampleMarkdownFile,
} from "../../storybook/fixtures/review-lab.js";
import {
  ReviewQueueSignalLedgerFacade,
  reviewQueueSignalLedgerFrameStyle,
  type ReviewQueueSignalLedgerItem,
} from "../../storybook/ReviewQueueDirectoryFacade.js";
import { Inspector } from "./Inspector.js";

const signalItems: ReviewQueueSignalLedgerItem[] = [
  {
    path: "docs/product/01-product-brief.md",
    unread: true,
    changed: true,
    draftCount: 0,
    additions: 18,
    deletions: 4,
  },
  {
    path: "docs/ui-mocks/44-compact-review-queue-inspector.html",
    unread: true,
    changed: true,
    draftCount: 0,
    additions: 244,
    deletions: 31,
  },
  {
    path: "docs/product-review.md",
    unread: false,
    changed: false,
    draftCount: 1,
  },
  {
    path: "examples/onboarding/README.md",
    unread: true,
    changed: true,
    draftCount: 0,
    additions: 32,
    deletions: 0,
  },
  {
    path: "packages/agent-guide/docs/getting-started.md",
    unread: true,
    changed: true,
    draftCount: 0,
    additions: 7,
    deletions: 2,
  },
];

const wiredReviewChanges: ReviewChangeItem[] = signalItems
  .filter((item) => item.changed)
  .map((item) => ({ path: item.path, status: "modified", source: "git" }));

const wiredDraft = sampleDraftComments[1]!;
const wiredResolvedComment = sampleComments.find(
  (comment) => comment.id === "comment-resolved",
)!;
const wiredReviewItems: ReviewQueueItem[] = [
  ...wiredReviewChanges.map((change): ReviewQueueItem => ({
    path: change.path,
    change,
    threadCounts: { open: 0, resolved: 0, archived: 0 },
    commentCount: 0,
    unread: true,
  })),
  {
    path: wiredResolvedComment.path,
    change: null,
    threadCounts: { open: 0, resolved: 1, archived: 0 },
    commentCount: 1,
    unread: false,
  },
  {
    path: wiredDraft.path,
    change: null,
    threadCounts: { open: 0, resolved: 0, archived: 0 },
    commentCount: 0,
    pendingDraftCount: 1,
    pendingDraftIds: [wiredDraft.id],
    unread: false,
  },
];

const meta = {
  title: "Review/Queue Signal Ledger",
  component: ReviewQueueSignalLedgerFacade,
  decorators: [
    (Story) => (
      <div style={reviewQueueSignalLedgerFrameStyle}>
        <Story />
      </div>
    ),
  ],
  args: {
    items: signalItems,
    selectedPath: "docs/product/01-product-brief.md",
    reviewedCount: 0,
    onNextQueued: fn(),
    onSelectDocument: fn(),
    onSelectPath: fn(),
    onOpenPath: fn(),
    onPublishPath: fn(),
    onFilterChange: fn(),
  },
  parameters: {
    layout: "centered",
    a11y: { test: "error" },
  },
} satisfies Meta<typeof ReviewQueueSignalLedgerFacade>;

export default meta;
type Story = StoryObj<typeof meta>;

export const MixedSignals: Story = {};

export const EmptyLedger: Story = {
  args: {
    items: [],
    selectedPath: null,
    reviewedCount: 7,
  },
};

export const SignalFilterInteraction: Story = {
  tags: ["interaction"],
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const draftPath = "docs/product-review.md";
    const changedPath = "docs/product/01-product-brief.md";

    await userEvent.click(canvas.getByRole("radio", { name: "Drafts 1" }));
    await expect(args.onFilterChange).toHaveBeenLastCalledWith("drafts");
    await expect(
      canvasElement.querySelector(`[data-review-path="${draftPath}"]`),
    ).toBeVisible();
    await expect(
      canvasElement.querySelector(`[data-review-path="${changedPath}"]`),
    ).not.toBeInTheDocument();

    await userEvent.click(
      canvas.getByRole("button", { name: `Publish 1 draft for ${draftPath}` }),
    );
    await expect(args.onPublishPath).toHaveBeenCalledWith(draftPath);

    await userEvent.click(canvas.getByRole("radio", { name: "Changed 4" }));
    const changedRow = canvasElement.querySelector<HTMLElement>(
      `[data-review-path="${changedPath}"]`,
    );
    await expect(changedRow).toBeVisible();
    await userEvent.dblClick(changedRow!.querySelector("button")!);
    await expect(args.onOpenPath).toHaveBeenCalledWith(changedPath);
  },
};

export const WiredInspector: Story = {
  render: (args) => (
    <Inspector
      file={sampleMarkdownFile}
      reviewChanges={wiredReviewChanges}
      reviewItems={wiredReviewItems}
      reviewDiffStats={{
        "docs/product/01-product-brief.md": { additions: 18, deletions: 4 },
        "docs/ui-mocks/44-compact-review-queue-inspector.html": {
          additions: 244,
          deletions: 31,
        },
        "examples/onboarding/README.md": { additions: 32, deletions: 0 },
        "packages/agent-guide/docs/getting-started.md": {
          additions: 7,
          deletions: 2,
        },
      }}
      loadingReviewDiffs={{}}
      unreadReviewPaths={
        new Set(
          signalItems.filter((item) => item.unread).map((item) => item.path),
        )
      }
      reviewComments={[wiredResolvedComment]}
      draftComments={[wiredDraft]}
      selectedCodeRange={null}
      activePath="docs/product/01-product-brief.md"
      activePaneId="main"
      onOpenEventPath={args.onSelectPath}
      onConfirmEventPath={args.onOpenPath}
      onOpenNextChanged={args.onNextQueued}
      onOpenPreviousChanged={() => undefined}
      onOpenAllChanged={() => undefined}
      onRevealInTree={() => undefined}
      onOpenDraft={() => undefined}
      onPublishDrafts={() => args.onPublishPath(wiredDraft.path)}
      onOpenDocument={args.onSelectDocument}
    />
  ),
};

export const WiredInspectorFilterInteraction: Story = {
  ...WiredInspector,
  tags: ["interaction"],
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const draftPath = wiredDraft.path;
    const changedPath = "docs/product/01-product-brief.md";
    const draftsFilter = canvas.getByRole("radio", { name: "Drafts 1" });
    const draftBadge = canvasElement.querySelector<HTMLElement>(
      ".review-signal-badges > .draft",
    );

    await expect(draftBadge).toBeVisible();
    await expect(window.getComputedStyle(draftBadge!).fontSize).toBe("9px");
    await expect(window.getComputedStyle(draftBadge!).lineHeight).toBe("12px");
    await expect(Math.round(draftBadge!.getBoundingClientRect().height)).toBe(
      18,
    );

    await userEvent.click(draftsFilter);
    await expect(draftsFilter).toBeChecked();
    await expect(
      canvasElement.querySelector(`[data-review-path="${draftPath}"]`),
    ).toBeVisible();
    await expect(
      canvasElement.querySelector(`[data-review-path="${changedPath}"]`),
    ).not.toBeVisible();

    await userEvent.click(
      canvas.getByRole("button", {
        name: `Publish 1 draft for ${draftPath}`,
      }),
    );
    await expect(args.onPublishPath).toHaveBeenCalledWith(draftPath);

    await userEvent.click(canvas.getByRole("radio", { name: "Changed 4" }));
    const changedRow = canvas.getByRole("button", {
      name: /Review queue item, modified docs\/product\/01-product-brief\.md/u,
    });
    await expect(changedRow).toBeVisible();
    await userEvent.click(changedRow);
    await expect(args.onSelectPath).toHaveBeenCalledWith(changedPath);
  },
};
