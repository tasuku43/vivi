import { describe, expect, it } from "vitest";
import type {
  CommentActor,
  CommentThread,
  CommentThreadActivityEvent,
  ViviComment,
} from "../domain/comments.js";
import { commentThreadReviewReceipt } from "./comment-activity.js";

const human: CommentActor = {
  id: "human:tasuku",
  kind: "human",
  displayName: "Tasuku",
};

const codex: CommentActor = {
  id: "codex:run-42",
  kind: "codex",
  displayName: "Codex",
};

const claude: CommentActor = {
  id: "claude-code:run-7",
  kind: "claude-code",
  displayName: "Claude Code",
};

const anchor = {
  surface: "source" as const,
  canonical: {
    path: "README.md",
    lineStart: 18,
    lineEnd: 18,
    quote: "Mention the agent-readable contract.",
  },
};

describe("commentThreadReviewReceipt", () => {
  it("shows published human feedback as not read until an agent read event exists", () => {
    expect(commentThreadReviewReceipt(thread(), [])).toMatchObject({
      state: "not-read",
      label: "Not read",
      meta: "published · not read by agent",
    });
  });

  it("shows agent read when the agent has read the thread but has not replied", () => {
    expect(
      commentThreadReviewReceipt(thread(), [
        activity("agent-read", "thread_read", claude, "2026-06-20T09:05:00Z"),
      ]),
    ).toMatchObject({
      state: "agent-read",
      label: "Agent read",
      meta: "Claude Code read · waiting on reply",
    });
  });

  it("shows an unread reply when an agent replied after the latest human read", () => {
    expect(
      commentThreadReviewReceipt(thread(), [
        activity("human-read", "thread_read", human, "2026-06-20T09:06:00Z"),
        activity("agent-reply", "comment_added", codex, "2026-06-20T09:08:00Z"),
      ]),
    ).toMatchObject({
      state: "reply-unread",
      label: "Unread reply",
      meta: "Codex replied · unread by you",
    });
  });

  it("shows reply read when a human read event follows the latest agent reply", () => {
    expect(
      commentThreadReviewReceipt(thread(), [
        activity("agent-reply", "comment_added", codex, "2026-06-20T09:08:00Z"),
        activity("human-read", "thread_read", human, "2026-06-20T09:09:00Z"),
      ]),
    ).toMatchObject({
      state: "reply-read",
      label: "Reply read",
      meta: "Codex reply read by you",
    });
  });

  it("does not treat a human reply as an agent reply", () => {
    expect(
      commentThreadReviewReceipt(thread(), [
        activity("human-reply", "comment_added", human, "2026-06-20T09:08:00Z"),
      ]),
    ).toMatchObject({
      state: "not-read",
      label: "Not read",
    });
  });
});

function thread(input: Partial<CommentThread> = {}): CommentThread {
  const firstComment = comment({
    id: "comment-1",
    createdAt: "2026-06-20T09:00:00Z",
    updatedAt: "2026-06-20T09:00:00Z",
  });
  return {
    id: "thread-1",
    path: "README.md",
    status: "open",
    reviewBatchId: "review-batch-1",
    anchor,
    createdAt: firstComment.createdAt,
    updatedAt: firstComment.updatedAt,
    comments: [firstComment],
    ...input,
  };
}

function comment(
  input: Partial<ViviComment> & Pick<ViviComment, "id">,
): ViviComment {
  return {
    threadId: "thread-1",
    path: "README.md",
    viewerKind: "markdown" as const,
    anchor,
    body: "Please check whether this section is visible enough.",
    createdBy: human,
    source: "human" as const,
    status: "open" as const,
    reviewBatchId: "review-batch-1",
    createdAt: "2026-06-20T09:00:00Z",
    updatedAt: "2026-06-20T09:00:00Z",
    ...input,
  };
}

function activity(
  id: string,
  type: CommentThreadActivityEvent["type"],
  actor: CommentActor,
  createdAt: string,
): CommentThreadActivityEvent {
  return {
    id,
    threadId: "thread-1",
    type,
    actor,
    createdAt,
  };
}
