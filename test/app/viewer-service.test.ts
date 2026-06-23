import { expect, it } from "vitest";
import { ViewerService } from "../../server/typescript/application/viewer-service.js";
import type {
  ChangeReviewPort,
  CommentStorePort,
  FileSystemPort,
} from "../../server/typescript/application/contracts.js";
import type { ViviComment } from "../../server/typescript/domain/comments.js";

it("delegates tree reads to the filesystem port", async () => {
  const fsPort: FileSystemPort = {
    async readTree() {
      return { root: ".", version: 1, nodes: [] };
    },
    async readFile() {
      throw new Error("not used");
    },
    async readHtmlPreview() {
      throw new Error("not used");
    },
    getConfig() {
      return { root: ".", allowHtmlScripts: false, maxFileSizeBytes: 123 };
    },
  };
  const service = new ViewerService({ fileSystem: fsPort });
  await expect(service.readTree()).resolves.toEqual({
    root: ".",
    version: 1,
    nodes: [],
  });
  expect(service.getConfig()).toEqual({
    root: ".",
    allowHtmlScripts: false,
    maxFileSizeBytes: 123,
  });
});

it("adds the configured review actor to viewer config", () => {
  const fsPort: FileSystemPort = {
    async readTree() {
      return { root: ".", version: 1, nodes: [] };
    },
    async readFile() {
      throw new Error("not used");
    },
    readHtmlPreview() {
      throw new Error("not used");
    },
    getConfig() {
      return { root: ".", allowHtmlScripts: false, maxFileSizeBytes: 123 };
    },
  };
  const service = new ViewerService({
    fileSystem: fsPort,
    reviewActor: {
      id: "gui-reviewer",
      kind: "human",
      displayName: "gui-reviewer",
    },
  });

  expect(service.getConfig().reviewActor).toEqual({
    id: "gui-reviewer",
    kind: "human",
    displayName: "gui-reviewer",
  });
});

it("delegates Git review reads when the optional port is present", async () => {
  const fsPort: FileSystemPort = {
    async readTree() {
      return { root: ".", version: 1, nodes: [] };
    },
    async readFile() {
      throw new Error("not used");
    },
    async readHtmlPreview() {
      throw new Error("not used");
    },
  };
  const changeReview: ChangeReviewPort = {
    async readChanges() {
      return {
        available: true,
        changes: [{ path: "README.md", status: "modified" }],
      };
    },
    async readDiff(relativePath, baseRef) {
      return {
        path: relativePath,
        status: "available",
        baseLabel: baseRef ?? "HEAD",
        compareLabel: "working tree",
        content: "diff",
      };
    },
    async readDiffBases() {
      return {
        available: true,
        options: [{ ref: "HEAD", label: "HEAD", subject: "initial" }],
      };
    },
  };

  const service = new ViewerService({ fileSystem: fsPort, changeReview });

  await expect(service.readChanges()).resolves.toEqual({
    available: true,
    changes: [{ path: "README.md", status: "modified" }],
  });
  await expect(service.readDiff("README.md", "HEAD")).resolves.toMatchObject({
    path: "README.md",
    status: "available",
  });
  await expect(service.readDiffBases()).resolves.toEqual({
    available: true,
    options: [{ ref: "HEAD", label: "HEAD", subject: "initial" }],
  });
});

it("searches text files through the filesystem port", async () => {
  const fsPort: FileSystemPort = {
    async readTree() {
      return {
        root: ".",
        version: 1,
        nodes: [
          {
            id: "README.md",
            path: "README.md",
            name: "README.md",
            kind: "file",
            parentPath: null,
            viewerKind: "markdown",
          },
          {
            id: "logo.png",
            path: "logo.png",
            name: "logo.png",
            kind: "file",
            parentPath: null,
            viewerKind: "image",
          },
        ],
      };
    },
    async readFile(relativePath) {
      if (relativePath !== "README.md") throw new Error("not searchable");
      return {
        path: "README.md",
        viewerKind: "markdown",
        encoding: "utf8",
        content: "# Demo\nFind this local workspace",
        etag: "sha256:test",
        size: 32,
        mtimeMs: 1,
      };
    },
    async readHtmlPreview() {
      throw new Error("not used");
    },
  };
  const service = new ViewerService({ fileSystem: fsPort });

  await expect(service.searchText("local")).resolves.toEqual({
    query: "local",
    results: [
      {
        path: "README.md",
        viewerKind: "markdown",
        lineNumber: 2,
        lineText: "Find this local workspace",
        matchStart: 10,
        matchLength: 5,
      },
    ],
  });
});

it("delegates lazy directory and backend search reads when available", async () => {
  let fullTreeReads = 0;
  const fsPort: FileSystemPort = {
    async readTree() {
      fullTreeReads += 1;
      return { root: ".", version: 1, nodes: [] };
    },
    async readDirectory(relativePath) {
      return {
        root: ".",
        version: 1,
        path: relativePath,
        depth: 1,
        nodes: [
          {
            id: "docs/guide.md",
            path: "docs/guide.md",
            name: "guide.md",
            kind: "file",
            parentPath: "docs",
            viewerKind: "markdown",
          },
        ],
      };
    },
    async readFile() {
      throw new Error("not used");
    },
    async readHtmlPreview() {
      throw new Error("not used");
    },
    async searchFiles(query) {
      return {
        query,
        results: [
          {
            path: "docs/guide.md",
            name: "guide.md",
            viewerKind: "markdown",
            score: 100,
          },
        ],
      };
    },
    async searchText(query) {
      return {
        query,
        results: [
          {
            path: "docs/guide.md",
            viewerKind: "markdown",
            lineNumber: 1,
            lineText: "# Guide",
            matchStart: 2,
            matchLength: 5,
          },
        ],
      };
    },
  };
  const service = new ViewerService({ fileSystem: fsPort });

  await expect(service.readDirectory("docs")).resolves.toMatchObject({
    path: "docs",
    nodes: [expect.objectContaining({ path: "docs/guide.md" })],
  });
  await expect(service.searchFiles("guide")).resolves.toMatchObject({
    query: "guide",
    results: [expect.objectContaining({ path: "docs/guide.md" })],
  });
  await expect(service.searchText("Guide")).resolves.toMatchObject({
    query: "Guide",
    results: [expect.objectContaining({ path: "docs/guide.md" })],
  });
  expect(fullTreeReads).toBe(0);
});

it("groups comments into application-level threads", async () => {
  const comments: ViviComment[] = [
    commentFixture({ id: "c1", threadId: "t1", status: "resolved" }),
    commentFixture({ id: "c2", threadId: "t1", body: "Follow-up" }),
  ];
  const commentStore: CommentStorePort = {
    async listComments() {
      return comments;
    },
    async createComment(comment) {
      return comment;
    },
    async updateComment(comment) {
      return comment;
    },
    async getComment() {
      return null;
    },
  };
  const fsPort: FileSystemPort = {
    async readTree() {
      return { root: ".", version: 1, nodes: [] };
    },
    async readFile() {
      throw new Error("not used");
    },
    async readHtmlPreview() {
      throw new Error("not used");
    },
  };
  const service = new ViewerService({ fileSystem: fsPort, commentStore });

  await expect(
    service.listCommentThreads({ path: "README.md" }),
  ).resolves.toEqual([
    {
      id: "t1",
      path: "README.md",
      status: "open",
      anchor: comments[0]!.anchor,
      updatedAt: comments[1]!.updatedAt,
      createdAt: comments[0]!.createdAt,
      comments,
    },
  ]);
});

function commentFixture(
  input: Partial<ViviComment> & { id: string },
): ViviComment {
  return {
    threadId: input.threadId,
    id: input.id,
    path: "README.md",
    viewerKind: "markdown",
    anchor: {
      surface: "source",
      canonical: { path: "README.md", lineStart: 1 },
    },
    body: input.body ?? "Comment",
    status: input.status ?? "open",
    createdAt: input.createdAt ?? "2026-06-20T00:00:00.000Z",
    updatedAt: input.updatedAt ?? `2026-06-20T00:00:0${input.id.at(-1)}.000Z`,
  };
}
