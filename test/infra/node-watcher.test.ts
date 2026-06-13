import { expect, it } from "vitest";
import { eventFromKnownPath } from "../../src/infra/node-watcher.js";

it("classifies watcher state transitions into semantic events", () => {
  expect(eventFromKnownPath("new.md", undefined, "file", 2)).toEqual({
    type: "add",
    path: "new.md",
    kind: "file",
    version: 2,
  });
  expect(eventFromKnownPath("README.md", "file", "file", 3)).toEqual({
    type: "change",
    path: "README.md",
    version: 3,
  });
  expect(eventFromKnownPath("old.md", "file", null, 4)).toEqual({
    type: "unlink",
    path: "old.md",
    kind: "file",
    version: 4,
  });
  expect(eventFromKnownPath("missing.md", undefined, null, 5)).toBeNull();
});
