import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styles = readFileSync("ui/src/styles.css", "utf8");

describe("code viewer line actions", () => {
  it("keeps the comment action on a fixed gutter rail", () => {
    expect(styles).toContain(
      "grid-template-columns: 64px max-content minmax(0, 1fr);",
    );
    expect(styles).toContain(
      "grid-template-columns: 48px max-content minmax(0, 1fr);",
    );
    expect(styles).toMatch(
      /\.code-line-comment-action \{[\s\S]*?position: absolute;[\s\S]*?left: 1px;[\s\S]*?width: 28px;[\s\S]*?height: 24px;/,
    );
  });
});

describe("rendered comment block ranges", () => {
  it("defines one layout-independent surface for document blocks", () => {
    expect(styles).toMatch(
      /\.vivi-rendered-comment-block \{[\s\S]*?--rendered-comment-block-left: -12px;[\s\S]*?--rendered-comment-block-right: -12px;/,
    );
    expect(styles).toMatch(
      /\.vivi-rendered-comment-block \{[\s\S]*?cursor: pointer;/,
    );
    expect(styles).toMatch(
      /\.vivi-rendered-comment-block:not\(tr\)::before \{[\s\S]*?left: var\(--rendered-comment-block-left\);/,
    );
    expect(styles).toMatch(
      /\.vivi-rendered-comment-block:not\(tr\)::before \{[\s\S]*?z-index: 0;/,
    );
    expect(styles).not.toContain("z-index: -1;");
    expect(styles).toMatch(
      /\.vivi-rendered-comment-block:not\(tr\) > \* \{[\s\S]*?position: relative;[\s\S]*?z-index: 1;/,
    );
    expect(styles).toMatch(
      /\.vivi-rendered-comment-block:not\(tr\)::before \{[\s\S]*?top: var\(--rendered-comment-block-top\);[\s\S]*?bottom: var\(--rendered-comment-block-bottom\);/,
    );
    expect(styles).toMatch(
      /\.vivi-rendered-comment-block:not\(tr\):hover::before,[\s\S]*?background: var\(--soft-line\);/,
    );
  });

  it("centers rendered comment surfaces around Markdown headings", () => {
    expect(styles).toMatch(
      /h1\.vivi-rendered-comment-block \{[\s\S]*?--rendered-comment-block-top: -4px;[\s\S]*?--rendered-comment-block-bottom: 14px;/,
    );
    expect(styles).toMatch(
      /h2\.vivi-rendered-comment-block \{[\s\S]*?--rendered-comment-block-bottom: -6px;/,
    );
  });

  it("paints list markers inside the highlight without moving the list item", () => {
    expect(styles).toMatch(
      /li\.vivi-rendered-comment-block \{[\s\S]*?--rendered-comment-block-left: calc\(-1\.45em - 12px\);/,
    );
    expect(styles).toMatch(
      /li\.vivi-rendered-comment-block \{[\s\S]*?--rendered-comment-block-y-pad: 6px;[\s\S]*?--rendered-comment-block-top: calc\([\s\S]*?-1 \* var\(--rendered-comment-block-y-pad\)/,
    );
    expect(styles).toMatch(
      /li\.vivi-rendered-comment-block::before \{[\s\S]*?bottom: calc\([\s\S]*?var\(--rendered-comment-block-bottom\)[\s\S]*?var\(--rendered-comment-block-y-pad, 0px\)/,
    );
    expect(styles).toMatch(
      /li\.vivi-rendered-comment-block \{[\s\S]*?--rendered-comment-marker-top: calc\(0\.85em \+ 1px\);/,
    );
    expect(styles).toMatch(
      /pre\.vivi-rendered-comment-block \{[\s\S]*?--rendered-comment-marker-left: calc\(100% - 28px\);[\s\S]*?--rendered-comment-marker-top: 18px;/,
    );
    expect(styles).toMatch(
      /\.rendered-comment-marker \{[\s\S]*?top: var\(--rendered-comment-marker-top, calc\(50% \+ 1px\)\);/,
    );
    expect(styles).toMatch(
      /pre\.vivi-rendered-comment-block > \.rendered-comment-marker \{[\s\S]*?position: absolute;[\s\S]*?top: var\(--rendered-comment-marker-top, 18px\);[\s\S]*?right: auto;[\s\S]*?left: var\(--rendered-comment-marker-left, calc\(100% - 28px\)\);/,
    );
  });

  it("uses the block surface for comment highlights", () => {
    expect(styles).toMatch(
      /\.vivi-rendered-comment-block\.has-rendered-comment:not\(tr\)::before,[\s\S]*?\.vivi-rendered-comment-block\.drafting-rendered-comment:not\(tr\)::before,[\s\S]*?background: linear-gradient/,
    );
    expect(styles).toMatch(
      /\.vivi-rendered-comment-block\.has-rendered-comment:not\(tr\)::before,[\s\S]*?\.vivi-rendered-comment-block\.drafting-rendered-comment:not\(tr\)::before,[\s\S]*?box-shadow: inset 2px 0 0 var\(--comment-line\);/,
    );
  });

  it("paints a bridge through vertical gaps for multi-block comments", () => {
    expect(styles).toContain("rendered-comment-range-join-after");
    expect(styles).toContain("--rendered-comment-join-after");
    const bridgeRule = styles.match(
      /\.vivi-rendered-comment-block\.rendered-comment-range-join-after[\s\S]*?::after \{[\s\S]*?\n\}/,
    );
    expect(bridgeRule?.[0]).toBeDefined();
    expect(bridgeRule?.[0]).toContain(
      "height: var(--rendered-comment-join-after, 0);",
    );
    expect(bridgeRule?.[0]).not.toContain("box-shadow");
  });
});
