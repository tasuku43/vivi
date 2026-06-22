import { describe, expect, it } from "vitest";
import type { ViviComment } from "../../ui/src/domain/comments.js";
import { buildCommentThreads } from "../../ui/src/domain/comments.js";
import {
  activeCommentsForPath,
  codeCommentThreads,
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

  it("projects legacy flat comments and hides terminal threads from active review", () => {
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
    expect(buildCommentThreads([openedThread, resolvedThread])[0]).toMatchObject(
      {
        id: "thread-a",
        status: "resolved",
      },
    );
    expect(
      activeCommentsForPath(
        [
          legacy,
          openedThread,
          resolvedThread,
          comment("open", "open"),
          comment("archived", "archived"),
        ],
        "README.md",
      ).map((item) => item.id),
    ).toEqual(["open"]);
  });
});
