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

it("uses GraphQL for startup workspace reads without generated document objects", async () => {
  const request = vi.fn<typeof fetch>(async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    expect(body.operationName).toBe("ViviWorkspace");
    expect(body.query).toContain("query ViviWorkspace");
    expect(body.query).toContain("fragment TreeFields");
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
