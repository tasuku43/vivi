import { describe, expect, it } from "vitest";
import type { CommentDraft } from "./comments.js";
import {
  buildStoredCommentInputSessions,
  commentInputAnchorKey,
  commentInputSessionStorageKeyForRoot,
  commentInputSessionTtlMs,
  commentInputSessionId,
  parseStoredCommentInputSessions,
  reduceCommentInputSessions,
  restoreStoredCommentInputSessions,
  unsavedCommentInputCount,
} from "./comment-input-session.js";

function draft(fileHash = "sha256:v1"): CommentDraft {
  return {
    path: "README.md",
    viewerKind: "markdown",
    anchor: {
      surface: "source",
      canonical: {
        path: "README.md",
        lineStart: 4,
        lineEnd: 4,
        quote: "same line",
        fileHash,
      },
    },
  };
}

describe("comment input sessions", () => {
  it("collapses without discarding and resumes with its body", () => {
    const input = draft();
    const started = reduceCommentInputSessions([], {
      type: "change",
      draft: input,
      body: "Keep this thought",
    });
    const collapsed = reduceCommentInputSessions(started, {
      type: "collapse",
      id: commentInputSessionId(input),
    });
    const resumed = reduceCommentInputSessions(collapsed, {
      type: "start",
      draft: input,
    });

    expect(collapsed[0]).toMatchObject({
      body: "Keep this thought",
      status: "collapsed",
    });
    expect(resumed[0]).toMatchObject({
      body: "Keep this thought",
      status: "open",
    });
  });

  it("marks changed file anchors stale until explicitly re-anchored", () => {
    const input = draft();
    const started = reduceCommentInputSessions([], {
      type: "change",
      draft: input,
      body: "Needs another look",
    });
    const stale = reduceCommentInputSessions(started, {
      type: "mark-path-version",
      path: input.path,
      fileHash: "sha256:v2",
    });
    const accidentalResume = reduceCommentInputSessions(stale, {
      type: "start",
      draft: draft("sha256:v2"),
    });
    const reanchored = reduceCommentInputSessions(accidentalResume, {
      type: "reanchor",
      id: commentInputSessionId(input),
      draft: draft("sha256:v2"),
    });

    expect(stale[0]?.status).toBe("stale");
    expect(accidentalResume[0]?.draft.anchor.canonical.fileHash).toBe(
      "sha256:v1",
    );
    expect(reanchored[0]).toMatchObject({ status: "open" });
    expect(reanchored[0]?.draft.anchor.canonical.fileHash).toBe("sha256:v2");
  });

  it("removes input only through discard", () => {
    const input = draft();
    const started = reduceCommentInputSessions([], {
      type: "start",
      draft: input,
    });

    expect(
      reduceCommentInputSessions(started, {
        type: "discard",
        id: commentInputSessionId(input),
      }),
    ).toEqual([]);
  });

  it("restores workspace-scoped input after a page reload", () => {
    const root = "/workspace/vivi";
    const sessions = reduceCommentInputSessions([], {
      type: "change",
      draft: draft(),
      body: "Keep this across reload",
    });
    const stored = buildStoredCommentInputSessions(root, sessions, 1_000);
    const parsed = parseStoredCommentInputSessions(JSON.stringify(stored));

    expect(commentInputSessionStorageKeyForRoot(root)).toContain(
      encodeURIComponent(root),
    );
    expect(restoreStoredCommentInputSessions(parsed, root, 2_000)).toEqual(
      sessions,
    );
    expect(
      restoreStoredCommentInputSessions(parsed, "/workspace/other", 2_000),
    ).toEqual([]);
  });

  it("expires abandoned input and ignores malformed storage", () => {
    const stored = buildStoredCommentInputSessions(
      "/workspace/vivi",
      reduceCommentInputSessions([], {
        type: "start",
        draft: draft(),
      }),
      1_000,
    );

    expect(
      restoreStoredCommentInputSessions(
        stored,
        stored.root,
        1_000 + commentInputSessionTtlMs + 1,
      ),
    ).toEqual([]);
    expect(parseStoredCommentInputSessions('{"version":1}')).toBeNull();
  });

  it("counts only typed input for the requested file and surface", () => {
    const typed = reduceCommentInputSessions([], {
      type: "change",
      draft: draft(),
      body: "Visible from rendered mode",
    });
    const empty = reduceCommentInputSessions(typed, {
      type: "start",
      draft: { ...draft(), path: "OTHER.md" },
    });

    expect(unsavedCommentInputCount(empty, "README.md", "source")).toBe(1);
    expect(unsavedCommentInputCount(empty, "README.md", "rendered")).toBe(0);
    expect(unsavedCommentInputCount(empty, "OTHER.md")).toBe(0);
  });

  it("keeps saved input in place until its draft anchor is published", () => {
    const input = draft();
    const started = reduceCommentInputSessions([], {
      type: "change",
      draft: input,
      body: "Save, then publish",
    });
    const saved = reduceCommentInputSessions(started, {
      type: "mark-saved",
      id: commentInputSessionId(input),
    });
    const published = reduceCommentInputSessions(saved, {
      type: "discard-anchors",
      anchorKeys: [commentInputAnchorKey(input)],
    });

    expect(saved[0]).toMatchObject({ body: "", status: "saved" });
    expect(published).toEqual([]);
  });
});
