import type { Meta, StoryObj } from "@storybook/react-vite";
import { CommentsPanel } from "./components/CommentsPanel.js";
import { InlineCommentCard } from "./components/InlineCommentCard.js";
import {
  manyReviewComments,
  sampleComments,
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
    onQueryChange: () => undefined,
    onStatusFilterChange: () => undefined,
    onClose: () => undefined,
    onOpenComment: () => undefined,
    onStatusChange: () => undefined,
  },
} satisfies Meta<typeof CommentsPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WorkspaceComments: Story = {};

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
