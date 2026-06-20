import type { Meta, StoryObj } from "@storybook/react-vite";
import type { CommentStatus, ViviComment } from "../../domain/comments.js";
import { summarizeThreadActivity } from "../../state/comment-activity.js";
import { CodeCommentThread } from "./components/CodeCommentThread.js";

const anchor = {
  surface: "source" as const,
  canonical: { path: "src/review.ts", lineStart: 12, lineEnd: 14 },
};

function comments(status: CommentStatus): ViviComment[] {
  return [
    {
      id: "comment-1",
      threadId: "thread-1",
      path: "src/review.ts",
      viewerKind: "text",
      anchor,
      body: "Please keep the retry boundary explicit.",
      source: "human",
      status,
      createdAt: "2026-06-20T09:00:00.000Z",
      updatedAt: "2026-06-20T09:05:00.000Z",
    },
    {
      id: "comment-2",
      threadId: "thread-1",
      path: "src/review.ts",
      viewerKind: "text",
      anchor,
      body: "Updated and covered by the timeout test.",
      source: "codex",
      status,
      createdAt: "2026-06-20T09:05:00.000Z",
      updatedAt: "2026-06-20T09:05:00.000Z",
    },
  ];
}

const meta = {
  title: "Comments/Thread lifecycle",
  component: CodeCommentThread,
  parameters: { layout: "centered" },
  args: { onClose: () => undefined },
} satisfies Meta<typeof CodeCommentThread>;

export default meta;
type Story = StoryObj<typeof meta>;

function args(status: CommentStatus) {
  return {
    thread: {
      key: "thread-1",
      path: "src/review.ts",
      lineStart: 12,
      lineEnd: 14,
      comments: comments(status),
    },
    draft: {
      threadId: "thread-1",
      path: "src/review.ts",
      viewerKind: "text" as const,
      anchor,
    },
  };
}

export const Open: Story = { args: args("open") };
export const Resolved: Story = { args: args("resolved") };
export const Archived: Story = { args: args("archived") };
export const WithAgentActivity: Story = {
  args: {
    ...args("open"),
    activity: summarizeThreadActivity(
      [
        {
          id: "activity-1",
          threadId: "thread-1",
          type: "thread_read",
          actor: {
            id: "claude-code:run-1",
            kind: "claude-code",
            displayName: "Claude Code",
          },
          createdAt: "2026-06-20T09:06:48.000Z",
        },
        {
          id: "activity-2",
          threadId: "thread-1",
          type: "comment_added",
          actor: {
            id: "codex:run-1",
            kind: "codex",
            displayName: "Codex",
          },
          createdAt: "2026-06-20T09:06:00.000Z",
        },
      ],
      new Date("2026-06-20T09:07:00.000Z").getTime(),
    ),
  },
};
