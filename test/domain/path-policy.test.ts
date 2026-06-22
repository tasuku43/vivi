import { describe, expect, it } from "vitest";
import {
  isIgnoredPath,
  normalizeRelativePath,
} from "../../server/typescript/domain/path-policy.js";

it("normalizes safe relative paths", () => {
  expect(normalizeRelativePath("./docs/../README.md")).toEqual({
    ok: true,
    relativePath: "README.md",
  });
});

it("rejects absolute paths", () => {
  expect(normalizeRelativePath("/etc/passwd")).toEqual({
    ok: false,
    reason: "absolute paths are not allowed",
  });
});

it("rejects root escape attempts", () => {
  expect(normalizeRelativePath("../../secret")).toEqual({
    ok: false,
    reason: "path escapes root",
  });
});

it("rejects null byte paths", () => {
  expect(normalizeRelativePath("docs/readme.md\0.png")).toEqual({
    ok: false,
    reason: "path contains invalid characters",
  });
});

it("ignores build and tool caches by default", () => {
  expect(isIgnoredPath(".tmp-go-build-cache/test-cache")).toBe(true);
  expect(isIgnoredPath("ui/storybook-static/index.html")).toBe(true);
  expect(isIgnoredPath("src/.vite/deps/react.js")).toBe(true);
});
