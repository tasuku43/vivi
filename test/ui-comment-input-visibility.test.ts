import { expect, it } from "vitest";
import type { CommentDraft } from "../ui/src/state/comments.js";
import {
  commentInputSessionId,
  resumableCommentInputSessions,
  type CommentInputSession,
} from "../ui/src/state/comment-input-session.js";
import { resumeViewerMode } from "../ui/src/features/workbench/WorkbenchContainer.js";
import { sourceDraftThreadForSession } from "../ui/src/features/comments/components/SourceCommentSurface.js";
import { buildUnavailableFeedbackItems } from "../ui/src/state/review-queue.js";
import type {
  DraftReviewComment,
  ViviComment,
} from "../ui/src/domain/comments.js";

function session(path: string, body: string): CommentInputSession {
  const draft: CommentDraft = {
    path,
    viewerKind: path.endsWith(".html") ? "html" : "markdown",
    anchor: {
      surface: "rendered",
      canonical: { path, lineStart: 3, lineEnd: 3 },
      rendered: {
        kind: path.endsWith(".html") ? "html" : "markdown",
        blockId: "vivi-block-1",
      },
    },
  };
  return {
    id: commentInputSessionId(draft),
    draft,
    body,
    status: "collapsed",
  };
}

it("only exposes non-empty inputs for files that remain open", () => {
  const markdown = session("README.md", "Markdown thought");
  const html = session("docs/report.html", "HTML thought");
  const closed = session("docs/closed.md", "Hidden but preserved");
  const empty = session("docs/empty.md", "");
  const sessions = [markdown, html, closed, empty];
  const openPaths = new Set(["README.md", "docs/report.html", "docs/empty.md"]);

  expect(resumableCommentInputSessions(sessions, openPaths)).toEqual([
    markdown,
    html,
  ]);
  expect(
    resumableCommentInputSessions(sessions, openPaths, "docs/report.html"),
  ).toEqual([html]);
  expect(resumableCommentInputSessions(sessions, openPaths, null)).toEqual([]);
  expect(sessions).toContain(closed);
});

it("resumes rendered HTML in preview mode and Markdown in rendered mode", () => {
  expect(resumeViewerMode(session("docs/report.html", "HTML thought"))).toBe(
    "preview",
  );
  expect(resumeViewerMode(session("README.md", "Markdown thought"))).toBe(
    "rendered",
  );
  const source = session("README.md", "Source thought");
  source.draft.anchor.surface = "source";
  expect(resumeViewerMode(source)).toBe("source");
});

it("clamps stale Source inputs to the current file and reanchors its hash", () => {
  const source = session("README.md", "Source thought");
  source.status = "stale";
  source.draft.anchor = {
    surface: "source",
    canonical: {
      path: "README.md",
      lineStart: 40,
      lineEnd: 44,
      quote: "Removed lines",
      fileHash: "sha256:old",
    },
  };
  source.id = commentInputSessionId(source.draft);

  const projection = sourceDraftThreadForSession(
    {
      path: "README.md",
      viewerKind: "markdown",
      encoding: "utf8",
      content: "# Current\n\nLast line\n",
      etag: "sha256:current",
      size: 21,
      mtimeMs: 1,
    },
    source,
  );

  expect(projection?.thread).toMatchObject({ lineStart: 3, lineEnd: 3 });
  expect(projection?.draft).toBe(source.draft);
  expect(projection?.reanchorDraft.anchor.canonical).toMatchObject({
    lineStart: 3,
    lineEnd: 3,
    quote: "Last line",
    fileHash: "sha256:current",
  });
});

it("projects missing feedback separately from active queue navigation", () => {
  const base = session("docs/missing.md", "body").draft;
  const comment: ViviComment = {
    id: "comment-1",
    threadId: "thread-1",
    ...base,
    body: "Published feedback",
    source: "human",
    status: "open",
    createdAt: "2026-08-29T00:00:00.000Z",
    updatedAt: "2026-08-29T00:00:00.000Z",
  };
  const draft: DraftReviewComment = {
    id: "draft-1",
    ...base,
    body: "Pending feedback",
    source: "human",
    createdAt: "2026-08-29T00:00:00.000Z",
    updatedAt: "2026-08-29T00:00:00.000Z",
  };

  expect(
    buildUnavailableFeedbackItems(
      [comment],
      [draft],
      new Set(["docs/missing.md"]),
    ),
  ).toEqual([
    {
      path: "docs/missing.md",
      publishedCount: 1,
      draftCount: 1,
    },
  ]);
});
