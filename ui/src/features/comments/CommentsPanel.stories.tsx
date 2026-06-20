import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ViviComment } from "../../domain/comments.js";
import { CommentsPanel } from "./components/CommentsPanel.js";
import { InlineCommentCard } from "./components/InlineCommentCard.js";

const comment: ViviComment = {
  id: "comment-1",
  path: "docs/guide.md",
  viewerKind: "markdown",
  anchor: {
    surface: "source",
    canonical: {
      path: "docs/guide.md",
      lineStart: 8,
      lineEnd: 9,
      quote: "Keep the API boundary narrow.",
    },
  },
  body: "This is the important architectural seam.",
  status: "open",
  createdAt: "2026-06-20T00:00:00.000Z",
  updatedAt: "2026-06-20T00:00:00.000Z",
};

const meta = {
  title: "Comments/CommentsPanel",
  component: CommentsPanel,
  args: {
    open: true,
    comments: [comment],
    query: "",
    statusFilter: "open",
    onQueryChange: () => undefined,
    onStatusFilterChange: () => undefined,
    onClose: () => undefined,
    onOpenComment: () => undefined,
  },
} satisfies Meta<typeof CommentsPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WorkspaceComments: Story = {};

export const InlineCommentCardStory: Story = {
  render: () => (
    <InlineCommentCard
      comment={comment}
      rect={{ left: 40, top: 80, width: 180, height: 24 }}
      onClose={() => undefined}
      onStatusChange={() => undefined}
    />
  ),
};
