import { describe, expect, it } from "vitest";
import {
  addHtmlHeadingIds,
  extractHtmlOutline,
  extractMarkdownOutline,
  renderMarkdownHtmlWithHeadingIds,
} from "../ui/src/state/outline.js";

describe("extractMarkdownOutline", () => {
  it("extracts H1 and H2 headings with stable ids", () => {
    expect(
      extractMarkdownOutline("# Title\n\n## Intro\n### Ignore\n## Intro"),
    ).toEqual([
      { id: "title", level: 1, text: "Title", lineStart: 1 },
      { id: "intro", level: 2, text: "Intro", lineStart: 3 },
      { id: "intro-2", level: 2, text: "Intro", lineStart: 5 },
    ]);
  });

  it("builds Markdown outline from the body after front matter", () => {
    expect(
      extractMarkdownOutline(`---
title: Outline Example
---

# Body Title

## Body Section`),
    ).toEqual([
      { id: "body-title", level: 1, text: "Body Title", lineStart: 5 },
      { id: "body-section", level: 2, text: "Body Section", lineStart: 7 },
    ]);
  });

  it("adds matching ids to rendered markdown headings", () => {
    const outline = extractMarkdownOutline("# Title\n\n## Intro");

    expect(
      renderMarkdownHtmlWithHeadingIds(
        "<h1>Title</h1><p>x</p><h2>Intro</h2>",
        outline,
      ),
    ).toBe('<h1 id="title">Title</h1><p>x</p><h2 id="intro">Intro</h2>');
  });

  it("extracts and injects HTML H1/H2 heading ids", () => {
    const html =
      '<h1>Title</h1><section><h2 id="custom">Intro</h2><h2>Intro</h2></section>';

    expect(extractHtmlOutline(html)).toEqual([
      { id: "title", level: 1, text: "Title", lineStart: 1 },
      { id: "custom", level: 2, text: "Intro", lineStart: 1 },
      { id: "intro", level: 2, text: "Intro", lineStart: 1 },
    ]);
    expect(addHtmlHeadingIds(html)).toContain('<h1 id="title">Title</h1>');
    expect(addHtmlHeadingIds(html)).toContain('<h2 id="custom">Intro</h2>');
    expect(addHtmlHeadingIds(html)).toContain('<h2 id="intro">Intro</h2>');
  });

  it("strips HTML tags before deriving generated heading ids", () => {
    const html =
      '<h1><script>alert("x")</script>Safe Title</h1><h2 data-label="one > two">Two</h2>';

    expect(extractHtmlOutline(html)).toEqual([
      { id: "safe-title", level: 1, text: "Safe Title", lineStart: 1 },
      { id: "two", level: 2, text: "Two", lineStart: 1 },
    ]);
    expect(addHtmlHeadingIds(html)).toContain('<h1 id="safe-title">');
    expect(addHtmlHeadingIds(html)).toContain(
      '<h2 id="two" data-label="one > two">',
    );
  });

  it("tracks heading source lines in multiline HTML", () => {
    expect(
      extractHtmlOutline("<main>\n<h1>Title</h1>\n<p>x</p>\n<h2>Next</h2>"),
    ).toEqual([
      { id: "title", level: 1, text: "Title", lineStart: 2 },
      { id: "next", level: 2, text: "Next", lineStart: 4 },
    ]);
  });
});
