import { expect, it } from "vitest";
import type { FsEvent } from "../ui/src/domain/fs-node.js";
import {
  buildCodeMetadata,
  currentScopeForLine,
  detectCodeSymbols,
  formatLineReference,
  formatSelectedCodeWithLineNumbers,
  normalizeLineRange,
  splitCodeLines,
} from "../ui/src/state/code-viewer.js";
import {
  eventLabel,
  recordReviewEvent,
  summarizeReviewEvents,
} from "../ui/src/state/review-events.js";
import {
  codeCommentThreads,
  sourceLineCommentDraft,
} from "../ui/src/state/comments.js";

it("splits code lines without inventing a trailing empty line", () => {
  expect(splitCodeLines("one\ntwo\n")).toEqual(["one", "two"]);
  expect(splitCodeLines("one\ntwo")).toEqual(["one", "two"]);
  expect(splitCodeLines("")).toEqual([""]);
});

it("normalizes and formats code line references", () => {
  expect(normalizeLineRange(8, 3, 10)).toEqual({ start: 3, end: 8 });
  expect(normalizeLineRange(-1, 99, 4)).toEqual({ start: 1, end: 4 });
  expect(formatLineReference("src/app.ts", { start: 4, end: 4 })).toBe(
    "src/app.ts:4",
  );
  expect(formatLineReference("src/app.ts", { start: 4, end: 7 })).toBe(
    "src/app.ts:4-7",
  );
});

it("formats selected code with path and line numbers", () => {
  expect(
    formatSelectedCodeWithLineNumbers("src/app.ts", "a\nb\nc\n", {
      start: 2,
      end: 3,
    }),
  ).toBe("src/app.ts:2-3\n2 | b\n3 | c");
});

it("detects lightweight JavaScript and TypeScript symbols", () => {
  const symbols = detectCodeSymbols(
    "src/app.ts",
    `import { readFile, writeFile } from "node:fs";
export class ViewerService {}
export function startServer() {}
const localThing = () => true;
if (ready) {}
while (ready) {}
`,
  );

  expect(symbols).toEqual([
    { kind: "import", name: "readFile, writeFile", line: 1 },
    { kind: "export", name: "ViewerService", line: 2 },
    { kind: "export", name: "startServer", line: 3 },
    { kind: "function", name: "localThing", line: 4 },
  ]);
  expect(currentScopeForLine(symbols, 4)).toEqual({
    kind: "function",
    name: "localThing",
    line: 4,
  });
});

it("builds code metadata for the inspector", () => {
  expect(
    buildCodeMetadata(
      {
        path: "data/sample.json",
        viewerKind: "json",
        encoding: "utf8",
        content: '{\n  "ok": true\n}\n',
        etag: "sha256:test",
        size: 16,
        mtimeMs: 1,
      },
      { start: 2, end: 2 },
    ),
  ).toMatchObject({
    path: "data/sample.json",
    language: "json",
    lineCount: 3,
    selectedReference: "data/sample.json:2",
  });
});

it("creates source comment drafts anchored to exactly one code line", () => {
  const draft = sourceLineCommentDraft(
    {
      path: "src/app.ts",
      viewerKind: "code",
      encoding: "utf8",
      content: "const a = 1;\nconst b = 2;\n",
      etag: "sha256:test",
      size: 24,
      mtimeMs: 1,
    },
    2,
  );

  expect(draft).toMatchObject({
    path: "src/app.ts",
    viewerKind: "text",
    anchor: {
      surface: "source",
      canonical: {
        path: "src/app.ts",
        lineStart: 2,
        lineEnd: 2,
        quote: "const b = 2;",
        fileHash: "sha256:test",
      },
    },
  });
});

it("groups multiple comments on one code line into an ordered thread", () => {
  const anchor = {
    surface: "source" as const,
    canonical: { path: "src/app.ts", lineStart: 2, lineEnd: 2 },
  };
  const threads = codeCommentThreads([
    {
      id: "reply",
      path: "src/app.ts",
      viewerKind: "text",
      anchor,
      body: "Second",
      status: "open",
      createdAt: "2026-06-19T02:00:00.000Z",
      updatedAt: "2026-06-19T02:00:00.000Z",
    },
    {
      id: "root",
      path: "src/app.ts",
      viewerKind: "text",
      anchor,
      body: "First",
      status: "open",
      createdAt: "2026-06-19T01:00:00.000Z",
      updatedAt: "2026-06-19T01:00:00.000Z",
    },
  ]);

  expect(threads).toHaveLength(1);
  expect(threads[0]).toMatchObject({
    path: "src/app.ts",
    lineStart: 2,
    lineEnd: 2,
  });
  expect(threads[0]?.comments.map((comment) => comment.id)).toEqual([
    "root",
    "reply",
  ]);
});

it("records and summarizes recent review events by file path", () => {
  const events: FsEvent[] = [
    { type: "change", path: "README.md", version: 2 },
    { type: "add", path: "src/new.ts", kind: "file", version: 3 },
    { type: "unlink", path: "old.txt", kind: "file", version: 4 },
  ];
  const reviewEvents = events.reduce(
    (items, event, index) => recordReviewEvent(items, event, 100 + index),
    [] as ReturnType<typeof recordReviewEvent>,
  );
  const summary = summarizeReviewEvents(reviewEvents);

  expect([...summary.changedPaths].sort()).toEqual(["README.md", "src/new.ts"]);
  expect([...summary.removedPaths]).toEqual(["old.txt"]);
  expect(summary.latestByPath.get("src/new.ts")?.event.type).toBe("add");
  expect(summary.renamePairs).toEqual([]);
  expect(eventLabel(events[0])).toBe("Changed");
  expect(eventLabel(events[1])).toBe("Added");
  expect(eventLabel(events[2])).toBe("Removed");
});

it("summarizes close add and unlink file events as a possible rename", () => {
  const reviewEvents = [
    {
      id: "1",
      event: {
        type: "unlink" as const,
        path: "docs/old.md",
        kind: "file" as const,
        version: 4,
      },
      receivedAt: 100,
    },
    {
      id: "2",
      event: {
        type: "add" as const,
        path: "docs/new.md",
        kind: "file" as const,
        version: 5,
      },
      receivedAt: 900,
    },
  ];

  const summary = summarizeReviewEvents(reviewEvents);

  expect(summary.renamePairs).toEqual([
    { fromPath: "docs/old.md", toPath: "docs/new.md", receivedAt: 900 },
  ]);
  expect([...summary.removedPaths]).toEqual([]);
  expect([...summary.changedPaths]).toContain("docs/new.md");
});
