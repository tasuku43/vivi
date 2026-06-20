import { expect, it, vi } from "vitest";
import { GraphqlViviClient } from "../ui/src/infrastructure/vivi-api/graphqlViviClient.js";

const file = {
  path: "README.md",
  viewerKind: "markdown" as const,
  encoding: "utf8" as const,
  content: "# Vivi",
  etag: "etag-1",
  size: 6,
  mtimeMs: 1,
};
const comment = {
  id: "c1",
  threadId: "t1",
  path: "README.md",
  viewerKind: "markdown" as const,
  anchor: {
    canonical: { path: "README.md", lineStart: 1 },
    surface: "source" as const,
  },
  body: "Keep this contract stable",
  status: "open" as const,
  createdAt: "2026-06-20T00:00:00.000Z",
  updatedAt: "2026-06-20T00:00:00.000Z",
};
const commentThread = {
  id: "t1",
  path: "README.md",
  status: "open" as const,
  anchor: comment.anchor,
  updatedAt: comment.updatedAt,
  comments: [comment],
};
const diff = {
  path: "README.md",
  status: "available" as const,
  baseLabel: "HEAD",
  compareLabel: "working tree",
  content: "+# Vivi",
};
const tree = {
  root: "/workspace",
  version: 1,
  nodes: [
    {
      id: "README.md",
      path: "README.md",
      name: "README.md",
      kind: "file" as const,
      parentPath: null,
      viewerKind: "markdown" as const,
    },
  ],
};
const config = {
  root: "/workspace",
  allowHtmlScripts: false,
  maxFileSizeBytes: 1024 * 1024,
};
const reviewQueue = {
  available: true,
  changes: [
    { path: "README.md", status: "modified" as const, kind: "file" as const },
  ],
};

it("assembles FileContext through GraphQL while keeping DTOs behind ViviClient", async () => {
  const request = vi.fn<typeof fetch>(async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    expect(body.operationName).toBe("ViviFileContext");
    expect(body.variables).toMatchObject({
      path: "README.md",
      includeComments: true,
      includeDiff: true,
      diffBase: "HEAD",
    });
    return Response.json({
      data: {
        fileContext: {
          file,
          comments: [comment],
          commentThreads: [commentThread],
          diff,
        },
      },
    });
  });
  const client = new GraphqlViviClient({ fetch: request });

  await expect(
    client.getFileContext({
      path: "README.md",
      includeComments: true,
      includeDiff: true,
      diffBase: "HEAD",
    }),
  ).resolves.toEqual({
    file,
    comments: [comment],
    commentThreads: [commentThread],
    diff,
  });

  expect(request.mock.calls.map(([url]) => String(url))).toEqual(["/graphql"]);
});

it("uses GraphQL mutations for comment creation and status updates", async () => {
  const request = vi.fn<typeof fetch>(async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    if (body.operationName === "CreateComment") {
      return Response.json({ data: { createComment: comment } });
    }
    if (body.operationName === "UpdateCommentThreadStatus") {
      return Response.json({
        data: {
          updateCommentThread: {
            ...commentThread,
            status: body.variables.status,
            comments: [
              { ...comment, status: body.variables.status },
            ],
          },
        },
      });
    }
    return Response.json({
      data: { updateComment: { ...comment, status: body.variables.status } },
    });
  });
  const client = new GraphqlViviClient({ fetch: request });

  await client.createComment({
    path: comment.path,
    viewerKind: comment.viewerKind,
    anchor: comment.anchor,
    body: comment.body,
  });
  await client.updateCommentStatus({ id: comment.id, status: "resolved" });
  await client.updateCommentThreadStatus({ id: "t1", status: "archived" });

  const firstBody = JSON.parse(String(request.mock.calls[0]?.[1]?.body));
  expect(firstBody.operationName).toBe("CreateComment");
  expect(firstBody.variables.input).toMatchObject({
    path: "README.md",
    body: comment.body,
  });

  const secondBody = JSON.parse(String(request.mock.calls[1]?.[1]?.body));
  expect(secondBody.operationName).toBe("UpdateCommentStatus");
  expect(secondBody.variables).toEqual({ id: "c1", status: "resolved" });

  const thirdBody = JSON.parse(String(request.mock.calls[2]?.[1]?.body));
  expect(thirdBody.operationName).toBe("UpdateCommentThreadStatus");
  expect(thirdBody.variables).toEqual({ id: "t1", status: "archived" });
});

it("uses GraphQL queries for workspace, review, diff, and search reads", async () => {
  const request = vi.fn<typeof fetch>(async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    switch (body.operationName) {
      case "ViviWorkspace":
        return Response.json({ data: { workspace: { tree, config } } });
      case "ViviReviewQueue":
        return Response.json({ data: { reviewQueue } });
      case "ViviDiff":
        return Response.json({ data: { diff } });
      case "ViviFileSearch":
        return Response.json({
          data: {
            fileSearch: {
              results: [
                {
                  path: "README.md",
                  name: "README.md",
                  viewerKind: "markdown",
                  score: 100,
                },
              ],
            },
          },
        });
      case "ViviTextSearch":
        return Response.json({
          data: {
            textSearch: {
              results: [
                {
                  path: "README.md",
                  viewerKind: "markdown",
                  lineNumber: 1,
                  lineText: "# Vivi",
                  matchStart: 2,
                  matchLength: 4,
                },
              ],
            },
          },
        });
      case "ViviCommentThreads":
        return Response.json({ data: { commentThreads: [commentThread] } });
      case "ViviCommentExport":
        return Response.json({
          data: {
            commentExport: {
              format: "jsonl",
              contentType: "application/x-ndjson; charset=utf-8",
              content: `${JSON.stringify(comment)}\n`,
            },
          },
        });
      default:
        return Response.json({ errors: [{ message: "unexpected operation" }] });
    }
  });
  const client = new GraphqlViviClient({ fetch: request });

  await expect(client.getWorkspace()).resolves.toEqual({ tree, config });
  await expect(client.getReviewQueue()).resolves.toEqual(reviewQueue);
  await expect(
    client.getDiff({ path: "README.md", base: "HEAD" }),
  ).resolves.toEqual(diff);
  await expect(client.searchFiles({ query: "read", limit: 5 })).resolves.toEqual([
    {
      path: "README.md",
      name: "README.md",
      viewerKind: "markdown",
      score: 100,
    },
  ]);
  await expect(client.searchText({ query: "Vivi", limit: 5 })).resolves.toEqual([
    {
      path: "README.md",
      viewerKind: "markdown",
      lineNumber: 1,
      lineText: "# Vivi",
      matchStart: 2,
      matchLength: 4,
    },
  ]);
  await expect(client.getCommentThreads({ path: "README.md" })).resolves.toEqual(
    [commentThread],
  );
  await expect(
    client.exportComments({ path: "README.md", status: "open" }),
  ).resolves.toBe(`${JSON.stringify(comment)}\n`);

  expect(
    request.mock.calls.map(
      ([, init]) => JSON.parse(String(init?.body)).operationName,
    ),
  ).toEqual([
    "ViviWorkspace",
    "ViviReviewQueue",
    "ViviDiff",
    "ViviFileSearch",
    "ViviTextSearch",
    "ViviCommentThreads",
    "ViviCommentExport",
  ]);
});

it("subscribes to workspace events through GraphQL SSE", () => {
  const sources: FakeEventSource[] = [];
  const client = new GraphqlViviClient({
    baseUrl: "http://vivi.local",
    createEventSource(url) {
      const source = new FakeEventSource(url);
      sources.push(source);
      return source as unknown as EventSource;
    },
  });
  const onEvent = vi.fn();

  const unsubscribe = client.subscribeWorkspaceEvents(onEvent);
  expect(sources).toHaveLength(1);
  const url = new URL(sources[0]!.url);
  expect(url.pathname).toBe("/graphql");
  expect(url.searchParams.get("operationName")).toBe("WorkspaceEvents");
  expect(url.searchParams.get("query")).toContain("workspaceEvents");

  sources[0]!.emit("next", {
    data: JSON.stringify({
      data: {
        workspaceEvents: {
          type: "change",
          path: "README.md",
          version: 2,
        },
      },
    }),
  });
  expect(onEvent).toHaveBeenCalledWith({
    type: "change",
    path: "README.md",
    version: 2,
  });

  unsubscribe();
  expect(sources[0]!.closed).toBe(true);
});

class FakeEventSource {
  readonly listeners = new Map<string, Array<(event: MessageEvent) => void>>();
  closed = false;

  constructor(readonly url: string) {}

  addEventListener(type: string, listener: EventListener): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener as (event: MessageEvent) => void);
    this.listeners.set(type, listeners);
  }

  emit(type: string, event: Pick<MessageEvent<string>, "data">): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event as MessageEvent);
    }
  }

  close(): void {
    this.closed = true;
  }
}
