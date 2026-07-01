import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, fn, userEvent, within } from "storybook/test";
import { CommentsPanel } from "./components/CommentsPanel.js";
import { InlineCommentCard } from "./components/InlineCommentCard.js";
import {
  manyDraftReviewComments,
  manyReviewComments,
  sampleComments,
  sampleDraftComments,
  sampleFiles,
  samplePublishedReviewBatch,
  sampleThreadActivities,
} from "../../storybook/fixtures/review-lab.js";

const meta = {
  title: "Review/Comments Inbox States",
  component: CommentsPanel,
  parameters: {
    layout: "fullscreen",
    a11y: { test: "error" },
  },
  args: {
    open: true,
    comments: sampleComments,
    query: "",
    statusFilter: "all",
    threadActivities: sampleThreadActivities,
    unreadReviewPaths: new Set(["docs/agent-handoff.md"]),
    onQueryChange: fn(),
    onStatusFilterChange: fn(),
    onClose: fn(),
    onOpenComment: fn(),
    onOpenDraft: fn(),
    onDeleteDraft: fn(),
    onPublishDrafts: fn(),
    onStatusChange: fn(),
  },
} satisfies Meta<typeof CommentsPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WorkspaceComments: Story = {
  name: "Comments inbox shows status filters",
  tags: ["interaction"],
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("complementary", { name: "Comments" }),
    ).toBeInTheDocument();
    const search = canvas.getByLabelText("Search comments");
    await expect(search).toHaveFocus();
    await userEvent.type(search, "agent");
    await expect(args.onQueryChange).toHaveBeenCalled();
    const filters = canvas.getByRole("group", {
      name: "Comment status filters",
    });
    await userEvent.click(
      within(filters).getByRole("button", { name: /open/i }),
    );
    await expect(args.onStatusFilterChange).toHaveBeenCalledWith("open");
    await expect(
      canvas.getByRole("button", {
        name: "Resolve comment for ui/src/features/workbench/WorkbenchContainer.tsx, L9-L12",
      }),
    ).toBeInTheDocument();
    await expect(canvas.getAllByText("Open feedback")[0]).toBeInTheDocument();
  },
};

export const OpenOnly: Story = {
  args: {
    statusFilter: "open",
  },
};

export const CurrentThreadActions: Story = {
  name: "Current inbox thread can be resolved",
  tags: ["interaction"],
  args: {
    activeCommentId: "comment-workbench-open-1",
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const resolveButtons = canvas.getAllByRole("button", {
      name: "Resolve",
    });
    await expect(resolveButtons).toHaveLength(1);
    await expect(
      canvas.getAllByRole("button", { name: "Archive" }),
    ).toHaveLength(1);
    await userEvent.click(resolveButtons[0]!);
    await expect(args.onStatusChange).toHaveBeenCalledWith(
      "thread-workbench-open",
      "resolved",
    );
  },
};

export const ResolvedHistoryArchivedHidden: Story = {
  tags: ["interaction"],
  args: {
    comments: sampleComments.filter(
      (comment) =>
        comment.status === "resolved" || comment.status === "archived",
    ),
    statusFilter: "all",
    query: "",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Resolved feedback")).toBeInTheDocument();
    await expect(
      canvas.queryByText("Archived feedback"),
    ).not.toBeInTheDocument();
    await expect(
      canvas.queryByRole("button", { name: /archived/i }),
    ).not.toBeInTheDocument();
  },
};

export const AgentActivityVisible: Story = {
  args: {
    query: "WorkbenchContainer",
  },
};

export const PendingDrafts: Story = {
  tags: ["interaction"],
  args: {
    draftComments: sampleDraftComments,
    statusFilter: "drafts",
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Comments Hub")).toBeInTheDocument();
    await expect(canvas.getByText("Pending drafts")).toBeInTheDocument();
    await expect(
      canvas.getByRole("button", { name: /Publish \d+ draft comments/ }),
    ).toBeVisible();
    await userEvent.click(
      canvas.getAllByRole("button", { name: /Open pending draft in/ })[0]!,
    );
    await expect(args.onOpenDraft).toHaveBeenCalled();
  },
};

export const EmptyPendingDrafts: Story = {
  args: {
    draftComments: [],
    statusFilter: "drafts",
  },
};

export const PendingDraftPublishFailure: Story = {
  args: {
    draftComments: sampleDraftComments,
    draftPublishError: "The selected target thread is no longer open.",
    statusFilter: "drafts",
  },
};

export const PublishedDraftBatch: Story = {
  args: {
    draftComments: [],
    publishedBatchId: samplePublishedReviewBatch.reviewBatchId,
    statusFilter: "drafts",
  },
};

export const ManyPendingDrafts: Story = {
  tags: ["interaction"],
  args: {
    draftComments: manyDraftReviewComments,
    statusFilter: "drafts",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("22 pending drafts ready")).toBeVisible();
    const list = canvasElement.querySelector<HTMLElement>(
      ".global-comments-list",
    );
    await expect(list).toBeInTheDocument();
    await expect(list).toHaveAttribute("role", "list");
    expect(list!.scrollHeight).toBeGreaterThan(list!.clientHeight);
  },
};

export const ScopedFileSearch: Story = {
  name: "Comments inbox filters within the current file",
  tags: ["interaction"],
  args: {
    query: sampleFiles.code.path,
    statusFilter: "all",
  },
  render: (args) => {
    const [query, setQuery] = useState(args.query ?? "");
    return (
      <CommentsPanel
        {...args}
        query={query}
        onQueryChange={(nextQuery) => {
          args.onQueryChange(nextQuery);
          setQuery(nextQuery);
        }}
      />
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByLabelText("Search comments")).toHaveValue(
      sampleFiles.code.path,
    );
    await expect(
      canvas.getByRole("button", { name: "Clear comments search" }),
    ).toBeInTheDocument();
    const filters = within(
      canvas.getByRole("group", { name: "Comment status filters" }),
    );
    await expect(
      filters.getByRole("button", { name: "Show all 3 threads" }),
    ).toHaveTextContent("All 3");
    await expect(
      filters.getByRole("button", { name: "Show 3 open threads" }),
    ).toHaveTextContent("Open 3");
    await expect(
      filters.getByRole("button", { name: "Show 0 resolved threads" }),
    ).toHaveTextContent("Resolved");
    await expect(
      canvas.getByRole("list", {
        name: "Comment threads, 3 threads · 4 messages",
      }),
    ).toBeInTheDocument();
    await userEvent.click(
      canvas.getByRole("button", { name: "Clear comments search" }),
    );
    await expect(canvas.getByLabelText("Search comments")).toHaveValue("");
    await expect(
      filters.getByRole("button", { name: "Show all 6 threads" }),
    ).toHaveTextContent("All 6");
  },
};

export const SourceChangedAnchor: Story = {
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
    currentFile: sampleFiles.code,
    statusFilter: "open",
  },
};

export const SourceMissingAnchor: Story = {
  args: {
    comments: [
      {
        ...sampleComments[0]!,
        path: "README.md",
        anchor: {
          ...sampleComments[0]!.anchor,
          canonical: {
            ...sampleComments[0]!.anchor.canonical,
            path: "README.md",
            quote: "# Vivi",
          },
        },
      },
    ],
    knownMissingPaths: new Set(["README.md"]),
    statusFilter: "open",
  },
};

export const NoMatchingComments: Story = {
  args: {
    query: "no matching fixture text",
  },
};

export const ManyComments: Story = {
  args: {
    comments: manyReviewComments,
    statusFilter: "open",
  },
};

export const InlineCommentCardStory: Story = {
  render: () => (
    <InlineCommentCard
      comment={sampleComments[0]!}
      rect={{ left: 40, top: 80, width: 180, height: 24 }}
      onClose={() => undefined}
      onStatusChange={() => undefined}
    />
  ),
};
