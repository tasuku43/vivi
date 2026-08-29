import { describe, expect, it } from "vitest";
import type { ViviComment } from "../../ui/src/domain/comments.js";
import { buildCommentThreads } from "../../ui/src/domain/comments.js";
import {
  codeCommentThreads,
  lineCommentThreadActionLabel,
  preferredCodeCommentThread,
} from "../../ui/src/state/comments.js";

const anchor = {
  surface: "source" as const,
  canonical: { path: "README.md", lineStart: 3, lineEnd: 3 },
};

function comment(
  id: string,
  status: ViviComment["status"],
  threadId?: string,
): ViviComment {
  return {
    id,
    threadId,
    path: "README.md",
    viewerKind: "markdown",
    anchor,
    body: id,
    source: "unknown",
    status,
    createdAt: `2026-01-01T00:00:0${id.length}Z`,
    updatedAt: `2026-01-01T00:00:0${id.length}Z`,
  };
}

describe("comment thread projection", () => {
  it("keeps explicit threads separate even when anchors match", () => {
    const threads = codeCommentThreads([
      comment("a", "open", "thread-a"),
      comment("b", "open", "thread-b"),
      comment("c", "open", "thread-a"),
    ]);
    expect(threads).toHaveLength(2);
    expect(
      threads.map((thread) => thread.comments.map((item) => item.id)),
    ).toEqual([["a", "c"], ["b"]]);
  });

  it("preserves legacy status in the transport-domain projection", () => {
    const legacy = comment("legacy", "resolved");
    const openedThread = {
      ...comment("thread-open", "open", "thread-a"),
      updatedAt: "2026-01-01T00:00:01Z",
    };
    const resolvedThread = {
      ...comment("thread-resolved", "resolved", "thread-a"),
      updatedAt: "2026-01-01T00:00:02Z",
    };
    expect(buildCommentThreads([legacy])[0]).toMatchObject({
      id: "legacy",
      status: "resolved",
    });
    expect(
      buildCommentThreads([openedThread, resolvedThread])[0],
    ).toMatchObject({
      id: "thread-a",
      status: "resolved",
    });
  });

  it("keeps browser feedback projection independent from legacy status", () => {
    const resolved = comment("resolved", "resolved", "thread-resolved");
    const open = comment("open", "open", "thread-open");
    const archived = comment("archived", "archived", "thread-archived");
    const threads = codeCommentThreads([resolved, archived, open]);

    expect(threads.map((thread) => thread.comments[0]?.id).sort()).toEqual([
      "archived",
      "open",
      "resolved",
    ]);
    expect(
      preferredCodeCommentThread(threads, "resolved")?.comments[0]?.id,
    ).toBe("resolved");
    expect(
      lineCommentThreadActionLabel(3, preferredCodeCommentThread(threads), {
        threadCount: 2,
        messageCount: 2,
      }),
    ).toBe("Open 2 comment threads on line 3 with 2 messages");
  });
});
