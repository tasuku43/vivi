import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import type { AddressInfo, Socket } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ViewerService } from "../application/viewer-service.js";
import {
  normalizeCommentFilters,
  type CommentActor,
  type CommentListFilters,
  type CommentStatus,
  type CommentThreadActivityEvent,
} from "../domain/comments.js";
import {
  viviMermaidThemeVariables,
  type MermaidPreviewTheme,
} from "../domain/mermaid-theme.js";
import {
  escapeAttribute,
  escapeHtml,
  hasCustomMermaidStyle,
} from "../domain/mermaid-preview.js";
import { normalizeRelativePath } from "../domain/path-policy.js";
import { addRenderedCommentBlockIdsToHtml } from "../domain/rendered-comment-blocks.js";

export interface ServerOptions {
  host: string;
  port: number;
  service: ViewerService;
  staticDir?: string;
  allowHtmlScripts?: boolean;
  threadReadObserverFactories?: ThreadReadObserverFactory[];
}

const serverCloseGraceMs = 2_000;

export interface ThreadReadObserver {
  observeThreadRead(threadId: string): Promise<void>;
}

export type ThreadReadObserverFactory = (input: {
  actor: CommentActor;
  clientEventId?: string;
  service: ViewerService;
}) => ThreadReadObserver | undefined;

export async function startHttpServer(
  options: ServerOptions,
): Promise<{ url: string; close: () => Promise<void> }> {
  const sockets = new Set<Socket>();
  const server = createServer(async (req, res) => {
    try {
      await routeRequest(req, res, options);
    } catch (error) {
      const normalized = normalizeHttpError(error);
      logHttpError(req, normalized, error);
      sendJson(res, normalized.httpStatus, {
        error: normalized.message,
        reason: normalized.reason,
        status: normalized.status,
      });
    }
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });

  await options.service.start();

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address() as AddressInfo;
  const actualPort = address.port;

  return {
    url: `http://${options.host}:${actualPort}`,
    close: async () => {
      await options.service.stop();
      server.closeIdleConnections?.();
      for (const socket of sockets) socket.destroy();
      await closeServerWithGrace(server, serverCloseGraceMs);
    },
  };
}

function closeServerWithGrace(server: Server, graceMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve();
    }, graceMs);
    timer.unref();

    server.close((err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve();
    });
  });
}

async function routeRequest(
  req: IncomingMessage,
  res: ServerResponse,
  options: ServerOptions,
): Promise<void> {
  const host = req.headers.host ?? `${options.host}:${options.port}`;
  const url = new URL(req.url ?? "/", `http://${host}`);

  if (url.pathname === "/graphql") {
    await handleGraphqlRequest(req, res, options);
    return;
  }

  if (url.pathname === "/api/v1/meta") {
    sendJson(res, 200, {
      version: "v1",
      comments: {
        statuses: ["open", "resolved", "archived"],
        surfaces: ["source", "rendered", "diff"],
        exportFormats: ["jsonl"],
      },
    });
    return;
  }

  if (url.pathname === "/api/v1/comments" && req.method === "GET") {
    sendJson(
      res,
      200,
      await options.service.listComments(
        normalizeCommentFilters({
          path: url.searchParams.get("path"),
          status: url.searchParams.get("status"),
        }),
      ),
    );
    return;
  }

  if (url.pathname === "/api/v1/comments" && req.method === "POST") {
    assertSafeJsonWriteRequest(req, options);
    sendJson(
      res,
      201,
      await options.service.createComment(await readJson(req)),
    );
    return;
  }

  const commentPatchMatch = /^\/api\/v1\/comments\/([^/]+)$/.exec(url.pathname);
  if (commentPatchMatch && req.method === "PATCH") {
    assertSafeJsonWriteRequest(req, options);
    sendJson(
      res,
      200,
      await options.service.updateComment(
        decodeURIComponent(commentPatchMatch[1] ?? ""),
        await readJson(req),
      ),
    );
    return;
  }

  if (url.pathname === "/api/v1/comments/export") {
    const format = url.searchParams.get("format") ?? "jsonl";
    if (format !== "jsonl") throw new Error("invalid comment export format");
    const body = await options.service.exportCommentsAsJsonl(
      normalizeCommentFilters({
        path: url.searchParams.get("path"),
        status: url.searchParams.get("status"),
      }),
    );
    res.writeHead(200, {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
    });
    res.end(body ? `${body}\n` : "");
    return;
  }

  if (url.pathname === "/api/tree") {
    const requestedPath = url.searchParams.get("path") ?? "";
    const depth = parsePositiveInt(url.searchParams.get("depth"));
    sendJson(
      res,
      200,
      url.searchParams.has("path") || url.searchParams.has("depth")
        ? await options.service.readDirectory(requestedPath, {
            depth: depth ?? 1,
          })
        : await options.service.readTree(),
    );
    return;
  }

  if (url.pathname === "/api/config") {
    sendJson(res, 200, options.service.getConfig());
    return;
  }

  if (url.pathname === "/api/changes") {
    sendJson(res, 200, await options.service.readChanges());
    return;
  }

  if (url.pathname === "/api/diff-bases") {
    sendJson(res, 200, await options.service.readDiffBases());
    return;
  }

  if (url.pathname === "/api/diff") {
    const requestedPath = url.searchParams.get("path") ?? "";
    const baseRef = url.searchParams.get("base") ?? undefined;
    sendJson(res, 200, await options.service.readDiff(requestedPath, baseRef));
    return;
  }

  if (url.pathname === "/api/file") {
    const requestedPath = url.searchParams.get("path") ?? "";
    sendJson(res, 200, await options.service.readFile(requestedPath));
    return;
  }

  if (url.pathname === "/api/search") {
    const query = url.searchParams.get("q") ?? "";
    const limit = parsePositiveInt(url.searchParams.get("limit")) ?? 40;
    sendJson(res, 200, await options.service.searchText(query, { limit }));
    return;
  }

  if (url.pathname === "/api/files") {
    const query = url.searchParams.get("q") ?? "";
    const limit = parsePositiveInt(url.searchParams.get("limit")) ?? 40;
    sendJson(res, 200, await options.service.searchFiles(query, { limit }));
    return;
  }

  if (url.pathname === "/preview/html") {
    const requestedPath = url.searchParams.get("path") ?? "";
    const html = await options.service.readHtmlPreview(requestedPath);
    const allowHtmlScripts =
      options.allowHtmlScripts ?? options.service.getConfig().allowHtmlScripts;
    const theme = parseHtmlPreviewTheme(url.searchParams.get("theme"));
    const nonce = randomBytes(16).toString("base64");
    const previewHtml = renderEmbeddedMermaidPreviewHtml(
      addRenderedCommentBlockIdsToHtml(
        addHtmlHeadingIds(withPreviewBase(html, requestedPath)),
      ),
      {
        enabled: true,
        allowHtmlScripts,
        nonce,
        theme,
        path: requestedPath,
      },
    );
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "x-content-type-options": "nosniff",
      "cache-control": "no-store",
      "content-security-policy": htmlPreviewCsp(allowHtmlScripts, nonce),
    });

    // codeql[js/reflected-xss]
    res.end(previewHtml);
    return;
  }

  if (url.pathname === "/vivi/vendor/mermaid.min.js") {
    const content = await readFile(mermaidBrowserBundlePath());
    res.writeHead(200, {
      "content-type": "text/javascript; charset=utf-8",
      "x-content-type-options": "nosniff",
      "cache-control": "no-store",
    });
    res.end(content);
    return;
  }

  if (url.pathname.startsWith("/preview/raw/")) {
    const requestedPath = decodeURIComponent(
      url.pathname.slice("/preview/raw/".length),
    );
    const file = await options.service.readFile(requestedPath);
    if (file.truncated) throw new Error("file is too large to preview");
    res.writeHead(200, {
      "content-type": previewContentTypeFor(file.path, file.mimeType),
      "x-content-type-options": "nosniff",
      "cache-control": "no-store",
    });
    res.end(
      file.encoding === "base64"
        ? Buffer.from(file.content, "base64")
        : file.content,
    );
    return;
  }

  if (url.pathname === "/events") {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    });
    res.write(": connected\n\n");
    const unsubscribe = options.service.subscribe((event) => {
      res.write(`event: fs\n`);
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    });
    req.on("close", unsubscribe);
    return;
  }

  await serveSpa(req, res, options.staticDir);
}

async function handleGraphqlRequest(
  req: IncomingMessage,
  res: ServerResponse,
  options: ServerOptions,
): Promise<void> {
  if (req.method === "GET") {
    const host = req.headers.host ?? `${options.host}:${options.port}`;
    const url = new URL(req.url ?? "/", `http://${host}`);
    const subscriptionInput = {
      operationName: url.searchParams.get("operationName") ?? undefined,
      query: url.searchParams.get("query") ?? undefined,
    };
    if (isGraphqlCommentActivityRequest(subscriptionInput)) {
      streamGraphqlCommentActivities(
        req,
        res,
        options,
        optionalGraphqlThreadId(url),
      );
      return;
    }
    if (
      isGraphqlWorkspaceEventsRequest({
        operationName: url.searchParams.get("operationName") ?? undefined,
        query: url.searchParams.get("query") ?? undefined,
      })
    ) {
      streamGraphqlWorkspaceEvents(req, res, options);
      return;
    }
  }
  if (req.method !== "POST") {
    sendJson(res, 405, {
      errors: [{ message: "GraphQL endpoint requires POST" }],
    });
    return;
  }
  const payload = (await readJson(req)) as {
    operationName?: string;
    query?: string;
    variables?: Record<string, unknown>;
  };
  const variables = payload.variables ?? {};
  const operationName = graphqlOperation(payload);
  const threadReadObserver = threadReadObserverFromRequest(req, options);
  if (isGraphqlMutation(operationName, payload.query) || threadReadObserver) {
    assertSafeJsonWriteRequest(req, options);
  }
  try {
    sendJson(res, 200, {
      data: await executeGraphqlOperation(
        operationName,
        variables,
        options,
        threadReadObserver,
      ),
    });
  } catch (error) {
    sendJson(res, 200, {
      errors: [
        {
          message: error instanceof Error ? error.message : String(error),
          extensions: { status: "request_error" },
        },
      ],
    });
  }
}

function streamGraphqlCommentActivities(
  req: IncomingMessage,
  res: ServerResponse,
  options: ServerOptions,
  threadId?: string,
): void {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
  });
  res.write(": connected\n\n");
  const unsubscribe = options.service.subscribeCommentThreadActivities(
    (event) => {
      if (threadId && event.threadId !== threadId) return;
      res.write("event: next\n");
      res.write(
        `data: ${JSON.stringify({ data: { commentThreadActivity: activityGraphqlValue(event) } })}\n\n`,
      );
    },
  );
  req.on("close", unsubscribe);
}

function streamGraphqlWorkspaceEvents(
  req: IncomingMessage,
  res: ServerResponse,
  options: ServerOptions,
): void {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
  });
  res.write(": connected\n\n");
  const unsubscribe = options.service.subscribe((event) => {
    res.write("event: next\n");
    res.write(
      `data: ${JSON.stringify({ data: { workspaceEvents: event } })}\n\n`,
    );
  });
  req.on("close", unsubscribe);
}

async function executeGraphqlOperation(
  operationName: string,
  variables: Record<string, unknown>,
  options: ServerOptions,
  threadReadObserver?: ThreadReadObserver,
): Promise<Record<string, unknown>> {
  switch (operationName) {
    case "ViviWorkspace": {
      const tree = await readGraphqlTree(options, variables);
      return {
        workspace: {
          tree,
          config: options.service.getConfig(),
        },
      };
    }
    case "ViviTree":
      return { tree: await readGraphqlTree(options, variables) };
    case "ViviConfig":
      return { config: options.service.getConfig() };
    case "ViviFile": {
      return {
        file: await options.service.readFile(requiredString(variables, "path")),
      };
    }
    case "ViviFileContext": {
      const requestedPath = requiredString(variables, "path");
      const includeComments = boolVariable(variables, "includeComments");
      const comments = includeComments
        ? await options.service.listComments({ path: requestedPath })
        : [];
      const commentThreads = includeComments
        ? await options.service.listCommentThreads({ path: requestedPath })
        : [];
      await observeThreadReads(
        threadReadObserver,
        commentThreads.map((thread) => thread.id),
      );
      return {
        fileContext: {
          file: await options.service.readFile(requestedPath),
          comments,
          commentThreads,
          diff: boolVariable(variables, "includeDiff")
            ? await options.service.readDiff(
                requestedPath,
                optionalString(variables, "diffBase"),
              )
            : undefined,
        },
      };
    }
    case "ViviComments": {
      const filters = graphqlCommentFilters(variables);
      const comments = await options.service.listComments(filters);
      const commentThreads = await options.service.listCommentThreads(filters);
      await observeThreadReads(
        threadReadObserver,
        commentThreads.map((thread) => thread.id),
      );
      return {
        comments,
        commentThreads,
      };
    }
    case "ViviCommentThreads": {
      const commentThreads = await options.service.listCommentThreads(
        graphqlCommentFilters(variables),
      );
      await observeThreadReads(
        threadReadObserver,
        commentThreads.map((thread) => thread.id),
      );
      return {
        commentThreads,
      };
    }
    case "ViviCommentThreadActivities":
      return {
        commentThreadActivities: (
          await options.service.listCommentThreadActivities(
            requiredString(variables, "threadId"),
            optionalString(variables, "after"),
            positiveVariable(variables, "first") ?? 100,
          )
        ).map(activityGraphqlValue),
      };
    case "ViviDraftReviewComments":
      return {
        draftReviewComments: await options.service.listDraftReviewComments({
          path: optionalString(variables, "path"),
        }),
      };
    case "ViviCommentExport":
      return {
        commentExport: {
          format: "jsonl",
          contentType: "application/x-ndjson; charset=utf-8",
          content: await options.service.exportCommentsAsJsonl(
            graphqlCommentFilters(variables),
          ),
        },
      };
    case "ViviReviewQueue":
      return { reviewQueue: await options.service.readChanges() };
    case "ViviDiffBases":
      return { diffBases: await options.service.readDiffBases() };
    case "ViviDiff":
      return {
        diff: await options.service.readDiff(
          requiredString(variables, "path"),
          optionalString(variables, "base"),
        ),
      };
    case "ViviFileSearch":
      return {
        fileSearch: await options.service.searchFiles(
          requiredString(variables, "query"),
          { limit: positiveVariable(variables, "limit") ?? 40 },
        ),
      };
    case "ViviTextSearch":
      return {
        textSearch: await options.service.searchText(
          requiredString(variables, "query"),
          { limit: positiveVariable(variables, "limit") ?? 40 },
        ),
      };
    case "ViviMeta":
      return {
        meta: {
          version: "v1",
          comments: {
            statuses: ["open", "resolved", "archived"],
            surfaces: ["source", "rendered", "diff"],
            exportFormats: ["jsonl"],
            actorKinds: ["human", "claude_code", "codex", "unknown"],
            activityTypes: [
              "thread_created",
              "thread_read",
              "comment_added",
              "comment_updated",
              "thread_status_changed",
            ],
          },
        },
      };
    case "ViviPreview": {
      const requestedPath = requiredString(variables, "path");
      return {
        htmlPreview: {
          url: `/preview/html?path=${encodeURIComponent(requestedPath)}`,
          scriptsAllowed: options.service.getConfig().allowHtmlScripts,
          transport: "http-rendering",
        },
        rawPreview: {
          url: `/preview/raw/${encodeURIComponent(requestedPath)}`,
          scriptsAllowed: false,
          transport: "http-rendering",
        },
      };
    }
    case "CreateComment":
      return {
        createComment: await options.service.createComment(
          variables.input ?? {},
        ),
      };
    case "CreateDraftReviewComment":
      return {
        createDraftReviewComment:
          await options.service.createDraftReviewComment(variables.input ?? {}),
      };
    case "UpdateDraftReviewComment":
      return {
        updateDraftReviewComment:
          await options.service.updateDraftReviewComment(
            requiredString(variables, "id"),
            variables.input ?? {},
          ),
      };
    case "DeleteDraftReviewComment":
      return {
        deleteDraftReviewComment:
          await options.service.deleteDraftReviewComment(
            requiredString(variables, "id"),
          ),
      };
    case "PublishDraftReviewComments": {
      const input = recordVariable(variables.input);
      return {
        publishDraftReviewComments:
          await options.service.publishDraftReviewComments({
            draftIds: stringArrayVariable(input.draftIds),
            actor: graphqlActor(input.actor),
          }),
      };
    }
    case "CreateThread":
      return {
        createThread: await options.service.createCommentThread(
          variables.input ?? {},
        ),
      };
    case "AddComment":
      return {
        addComment: await options.service.addComment(
          requiredString(variables, "threadId"),
          variables.input ?? {},
        ),
      };
    case "ResolveThread":
      return {
        resolveThread: await options.service.updateCommentThreadStatus({
          id: requiredString(variables, "id"),
          status: "resolved",
          actor: graphqlActor(variables.actor),
        }),
      };
    case "ArchiveThread":
      return {
        archiveThread: await options.service.updateCommentThreadStatus({
          id: requiredString(variables, "id"),
          status: "archived",
          actor: graphqlActor(variables.actor),
        }),
      };
    case "ReopenThread":
      return {
        reopenThread: await options.service.updateCommentThreadStatus({
          id: requiredString(variables, "id"),
          status: "open",
          actor: graphqlActor(variables.actor),
        }),
      };
    case "UpdateComment":
    case "UpdateCommentStatus":
      return {
        updateComment: await options.service.updateComment(
          requiredString(variables, "id"),
          variables.input ?? { status: requiredString(variables, "status") },
        ),
      };
    case "UpdateCommentThread":
    case "UpdateCommentThreadStatus":
      return {
        updateCommentThread: await options.service.updateCommentThreadStatus({
          id: requiredString(variables, "id"),
          status: requiredString(variables, "status") as CommentStatus,
          actor: graphqlActor(variables.actor),
        }),
      };
    default:
      throw new Error("unsupported GraphQL operation");
  }
}

async function readGraphqlTree(
  options: ServerOptions,
  variables: Record<string, unknown>,
) {
  const requestedPath = optionalString(variables, "path") ?? "";
  const depth = positiveVariable(variables, "depth");
  return requestedPath || depth
    ? options.service.readDirectory(requestedPath, { depth: depth ?? 1 })
    : options.service.readTree();
}

function graphqlOperation(payload: {
  operationName?: string;
  query?: string;
}): string {
  if (payload.operationName) return payload.operationName;
  for (const candidate of [
    "ViviWorkspace",
    "ViviTree",
    "ViviConfig",
    "ViviFileContext",
    "ViviFile",
    "ViviComments",
    "ViviCommentThreads",
    "ViviCommentThreadActivities",
    "ViviDraftReviewComments",
    "ViviCommentExport",
    "ViviReviewQueue",
    "ViviDiffBases",
    "ViviDiff",
    "ViviFileSearch",
    "ViviTextSearch",
    "ViviMeta",
    "ViviPreview",
    "CreateComment",
    "CreateDraftReviewComment",
    "UpdateDraftReviewComment",
    "DeleteDraftReviewComment",
    "PublishDraftReviewComments",
    "CreateThread",
    "AddComment",
    "UpdateCommentThreadStatus",
    "UpdateCommentThread",
    "UpdateCommentStatus",
    "UpdateComment",
  ]) {
    if (payload.query?.includes(candidate)) return candidate;
  }
  return "";
}

function isGraphqlMutation(operationName: string, query?: string): boolean {
  return (
    operationName === "CreateComment" ||
    operationName === "CreateDraftReviewComment" ||
    operationName === "UpdateDraftReviewComment" ||
    operationName === "DeleteDraftReviewComment" ||
    operationName === "PublishDraftReviewComments" ||
    operationName === "UpdateComment" ||
    operationName === "UpdateCommentStatus" ||
    operationName === "UpdateCommentThread" ||
    operationName === "UpdateCommentThreadStatus" ||
    query?.includes("mutation") === true
  );
}

function graphqlActor(value: unknown): CommentActor | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const actor = value as Record<string, unknown>;
  if (typeof actor.id !== "string" || !actor.id.trim()) return undefined;
  return {
    id: actor.id.trim(),
    kind:
      actor.kind === "claude_code"
        ? "claude-code"
        : actor.kind === "human" || actor.kind === "codex"
          ? actor.kind
          : "unknown",
    displayName:
      typeof actor.displayName === "string" && actor.displayName.trim()
        ? actor.displayName.trim()
        : undefined,
  };
}

function isGraphqlWorkspaceEventsRequest(input: {
  operationName?: string;
  query?: string;
}): boolean {
  return (
    input.operationName === "WorkspaceEvents" ||
    input.query?.includes("workspaceEvents") === true
  );
}

function isGraphqlCommentActivityRequest(input: {
  operationName?: string;
  query?: string;
}): boolean {
  return (
    input.operationName === "CommentThreadActivity" ||
    input.query?.includes("commentThreadActivity") === true
  );
}

function optionalGraphqlThreadId(url: URL): string | undefined {
  const raw = url.searchParams.get("variables");
  if (!raw) return undefined;
  try {
    const variables = JSON.parse(raw) as Record<string, unknown>;
    return optionalString(variables, "threadId");
  } catch {
    return undefined;
  }
}

function threadReadObserverFromRequest(
  req: IncomingMessage,
  options: ServerOptions,
): ThreadReadObserver | undefined {
  const actorId = headerText(req, "x-vivi-actor-id").trim();
  if (!actorId) return undefined;
  const actor: CommentActor = {
    id: actorId,
    kind: actorKindFromHeader(headerText(req, "x-vivi-actor-kind")),
    displayName: headerText(req, "x-vivi-actor-name") || undefined,
  };
  const clientEventId = headerText(req, "x-vivi-client-event-id") || undefined;
  const observer = compositeThreadReadObserver(
    threadReadObserverFactories(options).map((factory) =>
      factory({ actor, clientEventId, service: options.service }),
    ),
  );
  if (!observer) return undefined;
  const seen = new Set<string>();
  return {
    async observeThreadRead(threadId: string): Promise<void> {
      const normalizedThreadId = threadId.trim();
      if (!normalizedThreadId || seen.has(normalizedThreadId)) return;
      seen.add(normalizedThreadId);
      try {
        await observer.observeThreadRead(normalizedThreadId);
      } catch {
        // Activity observation must not make the read path fail.
      }
    },
  };
}

function threadReadObserverFactories(
  options: ServerOptions,
): ThreadReadObserverFactory[] {
  return (
    options.threadReadObserverFactories ?? [
      ({ actor, clientEventId, service }) => ({
        observeThreadRead(threadId: string) {
          return service.observeCommentThreadRead(
            threadId,
            actor,
            clientEventId,
          );
        },
      }),
    ]
  );
}

function compositeThreadReadObserver(
  observers: Array<ThreadReadObserver | undefined>,
): ThreadReadObserver | undefined {
  const filtered = observers.filter(
    (observer): observer is ThreadReadObserver => Boolean(observer),
  );
  if (filtered.length === 0) return undefined;
  if (filtered.length === 1) return filtered[0];
  return {
    async observeThreadRead(threadId: string): Promise<void> {
      for (const observer of filtered) {
        await observer.observeThreadRead(threadId);
      }
    },
  };
}

async function observeThreadReads(
  observer: ThreadReadObserver | undefined,
  threadIds: string[],
): Promise<void> {
  if (!observer) return;
  for (const threadId of threadIds) {
    await observer.observeThreadRead(threadId);
  }
}

function headerText(req: IncomingMessage, name: string): string {
  const value = req.headers[name];
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function actorKindFromHeader(value: string): CommentActor["kind"] {
  const kind = value === "claude_code" ? "claude-code" : value;
  if (
    kind === "human" ||
    kind === "claude-code" ||
    kind === "codex" ||
    kind === "unknown"
  ) {
    return kind;
  }
  return "unknown";
}

function activityGraphqlValue(event: CommentThreadActivityEvent) {
  return {
    ...event,
    actor: {
      ...event.actor,
      kind:
        event.actor.kind === "claude-code" ? "claude_code" : event.actor.kind,
    },
  };
}

function graphqlCommentFilters(
  variables: Record<string, unknown>,
): CommentListFilters {
  return normalizeCommentFilters({
    path: optionalString(variables, "path") ?? null,
    status: optionalString(variables, "status") ?? null,
    reviewBatchId: optionalString(variables, "reviewBatchId") ?? null,
  });
}

async function serveSpa(
  req: IncomingMessage,
  res: ServerResponse,
  staticDir?: string,
): Promise<void> {
  const base = staticDir ?? defaultStaticDir();
  const requested =
    req.url && req.url !== "/" ? req.url.split("?")[0] : "/index.html";
  const filePath = resolveStaticAssetPath(base, requested);
  if (!filePath) {
    sendJson(res, 400, { error: "static path escapes root" });
    return;
  }
  try {
    const content = await readFile(filePath);
    res.writeHead(200, { "content-type": contentTypeFor(filePath) });
    res.end(content);
  } catch {
    const content = await readFile(path.join(base, "index.html"));
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(content);
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > 1024 * 1024) throw new Error("request body too large");
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) throw new Error("JSON request body is required");
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("invalid JSON request body");
  }
}

function assertSafeJsonWriteRequest(
  req: IncomingMessage,
  options: ServerOptions,
): void {
  const contentType = req.headers["content-type"];
  if (
    typeof contentType !== "string" ||
    !contentType.toLowerCase().includes("application/json")
  ) {
    throw new Error("comment write APIs require application/json");
  }

  const hostHeader = req.headers.host;
  const hostName = hostHeader?.split(":")[0]?.replace(/^\[|\]$/g, "");
  if (!hostName || !isAllowedWriteHost(hostName, options.host)) {
    throw new Error("invalid Host header for local write API");
  }

  const origin = req.headers.origin;
  if (typeof origin === "string" && origin) {
    const originUrl = new URL(origin);
    if (originUrl.host !== hostHeader) {
      throw new Error("invalid Origin header for local write API");
    }
  }
}

function parsePositiveInt(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function optionalString(
  variables: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = variables[key];
  return typeof value === "string" ? value : undefined;
}

function requiredString(
  variables: Record<string, unknown>,
  key: string,
): string {
  const value = optionalString(variables, key)?.trim();
  if (!value) throw new Error(`${key} is required`);
  return value;
}

function boolVariable(
  variables: Record<string, unknown>,
  key: string,
): boolean {
  return variables[key] === true;
}

function recordVariable(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringArrayVariable(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === "string");
}

function positiveVariable(
  variables: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = variables[key];
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return Math.floor(value);
}

function statusForPublicError(message: string): number | null {
  if (message === "file is too large to preview") return 413;
  if (
    message === "path is not a file" ||
    message === "path is not an HTML file"
  )
    return 404;
  if (
    [
      "path contains invalid characters",
      "absolute paths are not allowed",
      "path escapes root",
      "path is ignored",
      "path is excluded",
      "file path is required",
      "request body too large",
      "JSON request body is required",
      "invalid JSON request body",
      "comment write APIs require application/json",
      "invalid Host header for local write API",
      "invalid Origin header for local write API",
      "comment id is required",
      "thread id is required",
      "draft id is required",
      "client event id must be a string",
      "path is required",
      "body is required",
      "lineStart must be positive",
      "lineEnd must be positive",
      "lineEnd must be greater than or equal to lineStart",
      "diff line range is invalid",
      "only target comment writes may be observed",
      "target comment id does not match request",
    ].includes(message)
  ) {
    return 400;
  }
  return null;
}

function normalizeHttpError(error: unknown): {
  httpStatus: number;
  message: string;
  reason: string;
  status: string;
} {
  const code =
    error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code)
      : "";
  const message = error instanceof Error ? error.message : "unknown error";
  const fsReason = reasonForFileSystemCode(code);
  if (fsReason) {
    return {
      httpStatus: statusForFileSystemCode(code),
      message: "filesystem error",
      reason: fsReason,
      status: code,
    };
  }
  const publicStatus = statusForPublicError(message);
  if (!publicStatus) {
    return {
      httpStatus: 500,
      message: "internal server error",
      reason: "An internal error occurred.",
      status: "internal_error",
    };
  }
  return {
    httpStatus: publicStatus,
    message,
    reason: message,
    status: "request_error",
  };
}

function logHttpError(
  req: IncomingMessage,
  normalized: ReturnType<typeof normalizeHttpError>,
  error: unknown,
): void {
  const method = req.method ?? "GET";
  const target = req.url ?? "/";
  const message = `[vivi] ${method} ${target} failed with ${normalized.httpStatus}: ${normalized.reason}`;
  if (normalized.httpStatus >= 500) {
    console.error("%s", message, error);
    return;
  }
  console.warn("%s", message);
}

function reasonForFileSystemCode(code: string): string | null {
  if (code === "ENOENT") return "The requested path does not exist.";
  if (code === "ENOTDIR") return "A path segment is not a directory.";
  if (code === "EISDIR") return "The requested path is a directory.";
  if (code === "EACCES" || code === "EPERM")
    return "The requested path cannot be read due to filesystem permissions.";
  return null;
}

function statusForFileSystemCode(code: string): number {
  if (code === "ENOENT" || code === "ENOTDIR") return 404;
  if (code === "EISDIR") return 400;
  if (code === "EACCES" || code === "EPERM") return 403;
  return 500;
}

function isAllowedWriteHost(hostName: string, configuredHost: string): boolean {
  if (hostName === configuredHost) return true;
  return (
    hostName === "localhost" ||
    hostName === "127.0.0.1" ||
    hostName === "::1" ||
    hostName === "0.0.0.0"
  );
}

function defaultStaticDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, "../ui"),
    path.resolve(process.cwd(), "ui/dist"),
    process.cwd(),
  ];
  return (
    candidates.find((candidate) =>
      existsSync(path.join(candidate, "index.html")),
    ) ?? candidates[0]
  );
}

function isInside(root: string, target: string): boolean {
  const relative = path.relative(path.resolve(root), target);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

function resolveStaticAssetPath(
  root: string,
  requestedPath: string,
): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(requestedPath);
  } catch {
    return null;
  }
  const normalized = normalizeRelativePath(
    decoded === "/" ? "index.html" : decoded.replace(/^\/+/, ""),
  );
  if (!normalized.ok) return null;
  const relativePath = normalized.relativePath || "index.html";
  const absolutePath = path.join(path.resolve(root), relativePath);
  return isInside(root, absolutePath) ? absolutePath : null;
}

function htmlPreviewCsp(allowHtmlScripts: boolean, nonce: string): string {
  const base = [
    "default-src 'self' data: blob:",
    "object-src 'none'",
    "base-uri 'self'",
  ];
  base.push("style-src 'self' 'unsafe-inline'");
  base.push(
    allowHtmlScripts
      ? "script-src 'self' 'unsafe-inline'"
      : `script-src 'nonce-${nonce}'`,
  );
  base.push("sandbox allow-same-origin allow-scripts");
  return base.join("; ");
}

function withPreviewBase(html: string, relativePath: string): string {
  const directory = path.posix.dirname(relativePath.split(path.sep).join("/"));
  const encodedDirectory = directory
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const basePath =
    directory === "." ? "/preview/raw/" : `/preview/raw/${encodedDirectory}/`;
  const base = `<base href="${basePath}">`;
  if (/<base\s/i.test(html)) return html;
  const headStart = findOpeningTagStart(html, "head");
  if (headStart !== -1) {
    const headEnd = findTagEnd(html, headStart);
    if (headEnd !== -1)
      return `${html.slice(0, headEnd + 1)}${base}${html.slice(headEnd + 1)}`;
  }
  const htmlStart = findOpeningTagStart(html, "html");
  if (htmlStart !== -1) {
    const htmlEnd = findTagEnd(html, htmlStart);
    if (htmlEnd !== -1)
      return `${html.slice(0, htmlEnd + 1)}<head>${base}</head>${html.slice(htmlEnd + 1)}`;
  }
  return `<head>${base}</head>${html}`;
}

function addHtmlHeadingIds(html: string): string {
  const lower = html.toLowerCase();
  if (!lower.includes("<h1") && !lower.includes("<h2")) return html;
  const used = new Map<string, number>();
  let output = "";
  let index = 0;
  while (index < html.length) {
    const start = findNextHeadingStart(html, index);
    if (start === -1) {
      output += html.slice(index);
      break;
    }
    output += html.slice(index, start);
    const level = html[start + 2];
    const tagEnd = findTagEnd(html, start);
    if (tagEnd === -1 || (level !== "1" && level !== "2")) {
      output += html.slice(start);
      break;
    }
    const openingTag = html.slice(start, tagEnd + 1);
    const closingTag = `</h${level}>`;
    const closeStart = html.toLowerCase().indexOf(closingTag, tagEnd + 1);
    if (closeStart === -1) {
      output += openingTag;
      index = tagEnd + 1;
      continue;
    }
    const innerHtml = html.slice(tagEnd + 1, closeStart);
    if (/\sid\s*=/i.test(openingTag)) {
      output += html.slice(start, closeStart + closingTag.length);
      index = closeStart + closingTag.length;
      continue;
    }
    const text = htmlToText(innerHtml).trim();
    const base = slugify(text) || `heading-${used.size + 1}`;
    const count = used.get(base) ?? 0;
    used.set(base, count + 1);
    const id = count === 0 ? base : `${base}-${count + 1}`;
    output += `${addAttributeToOpeningTag(openingTag, `id="${escapeAttribute(id)}"`)}${innerHtml}${html.slice(closeStart, closeStart + closingTag.length)}`;
    index = closeStart + closingTag.length;
  }
  return output;
}

function findNextHeadingStart(html: string, from: number): number {
  const first = findOpeningTagStart(html, "h1", from);
  const second = findOpeningTagStart(html, "h2", from);
  if (first === -1) return second;
  if (second === -1) return first;
  return Math.min(first, second);
}

function addAttributeToOpeningTag(tag: string, attribute: string): string {
  const suffix = /\/\s*>$/.test(tag) ? "/>" : ">";
  const body = tag.slice(0, -suffix.length).trimEnd();
  return `${body} ${attribute}${suffix}`;
}

function renderEmbeddedMermaidPreviewHtml(
  html: string,
  options: {
    enabled: boolean;
    allowHtmlScripts: boolean;
    nonce: string;
    theme: MermaidPreviewTheme;
    path: string;
  },
): string {
  if (options.enabled && !hasClosedMermaidCandidate(html)) {
    return injectHtmlPreviewRuntime(html, {
      includeMermaidRuntime: false,
      nonce: options.nonce,
      theme: options.theme,
      path: options.path,
    });
  }
  let index = 0;
  const rendered = options.enabled
    ? replaceHtmlElementBlocks(
        html,
        new Set(["pre", "div", "code"]),
        ({ match, attributes, innerHtml }) => {
          if (!hasMermaidClass(attributes)) return match;
          const source = htmlToText(innerHtml).trim();
          if (!source) return match;
          const id = `vivi-html-mermaid-${index}`;
          index += 1;
          const scriptStatus = options.allowHtmlScripts
            ? "user scripts active"
            : "user scripts inactive";
          const commentAttributes = htmlCommentBlockAttributes(attributes);
          return `<figure class="html-mermaid" id="${id}" data-vivi-html-mermaid data-mermaid-status="pending" data-mermaid-custom-style="${hasCustomMermaidStyle(source) ? "true" : "false"}" data-mermaid-source="${escapeAttribute(source)}"${commentAttributes}><figcaption>Mermaid preview · ${scriptStatus}</figcaption><div class="mermaid-render-target" aria-live="polite"></div><div class="markdown-mermaid-fallback unsupported"><p>Mermaid preview is loading. Source is shown below if rendering fails.</p><details class="markdown-mermaid-source"><summary>Mermaid source</summary><pre><code>${escapeHtml(source)}</code></pre></details></div></figure>`;
        },
      )
    : html;
  return injectHtmlPreviewRuntime(rendered, {
    includeMermaidRuntime: options.enabled && index > 0,
    nonce: options.nonce,
    theme: options.theme,
    path: options.path,
  });
}

function replaceHtmlElementBlocks(
  html: string,
  tagNames: Set<string>,
  replaceBlock: (block: {
    match: string;
    tagName: string;
    attributes: string;
    innerHtml: string;
  }) => string,
): string {
  let output = "";
  let index = 0;
  while (index < html.length) {
    const tagStart = html.indexOf("<", index);
    if (tagStart === -1) {
      output += html.slice(index);
      break;
    }
    output += html.slice(index, tagStart);
    const tagEnd = findTagEnd(html, tagStart);
    if (tagEnd === -1) {
      output += html.slice(tagStart);
      break;
    }
    const openingTag = html.slice(tagStart, tagEnd + 1);
    const tagName = tagNameFromOpeningTag(openingTag);
    if (!tagName || !tagNames.has(tagName) || isSelfClosingTag(openingTag)) {
      output += openingTag;
      index = tagEnd + 1;
      continue;
    }
    const closeStart = findClosingTagStart(html, tagName, tagEnd + 1);
    if (closeStart === -1) {
      output += openingTag;
      index = tagEnd + 1;
      continue;
    }
    const closeEnd = findTagEnd(html, closeStart);
    if (closeEnd === -1) {
      output += html.slice(tagStart);
      break;
    }
    output += replaceBlock({
      match: html.slice(tagStart, closeEnd + 1),
      tagName,
      attributes: openingTagAttributes(openingTag, tagName),
      innerHtml: html.slice(tagEnd + 1, closeStart),
    });
    index = closeEnd + 1;
  }
  return output;
}

function htmlCommentBlockAttributes(attributes: string): string {
  return [
    /\sdata-vivi-comment-block-id="[^"]*"/i.exec(attributes)?.[0],
    /\sdata-vivi-source-line-start="\d+"/i.exec(attributes)?.[0],
    /\sdata-vivi-source-line-end="\d+"/i.exec(attributes)?.[0],
  ]
    .filter(Boolean)
    .join("");
}

function hasMermaidClass(attributes: string): boolean {
  const match = /\sclass\s*=\s*(["'])(.*?)\1/i.exec(attributes);
  return Boolean(match?.[2].split(/\s+/).includes("mermaid"));
}

function hasClosedMermaidCandidate(html: string): boolean {
  const lower = html.toLowerCase();
  if (!lower.includes("mermaid")) return false;
  return (
    lower.includes("</pre>") ||
    lower.includes("</div>") ||
    lower.includes("</code>")
  );
}

function htmlToText(html: string): string {
  return stripHtmlTags(html)
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function stripHtmlTags(html: string): string {
  let output = "";
  let index = 0;
  while (index < html.length) {
    const tagStart = html.indexOf("<", index);
    if (tagStart === -1) {
      output += html.slice(index);
      break;
    }
    output += html.slice(index, tagStart);
    const tagEnd = findTagEnd(html, tagStart);
    if (tagEnd === -1) break;
    const rawTag = html.slice(tagStart, tagEnd + 1);
    const tagName = tagNameFromOpeningTag(rawTag);
    if (tagName === "script" || tagName === "style") {
      const closeTag = `</${tagName}>`;
      const closeStart = html.toLowerCase().indexOf(closeTag, tagEnd + 1);
      index = closeStart === -1 ? tagEnd + 1 : closeStart + closeTag.length;
      continue;
    }
    if (/^<br\s*\/?>$/i.test(rawTag)) output += "\n";
    index = tagEnd + 1;
  }
  return output;
}

function findTagEnd(html: string, start: number): number {
  let quote: string | null = null;
  for (let index = start + 1; index < html.length; index += 1) {
    const character = html[index];
    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === `"` || character === `'`) {
      quote = character;
      continue;
    }
    if (character === ">") return index;
  }
  return -1;
}

function tagNameFromOpeningTag(tag: string): string | null {
  const trimmed = tag.slice(1).trimStart();
  let name = "";
  for (const character of trimmed) {
    if (!/[a-z0-9]/i.test(character)) break;
    name += character.toLowerCase();
  }
  return name || null;
}

function openingTagAttributes(tag: string, tagName: string): string {
  const body = tag.slice(1, tag.endsWith(">") ? -1 : undefined).trim();
  return body.slice(tagName.length).replace(/\/\s*$/, "");
}

function isSelfClosingTag(tag: string): boolean {
  return tag.slice(0, -1).trimEnd().endsWith("/");
}

function findOpeningTagStart(html: string, tagName: string, from = 0): number {
  const lower = html.toLowerCase();
  const needle = `<${tagName.toLowerCase()}`;
  let index = from;
  while (index < lower.length) {
    const found = lower.indexOf(needle, index);
    if (found === -1) return -1;
    const boundary = lower[found + needle.length];
    if (boundary === undefined || boundary === ">" || /\s/.test(boundary)) {
      return found;
    }
    index = found + 1;
  }
  return -1;
}

function findClosingTagStart(html: string, tagName: string, from = 0): number {
  const lower = html.toLowerCase();
  const needle = `</${tagName.toLowerCase()}`;
  let index = from;
  while (index < lower.length) {
    const found = lower.indexOf(needle, index);
    if (found === -1) return -1;
    const boundary = lower[found + needle.length];
    if (boundary === undefined || boundary === ">" || /\s/.test(boundary)) {
      return found;
    }
    index = found + 1;
  }
  return -1;
}

function injectHtmlPreviewRuntime(
  html: string,
  options: {
    includeMermaidRuntime: boolean;
    nonce: string;
    theme: MermaidPreviewTheme;
    path: string;
  },
): string {
  if (/data-vivi-mermaid-preview/i.test(html)) return html;
  const palette = htmlPreviewPalette(options.theme);
  const styles = `<style data-vivi-mermaid-preview data-vivi-html-theme="${options.theme}">
	html{color-scheme:${options.theme};}
	.html-mermaid{margin:18px 0;}
	.html-mermaid figcaption,.markdown-mermaid-source summary{color:${palette.muted};font-size:12px;}
	.mermaid-render-target{overflow:auto;border:1px solid ${palette.line};border-radius:8px;background:${palette.panel};padding:14px;}
.mermaid-render-target svg{display:block;max-width:100%;height:auto;}
.html-mermaid[data-mermaid-status="rendered"] .markdown-mermaid-fallback{display:none;}
.markdown-mermaid-source{margin-top:10px;}
.markdown-mermaid-source summary{cursor:pointer;}
.markdown-mermaid-source pre{overflow:auto;border:1px solid ${palette.line};border-radius:8px;background:${palette.codeBackground};color:${palette.codeText};padding:10px;}
.html-mermaid.unsupported{border:1px solid ${palette.line};border-radius:8px;background:${palette.panel};padding:12px;}
		.vivi-rendered-comment-block{--rendered-comment-block-left:0px;--rendered-comment-block-right:0px;--vivi-rendered-soft-line:${palette.softLine};--vivi-rendered-panel:${palette.panel};--vivi-rendered-palette:${palette.background};--vivi-rendered-comment-tint:${palette.commentTint};--vivi-rendered-comment-tint-active:${palette.commentTintActive};--vivi-rendered-comment-line:${palette.commentLine};--vivi-rendered-comment-text:${palette.commentText};isolation:isolate;position:relative;z-index:0;border-radius:8px;transition:background 140ms ease,box-shadow 140ms ease;}
	li.vivi-rendered-comment-block{--rendered-comment-block-left:calc(-1.45em);}
	.vivi-rendered-comment-block:not(tr)::before{content:"";position:absolute;z-index:0;top:0;right:var(--rendered-comment-block-right);bottom:0;left:var(--rendered-comment-block-left);border-radius:inherit;pointer-events:none;transition:background 140ms ease,box-shadow 140ms ease;}
	.vivi-rendered-comment-block:not(tr)>*{position:relative;z-index:1;}
		.vivi-rendered-comment-block.hover-rendered-comment-block:not(tr)::before,tr.vivi-rendered-comment-block.hover-rendered-comment-block{background:var(--vivi-rendered-soft-line);}
		.vivi-rendered-comment-block.has-rendered-comment,.vivi-rendered-comment-block.drafting-rendered-comment{border-radius:8px;}
		.vivi-rendered-comment-block.has-rendered-comment:not(tr),.vivi-rendered-comment-block.drafting-rendered-comment:not(tr){background:transparent;box-shadow:none;}
		blockquote.vivi-rendered-comment-block.has-rendered-comment,blockquote.vivi-rendered-comment-block.drafting-rendered-comment,blockquote.vivi-rendered-comment-block.active-rendered-comment{border-left-color:transparent!important;}
			.vivi-rendered-comment-block.has-rendered-comment:not(tr)::before,.vivi-rendered-comment-block.drafting-rendered-comment:not(tr)::before,tr.vivi-rendered-comment-block.has-rendered-comment,tr.vivi-rendered-comment-block.drafting-rendered-comment{background:linear-gradient(90deg,var(--vivi-rendered-comment-tint-active),color-mix(in srgb,var(--vivi-rendered-comment-tint) 56%,transparent) 68%,transparent);box-shadow:inset 2px 0 0 var(--vivi-rendered-comment-line);}
	.vivi-rendered-comment-block.active-rendered-comment{background:transparent;box-shadow:none;}
		.vivi-rendered-comment-block.active-rendered-comment:not(tr)::before,tr.vivi-rendered-comment-block.active-rendered-comment{background:linear-gradient(90deg,color-mix(in srgb,var(--vivi-rendered-comment-tint-active) 86%,white),var(--vivi-rendered-comment-tint) 72%,transparent);box-shadow:inset 3px 0 0 var(--vivi-rendered-comment-text),0 0 0 1px color-mix(in srgb,var(--vivi-rendered-comment-line) 46%,transparent);}
	.vivi-rendered-comment-block.rendered-comment-range-start.has-rendered-comment,.vivi-rendered-comment-block.rendered-comment-range-start.drafting-rendered-comment{border-bottom-left-radius:0;border-bottom-right-radius:0;}
	.vivi-rendered-comment-block.rendered-comment-range-middle.has-rendered-comment,.vivi-rendered-comment-block.rendered-comment-range-middle.drafting-rendered-comment{border-radius:0;}
	.vivi-rendered-comment-block.rendered-comment-range-end.has-rendered-comment,.vivi-rendered-comment-block.rendered-comment-range-end.drafting-rendered-comment{border-top-left-radius:0;border-top-right-radius:0;}
		.vivi-rendered-comment-block.rendered-comment-range-join-after:not(tr)::after{content:"";position:absolute;z-index:1;left:var(--rendered-comment-block-left);right:var(--rendered-comment-block-right);top:100%;height:var(--rendered-comment-join-after,0);pointer-events:none;background:linear-gradient(90deg,var(--vivi-rendered-comment-tint-active),color-mix(in srgb,var(--vivi-rendered-comment-tint) 56%,transparent) 68%,transparent);}
		.vivi-rendered-comment-block.active-rendered-comment.rendered-comment-range-join-after:not(tr)::after{background:linear-gradient(90deg,color-mix(in srgb,var(--vivi-rendered-comment-tint-active) 86%,white),var(--vivi-rendered-comment-tint) 72%,transparent);}
		.rendered-comment-marker{position:absolute;z-index:2147483646;top:calc(50% + 1px);right:8px;width:20px;height:20px;border:1px solid var(--vivi-rendered-comment-line);border-radius:6px;background:var(--vivi-rendered-panel);color:var(--vivi-rendered-comment-text);box-shadow:0 5px 14px rgba(0,0,0,.22);cursor:pointer;padding:0;transform:translateY(-50%);transition:background 140ms ease,border-color 140ms ease,transform 140ms ease;}
	.rendered-comment-marker::before{content:"";position:absolute;left:5px;top:5px;width:7px;height:6px;border:1.25px solid currentColor;border-radius:3px;}
	.rendered-comment-marker::after{content:"";position:absolute;left:7px;top:10px;width:3px;height:3px;border-left:1.25px solid currentColor;transform:skew(-22deg);}
		.rendered-comment-marker:hover,.rendered-comment-marker:focus-visible{outline:none;background:var(--vivi-rendered-comment-tint-active);border-color:var(--vivi-rendered-comment-text);transform:translateY(calc(-50% - 1px));}
		.rendered-comment-marker-count{position:absolute;right:-5px;top:-6px;display:grid;place-items:center;min-width:13px;height:13px;border:1px solid var(--vivi-rendered-comment-line);border-radius:999px;background:var(--vivi-rendered-palette);color:var(--vivi-rendered-comment-text);font-size:8px;font-weight:800;line-height:1;padding:0 2px;}
.vivi-rendered-comment-action-host{position:relative;}
</style>`;
  const selectionBridge = `<script nonce="${escapeAttribute(options.nonce)}">
(() => {
  const path = ${JSON.stringify(options.path)};
  const blockSelector = "[data-vivi-comment-block-id]";
  const interactiveSelector = "input,select,textarea,[contenteditable]";
  const layoutContainerBlockTags = new Set(["main", "section", "article", "nav", "aside", "header", "footer", "figure"]);
  let renderedComments = [];
  let activeCommentId = null;
  let draftingBlockIds = [];
  let openBlockIds = [];
  let openBlockIdGroups = [];
  let hoveredBlock = null;
  let pendingRenderedThreadOpen = false;
  const post = (message) => parent.postMessage({ path, ...message }, "*");
  const cssPath = (element) => {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return undefined;
    if (element.id && globalThis.CSS?.escape) return "#" + CSS.escape(element.id);
    const parts = [];
    let current = element;
    while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.body) {
      const name = current.localName;
      const parent = current.parentElement;
      if (!parent) break;
      const siblings = Array.from(parent.children).filter((item) => item.localName === name);
      const index = siblings.indexOf(current) + 1;
      parts.unshift(siblings.length > 1 ? \`\${name}:nth-of-type(\${index})\` : name);
      current = parent;
    }
    return parts.join(">");
  };
  const readableText = (element) => {
    const clone = element?.cloneNode(true);
    clone?.querySelectorAll?.(".rendered-comment-marker").forEach((item) => item.remove());
    return (clone?.innerText || clone?.textContent || "").replace(/\\s+/g, " ").trim();
  };
  const rectLikeForBlocks = (blocks) => {
    if (!blocks.length) return null;
    const first = blocks[0].getBoundingClientRect();
    const last = blocks[blocks.length - 1].getBoundingClientRect();
    const left = Math.min(first.left, last.left);
    const top = Math.min(first.top, last.top);
    const right = Math.max(first.right, last.right);
    const bottom = Math.max(first.bottom, last.bottom);
    return { left, top, width: right - left, height: bottom - top };
  };
  const isLayoutContainerBlock = (element) =>
    element?.matches?.(blockSelector) &&
    layoutContainerBlockTags.has(element.localName) &&
    Boolean(element.querySelector(blockSelector));
  const isCommentableBlock = (element) =>
    element?.matches?.(blockSelector) && !isLayoutContainerBlock(element);
  const renderedThreadOpen = () => pendingRenderedThreadOpen || openBlockIds.length > 0 || draftingBlockIds.length > 0;
  const closestBlock = (target) => {
    if (!target || target.nodeType !== Node.ELEMENT_NODE) return null;
    let element = target;
    while (element && element.nodeType === Node.ELEMENT_NODE && element !== document.documentElement) {
      if (isCommentableBlock(element)) return element;
      element = element.parentElement;
    }
    return null;
  };
  const commentableBlocks = () => Array.from(document.querySelectorAll(blockSelector)).filter(isCommentableBlock);
  const setHoveredBlock = (block) => {
    if (hoveredBlock === block) return;
    hoveredBlock?.classList.remove("hover-rendered-comment-block");
    hoveredBlock = block;
    hoveredBlock?.classList.add("hover-rendered-comment-block");
  };
  const shouldProjectSourceRange = (closest, blocks) => blocks.length > 1 && blocks.includes(closest) && blocks.some((block) => block !== closest && !closest.contains(block));
  const sourceRange = (blocks) => {
    const starts = blocks.map((block) => Number(block.dataset.viviSourceLineStart)).filter(Number.isInteger);
    const ends = blocks.map((block) => Number(block.dataset.viviSourceLineEnd || block.dataset.viviSourceLineStart)).filter(Number.isInteger);
    return starts.length && ends.length ? { sourceLineStart: starts[0], sourceLineEnd: ends[ends.length - 1] } : {};
  };
  const targetForBlocks = (blocks, selectedText) => {
    const targets = blocks.filter((block) => block.dataset.viviCommentBlockId);
    if (!targets.length) return null;
    const text = selectedText?.trim() || targets.map(readableText).join("\\n");
    const rect = rectLikeForBlocks(targets);
    if (!text || !rect) return null;
    return {
      blockId: targets[0].dataset.viviCommentBlockId,
      blockIds: targets.map((block) => block.dataset.viviCommentBlockId),
      selector: cssPath(targets[0]),
      text,
      rect,
      ...sourceRange(targets)
    };
  };
  const findBlocksForComment = (comment) => {
    const byRange = Number.isInteger(comment.sourceLineStart)
      ? commentableBlocks().filter((block) => {
          const start = Number(block.dataset.viviSourceLineStart);
          const end = Number(block.dataset.viviSourceLineEnd);
          const commentEnd = Number.isInteger(comment.sourceLineEnd) ? comment.sourceLineEnd : comment.sourceLineStart;
          return Number.isInteger(start) && Number.isInteger(end) && start <= commentEnd && end >= comment.sourceLineStart;
        })
      : [];
    if (comment.blockId) {
      const byBlock = document.querySelector(\`[data-vivi-comment-block-id="\${escapeSelectorValue(comment.blockId)}"]\`);
      const closest = byBlock ? closestBlock(byBlock) : null;
      if (closest) {
        const spansMultipleLines = Number.isInteger(comment.sourceLineStart) && Number.isInteger(comment.sourceLineEnd) && comment.sourceLineEnd > comment.sourceLineStart;
        if (spansMultipleLines && shouldProjectSourceRange(closest, byRange)) return byRange;
        return [closest];
      }
    }
    if (comment.selector) {
      try {
        const bySelector = document.querySelector(comment.selector);
        if (bySelector?.matches(blockSelector)) return [bySelector];
        const nearest = bySelector?.closest(blockSelector);
        if (nearest) return [nearest];
      } catch {}
    }
    if (byRange.length) return byRange;
    const quote = comment.textQuote?.trim();
    const byQuote = quote ? Array.from(document.querySelectorAll(blockSelector)).find((block) => readableText(block).includes(quote)) ?? null : null;
    return byQuote ? [byQuote] : [];
  };
  const actionLabel = (count) => \`Open comment thread with \${count} \${count === 1 ? "message" : "messages"}\`;
  const removeAction = (block) => {
    block.querySelectorAll(".rendered-comment-marker").forEach((action) => action.remove());
    block.classList.remove("vivi-rendered-comment-action-host");
    block.lastElementChild?.classList.remove("vivi-rendered-comment-action-host");
  };
  const ensureAction = (block, count) => {
    const host = block.localName === "tr" && block.lastElementChild ? block.lastElementChild : block;
    if (host !== block) host.classList.add("vivi-rendered-comment-action-host");
    const action = document.createElement("button");
    action.type = "button";
    action.className = "rendered-comment-marker";
    action.dataset.commentCount = String(count);
    action.setAttribute("aria-label", actionLabel(count));
    action.title = actionLabel(count);
    const countNode = document.createElement("span");
    countNode.className = "rendered-comment-marker-count";
    countNode.setAttribute("aria-hidden", "true");
    countNode.textContent = String(count);
    action.append(countNode);
    host.append(action);
    return action;
  };
	  const pixelValue = (value) => {
	    const parsed = Number.parseFloat(value);
	    return Number.isFinite(parsed) ? parsed : 0;
	  };
	  const applyRangeBridge = (blocks) => {
	    if (blocks.length < 2) return;
	    const bounds = blocks.map((block) => {
	      const rect = block.getBoundingClientRect();
	      const before = getComputedStyle(block, "::before");
	      return {left: rect.left + pixelValue(before.left), right: rect.right - pixelValue(before.right)};
	    });
	    const rangeLeft = Math.min(...bounds.map((bound) => bound.left));
	    const rangeRight = Math.max(...bounds.map((bound) => bound.right));
	    blocks.forEach((block, index) => {
	      const rect = block.getBoundingClientRect();
	      block.style.setProperty("--rendered-comment-block-left", \`\${Math.round(rangeLeft - rect.left)}px\`);
	      block.style.setProperty("--rendered-comment-block-right", \`\${Math.round(rect.right - rangeRight)}px\`);
	      block.classList.add(index === 0 ? "rendered-comment-range-start" : index === blocks.length - 1 ? "rendered-comment-range-end" : "rendered-comment-range-middle");
	      const next = blocks[index + 1];
	      if (!next) return;
	      const gap = Math.max(0, Math.round(next.getBoundingClientRect().top - block.getBoundingClientRect().bottom));
	      if (gap <= 1) return;
	      block.classList.add("rendered-comment-range-join-after");
	      block.style.setProperty("--rendered-comment-join-after", \`\${gap}px\`);
	    });
	  };
  const bindBlockAction = (block) => {
    if (block.dataset.viviCommentClickBound === "true") return;
    block.dataset.viviCommentClickBound = "true";
    block.addEventListener("click", (event) => {
      if (event.target.closest?.(".rendered-comment-marker")) return;
      if (event.target.closest?.(interactiveSelector)) return;
      if (document.getSelection()?.toString().trim()) return;
      if (!hasRenderedCommentModifier(event)) return;
      event.preventDefault();
      event.stopPropagation();
      const target = targetForBlocks([block]);
      postTarget(target);
    });
  };
  const applyHighlights = () => {
    const blocks = commentableBlocks();
    blocks.forEach((block) => {
      bindBlockAction(block);
      block.classList.add("vivi-rendered-comment-block");
	      block.classList.remove("has-rendered-comment", "active-rendered-comment", "drafting-rendered-comment", "hover-rendered-comment-block", "rendered-comment-range-start", "rendered-comment-range-middle", "rendered-comment-range-end", "rendered-comment-range-join-after");
	      block.style.removeProperty("--rendered-comment-block-left");
	      block.style.removeProperty("--rendered-comment-block-right");
	      block.style.removeProperty("--rendered-comment-join-after");
      delete block.dataset.viviCommentId;
      delete block.dataset.viviCommentCount;
      removeAction(block);
    });
    const commentsByBlock = new Map();
    const markerCommentsByBlock = new Map();
    for (const comment of renderedComments) {
      const commentBlocks = findBlocksForComment(comment);
      applyRangeBridge(commentBlocks);
      for (const block of commentBlocks) {
        const list = commentsByBlock.get(block) || [];
        list.push(comment);
        commentsByBlock.set(block, list);
      }
      const markerBlock = commentBlocks[commentBlocks.length - 1];
      if (markerBlock) {
        const list = markerCommentsByBlock.get(markerBlock) || [];
        list.push(comment);
        markerCommentsByBlock.set(markerBlock, list);
      }
    }
    for (const [block, comments] of commentsByBlock) {
      const firstComment = comments[0];
      block.classList.add("has-rendered-comment");
      if (comments.some((comment) => comment.id === activeCommentId)) block.classList.add("active-rendered-comment");
      block.dataset.viviCommentId = firstComment.id;
      block.dataset.viviCommentCount = String(comments.length);
    }
    for (const [block, comments] of markerCommentsByBlock) {
      const action = ensureAction(block, comments.length);
      action.dataset.commentId = comments[0].id;
    }
    const drafting = blocks.filter((block) => draftingBlockIds.includes(block.dataset.viviCommentBlockId));
    applyRangeBridge(drafting);
    drafting.forEach((block) => block.classList.add("drafting-rendered-comment"));
    postThreadLayout();
  };
  const postTarget = (target, type = "vivi-html-block-target", id) => {
    if (!target) return;
    if (type === "vivi-html-block-target" || type === "vivi-html-comment-open") {
      pendingRenderedThreadOpen = true;
      setHoveredBlock(null);
    }
    post({ type, id, ...target });
  };
  const postThreadLayout = () => {
    if (!openBlockIds.length) return;
    const groups = openBlockIdGroups.length ? openBlockIdGroups : [openBlockIds];
    for (const group of groups) {
      const byId = new Set(group);
      const blocks = commentableBlocks().filter((block) => byId.has(block.dataset.viviCommentBlockId));
      const target = targetForBlocks(blocks);
      if (target) post({ type: "vivi-html-thread-layout", blockIds: target.blockIds, rect: target.rect });
    }
  };
  const publishSelection = () => {
    const selection = document.getSelection();
    if (!selection?.toString().trim() || !selection.rangeCount) return;
    const range = selection.getRangeAt(0);
    const blocks = commentableBlocks().filter((block) => {
      try { return range.intersectsNode(block); } catch { return false; }
    });
    postTarget(targetForBlocks(blocks, selection.toString()));
  };
  const publishSoon = () => {
    window.requestAnimationFrame(() => window.setTimeout(publishSelection, 0));
  };
  const hasRenderedCommentModifier = (event) =>
    event.altKey || event.ctrlKey || event.metaKey;
  window.addEventListener("message", (event) => {
    if (event.source && event.source !== parent) return;
    const data = event.data;
    if (data?.type !== "vivi-html-comments" || data.path !== path) return;
    renderedComments = Array.isArray(data.comments) ? data.comments : [];
    activeCommentId = typeof data.activeCommentId === "string" ? data.activeCommentId : null;
    draftingBlockIds = Array.isArray(data.draftingBlockIds) ? data.draftingBlockIds : [];
    openBlockIds = Array.isArray(data.openBlockIds) ? data.openBlockIds : [];
    openBlockIdGroups = Array.isArray(data.openBlockIdGroups) ? data.openBlockIdGroups.filter((group) => Array.isArray(group)) : [];
    pendingRenderedThreadOpen = false;
    if (renderedThreadOpen()) setHoveredBlock(null);
    applyHighlights();
  });
  document.addEventListener("click", (event) => {
    const marker = event.target.closest?.(".rendered-comment-marker");
    const block = closestBlock(marker || event.target);
    if (marker) {
      event.preventDefault();
      event.stopPropagation();
      const target = targetForBlocks(block ? [block] : []);
      postTarget(target, "vivi-html-comment-open", marker.dataset.commentId);
      return;
    }
    if (!block) {
      pendingRenderedThreadOpen = false;
      post({ type: "vivi-html-comment-clear" });
      return;
    }
    if (event.target.closest?.(interactiveSelector)) return;
    if (document.getSelection()?.toString().trim()) return;
    if (!hasRenderedCommentModifier(event)) return;
    event.preventDefault();
    event.stopPropagation();
    const target = targetForBlocks([block]);
    postTarget(target);
  });
  document.addEventListener("pointermove", (event) => setHoveredBlock(renderedThreadOpen() ? null : closestBlock(event.target)));
  document.addEventListener("pointerleave", () => setHoveredBlock(null));
  document.addEventListener("mouseup", publishSoon);
  document.addEventListener("keyup", publishSoon);
  window.addEventListener("scroll", () => window.requestAnimationFrame(postThreadLayout), true);
  window.addEventListener("resize", postThreadLayout);
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", applyHighlights, { once: true });
  } else {
    applyHighlights();
  }
})();
</script>`;
  const mermaidScripts = options.includeMermaidRuntime
    ? `<script nonce="${escapeAttribute(options.nonce)}" src="/vivi/vendor/mermaid.min.js"></script><script nonce="${escapeAttribute(options.nonce)}">
(() => {
  const previewTheme = ${JSON.stringify(options.theme)};
  const themeVariables = ${JSON.stringify(viviMermaidThemeVariables(options.theme))};
  const renderBlocks = async () => {
    const mermaid = globalThis.mermaid;
    if (!mermaid) return;
    const blocks = Array.from(document.querySelectorAll("[data-vivi-html-mermaid]"));
    for (const [index, block] of blocks.entries()) {
      const source = block.dataset.mermaidSource;
      const target = block.querySelector(".mermaid-render-target");
      if (!source || !target || block.dataset.mermaidStatus === "rendered") continue;
      try {
        const hasCustomStyle = block.dataset.mermaidCustomStyle === "true";
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: hasCustomStyle ? (previewTheme === "dark" ? "dark" : "default") : "base",
          themeVariables: hasCustomStyle ? undefined : themeVariables,
          flowchart: { htmlLabels: false }
        });
        const result = await mermaid.render(\`vivi-html-mermaid-\${index}-\${Date.now()}\`, source);
        target.innerHTML = result.svg;
        block.dataset.mermaidStatus = "rendered";
      } catch (error) {
        block.dataset.mermaidStatus = "error";
        target.textContent = error instanceof Error ? error.message : "Mermaid could not render this diagram.";
      }
    }
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", renderBlocks, { once: true });
  } else {
    renderBlocks();
  }
})();
</script>`
    : "";
  const scripts = `${selectionBridge}${mermaidScripts}`;
  const headClose = findClosingTagStart(html, "head");
  if (headClose !== -1)
    return `${html.slice(0, headClose)}${styles}${scripts}${html.slice(headClose)}`;
  const bodyStart = findOpeningTagStart(html, "body");
  if (bodyStart !== -1)
    return `${html.slice(0, bodyStart)}${styles}${scripts}${html.slice(bodyStart)}`;
  return `${styles}${scripts}${html}`;
}

function mermaidBrowserBundlePath(): string {
  const require = createRequire(import.meta.url);
  return require.resolve("mermaid/dist/mermaid.min.js");
}

function parseHtmlPreviewTheme(value: string | null): MermaidPreviewTheme {
  return value === "light" ? "light" : "dark";
}

function htmlPreviewPalette(theme: MermaidPreviewTheme) {
  if (theme === "light") {
    return {
      accent: "#2f6f73",
      background: "#fbfaf7",
      codeBackground: "#f2f0ea",
      codeText: "#172426",
      commentLine: "rgba(126,87,194,.35)",
      commentText: "#5e3aa3",
      commentTint: "rgba(126,87,194,.12)",
      commentTintActive: "rgba(126,87,194,.2)",
      line: "#d4c9b8",
      muted: "#66736f",
      panel: "#ffffff",
      softLine: "rgba(24,32,47,.08)",
      text: "#172426",
    };
  }

  return {
    accent: "#7dd3c7",
    background: "#0e1316",
    codeBackground: "#11191d",
    codeText: "#edf7f5",
    commentLine: "rgba(169,134,255,.42)",
    commentText: "#d8c7ff",
    commentTint: "rgba(169,134,255,.14)",
    commentTintActive: "rgba(169,134,255,.22)",
    line: "#34474d",
    muted: "#96aaa9",
    panel: "#152126",
    softLine: "rgba(255,255,255,.06)",
    text: "#edf7f5",
  };
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/`([^`]+)`/g, "$1")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

function contentTypeFor(filePath: string): string {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".svg")) return "image/svg+xml";
  if (filePath.endsWith(".png")) return "image/png";
  if (filePath.endsWith(".jpg") || filePath.endsWith(".jpeg"))
    return "image/jpeg";
  return "application/octet-stream";
}

function previewContentTypeFor(filePath: string, fallback?: string): string {
  const type = contentTypeFor(filePath);
  return type === "application/octet-stream" ? (fallback ?? type) : type;
}
