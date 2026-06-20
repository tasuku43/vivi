import { expect, it } from "vitest";
import type { FsNode } from "../../server/typescript/domain/fs-node.js";
import {
  collectSearchableFiles,
  searchFilePayload,
} from "../../server/typescript/domain/search.js";

it("collects only text-searchable files from the tree", () => {
  const nodes: FsNode[] = [
    {
      id: "src",
      path: "src",
      name: "src",
      kind: "directory",
      parentPath: null,
      children: [
        {
          id: "src/app.ts",
          path: "src/app.ts",
          name: "app.ts",
          kind: "file",
          parentPath: "src",
          viewerKind: "code",
        },
        {
          id: "src/logo.png",
          path: "src/logo.png",
          name: "logo.png",
          kind: "file",
          parentPath: "src",
          viewerKind: "image",
        },
      ],
    },
  ];

  expect(collectSearchableFiles(nodes).map((node) => node.path)).toEqual([
    "src/app.ts",
  ]);
});

it("returns bounded line matches for utf8 file payloads", () => {
  const results = searchFilePayload(
    {
      path: "README.md",
      viewerKind: "markdown",
      encoding: "utf8",
      content: "# Vivi\n\nLive local viewer\nSearch local files",
      etag: "sha256:test",
      size: 48,
      mtimeMs: 1,
    },
    "local",
    1,
  );

  expect(results).toEqual([
    {
      path: "README.md",
      viewerKind: "markdown",
      lineNumber: 3,
      lineText: "Live local viewer",
      matchStart: 5,
      matchLength: 5,
    },
  ]);
});

it("skips binary and truncated payloads for full-text search", () => {
  expect(
    searchFilePayload(
      {
        path: "logo.png",
        viewerKind: "image",
        encoding: "base64",
        content: "bG9jYWw=",
        etag: "sha256:test",
        size: 5,
        mtimeMs: 1,
      },
      "local",
    ),
  ).toEqual([]);
  expect(
    searchFilePayload(
      {
        path: "large.log",
        viewerKind: "text",
        encoding: "utf8",
        content: "local",
        etag: "mtime:test",
        size: 2_000_000,
        mtimeMs: 1,
        truncated: true,
      },
      "local",
    ),
  ).toEqual([]);
});
