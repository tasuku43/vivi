import { describe, expect, it } from "vitest";
import { normalizeRelativePath } from "../../src/domain/path-policy.js";

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
