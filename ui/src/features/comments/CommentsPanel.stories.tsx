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
    await userEvent.type(canvas.getByLabelText("Search comments"), "agent");
    await expect(args.onQueryChange).toHaveBeenCalled();
    const filters = canvas.getByRole("group", {
      name: "Comment status filters",
    });
    await userEvent.click(
      within(filters).getByRole("button", { name: /open/i }),
    );
    await expect(args.onStatusFilterChange).toHaveBeenCalledWith("open");
  },
};

export const OpenOnly: Story = {
  args: {
    statusFilter: "open",
  },
};

export const ResolvedAndArchivedHistory: Story = {
  args: {
    statusFilter: "all",
    query: "legacy",
  },
};

export const AgentActivityVisible: Story = {
  args: {
    query: "WorkbenchContainer",
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
