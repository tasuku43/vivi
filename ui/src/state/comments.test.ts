import { describe, expect, it } from "vitest";
import type { DraftReviewComment, ViviComment } from "../domain/comments.js";
import {
  codeCommentThreads,
  draftReviewCommentAsViviComment,
} from "./comments.js";

const anchor = {
  surface: "source" as const,
  canonical: {
    path: "README.md",
    lineStart: 4,
    lineEnd: 4,
    quote: "same line",
    fileHash: "sha256:readme",
  },
};

const existingComment: ViviComment = {
  id: "comment-existing",
  threadId: "thread-existing",
  path: "README.md",
  viewerKind: "markdown",
  anchor,
  body: "Existing published thread.",
  status: "open",
  createdAt: "2026-06-20T09:00:00.000Z",
  updatedAt: "2026-06-20T09:00:00.000Z",
};

function draft(
  id: string,
  input: { threadId?: string; body?: string } = {},
): DraftReviewComment {
  return {
    id,
    threadId: input.threadId,
    path: "README.md",
    viewerKind: "markdown",
    anchor,
    body: input.body ?? `Draft ${id}`,
    createdAt: "2026-06-20T09:10:00.000Z",
    updatedAt: "2026-06-20T09:10:00.000Z",
  };
}

describe("draftReviewCommentAsViviComment", () => {
  it("keeps threadId-less same-anchor drafts separate from published threads", () => {
    const draftComment = draftReviewCommentAsViviComment(
      draft("same-anchor"),
      [existingComment],
    );

    expect(draftComment.threadId).not.toBe(existingComment.threadId);
    expect(draftComment.threadId).toContain("draft-thread:same-anchor:");

    const threads = codeCommentThreads([existingComment, draftComment]);
    expect(threads).toHaveLength(2);
    expect(
      threads
        .map((thread) => thread.comments.map((comment) => comment.id).join(","))
        .sort(),
    ).toEqual(["comment-existing", "draft:same-anchor"]);
  });

  it("uses explicit draft threadId to preview reply drafts", () => {
    const replyDraft = draftReviewCommentAsViviComment(
      draft("reply", { threadId: existingComment.threadId }),
      [existingComment],
    );

    expect(replyDraft.threadId).toBe(existingComment.threadId);

    const threads = codeCommentThreads([existingComment, replyDraft]);
    expect(threads).toHaveLength(1);
    expect(threads[0]?.comments.map((comment) => comment.id)).toEqual([
      "comment-existing",
      "draft:reply",
    ]);
  });

  it("keeps multiple threadId-less drafts on the same anchor as separate previews", () => {
    const first = draftReviewCommentAsViviComment(
      draft("first", { body: "First draft." }),
      [],
    );
    const second = draftReviewCommentAsViviComment(
      draft("second", { body: "Second draft." }),
      [],
    );

    expect(first.threadId).not.toBe(second.threadId);

    const threads = codeCommentThreads([first, second]);
    expect(threads).toHaveLength(2);
    expect(threads.map((thread) => thread.comments[0]?.body)).toEqual([
      "First draft.",
      "Second draft.",
    ]);
  });
});
