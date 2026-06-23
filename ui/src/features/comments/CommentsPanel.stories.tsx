import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { CommentsPanel } from "./components/CommentsPanel.js";
import { InlineCommentCard } from "./components/InlineCommentCard.js";
import {
  manyReviewComments,
  sampleComments,
  sampleFiles,
  sampleThreadActivities,
} from "../../storybook/fixtures/review-lab.js";

const meta = {
  title: "Review/Comments/Comments Panel",
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
    onStatusChange: fn(),
  },
} satisfies Meta<typeof CommentsPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WorkspaceComments: Story = {
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
  tags: ["interaction"],
  args: {
    activeCommentId: "comment-workbench-open-1",
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const resolveButtons = canvas.getAllByRole("button", {
      name: "Resolve current thread",
    });
    await expect(resolveButtons).toHaveLength(1);
    await expect(
      canvas.getAllByRole("button", { name: "Archive current thread" }),
    ).toHaveLength(1);
    await userEvent.click(resolveButtons[0]!);
    await expect(args.onStatusChange).toHaveBeenCalledWith(
      "thread-workbench-open",
      "resolved",
    );
  },
};

export const ResolvedAndArchivedHistory: Story = {
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
    await expect(canvas.getByText("Archived feedback")).toBeInTheDocument();
  },
};

export const AgentActivityVisible: Story = {
  args: {
    query: "WorkbenchContainer",
  },
};

export const ScopedFileSearch: Story = {
  tags: ["interaction"],
  args: {
    query: sampleFiles.code.path,
    statusFilter: "all",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByLabelText("Search comments")).toHaveValue(
      sampleFiles.code.path,
    );
    await expect(canvas.getByRole("button", { name: "Show all 3 threads" }))
      .toHaveTextContent("All 3");
    await expect(canvas.getByRole("button", { name: "Show 3 open threads" }))
      .toHaveTextContent("Open 3");
    await expect(
      canvas.getByRole("button", { name: "Show 0 resolved threads" }),
    ).toHaveTextContent("Resolved");
    await expect(
      canvas.getByRole("list", {
        name: "Comment threads, 3 threads · 4 messages",
      }),
    ).toBeInTheDocument();
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
