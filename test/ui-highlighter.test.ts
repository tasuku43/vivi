import { expect, it } from "vitest";
import { highlightCode } from "../src/ui/state/highlighter.js";

it("loads syntax languages on demand and falls back for unknown languages", async () => {
  const highlighted = await highlightCode(
    "const ok: boolean = true;",
    "typescript",
    "dark",
  );
  const fallback = await highlightCode(
    "plain text",
    "made-up-language",
    "light",
  );

  expect(highlighted).toContain("<pre");
  expect(highlighted).toContain("const");
  expect(fallback).toContain("plain text");
});
