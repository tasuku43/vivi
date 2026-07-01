import { describe, expect, it } from "vitest";
import { parseUnifiedDiff } from "../../../state/git-review.js";
import {
  buildRenderedChangeCards,
  buildRenderedDiffRows,
} from "./DiffViewer.js";

describe("buildRenderedChangeCards", () => {
  it("groups adjacent removed and added rendered blocks into changed cards", () => {
    const diff = [
      "diff --git a/docs/review.md b/docs/review.md",
      "--- a/docs/review.md",
      "+++ b/docs/review.md",
      "@@ -1,4 +1,5 @@",
      " # Review",
      "-Old paragraph.",
      "+New paragraph.",
      " Existing paragraph.",
      "+Added paragraph.",
      " Another existing paragraph.",
      "-Removed paragraph.",
    ].join("\n");

    const rows = buildRenderedDiffRows(parseUnifiedDiff(diff), "markdown");
    const cards = buildRenderedChangeCards(rows);

    expect(cards.map((card) => card.kind)).toEqual([
      "changed",
      "added",
      "removed",
    ]);
    expect(cards[0]).toMatchObject({
      before: { source: "Old paragraph." },
      after: { source: "New paragraph." },
    });
    expect(cards[0]?.sourceRows).toHaveLength(2);
  });

  it("splits mixed fenced code changes into before and after cards", () => {
    const diff = [
      "diff --git a/docs/review.md b/docs/review.md",
      "--- a/docs/review.md",
      "+++ b/docs/review.md",
      "@@ -1,5 +1,5 @@",
      " ```ts",
      " const unchanged = true;",
      "-console.log('old');",
      "+console.log('new');",
      " ```",
    ].join("\n");

    const rows = buildRenderedDiffRows(parseUnifiedDiff(diff), "markdown");
    const cards = buildRenderedChangeCards(rows);

    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      kind: "changed",
      before: {
        source: "```ts\nconst unchanged = true;\nconsole.log('old');\n```",
      },
      after: {
        source: "```ts\nconst unchanged = true;\nconsole.log('new');\n```",
      },
    });
    expect(cards[0]?.before?.source).not.toContain("console.log('new')");
    expect(cards[0]?.after?.source).not.toContain("console.log('old')");
  });
});
