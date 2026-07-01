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
  expect(highlighted).toContain("github-dark");
  expect(highlighted).not.toContain("github-dark-high-contrast");
  expect(highlighted).toContain("const");
  expect(dockerfile).toContain("FROM");
  expect(makefile).toContain("obj-y");
  expect(fallback).toContain("plain text");
});

it("uses readable markup themes for HTML and XML source", async () => {
  const html = await highlightCode(
    '<main class="review-card">Review</main>',
    "html",
    "dark",
  );
  const xml = await highlightCode(
    '<svg viewBox="0 0 16 16"><path d="M0 0h16v16"/></svg>',
    "xml",
    "light",
  );

  expect(html).toContain("github-dark");
  expect(html).not.toContain("dark-plus");
  expect(html).toContain("#E1E4E8");
  expect(html).toContain("review-card");
  expect(xml).toContain("light-plus");
  expect(xml).toContain("viewBox");
});
