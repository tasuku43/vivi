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
      /\.code-line-comment-action \{[\s\S]*?position: absolute;[\s\S]*?left: 5px;/,
    );
  });
});

describe("rendered comment block ranges", () => {
  it("defines one layout-independent surface for document blocks", () => {
    expect(styles).toMatch(
      /\.vivi-rendered-comment-block \{[\s\S]*?--rendered-comment-block-left: -12px;[\s\S]*?--rendered-comment-block-right: -12px;/,
    );
    expect(styles).toMatch(
      /\.vivi-rendered-comment-block:not\(tr\)::before \{[\s\S]*?left: var\(--rendered-comment-block-left\);/,
    );
    expect(styles).toMatch(
      /\.vivi-rendered-comment-block:not\(tr\):hover::before,[\s\S]*?background: var\(--soft-line\);/,
    );
  });

  it("paints list markers inside the highlight without moving the list item", () => {
    expect(styles).toMatch(
      /li\.vivi-rendered-comment-block \{[\s\S]*?--rendered-comment-block-left: calc\(-1\.45em - 12px\);/,
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
