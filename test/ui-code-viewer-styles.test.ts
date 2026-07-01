import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styles = readFileSync("ui/src/styles.css", "utf8");
function normalizeCssModuleGlobals(css: string): string {
  let normalized = "";
  for (let index = 0; index < css.length; index += 1) {
    if (!css.startsWith(":global(", index)) {
      normalized += css[index];
      continue;
    }

    index += ":global(".length;
    let depth = 1;
    while (index < css.length && depth > 0) {
      const char = css[index];
      if (char === "(") depth += 1;
      if (char === ")") depth -= 1;
      if (depth > 0) normalized += char;
      index += 1;
    }
    index -= 1;
  }
  return normalized;
}

const markdownViewerStyles = readFileSync(
  "ui/src/features/file-context/viewers/MarkdownViewer.module.css",
  "utf8",
);
const sourceCommentSurfaceStyles = readFileSync(
  "ui/src/features/comments/components/SourceCommentSurface.module.css",
  "utf8",
);
const lineCommentRailStyles = readFileSync(
  "ui/src/features/comments/components/LineCommentRail.module.css",
  "utf8",
);
const sourceLineStyles = normalizeCssModuleGlobals(
  `${styles}\n${sourceCommentSurfaceStyles}\n${lineCommentRailStyles}`,
);
const renderedCommentStyles = `${styles}\n${markdownViewerStyles}`;
const normalizedRenderedCommentStyles = normalizeCssModuleGlobals(
  renderedCommentStyles,
);

describe("code viewer line actions", () => {
  it("keeps the comment action on a fixed gutter rail", () => {
    expect(sourceLineStyles).toContain("--source-line-gutter-width: 64px;");
    expect(sourceLineStyles).toMatch(
      /grid-template-columns:\s*var\(--source-line-gutter-width\) max-content minmax\(\s*0,\s*1fr\s*\);/,
    );
    expect(sourceLineStyles).toContain("--source-line-gutter-width: 48px;");
    expect(sourceLineStyles).toMatch(
      /\.code-line-comment-action \{[\s\S]*?position: absolute;[\s\S]*?left: 1px;[\s\S]*?width: 28px;[\s\S]*?height: 24px;/,
    );
  });

  it("bridges source comment highlights through the gutter", () => {
    expect(sourceLineStyles).toContain(
      "--source-comment-highlight-gutter-mix: 44%;",
    );
    expect(sourceLineStyles).toContain(
      "--source-comment-active-gutter-mix: 56%;",
    );
    expect(sourceLineStyles).toMatch(
      /\.code-line\.has-comment,[\s\S]*?\.code-line\.drafting-comment \{[\s\S]*?var\(--source-comment-highlight-gutter-mix\),[\s\S]*?0 var\(--source-line-gutter-width\),/,
    );
    expect(sourceLineStyles).toMatch(
      /\.code-line\.active-comment \{[\s\S]*?var\(--source-comment-active-gutter-mix\),[\s\S]*?0 var\(--source-line-gutter-width\),/,
    );
  });
});

describe("rendered comment block ranges", () => {
  it("defines one layout-independent surface for document blocks", () => {
    expect(normalizedRenderedCommentStyles).toMatch(
      /\.vivi-rendered-comment-block \{[\s\S]*?--rendered-comment-block-left: -8px;[\s\S]*?--rendered-comment-block-right: -8px;/,
    );
    expect(normalizedRenderedCommentStyles).toMatch(
      /\.vivi-rendered-comment-block \{[\s\S]*?cursor: pointer;/,
    );
    expect(normalizedRenderedCommentStyles).toMatch(
      /\.vivi-rendered-comment-block:not\(tr\)::before \{[\s\S]*?left: var\(--rendered-comment-block-left\);/,
    );
    expect(normalizedRenderedCommentStyles).toMatch(
      /\.vivi-rendered-comment-block:not\(tr\)::before \{[\s\S]*?z-index: 0;/,
    );
    expect(normalizedRenderedCommentStyles).not.toContain("z-index: -1;");
    expect(normalizedRenderedCommentStyles).toMatch(
      /\.vivi-rendered-comment-block:not\(tr\) > \* \{[\s\S]*?position: relative;[\s\S]*?z-index: 1;/,
    );
    expect(normalizedRenderedCommentStyles).toMatch(
      /\.vivi-rendered-comment-block:not\(tr\)::before \{[\s\S]*?top: var\(--rendered-comment-block-top\);[\s\S]*?bottom: calc\([\s\S]*?var\(--rendered-comment-block-bottom\)[\s\S]*?var\(--rendered-comment-block-bottom-pad\)/,
    );
    expect(normalizedRenderedCommentStyles).toMatch(
      /\.vivi-rendered-comment-block:not\(tr\):hover::before,[\s\S]*?background: var\(--vivi-color-border-soft\);/,
    );
  });

  it("centers rendered comment surfaces around Markdown headings", () => {
    expect(normalizedRenderedCommentStyles).toMatch(
      /h1\.vivi-rendered-comment-block \{[\s\S]*?--rendered-comment-block-top: -4px;[\s\S]*?--rendered-comment-block-bottom: 14px;/,
    );
    expect(normalizedRenderedCommentStyles).toMatch(
      /h2\.vivi-rendered-comment-block \{[\s\S]*?--rendered-comment-block-bottom: -6px;/,
    );
  });

  it("paints list markers inside the highlight without moving the list item", () => {
    expect(normalizedRenderedCommentStyles).toMatch(
      /li\.vivi-rendered-comment-block \{[\s\S]*?--rendered-comment-block-left: calc\(-1\.35em - 8px\);/,
    );
    expect(normalizedRenderedCommentStyles).toMatch(
      /li\.vivi-rendered-comment-block \{[\s\S]*?--rendered-comment-block-y-pad: 3px;[\s\S]*?--rendered-comment-block-bottom-pad: 2px;[\s\S]*?--rendered-comment-block-top: calc\([\s\S]*?-1 \* var\(--rendered-comment-block-y-pad\)/,
    );
    expect(normalizedRenderedCommentStyles).toMatch(
      /li\.vivi-rendered-comment-block:has\(> \.rendered-comment-thread-host\)\s*\{[\s\S]*?--rendered-comment-block-bottom-pad: 11px;/,
    );
    expect(normalizedRenderedCommentStyles).toMatch(
      /\.vivi-rendered-comment-block:not\(tr\)::before \{[\s\S]*?bottom: calc\([\s\S]*?var\(--rendered-comment-block-bottom\)[\s\S]*?var\(--rendered-comment-block-bottom-pad\)/,
    );
    expect(normalizedRenderedCommentStyles).toMatch(
      /li\.vivi-rendered-comment-block \{[\s\S]*?--rendered-comment-marker-top: calc\(0\.85em \+ 1px\);/,
    );
    expect(normalizedRenderedCommentStyles).toMatch(
      /pre\.vivi-rendered-comment-block \{[\s\S]*?--rendered-comment-marker-left: calc\(100% - 28px\);[\s\S]*?--rendered-comment-marker-top: 18px;/,
    );
    expect(normalizedRenderedCommentStyles).toMatch(
      /\.rendered-comment-marker \{[\s\S]*?top: var\(--rendered-comment-marker-top, calc\(50% \+ 1px\)\);/,
    );
    expect(normalizedRenderedCommentStyles).toMatch(
      /\.rendered-comment-marker \{[\s\S]*?right: -12px;/,
    );
    expect(normalizedRenderedCommentStyles).toMatch(
      /pre\.vivi-rendered-comment-block > \.rendered-comment-marker \{[\s\S]*?position: absolute;[\s\S]*?top: var\(--rendered-comment-marker-top, 18px\);[\s\S]*?right: auto;[\s\S]*?left: var\(--rendered-comment-marker-left, calc\(100% - 28px\)\);/,
    );
  });

  it("uses the block surface for comment highlights", () => {
    expect(normalizedRenderedCommentStyles).toMatch(
      /\.vivi-rendered-comment-block\.has-rendered-comment:not\(tr\)::before\s*,[\s\S]*?\.vivi-rendered-comment-block\.drafting-rendered-comment:not\(tr\)::before\s*,[\s\S]*?background: linear-gradient/,
    );
    expect(normalizedRenderedCommentStyles).toMatch(
      /\.vivi-rendered-comment-block\.has-rendered-comment:not\(tr\)::before\s*,[\s\S]*?\.vivi-rendered-comment-block\.drafting-rendered-comment:not\(tr\)::before\s*,[\s\S]*?box-shadow: inset 2px 0 0 var\(--vivi-color-comment-border\);/,
    );
  });

  it("paints a bridge through vertical gaps for multi-block comments", () => {
    expect(normalizedRenderedCommentStyles).toContain(
      "rendered-comment-range-join-after",
    );
    expect(normalizedRenderedCommentStyles).toContain(
      "--rendered-comment-join-after",
    );
    const bridgeRule = normalizedRenderedCommentStyles.match(
      /\.vivi-rendered-comment-block\.rendered-comment-range-join-after[\s\S]*?::after\s*\{[\s\S]*?\n\s*\}/,
    );
    expect(bridgeRule?.[0]).toBeDefined();
    expect(bridgeRule?.[0]).toContain(
      "height: var(--rendered-comment-join-after, 0);",
    );
    expect(bridgeRule?.[0]).not.toContain("box-shadow");
  });
});
