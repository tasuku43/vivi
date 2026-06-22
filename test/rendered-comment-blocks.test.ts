import { describe, expect, it } from "vitest";
import {
  addRenderedCommentBlockIdsToHtml,
  renderedCommentBlocksForHtml,
} from "../ui/src/domain/rendered-comment-blocks.js";
import { positionInlineCommentCard } from "../ui/src/features/comments/components/InlineCommentCard.js";
import {
  renderedCommentActionLabel,
  renderedCommentSourceRange,
  renderedCommentSummaryForComment,
} from "../ui/src/state/rendered-comment-blocks.js";

describe("rendered comment blocks", () => {
  it("annotates readable blocks without rewriting raw text or template content", () => {
    const html = addRenderedCommentBlockIdsToHtml(`
<script>const example = "<p>not markup</p>";</script>
<style>p::before { content: "<p>not markup</p>"; }</style>
<template><p>not rendered</p></template>
<p title="one > two">Visible</p>
<p data-vivi-comment-block-id="kept">Existing</p>
<p>After</p>`);

    expect(html).toContain('const example = "<p>not markup</p>";');
    expect(html).toContain('content: "<p>not markup</p>";');
    expect(html).toContain("<template><p>not rendered</p></template>");
    expect(html).toContain(
      '<p title="one > two" data-vivi-comment-block-id="vivi-block-1" data-vivi-source-line-start="5" data-vivi-source-line-end="5">',
    );
    expect(html).not.toContain('data-vivi-comment-block-id="kept"');
    expect(html).toContain(
      '<p data-vivi-comment-block-id="vivi-block-3" data-vivi-source-line-start="7" data-vivi-source-line-end="7">After</p>',
    );
  });

  it("builds trusted ranges for multiline and optionally closed HTML blocks", () => {
    expect(
      renderedCommentBlocksForHtml(`<h1>Title</h1>
<p>First
line
<ul><li>One<li>Two</ul>
<table><tr><td>A</td></tr>
<tr><td>B</td></tr></table>`),
    ).toEqual([
      expect.objectContaining({
        blockId: "vivi-block-1",
        tagName: "h1",
        sourceLineStart: 1,
        sourceLineEnd: 1,
      }),
      expect.objectContaining({
        blockId: "vivi-block-2",
        tagName: "p",
        sourceLineStart: 2,
        sourceLineEnd: 3,
      }),
      expect.objectContaining({
        blockId: "vivi-block-3",
        tagName: "li",
        sourceLineStart: 4,
      }),
      expect.objectContaining({
        blockId: "vivi-block-4",
        tagName: "li",
        sourceLineStart: 4,
      }),
      expect.objectContaining({
        blockId: "vivi-block-5",
        tagName: "tr",
        sourceLineStart: 5,
        sourceLineEnd: 5,
      }),
      expect.objectContaining({
        blockId: "vivi-block-6",
        tagName: "tr",
        sourceLineStart: 6,
        sourceLineEnd: 6,
      }),
    ]);
  });

  it("keeps block annotation linear for many nested-looking tags", () => {
    const html = `<body ${"<body ".repeat(2_000)}><pre class="mermaid">${"<div>a".repeat(4_000)}</body>`;

    expect(addRenderedCommentBlockIdsToHtml(html)).toContain(
      '<pre class="mermaid" data-vivi-comment-block-id="vivi-block-1"',
    );
    expect(renderedCommentBlocksForHtml(html)).toEqual([
      expect.objectContaining({
        blockId: "vivi-block-1",
        tagName: "pre",
      }),
    ]);
  });

  it("projects source comments into document blocks without changing storage", () => {
    expect(
      renderedCommentSummaryForComment(
        {
          id: "source-comment",
          path: "README.md",
          viewerKind: "markdown",
          anchor: {
            surface: "source",
            canonical: {
              path: "README.md",
              lineStart: 3,
              lineEnd: 4,
              quote: "raw markdown",
            },
          },
          body: "Review this paragraph",
          status: "open",
          createdAt: "2026-06-19T00:00:00.000Z",
          updatedAt: "2026-06-19T00:00:00.000Z",
        },
        "markdown",
      ),
    ).toMatchObject({
      id: "source-comment",
      sourceLineStart: 3,
      sourceLineEnd: 4,
    });
  });

  it("projects diff comments into rendered document blocks through canonical lines", () => {
    expect(
      renderedCommentSummaryForComment(
        {
          id: "diff-comment",
          path: "README.md",
          viewerKind: "markdown",
          anchor: {
            surface: "diff",
            canonical: {
              path: "README.md",
              lineStart: 3,
              lineEnd: 4,
              quote: "current markdown",
            },
            diff: {
              path: "README.md",
              base: "HEAD",
              ref: "working tree",
              hunkId: "@@ -3,2 +3,2 @@",
              side: "new",
              newLineStart: 3,
              newLineEnd: 4,
            },
          },
          body: "Review this diff paragraph",
          status: "open",
          createdAt: "2026-06-19T00:00:00.000Z",
          updatedAt: "2026-06-19T00:00:00.000Z",
        },
        "markdown",
      ),
    ).toMatchObject({
      id: "diff-comment",
      sourceLineStart: 3,
      sourceLineEnd: 4,
      textQuote: "current markdown",
    });
  });

  it("labels rendered comment markers with their message count", () => {
    expect(renderedCommentActionLabel(1)).toBe(
      "Open comment thread with 1 message",
    );
    expect(renderedCommentActionLabel(3)).toBe(
      "Open comment thread with 3 messages",
    );
  });

  it("normalizes multiple rendered blocks to one source line range", () => {
    expect(
      renderedCommentSourceRange([
        { sourceLineStart: 12, sourceLineEnd: 13 },
        { sourceLineStart: 15, sourceLineEnd: 15 },
        { sourceLineStart: 18, sourceLineEnd: 21 },
      ]),
    ).toEqual({ start: 12, end: 21 });
  });

  it("keeps a rendered comment card beside the block or moves it fully above", () => {
    expect(
      positionInlineCommentCard(
        { left: 200, top: 120, width: 300, height: 60 },
        { width: 1000, height: 700 },
        { width: 340, height: 220 },
      ),
    ).toMatchObject({ left: 512, arrow: "left" });

    const narrow = positionInlineCommentCard(
      { left: 280, top: 232, width: 460, height: 58 },
      { width: 756, height: 469 },
      { width: 340, height: 220 },
    );
    expect(narrow).toMatchObject({ arrow: "top", top: 302, maxHeight: 155 });
  });
});
