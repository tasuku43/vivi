import { afterEach, beforeEach, expect, it } from "vitest";
import {
  createContractFixture,
  type ContractFixture,
} from "./support/fixture-workspace.js";
import { startViviServer, type StartedServer } from "./support/vivi-server.js";

let fixture: ContractFixture;
let server: StartedServer | null = null;

beforeEach(async () => {
  fixture = await createContractFixture();
});

afterEach(async () => {
  await server?.close();
  server = null;
  await fixture.cleanup();
});

it("serves the first GraphQL data API slice with REST-equivalent behavior", async () => {
  server = await startViviServer({
    rootDir: fixture.rootDir,
    extraEnv: { VIVI_DATA_DIR: `${fixture.outsideDir}/vivi-data` },
  });

  const workspace = await graphql<{
    workspace: {
      config: {
        root: string;
        allowHtmlScripts: boolean;
        maxFileSizeBytes: number;
      };
      tree: {
        nodes: Array<{ path: string; kind: string; childrenLoaded?: boolean }>;
      };
    };
  }>("ViviWorkspace", { depth: 1 });
  expect(workspace.workspace.config).toMatchObject({
    root: fixture.rootDir,
    allowHtmlScripts: false,
    maxFileSizeBytes: 1024 * 1024,
  });
  expect(pathsFromTree(workspace.workspace.tree.nodes)).toEqual(
    expect.arrayContaining(["README.md", "docs", "index.html", "src.ts"]),
  );
  expect(JSON.stringify(workspace.workspace.tree)).not.toContain(
    "node_modules",
  );

  const fileContext = await graphql<{
    fileContext: {
      file: { path: string; viewerKind: string; content: string };
      comments: Array<{ id: string }>;
      commentThreads: Array<{ id: string }>;
    };
  }>("ViviFileContext", {
    path: "README.md",
    includeComments: true,
  });
  expect(fileContext.fileContext.file).toMatchObject({
    path: "README.md",
    viewerKind: "markdown",
    content: expect.stringContaining("# Vivi Fixture"),
  });
  expect(fileContext.fileContext.comments).toEqual([]);
  expect(fileContext.fileContext.commentThreads).toEqual([]);

  const created = await graphql<{
    createComment: {
      id: string;
      threadId?: string;
      path: string;
      body: string;
      status: string;
      viewerKind: string;
      anchor: { canonical: { fileHash?: string } };
    };
  }>("CreateComment", {
    input: {
      path: "README.md",
      body: "GraphQL contract comment",
      anchor: {
        surface: "source",
        canonical: {
          path: "README.md",
          lineStart: 1,
          lineEnd: 1,
          quote: "# Vivi Fixture",
        },
      },
    },
  });
  expect(created.createComment).toMatchObject({
    path: "README.md",
    body: "GraphQL contract comment",
    status: "open",
    viewerKind: "markdown",
  });
  expect(created.createComment.anchor.canonical.fileHash).toMatch(/^sha256:/);
  expect(created.createComment.threadId).toBe(created.createComment.id);

  const comments = await graphql<{
    comments: Array<{ id: string; threadId?: string; path: string }>;
    commentThreads: Array<{
      id: string;
      path: string;
      status: string;
      comments: Array<{ id: string }>;
    }>;
  }>("ViviComments", { path: "README.md" });
  expect(comments.comments).toContainEqual(
    expect.objectContaining({
      id: created.createComment.id,
      threadId: created.createComment.id,
    }),
  );
  expect(comments.commentThreads).toContainEqual(
    expect.objectContaining({
      id: created.createComment.id,
      path: "README.md",
      status: "open",
      comments: [expect.objectContaining({ id: created.createComment.id })],
    }),
  );

  const fileContextWithThread = await graphql<{
    fileContext: {
      commentThreads: Array<{
        id: string;
        comments: Array<{ id: string; threadId?: string }>;
      }>;
    };
  }>("ViviFileContext", {
    path: "README.md",
    includeComments: true,
  });
  expect(fileContextWithThread.fileContext.commentThreads).toContainEqual(
    expect.objectContaining({
      id: created.createComment.id,
      comments: [
        expect.objectContaining({
          id: created.createComment.id,
          threadId: created.createComment.id,
        }),
      ],
    }),
  );

  const exported = await graphql<{
    commentExport: { format: string; contentType: string; content: string };
  }>("ViviCommentExport", { path: "README.md", status: "open" });
  expect(exported.commentExport).toMatchObject({
    format: "jsonl",
    contentType: "application/x-ndjson; charset=utf-8",
  });
  expect(exported.commentExport.content.trim().split("\n").map(JSON.parse)).toContainEqual(
    expect.objectContaining({
      id: created.createComment.id,
      threadId: created.createComment.id,
      body: "GraphQL contract comment",
    }),
  );

  const resolvedThread = await graphql<{
    updateCommentThread: {
      id: string;
      status: string;
      comments: Array<{ id: string; status: string; resolvedAt?: string }>;
    };
  }>("UpdateCommentThreadStatus", {
    id: created.createComment.id,
    status: "resolved",
  });
  expect(resolvedThread.updateCommentThread).toMatchObject({
    id: created.createComment.id,
    status: "resolved",
    comments: [
      expect.objectContaining({
        id: created.createComment.id,
        status: "resolved",
        resolvedAt: expect.any(String),
      }),
    ],
  });

  const resolved = await graphql<{
    updateComment: { id: string; status: string; resolvedAt?: string };
  }>("UpdateCommentStatus", {
    id: created.createComment.id,
    status: "resolved",
  });
  expect(resolved.updateComment).toMatchObject({
    id: created.createComment.id,
    status: "resolved",
  });
  expect(resolved.updateComment.resolvedAt).toEqual(expect.any(String));

  const search = await graphql<{
    textSearch: {
      results: Array<{ path: string; lineNumber: number; lineText: string }>;
    };
  }>("ViviTextSearch", {
    query: "Contract workspace changed",
    limit: 10,
  });
  expect(search.textSearch.results).toContainEqual(
    expect.objectContaining({
      path: "README.md",
      lineNumber: 5,
      lineText: "Contract workspace changed",
    }),
  );

  const files = await graphql<{
    fileSearch: {
      query: string;
      results: Array<{ path: string; viewerKind?: string; score: number }>;
    };
  }>("ViviFileSearch", {
    query: "guide",
    limit: 10,
  });
  expect(files.fileSearch.query).toBe("guide");
  expect(files.fileSearch.results).toContainEqual(
    expect.objectContaining({ path: "docs/guide.md", viewerKind: "markdown" }),
  );

  const review = await graphql<{
    reviewQueue: {
      available: boolean;
      changes: Array<{ path: string; status: string; kind: string }>;
    };
  }>("ViviReviewQueue", {});
  expect(review.reviewQueue.available).toBe(true);
  expect(review.reviewQueue.changes).toEqual(
    expect.arrayContaining([
      { path: "README.md", status: "modified", kind: "file" },
      { path: "docs/guide.md", status: "modified", kind: "file" },
      { path: "src.ts", status: "modified", kind: "file" },
      { path: "untracked.md", status: "added", kind: "file" },
      { path: "deleted.md", status: "deleted", kind: "file" },
    ]),
  );

  const bases = await graphql<{
    diffBases: {
      available: boolean;
      options: Array<{ ref: string; label: string; subject?: string }>;
    };
  }>("ViviDiffBases", {});
  expect(bases.diffBases.available).toBe(true);
  expect(bases.diffBases.options[0]).toMatchObject({ ref: "HEAD" });

  const diff = await graphql<{
    diff: { status: string; content: string; baseLabel: string };
  }>("ViviDiff", {
    path: "README.md",
    base: "HEAD",
  });
  expect(diff.diff.status).toBe("available");
  expect(diff.diff.baseLabel).toBe("HEAD");
  expect(diff.diff.content).toContain("-Contract workspace");
  expect(diff.diff.content).toContain("+Contract workspace changed");

  const meta = await graphql<{
    meta: {
      version: string;
      comments: { statuses: string[]; surfaces: string[] };
    };
  }>("ViviMeta", {});
  expect(meta.meta).toMatchObject({
    version: "v1",
    comments: {
      statuses: ["open", "resolved", "archived"],
      surfaces: ["source", "rendered", "diff"],
    },
  });

  const preview = await graphql<{
    htmlPreview: { url: string; scriptsAllowed: boolean; transport: string };
    rawPreview: { url: string; scriptsAllowed: boolean; transport: string };
  }>("ViviPreview", { path: "index.html" });
  expect(preview.htmlPreview).toMatchObject({
    url: "/preview/html?path=index.html",
    scriptsAllowed: false,
    transport: "http-rendering",
  });
  expect(preview.rawPreview).toMatchObject({
    url: "/preview/raw/index.html",
    scriptsAllowed: false,
    transport: "http-rendering",
  });
});

async function graphql<T>(
  operationName: string,
  variables: Record<string, unknown>,
): Promise<T> {
  if (!server) throw new Error("server is not running");
  const response = await fetch(`${server.url}/graphql`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      operationName,
      query: graphqlQuery(operationName),
      variables,
    }),
  });
  expect(response.status).toBe(200);
  const payload = (await response.json()) as {
    data?: T;
    errors?: Array<{ message: string }>;
  };
  expect(payload.errors).toBeUndefined();
  if (!payload.data) throw new Error("GraphQL response did not include data");
  return payload.data;
}

function graphqlQuery(operationName: string): string {
  const queries: Record<string, string> = {
    ViviWorkspace: `query ViviWorkspace($depth: Int) {
      workspace(depth: $depth) {
        config { root allowHtmlScripts maxFileSizeBytes }
        tree {
          nodes {
            path
            kind
            childrenLoaded
            children { path }
          }
        }
      }
    }`,
    ViviFileContext: `query ViviFileContext($path: String!, $includeComments: Boolean) {
      fileContext(path: $path, includeComments: $includeComments) {
        file { path viewerKind content }
        comments { id }
        commentThreads {
          id
          comments { id threadId }
        }
      }
    }`,
    CreateComment: `mutation CreateComment($input: CommentInput!) {
      createComment(input: $input) {
        id
        threadId
        path
        body
        status
        viewerKind
        anchor
      }
    }`,
    ViviComments: `query ViviComments($path: String) {
      comments(path: $path) { id threadId path }
      commentThreads(path: $path) {
        id
        path
        status
        comments { id }
      }
    }`,
    ViviCommentExport: `query ViviCommentExport($path: String, $status: CommentStatus) {
      commentExport(path: $path, status: $status, format: jsonl) {
        format
        contentType
        content
      }
    }`,
    UpdateCommentThreadStatus: `mutation UpdateCommentThreadStatus($id: ID!, $status: CommentStatus!) {
      updateCommentThread(id: $id, input: { status: $status }) {
        id
        status
        comments { id status resolvedAt }
      }
    }`,
    UpdateCommentStatus: `mutation UpdateCommentStatus($id: ID!, $status: CommentStatus!) {
      updateComment(id: $id, input: { status: $status }) {
        id
        status
        resolvedAt
      }
    }`,
    ViviTextSearch: `query ViviTextSearch($query: String!, $limit: Int) {
      textSearch(query: $query, limit: $limit) {
        results { path lineNumber lineText }
      }
    }`,
    ViviFileSearch: `query ViviFileSearch($query: String!, $limit: Int) {
      fileSearch(query: $query, limit: $limit) {
        query
        results { path viewerKind score }
      }
    }`,
    ViviReviewQueue: `query ViviReviewQueue {
      reviewQueue {
        available
        changes { path status kind }
      }
    }`,
    ViviDiffBases: `query ViviDiffBases {
      diffBases {
        available
        options { ref label subject }
      }
    }`,
    ViviDiff: `query ViviDiff($path: String!, $base: String) {
      diff(path: $path, base: $base) {
        status
        content
        baseLabel
      }
    }`,
    ViviMeta: `query ViviMeta {
      meta {
        version
        comments { statuses surfaces }
      }
    }`,
    ViviPreview: `query ViviPreview($path: String!) {
      htmlPreview(path: $path) { url scriptsAllowed transport }
      rawPreview(path: $path) { url scriptsAllowed transport }
    }`,
  };
  return queries[operationName] ?? `query ${operationName} { __typename }`;
}

function pathsFromTree(
  nodes: Array<{ path: string; children?: Array<{ path: string }> }>,
): string[] {
  const paths: string[] = [];
  for (const node of nodes) {
    paths.push(node.path);
    if (node.children) paths.push(...pathsFromTree(node.children));
  }
  return paths.sort();
}
