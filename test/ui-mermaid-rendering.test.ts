import { expect, it } from "vitest";
import {
  mermaidRenderInvocationId,
  shouldStartMermaidBlockRender,
} from "../ui/src/features/file-context/rendering/mermaid-rendering.js";

it("uses a unique DOM marker for every Mermaid render invocation", () => {
  const first = mermaidRenderInvocationId("markdown-mermaid-same-source");
  const second = mermaidRenderInvocationId("markdown-mermaid-same-source");

  expect(first).not.toBe(second);
  expect(first).toMatch(/^vivi-markdown-mermaid-same-source-\d+$/);
  expect(second).toMatch(/^vivi-markdown-mermaid-same-source-\d+$/);
});

it("restarts an in-flight Mermaid block when the resolved theme changes", () => {
  expect(shouldStartMermaidBlockRender("loading", "dark", "light")).toBe(true);
  expect(shouldStartMermaidBlockRender("loading", "dark", "dark")).toBe(false);
  expect(shouldStartMermaidBlockRender("rendered", "dark", "dark")).toBe(false);
  expect(shouldStartMermaidBlockRender("fallback", "dark", "dark")).toBe(true);
});
