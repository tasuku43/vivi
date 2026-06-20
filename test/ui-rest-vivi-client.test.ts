import { expect, it, vi } from "vitest";
import { RestViviClient } from "../ui/src/infrastructure/vivi-api/restViviClient.js";

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
const diff = {
  path: "README.md",
  status: "available" as const,
  baseLabel: "HEAD",
  compareLabel: "working tree",
  content: "+# Vivi",
};

it("assembles FileContext while keeping REST calls behind ViviClient", async () => {
  const request = vi.fn<typeof fetch>(async (input) => {
    const url = String(input);
    if (url.startsWith("/api/file?")) return Response.json(file);
    if (url.startsWith("/api/v1/comments?")) return Response.json([comment]);
    if (url.startsWith("/api/diff?")) return Response.json(diff);
    return new Response(null, { status: 404 });
  });
  const client = new RestViviClient({ fetch: request });

  await expect(
    client.getFileContext({
      path: "README.md",
      includeComments: true,
      includeDiff: true,
      diffBase: "HEAD",
    }),
  ).resolves.toEqual({ file, comments: [comment], diff });

  expect(request.mock.calls.map(([url]) => String(url))).toEqual([
    "/api/file?path=README.md",
    "/api/v1/comments?path=README.md",
    "/api/diff?path=README.md&base=HEAD",
  ]);
});

it("preserves comment creation and status update payloads", async () => {
  const request = vi.fn<typeof fetch>(async (_input, init) =>
    Response.json({
      ...comment,
      status: JSON.parse(String(init?.body)).status ?? comment.status,
    }),
  );
  const client = new RestViviClient({ fetch: request });

  await client.createComment({
    path: comment.path,
    viewerKind: comment.viewerKind,
    anchor: comment.anchor,
    body: comment.body,
  });
  await client.updateCommentStatus({ id: comment.id, status: "resolved" });

  expect(request.mock.calls[0]?.[1]).toMatchObject({ method: "POST" });
  expect(JSON.parse(String(request.mock.calls[0]?.[1]?.body))).toMatchObject({
    path: "README.md",
    body: comment.body,
  });
  expect(request.mock.calls[1]?.[1]).toMatchObject({ method: "PATCH" });
  expect(JSON.parse(String(request.mock.calls[1]?.[1]?.body))).toEqual({
    status: "resolved",
  });
});
