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
      documentHeading: "Vivi",
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
const reviewLedger = {
  decisions: [
    {
      path: "README.md",
      fingerprint: "fingerprint-1",
      reason: "accepted_change" as const,
      createdAt: "2026-07-01T00:00:00.000Z",
    },
  ],
  receipts: [],
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

it("uses the review ledger REST endpoint beside GraphQL data APIs", async () => {
  const request = vi.fn<typeof fetch>(async (input, init) => {
    expect(String(input)).toBe("/api/v1/review-ledger");
    if (init?.method === "PUT") {
      expect(JSON.parse(String(init.body))).toEqual(reviewLedger);
    }
    return Response.json(reviewLedger);
  });
  const client = new GraphqlViviClient({ fetch: request });

  await expect(client.getReviewLedger()).resolves.toEqual(reviewLedger);
  await expect(client.saveReviewLedger(reviewLedger)).resolves.toEqual(
    reviewLedger,
  );

  expect(request.mock.calls.map(([, init]) => init?.method ?? "GET")).toEqual([
    "GET",
    "PUT",
  ]);
});

it("uses GraphQL mutations for comment creation", async () => {
  const request = vi.fn<typeof fetch>(async () =>
    Response.json({ data: { createComment: comment } }),
  );
  const client = new GraphqlViviClient({ fetch: request });
  await client.createComment({
    path: comment.path,
    viewerKind: comment.viewerKind,
    anchor: comment.anchor,
    body: comment.body,
  });
  const body = JSON.parse(String(request.mock.calls[0]?.[1]?.body));
  expect(body.operationName).toBe("CreateComment");
  expect(body.variables.input).toMatchObject({
    path: "README.md",
    body: comment.body,
  });
});

it("uses GraphQL operations for draft review batches", async () => {
  const draft = {
    id: "draft-1",
    path: "README.md",
    viewerKind: "markdown" as const,
    anchor: comment.anchor,
    body: "Hold until batch publish",
    source: "human" as const,
    createdBy: { id: "human", kind: "human" as const },
    createdAt: "2026-06-20T00:00:00.000Z",
    updatedAt: "2026-06-20T00:00:00.000Z",
  };
  const request = vi.fn<typeof fetch>(async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    switch (body.operationName) {
      case "ViviDraftReviewComments":
        return Response.json({ data: { draftReviewComments: [draft] } });
      case "CreateDraftReviewComment":
        return Response.json({ data: { createDraftReviewComment: draft } });
      case "UpdateDraftReviewComment":
        return Response.json({
          data: {
            updateDraftReviewComment: {
              ...draft,
              body: body.variables.input.body,
            },
          },
        });
      case "DeleteDraftReviewComment":
        return Response.json({ data: { deleteDraftReviewComment: draft } });
      case "PublishDraftReviewComments":
        return Response.json({
          data: {
            publishDraftReviewComments: {
              reviewBatchId: "review-batch-1",
              publishedAt: "2026-06-20T00:01:00.000Z",
              threads: [
                {
                  ...commentThread,
                  reviewBatchId: "review-batch-1",
                  comments: [{ ...comment, reviewBatchId: "review-batch-1" }],
                },
              ],
            },
          },
        });
      default:
        return Response.json({ errors: [{ message: "unexpected operation" }] });
    }
  });
  const client = new GraphqlViviClient({ fetch: request });

  await expect(client.getDraftReviewComments()).resolves.toEqual([draft]);
  await client.createDraftReviewComment({
    path: draft.path,
    viewerKind: draft.viewerKind,
    anchor: draft.anchor,
    body: draft.body,
  });
  await client.updateDraftReviewComment({
    id: draft.id,
    body: "Edited draft",
  });
  await client.deleteDraftReviewComment(draft.id);
  await expect(client.publishDraftReviewComments()).resolves.toMatchObject({
    reviewBatchId: "review-batch-1",
    threads: [
      {
        reviewBatchId: "review-batch-1",
        comments: [{ reviewBatchId: "review-batch-1" }],
      },
    ],
  });

  expect(
    request.mock.calls.map(
      ([, init]) => JSON.parse(String(init?.body)).operationName,
    ),
  ).toEqual([
    "ViviDraftReviewComments",
    "CreateDraftReviewComment",
    "UpdateDraftReviewComment",
    "DeleteDraftReviewComment",
    "PublishDraftReviewComments",
  ]);
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
  await expect(
    client.searchFiles({ query: "read", limit: 5 }),
  ).resolves.toEqual([
    {
      path: "README.md",
      name: "README.md",
      viewerKind: "markdown",
      score: 100,
    },
  ]);
  await expect(client.searchText({ query: "Vivi", limit: 5 })).resolves.toEqual(
    [
      {
        path: "README.md",
        viewerKind: "markdown",
        lineNumber: 1,
        lineText: "# Vivi",
        matchStart: 2,
        matchLength: 4,
      },
    ],
  );
  await expect(
    client.getCommentThreads({ path: "README.md" }),
  ).resolves.toEqual([commentThread]);
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

it("reads and subscribes to actor-aware comment activity", async () => {
  const event = {
    id: "activity-1",
    threadId: "t1",
    type: "thread_read" as const,
    actor: {
      id: "claude-code:run-1",
      kind: "claude_code" as const,
      displayName: "Claude Code",
    },
    commentId: null,
    previousStatus: null,
    status: null,
    clientEventId: "fetch-open-1",
    createdAt: "2026-06-20T00:00:01.000Z",
  };
  const request = vi.fn<typeof fetch>(async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    expect(body.operationName).toBe("ViviCommentThreadActivities");
    return Response.json({ data: { commentThreadActivities: [event] } });
  });
  const sources: FakeEventSource[] = [];
  const client = new GraphqlViviClient({
    fetch: request,
    createEventSource(url) {
      const source = new FakeEventSource(url);
      sources.push(source);
      return source as unknown as EventSource;
    },
  });
  await expect(
    client.getCommentThreadActivities({ threadId: "t1" }),
  ).resolves.toMatchObject([
    {
      type: "thread_read",
      actor: { id: "claude-code:run-1", kind: "claude-code" },
    },
  ]);
  const onEvent = vi.fn();
  const unsubscribe = client.subscribeCommentThreadActivities("t1", onEvent);
  const url = new URL(sources[0]!.url, "http://vivi.local");
  expect(url.searchParams.get("operationName")).toBe("CommentThreadActivity");
  expect(JSON.parse(url.searchParams.get("variables")!)).toEqual({
    threadId: "t1",
  });
  sources[0]!.emit("next", {
    data: JSON.stringify({ data: { commentThreadActivity: event } }),
  });
  expect(onEvent).toHaveBeenCalledWith(
    expect.objectContaining({
      id: "activity-1",
      actor: expect.objectContaining({ kind: "claude-code" }),
    }),
  );
  unsubscribe();
  expect(sources[0]!.closed).toBe(true);
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
  const onStatus = vi.fn();

  const unsubscribe = client.subscribeWorkspaceEvents(onEvent, { onStatus });
  expect(sources).toHaveLength(1);
  const url = new URL(sources[0]!.url);
  expect(url.pathname).toBe("/graphql");
  expect(url.searchParams.get("operationName")).toBe("WorkspaceEvents");
  expect(url.searchParams.get("query")).toContain("workspaceEvents");
  expect(onStatus).toHaveBeenCalledWith("connecting");

  sources[0]!.emit("open", { data: "" });
  expect(onStatus).toHaveBeenCalledWith("connected");
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
  sources[0]!.emit("error", { data: "" });
  expect(onStatus).toHaveBeenCalledWith("disconnected");

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

it("deletes a published comment by id and returns its domain identity", async () => {
  const deleted = { id: "c1", threadId: "t1", path: "README.md" };
  const request = vi.fn<typeof fetch>(async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    expect(body.operationName).toBe("DeletePublishedComment");
    expect(body.query).toContain("mutation DeletePublishedComment($id: ID!)");
    expect(body.query).toContain("deletePublishedComment(id: $id)");
    expect(body.variables).toEqual({ id: "c1" });
    return Response.json({
      data: {
        deletePublishedComment: { ...deleted, __typename: "DeletedComment" },
      },
    });
  });
  const client = new GraphqlViviClient({ fetch: request });
  await expect(client.deletePublishedComment("c1")).resolves.toEqual(deleted);
  expect(request).toHaveBeenCalledTimes(1);
});

it("surfaces published deletion failures without retrying the mutation", async () => {
  const request = vi.fn<typeof fetch>(async () =>
    Response.json({
      errors: [{ message: "comment not found" }],
    }),
  );
  const client = new GraphqlViviClient({ fetch: request });
  await expect(client.deletePublishedComment("missing")).rejects.toThrow(
    "comment not found",
  );
  expect(request).toHaveBeenCalledTimes(1);
});

it("maps comment deletion activity including the actor kind", async () => {
  const request = vi.fn<typeof fetch>(async () =>
    Response.json({
      data: {
        commentThreadActivities: [
          {
            id: "a-delete",
            threadId: "t1",
            commentId: "c1",
            type: "comment_deleted",
            actor: {
              id: "claude:1",
              kind: "claude_code",
              displayName: "Claude",
            },
            createdAt: "2026-09-08T00:00:00Z",
          },
        ],
      },
    }),
  );
  const client = new GraphqlViviClient({ fetch: request });
  await expect(
    client.getCommentThreadActivities({ threadId: "t1" }),
  ).resolves.toEqual([
    {
      id: "a-delete",
      threadId: "t1",
      commentId: "c1",
      type: "comment_deleted",
      actor: { id: "claude:1", kind: "claude-code", displayName: "Claude" },
      createdAt: "2026-09-08T00:00:00Z",
    },
  ]);
});
