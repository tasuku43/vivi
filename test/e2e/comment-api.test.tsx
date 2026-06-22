import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it } from "vitest";
import { ViewerService } from "../../server/typescript/application/viewer-service.js";
import type { ViviComment } from "../../server/typescript/domain/comments.js";
import type { FilePayload } from "../../server/typescript/domain/fs-node.js";
import { NodeCommentStore } from "../../server/typescript/infrastructure/node-comment-store.js";
import { NodeFileSystem } from "../../server/typescript/infrastructure/node-file-system.js";
import { startHttpServer } from "../../server/typescript/http/http-server.js";
import { CommentedSourceLines } from "../../ui/src/features/comments/components/CommentedSourceLines.js";
import { CommentsPanel } from "../../ui/src/features/comments/components/CommentsPanel.js";
import { DraftReviewTray } from "../../ui/src/features/comments/components/DraftReviewTray.js";
import { Inspector } from "../../ui/src/features/review-queue/Inspector.js";
import { renderedCommentDraft } from "../../ui/src/state/comments.js";

let workspaceDir: string;
let dataDir: string;
let server: { url: string; close: () => Promise<void> } | null = null;

beforeEach(async () => {
  workspaceDir = await mkdtemp(path.join(tmpdir(), "vivi-comments-root-"));
  dataDir = await mkdtemp(path.join(tmpdir(), "vivi-comments-data-"));
  await mkdir(path.join(workspaceDir, "src"), { recursive: true });
  await writeFile(
    path.join(workspaceDir, "README.md"),
    "# Title\n\nRendered markdown text\n",
  );
  await writeFile(
    path.join(workspaceDir, "index.html"),
    "<h1>Hello</h1>\n<p>Rendered HTML text</p>\n",
  );
  await writeFile(
    path.join(workspaceDir, "src", "app.ts"),
    'const current = "line";\nconst added = "line";\n',
  );
  const service = new ViewerService({
    fileSystem: new NodeFileSystem({ rootDir: workspaceDir }),
    commentStore: new NodeCommentStore({ dataDir }),
  });
  server = await startHttpServer({ host: "127.0.0.1", port: 0, service });
});

afterEach(async () => {
  await server?.close();
  await rm(workspaceDir, { recursive: true, force: true });
  await rm(dataDir, { recursive: true, force: true });
});

it("creates, lists, updates, persists, and exports comments", async () => {
  const meta = await fetchJson<{ version: string }>("/api/v1/meta");
  expect(meta.version).toBe("v1");

  const source = await postComment({
    path: "src/app.ts",
    body: "Check the source line",
    anchor: {
      surface: "source",
      canonical: {
        path: "src/app.ts",
        lineStart: 1,
        lineEnd: 1,
        quote: 'const current = "line";',
      },
    },
  });

  const renderedMarkdown = await postComment({
    path: "README.md",
    body: "Rendered Markdown note",
    anchor: {
      surface: "rendered",
      canonical: { path: "README.md", quote: "Rendered markdown text" },
      rendered: {
        kind: "markdown",
        blockId: "vivi-block-2",
        selector: "p:nth-of-type(1)",
        textQuote: "Rendered markdown text",
        sourceLineStart: 3,
        sourceLineEnd: 3,
      },
    },
  });

  const renderedHtml = await postComment({
    path: "index.html",
    body: "Rendered HTML note",
    anchor: {
      surface: "rendered",
      canonical: { path: "index.html", quote: "Rendered HTML text" },
      rendered: {
        kind: "html",
        blockId: "vivi-block-2",
        selector: "p:nth-of-type(1)",
        textQuote: "Rendered HTML text",
        sourceLineStart: 2,
        sourceLineEnd: 2,
      },
    },
  });

  const diffContext = await postComment({
    path: "src/app.ts",
    body: "Context line diff note",
    anchor: {
      surface: "diff",
      canonical: { path: "src/app.ts" },
      diff: {
        path: "src/app.ts",
        lineStart: 1,
        lineEnd: 1,
        side: "current",
        changeKind: "context",
      },
    },
  });

  const diffAdded = await postComment({
    path: "src/app.ts",
    body: "Added line diff note",
    anchor: {
      surface: "diff",
      canonical: { path: "src/app.ts" },
      diff: {
        path: "src/app.ts",
        lineStart: 2,
        lineEnd: 2,
        side: "current",
        changeKind: "added",
      },
    },
  });

  expect(source.anchor.canonical.fileHash).toMatch(/^sha256:/);
  expect(renderedMarkdown.anchor.canonical.lineStart).toBe(3);
  expect(renderedMarkdown.anchor.rendered?.blockId).toBe("vivi-block-2");
  expect(renderedHtml.anchor.canonical.lineStart).toBe(2);
  expect(renderedHtml.anchor.rendered?.blockId).toBe("vivi-block-2");
  expect(diffContext.anchor.diff?.changeKind).toBe("context");
  expect(diffAdded.anchor.diff?.changeKind).toBe("added");

  const deletedLineAttempt = await fetch(`${server!.url}/api/v1/comments`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      path: "src/app.ts",
      body: "Deleted line must fail",
      anchor: {
        surface: "diff",
        canonical: { path: "src/app.ts" },
        diff: {
          path: "src/app.ts",
          lineStart: 1,
          lineEnd: 1,
          side: "old",
          changeKind: "deleted",
        },
      },
    }),
  });
  expect(deletedLineAttempt.status).toBe(400);

  const byPath = await fetchJson<ViviComment[]>(
    "/api/v1/comments?path=src%2Fapp.ts",
  );
  expect(byPath.map((comment) => comment.id).sort()).toEqual(
    [source.id, diffContext.id, diffAdded.id].sort(),
  );

  const resolved = await patchJson<ViviComment>(
    `/api/v1/comments/${source.id}`,
    { status: "resolved" },
  );
  expect(resolved.status).toBe("resolved");
  expect(resolved.resolvedAt).toBeDefined();

  const openOnly = await fetchJson<ViviComment[]>(
    "/api/v1/comments?status=open",
  );
  expect(openOnly).toHaveLength(4);
  expect(openOnly.map((comment) => comment.id)).not.toContain(source.id);

  const persisted = await new NodeCommentStore({ dataDir }).listComments({
    path: "README.md",
  });
  expect(persisted).toContainEqual(
    expect.objectContaining({ id: renderedMarkdown.id }),
  );

  const exported = await fetch(
    `${server!.url}/api/v1/comments/export?status=open&format=jsonl`,
  ).then((res) => res.text());
  const lines = exported.trim().split("\n");
  expect(lines).toHaveLength(4);
  expect(lines.map((line) => JSON.parse(line))).toContainEqual(
    expect.objectContaining({
      path: "index.html",
      status: "open",
      type: "commentThread",
      comments: expect.arrayContaining([
        expect.objectContaining({ body: "Rendered HTML note" }),
      ]),
    }),
  );
});

it("creates a comment from the UI anchor model and renders it after retrieval", async () => {
  const file = await fetchJson<FilePayload>("/api/file?path=README.md");
  const draft = renderedCommentDraft(file, "markdown", {
    text: "Rendered markdown text",
    blockId: "vivi-block-2",
    sourceLineStart: 3,
    sourceLineEnd: 3,
    sourceQuote: "Rendered markdown text",
  });

  const created = await postComment({
    ...draft,
    body: "UI-created note from selected text",
  });
  expect(created.anchor.surface).toBe("rendered");
  expect(created.anchor.canonical.lineStart).toBe(3);
  expect(created.anchor.rendered?.blockId).toBe("vivi-block-2");

  const retrieved = await fetchJson<ViviComment[]>(
    "/api/v1/comments?path=README.md",
  );
  expect(retrieved).toContainEqual(
    expect.objectContaining({
      id: created.id,
      body: "UI-created note from selected text",
    }),
  );

  const html = renderToStaticMarkup(
    <Inspector
      file={file}
      outline={[]}
      reviewChanges={[]}
      reviewDiffStats={{}}
      loadingReviewDiffs={{}}
      unreadReviewPaths={new Set()}
      comments={retrieved}
      selectedCodeRange={null}
      activePaneId="main"
      onOutlineSelect={() => undefined}
      onOpenEventPath={() => undefined}
      onConfirmEventPath={() => undefined}
      onOpenNextChanged={() => undefined}
      onOpenPreviousChanged={() => undefined}
      onOpenAllChanged={() => undefined}
      onTargetHoverChange={() => undefined}
      onRevealTarget={() => undefined}
      onRevealInTree={() => undefined}
    />,
  );

  expect(html).toContain("Comments");
  expect(html).toContain("1 open comments");
  expect(html).toContain("Open in Comments panel");
  expect(html).not.toContain("UI-created note from selected text");
  expect(html).not.toContain("Rendered markdown text");

  const panelHtml = renderToStaticMarkup(
    <CommentsPanel
      open
      comments={retrieved}
      query=""
      statusFilter="open"
      onQueryChange={() => undefined}
      onStatusFilterChange={() => undefined}
      onClose={() => undefined}
      onOpenComment={() => undefined}
    />,
  );
  expect(panelHtml).toContain("UI-created note from selected text");
  expect(panelHtml).toContain("Rendered markdown text");
  expect(panelHtml).toContain("README.md");
  expect(panelHtml).toContain("L3");

  const sourceHtml = renderToStaticMarkup(
    <CommentedSourceLines
      content={file.content}
      comments={retrieved}
      onOpenComment={() => undefined}
    />,
  );
  expect(sourceHtml).toContain("has-comment");
  expect(sourceHtml).toContain(`data-comment-id="${created.id}"`);

  const draftTrayHtml = renderToStaticMarkup(
    <DraftReviewTray
      drafts={[
        {
          id: "draft-1",
          path: "README.md",
          viewerKind: "markdown",
          anchor: draft.anchor,
          body: "Unpublished batch note",
          source: "human",
          createdAt: "2026-06-20T00:00:00.000Z",
          updatedAt: "2026-06-20T00:00:00.000Z",
        },
      ]}
    />,
  );
  expect(draftTrayHtml).toContain("Draft Review");
  expect(draftTrayHtml).toContain("Publish review comments");
  expect(draftTrayHtml).toContain("Unpublished batch note");
});

async function fetchJson<T>(route: string): Promise<T> {
  const response = await fetch(`${server!.url}${route}`);
  expect(response.status).toBe(200);
  return (await response.json()) as T;
}

async function postComment(body: unknown): Promise<ViviComment> {
  const response = await fetch(`${server!.url}/api/v1/comments`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(response.status).toBe(201);
  return (await response.json()) as ViviComment;
}

async function patchJson<T>(route: string, body: unknown): Promise<T> {
  const response = await fetch(`${server!.url}${route}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(response.status).toBe(200);
  return (await response.json()) as T;
}
