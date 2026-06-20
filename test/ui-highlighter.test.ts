import { expect, it } from "vitest";
import { highlightCode } from "../ui/src/state/highlighter.js";

it("loads syntax languages on demand and falls back for unknown languages", async () => {
  const highlighted = await highlightCode(
    "const ok: boolean = true;",
    "typescript",
    "dark",
  );
  const dockerfile = await highlightCode(
    "FROM alpine:3.20\nRUN echo ok",
    "dockerfile",
    "dark",
  );
  const makefile = await highlightCode("obj-y += kernel.o", "makefile", "dark");
  const fallback = await highlightCode(
    "plain text",
    "made-up-language",
    "light",
  );

  expect(highlighted).toContain("<pre");
  expect(highlighted).toContain("const");
  expect(dockerfile).toContain("FROM");
  expect(makefile).toContain("obj-y");
  expect(fallback).toContain("plain text");
});
