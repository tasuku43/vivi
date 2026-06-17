import { describe, expect, it } from "vitest";
import {
  addHtmlHeadingIds,
  extractHtmlOutline,
  extractMarkdownOutline,
  renderMarkdownHtmlWithHeadingIds,
} from "../src/ui/state/outline.js";

describe("extractMarkdownOutline", () => {
  it("extracts H1 and H2 headings with stable ids", () => {
    expect(
      extractMarkdownOutline("# Title\n\n## Intro\n### Ignore\n## Intro"),
    ).toEqual([
      { id: "title", level: 1, text: "Title" },
      { id: "intro", level: 2, text: "Intro" },
      { id: "intro-2", level: 2, text: "Intro" },
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
      { id: "body-title", level: 1, text: "Body Title" },
      { id: "body-section", level: 2, text: "Body Section" },
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
      { id: "title", level: 1, text: "Title" },
      { id: "custom", level: 2, text: "Intro" },
      { id: "intro", level: 2, text: "Intro" },
    ]);
    expect(addHtmlHeadingIds(html)).toContain('<h1 id="title">Title</h1>');
    expect(addHtmlHeadingIds(html)).toContain('<h2 id="custom">Intro</h2>');
    expect(addHtmlHeadingIds(html)).toContain('<h2 id="intro">Intro</h2>');
  });
});
