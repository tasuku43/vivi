import type { Meta, StoryObj } from "@storybook/react-vite";
import type { CommentStatus, ViviComment } from "../../domain/comments.js";
import { draftReviewCommentAsViviComment } from "../../state/comments.js";
import { summarizeThreadActivity } from "../../state/comment-activity.js";
import { CodeCommentThread } from "./components/CodeCommentThread.js";
import {
  sampleComments,
  sampleDraftComments,
  sampleFiles,
  sampleThreadActivities,
} from "../../storybook/fixtures/review-lab.js";

const anchor = {
  surface: "source" as const,
  canonical: {
    path: sampleFiles.code.path,
    lineStart: 9,
    lineEnd: 12,
    quote: "function publishDraftReviewComments()",
    fileHash: sampleFiles.code.etag,
  },
};

function comments(status: CommentStatus): ViviComment[] {
  return [
    {
      ...sampleComments[0]!,
      status,
      resolvedAt:
        status === "resolved" ? "2026-06-20T09:20:00.000Z" : undefined,
      archivedAt:
        status === "archived" ? "2026-06-20T09:25:00.000Z" : undefined,
    },
    {
      ...sampleComments[1]!,
      status,
      resolvedAt:
        status === "resolved" ? "2026-06-20T09:20:00.000Z" : undefined,
      archivedAt:
        status === "archived" ? "2026-06-20T09:25:00.000Z" : undefined,
    },
  ];
}

const meta = {
  title: "Review/Comments/Inline Thread",
  component: CodeCommentThread,
  parameters: { layout: "centered", a11y: { test: "error" } },
  args: { onClose: () => undefined },
} satisfies Meta<typeof CodeCommentThread>;

export default meta;
type Story = StoryObj<typeof meta>;

function args(status: CommentStatus) {
  return {
    thread: {
      key: "thread-workbench-open",
      path: sampleFiles.code.path,
      lineStart: 9,
      lineEnd: 12,
      status,
      comments: comments(status),
    },
    draft: {
      threadId: "thread-workbench-open",
      path: sampleFiles.code.path,
      viewerKind: "text" as const,
      anchor,
    },
  };
}

export const Open: Story = { args: args("open") };
export const Resolved: Story = { args: args("resolved") };
export const Archived: Story = { args: args("archived") };

export const UserWritesOneDraftComment: Story = {
  args: {
    thread: {
      key: "draft-review-1",
      path: sampleFiles.code.path,
      lineStart: 6,
      lineEnd: 6,
      status: "open",
      comments: [
        draftReviewCommentAsViviComment(
          sampleDraftComments[0]!,
          sampleComments,
        ),
      ],
    },
    draft: {
      path: sampleFiles.code.path,
      viewerKind: "text",
      anchor: sampleDraftComments[0]!.anchor,
    },
  },
};

export const UserWritesMultipleDraftComments: Story = {
  args: {
    thread: {
      key: "draft-review-multiple",
      path: sampleFiles.code.path,
      lineStart: 6,
      lineEnd: 10,
      status: "open",
      comments: sampleDraftComments
        .filter((draft) => draft.path === sampleFiles.code.path)
        .map((draft) => draftReviewCommentAsViviComment(draft, sampleComments)),
    },
    draft: {
      path: sampleFiles.code.path,
      viewerKind: "text",
      anchor: sampleDraftComments[0]!.anchor,
    },
  },
};

export const AgentHasReadThread: Story = {
  args: {
    ...args("open"),
    activity: summarizeThreadActivity(
      sampleThreadActivities["thread-workbench-open"]?.timeline.filter(
        (event) => event.type === "thread_read",
      ),
    ),
  },
};

export const AgentHasReplied: Story = {
  args: {
    ...args("open"),
    activity: sampleThreadActivities["thread-workbench-open"],
  },
};
