import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import type { ReviewChangeItem } from "../../state/git-review.js";
import type { ReviewQueueItem } from "../../state/review-queue.js";
import {
  reviewQueueDirectoryChangedPaths,
  reviewQueueDirectoryOpenThreadCounts,
  reviewQueueDirectoryPaths,
  reviewQueueDirectoryTree,
  reviewQueueDirectoryUnreadPaths,
  sampleDraftComments,
  sampleMarkdownFile,
} from "../../storybook/fixtures/review-lab.js";
import {
  ReviewQueueDirectoryFacade,
  reviewQueueDirectoryFrameStyle,
} from "../../storybook/ReviewQueueDirectoryFacade.js";
import { Inspector } from "./Inspector.js";

const readyItems = [
  {
    id: "workspace-document-drafts",
    ["title"]: "18-ux-acceptance-criteria.md",
    detail: "docs/product · 4 private comments",
    count: 4,
  },
];

const wiredReviewChanges: ReviewChangeItem[] = [
  {
    path: "docs/product/01-product-brief.md",
    status: "modified",
    source: "git",
  },
  {
    path: "docs/ui-mocks/43-review-queue-directory-organization.html",
    status: "modified",
    source: "git",
  },
  {
    path: "examples/onboarding/README.md",
    status: "added",
    source: "git",
  },
  {
    path: "packages/agent-guide/docs/getting-started.md",
    status: "modified",
    source: "git",
  },
];

const wiredDraft = sampleDraftComments[1]!;
const wiredReviewItems: ReviewQueueItem[] = [
  ...wiredReviewChanges.map(
    (change): ReviewQueueItem => ({
      path: change.path,
      change,
      threadCounts: { open: 0, resolved: 0, archived: 0 },
      commentCount: 0,
      unread: true,
    }),
  ),
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
  title: "Review/Queue Directory Tree",
  component: ReviewQueueDirectoryFacade,
  decorators: [
    (Story) => (
      <div style={reviewQueueDirectoryFrameStyle}>
        <Story />
      </div>
    ),
  ],
  args: {
    nodes: reviewQueueDirectoryTree,
    selectedPath: "docs/product/01-product-brief.md",
    queuedPaths: reviewQueueDirectoryPaths,
    unreadPaths: reviewQueueDirectoryUnreadPaths,
    changedPaths: reviewQueueDirectoryChangedPaths,
    activePaths: ["docs/ui-mocks/index.html"],
    currentStopPath: "docs/product/01-product-brief.md",
    openThreadCountsByPath: reviewQueueDirectoryOpenThreadCounts,
    queuedCount: 7,
    inReviewCount: 2,
    seenCount: 3,
    branchCount: 4,
    readyItems,
    onNextQueued: fn(),
    onSelectDocument: fn(),
    onSelectPath: fn(),
    onOpenPath: fn(),
    onOpenReadyItem: fn(),
    onReviewReady: fn(),
    onPublishReady: fn(),
  },
  parameters: {
    layout: "centered",
    a11y: { test: "error" },
  },
} satisfies Meta<typeof ReviewQueueDirectoryFacade>;

export default meta;
type Story = StoryObj<typeof meta>;

export const MixedDirectories: Story = {};

export const EmptyQueue: Story = {
  args: {
    nodes: [],
    selectedPath: null,
    queuedPaths: [],
    unreadPaths: [],
    changedPaths: [],
    activePaths: [],
    currentStopPath: null,
    openThreadCountsByPath: {},
    queuedCount: 0,
    inReviewCount: 0,
    seenCount: 7,
    branchCount: 0,
    readyItems: [],
  },
};

export const DirectoryCollapseInteraction: Story = {
  tags: ["interaction"],
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const docs = canvasElement.querySelector<HTMLElement>(
      '[data-tree-path="docs"]',
    );
    const queuedFileSelector =
      '[data-tree-path="docs/product/01-product-brief.md"]';

    await expect(docs).not.toBeNull();
    await expect(docs).toHaveAttribute("aria-expanded", "true");
    await expect(
      canvasElement.querySelector(queuedFileSelector),
    ).toBeInTheDocument();

    await userEvent.click(docs!);
    await expect(docs).toHaveAttribute("aria-expanded", "false");
    await expect(
      canvasElement.querySelector(queuedFileSelector),
    ).not.toBeInTheDocument();

    docs!.focus();
    await userEvent.keyboard("{ArrowRight}");
    await expect(docs).toHaveAttribute("aria-expanded", "true");

    const queuedFile = canvasElement.querySelector<HTMLElement>(
      queuedFileSelector,
    );
    await expect(queuedFile).toBeVisible();
    await userEvent.click(queuedFile!);
    await expect(args.onSelectPath).toHaveBeenCalledWith(
      "docs/product/01-product-brief.md",
    );

    await userEvent.click(canvas.getByRole("button", { name: "Next queued" }));
    await expect(args.onNextQueued).toHaveBeenCalledOnce();
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
        "docs/ui-mocks/43-review-queue-directory-organization.html": {
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
      unreadReviewPaths={new Set(reviewQueueDirectoryUnreadPaths)}
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
      onOpenDraft={() => args.onReviewReady()}
      onPublishDrafts={() => args.onPublishReady()}
      onOpenDocument={args.onSelectDocument}
    />
  ),
};

export const WiredInspectorDirectoryInteraction: Story = {
  ...WiredInspector,
  tags: ["interaction"],
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const docs = canvasElement.querySelector<HTMLElement>(
      '[data-tree-path="docs"]',
    );
    const htmlPath =
      "docs/ui-mocks/43-review-queue-directory-organization.html";
    const markdownPath = "docs/product/01-product-brief.md";

    await expect(docs).not.toBeNull();
    await expect(docs).toHaveAttribute("aria-expanded", "true");
    await expect(
      canvas.getByRole("button", { name: "Publish 1" }),
    ).toBeVisible();

    await userEvent.click(docs!);
    await expect(docs).toHaveAttribute("aria-expanded", "false");
    await expect(
      canvasElement.querySelector(`[data-tree-path="${htmlPath}"]`),
    ).not.toBeInTheDocument();

    await userEvent.click(docs!);
    const htmlFile = canvasElement.querySelector<HTMLElement>(
      `[data-tree-path="${htmlPath}"]`,
    );
    const markdownFile = canvasElement.querySelector<HTMLElement>(
      `[data-tree-path="${markdownPath}"]`,
    );
    await expect(htmlFile).toBeVisible();
    await expect(markdownFile).toBeVisible();

    await userEvent.click(htmlFile!);
    await expect(args.onSelectPath).toHaveBeenCalledWith(htmlPath);
    await userEvent.dblClick(markdownFile!);
    await expect(args.onOpenPath).toHaveBeenCalledWith(markdownPath);

    await userEvent.click(canvas.getByRole("button", { name: "Publish 1" }));
    await expect(args.onPublishReady).toHaveBeenCalledOnce();
  },
};
