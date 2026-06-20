import type { Meta, StoryObj } from "@storybook/react-vite";
import type {
  CommentThreadActivityEvent,
  ViviComment,
} from "../../domain/comments.js";
import { summarizeThreadActivity } from "../../state/comment-activity.js";
import { CommentsPanel } from "./components/CommentsPanel.js";
import { InlineCommentCard } from "./components/InlineCommentCard.js";

const comment: ViviComment = {
  id: "comment-1",
  threadId: "thread-1",
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

export const NoActivity: Story = {};

export const ReadByClaudeCode: Story = {
  args: {
    threadActivities: {
      "thread-1": summarizeThreadActivity([
        activity({
          id: "activity-read",
          type: "thread_read",
          actor: {
            id: "claude-code:run-1",
            kind: "claude-code",
            displayName: "Claude Code",
          },
          createdAt: "2026-06-20T00:00:48.000Z",
        }),
      ]),
    },
  },
};

export const CommentAddedByCodex: Story = {
  args: {
    threadActivities: {
      "thread-1": summarizeThreadActivity([
        activity({
          id: "activity-reply",
          type: "comment_added",
          actor: {
            id: "codex:run-1",
            kind: "codex",
            displayName: "Codex",
          },
          createdAt: "2026-06-20T00:00:00.000Z",
        }),
      ]),
    },
  },
};

export const StatusChangedByHuman: Story = {
  args: {
    threadActivities: {
      "thread-1": summarizeThreadActivity([
        activity({
          id: "activity-status",
          type: "thread_status_changed",
          actor: {
            id: "human:tasuku",
            kind: "human",
            displayName: "Tasuku",
          },
          previousStatus: "open",
          status: "resolved",
          createdAt: "2026-06-20T00:00:10.000Z",
        }),
      ]),
    },
  },
};

export const MultipleAgents: Story = {
  args: {
    threadActivities: {
      "thread-1": summarizeThreadActivity([
        activity({
          id: "activity-read",
          type: "thread_read",
          actor: {
            id: "claude-code:run-1",
            kind: "claude-code",
            displayName: "Claude Code",
          },
          createdAt: "2026-06-20T00:00:48.000Z",
        }),
        activity({
          id: "activity-reply",
          type: "comment_added",
          actor: {
            id: "codex:run-1",
            kind: "codex",
            displayName: "Codex",
          },
          createdAt: "2026-06-20T00:00:00.000Z",
        }),
        activity({
          id: "activity-unknown",
          type: "thread_read",
          actor: {
            id: "agent:unknown",
            kind: "unknown",
            displayName: "unknown agent",
          },
          createdAt: "2026-06-19T23:58:00.000Z",
        }),
      ]),
    },
  },
};

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

function activity(
  input: Partial<CommentThreadActivityEvent> & {
    id: string;
    type: CommentThreadActivityEvent["type"];
  },
): CommentThreadActivityEvent {
  return {
    threadId: "thread-1",
    commentId: undefined,
    clientEventId: undefined,
    actor: { id: "agent:unknown", kind: "unknown" },
    createdAt: "2026-06-20T00:00:00.000Z",
    ...input,
  };
}
