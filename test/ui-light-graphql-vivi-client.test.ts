import { expect, it, vi } from "vitest";
import { LightGraphqlViviClient } from "../ui/src/infrastructure/vivi-api/lightGraphqlViviClient.js";

const file = {
  path: "README.md",
  viewerKind: "markdown" as const,
  encoding: "utf8" as const,
  content: "# Vivi",
  etag: "etag-1",
  size: 6,
  mtimeMs: 1,
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
const activity = {
  id: "a1",
  threadId: "t1",
  type: "comment_added" as const,
  actor: { id: "codex:run-1", kind: "codex" as const, displayName: "Codex" },
  commentId: "c1",
  previousStatus: null,
  status: null,
  clientEventId: null,
  leaseExpiresAt: null,
  createdAt: "2026-06-20T00:01:00.000Z",
};

it("uses GraphQL for startup workspace reads without generated document objects", async () => {
  const request = vi.fn<typeof fetch>(async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    expect(body.operationName).toBe("ViviWorkspace");
    expect(body.query).toContain("query ViviWorkspace");
    expect(body.query).toContain("fragment TreeFields");
    expect(body.query).toContain("documentHeading");
    expect(body.variables).toEqual({ depth: 1 });
    return Response.json({
      data: {
        workspace: { tree, config },
      },
    });
  });
  const client = new LightGraphqlViviClient({ fetch: request });

  await expect(client.getWorkspace()).resolves.toEqual({ tree, config });
  expect(request.mock.calls.map(([url]) => String(url))).toEqual(["/graphql"]);
});

it("assembles file context through GraphQL", async () => {
  const request = vi.fn<typeof fetch>(async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    expect(body.operationName).toBe("ViviFileContext");
    expect(body.variables).toMatchObject({
      path: "README.md",
      includeComments: true,
    });
    return Response.json({
      data: {
        fileContext: {
          file,
          comments: [comment],
          commentThreads: [
            {
              id: "t1",
              path: "README.md",
              status: "open",
              anchor: comment.anchor,
              updatedAt: comment.updatedAt,
              comments: [comment],
            },
          ],
          diff: null,
        },
      },
    });
  });
  const client = new LightGraphqlViviClient({ fetch: request });

  await expect(
    client.getFileContext({ path: "README.md", includeComments: true }),
  ).resolves.toMatchObject({
    file,
    comments: [comment],
    commentThreads: [{ id: "t1", comments: [comment] }],
  });
  expect(request.mock.calls.map(([url]) => String(url))).toEqual(["/graphql"]);
});

it("classifies GraphQL file-not-found without treating permission errors as missing", async () => {
  const missing = new LightGraphqlViviClient({
    fetch: vi.fn<typeof fetch>(async () =>
      Response.json({
        errors: [{ message: "open gone.md: no such file or directory" }],
      }),
    ),
  });
  const forbidden = new LightGraphqlViviClient({
    fetch: vi.fn<typeof fetch>(async () =>
      Response.json({ errors: [{ message: "permission denied: private.md" }] }),
    ),
  });

  await expect(
    missing.getFileContext({ path: "gone.md" }),
  ).rejects.toMatchObject({
    code: "not_found",
  });
  await expect(
    forbidden.getFileContext({ path: "private.md" }),
  ).rejects.toMatchObject({ code: "forbidden" });
});

it("loads comment thread activity through GraphQL", async () => {
  const request = vi.fn<typeof fetch>(async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    expect(body.operationName).toBe("ViviCommentThreadActivities");
    expect(body.query).toContain("query ViviCommentThreadActivities");
    expect(body.query).toContain("commentThreadActivities");
    expect(body.variables).toEqual({ threadId: "t1", first: 12 });
    return Response.json({
      data: {
        commentThreadActivities: [activity],
      },
    });
  });
  const client = new LightGraphqlViviClient({ fetch: request });

  await expect(
    client.getCommentThreadActivities({ threadId: "t1", first: 12 }),
  ).resolves.toEqual([activity]);
  expect(request.mock.calls.map(([url]) => String(url))).toEqual(["/graphql"]);
});

it("negotiates attention once for legacy servers without hiding permission failures", async () => {
  const request = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          errors: [{ message: "unsupported GraphQL operation" }],
        }),
        { status: 200 },
      ),
  );
  const client = new LightGraphqlViviClient({ fetch: request });
  expect(await client.getDocumentAttention([])).toBeNull();
  await client.observeDocument("README.md", "Opened");
  expect(await client.getDocumentAttention([])).toBeNull();
  expect(request).toHaveBeenCalledTimes(1);
  const denied = new LightGraphqlViviClient({
    fetch: async () =>
      new Response(
        JSON.stringify({ errors: [{ message: "permission denied" }] }),
        { status: 200 },
      ),
  });
  await expect(denied.getDocumentAttention([])).rejects.toThrow(
    "permission denied",
  );
});

it("maps shared attention and sends explicit document intent", async () => {
  const snapshot = {
    events: [{ path: "README.md", at: 1000, reason: "Opened" }],
    eligiblePaths: ["README.md"],
    headings: { "README.md": "Vivi" },
  };
  const requests: Array<{ operationName: string; variables: unknown }> = [];
  const client = new LightGraphqlViviClient({
    fetch: async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      requests.push(body);
      return new Response(
        JSON.stringify({
          data:
            body.operationName === "DocumentAttention"
              ? { attention: snapshot }
              : {
                  observeDocument: {
                    path: "README.md",
                    at: 1000,
                    reason: "Opened",
                  },
                },
        }),
        { status: 200 },
      );
    },
  });
  expect(await client.getDocumentAttention(["README.md"])).toEqual(snapshot);
  await client.observeDocument("README.md", "Opened");
  expect(requests).toMatchObject([
    { operationName: "DocumentAttention", variables: { paths: ["README.md"] } },
    {
      operationName: "ObserveDocument",
      variables: { path: "README.md", reason: "Opened" },
    },
  ]);
});

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
  const client = new LightGraphqlViviClient({ fetch: request });
  await expect(client.deletePublishedComment("c1")).resolves.toEqual(deleted);
  expect(request).toHaveBeenCalledTimes(1);
});

it("surfaces published deletion failures without retrying the mutation", async () => {
  const request = vi.fn<typeof fetch>(async () =>
    Response.json({
      errors: [{ message: "comment not found" }],
    }),
  );
  const client = new LightGraphqlViviClient({ fetch: request });
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
  const client = new LightGraphqlViviClient({ fetch: request });
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
