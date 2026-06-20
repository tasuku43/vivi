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
  type CommentListFilters,
  type CommentStatus,
} from "../domain/comments.js";
import {
  viviMermaidThemeVariables,
  type MermaidPreviewTheme,
} from "../domain/mermaid-theme.js";
import {
  escapeHtml,
  hasCustomMermaidStyle,
} from "../domain/mermaid-preview.js";
import { addRenderedCommentBlockIdsToHtml } from "../domain/rendered-comment-blocks.js";

export interface ServerOptions {
  host: string;
  port: number;
  service: ViewerService;
  staticDir?: string;
  allowHtmlScripts?: boolean;
}

const serverCloseGraceMs = 2_000;

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
    if (isGraphqlWorkspaceEventsRequest({
      operationName: url.searchParams.get("operationName") ?? undefined,
      query: url.searchParams.get("query") ?? undefined,
    })) {
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
  if (isGraphqlMutation(operationName, payload.query)) {
    assertSafeJsonWriteRequest(req, options);
  }
  try {
    sendJson(res, 200, {
      data: await executeGraphqlOperation(operationName, variables, options),
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
      return { file: await options.service.readFile(requiredString(variables, "path")) };
    }
    case "ViviFileContext": {
      const requestedPath = requiredString(variables, "path");
      const includeComments = boolVariable(variables, "includeComments");
      return {
        fileContext: {
          file: await options.service.readFile(requestedPath),
          comments: includeComments
            ? await options.service.listComments({ path: requestedPath })
            : [],
          commentThreads: includeComments
            ? await options.service.listCommentThreads({ path: requestedPath })
            : [],
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
      return {
        comments,
        commentThreads: await options.service.listCommentThreads(filters),
      };
    }
    case "ViviCommentThreads":
      return {
        commentThreads: await options.service.listCommentThreads(
          graphqlCommentFilters(variables),
        ),
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
    "ViviCommentExport",
    "ViviReviewQueue",
    "ViviDiffBases",
    "ViviDiff",
    "ViviFileSearch",
    "ViviTextSearch",
    "ViviMeta",
    "ViviPreview",
    "CreateComment",
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
    operationName === "UpdateComment" ||
    operationName === "UpdateCommentStatus" ||
    operationName === "UpdateCommentThread" ||
    operationName === "UpdateCommentThreadStatus" ||
    query?.includes("mutation") === true
  );
}

function isGraphqlWorkspaceEventsRequest(input: {
  operationName?: string;
  query?: string;
}): boolean {
  return (
    input.operationName === "WorkspaceEvents" ||
    input.query?.includes("workspaceEvents") === true ||
    input.query?.includes("subscription") === true
  );
}

function graphqlCommentFilters(
  variables: Record<string, unknown>,
): CommentListFilters {
  return normalizeCommentFilters({
    path: optionalString(variables, "path") ?? null,
    status: optionalString(variables, "status") ?? null,
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
  const safeRequested = requested?.replace(/^\/+/, "") || "index.html";
  const filePath = path.resolve(base, safeRequested);
  if (!isInside(base, filePath)) {
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

function requiredString(variables: Record<string, unknown>, key: string): string {
  const value = optionalString(variables, key)?.trim();
  if (!value) throw new Error(`${key} is required`);
  return value;
}

function boolVariable(variables: Record<string, unknown>, key: string): boolean {
  return variables[key] === true;
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

function statusForError(message: string): number {
  if (message.includes("too large")) return 413;
  if (
    message.includes("no such file") ||
    message.includes("ENOENT") ||
    message.includes("not a file") ||
    message.includes("not an HTML file") ||
    message.includes("not found")
  ) {
    return 404;
  }
  if (
    message.includes("path") ||
    message.includes("absolute") ||
    message.includes("root") ||
    message.includes("ignored") ||
    message.includes("excluded") ||
    message.includes("invalid") ||
    message.includes("required") ||
    message.includes("must") ||
    message.includes("only target") ||
    message.includes("does not match")
  ) {
    return 400;
  }
  return 500;
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
  const httpStatus = statusForError(message);
  return {
    httpStatus,
    message,
    reason: message,
    status: httpStatus >= 500 ? "internal_error" : "request_error",
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
    console.error(message, error);
    return;
  }
  console.warn(message);
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
  if (/<head(\s[^>]*)?>/i.test(html))
    return html.replace(/<head(\s[^>]*)?>/i, (match) => `${match}${base}`);
  if (/<html(\s[^>]*)?>/i.test(html))
    return html.replace(
      /<html(\s[^>]*)?>/i,
      (match) => `${match}<head>${base}</head>`,
    );
  return `<head>${base}</head>${html}`;
}

function addHtmlHeadingIds(html: string): string {
  const used = new Map<string, number>();
  return html.replace(
    /<h([12])(\s[^>]*)?>([\s\S]*?)<\/h\1>/gi,
    (match, rawLevel: string, rawAttributes = "", innerHtml: string) => {
      if (/\sid\s*=/i.test(rawAttributes)) return match;
      const text = innerHtml
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/g, " ")
        .trim();
      const base = slugify(text) || `heading-${used.size + 1}`;
      const count = used.get(base) ?? 0;
      used.set(base, count + 1);
      const id = count === 0 ? base : `${base}-${count + 1}`;
      return `<h${rawLevel}${rawAttributes} id="${escapeAttribute(id)}">${innerHtml}</h${rawLevel}>`;
    },
  );
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
  let index = 0;
  const rendered = options.enabled
    ? html.replace(
        /<(pre|div|code)(\s[^>]*)?>([\s\S]*?)<\/\1>/gi,
        (match, tagName: string, rawAttributes = "", innerHtml: string) => {
          if (!hasMermaidClass(rawAttributes)) return match;
          const source = htmlToText(innerHtml).trim();
          if (!source) return match;
          const id = `vivi-html-mermaid-${index}`;
          index += 1;
          const scriptStatus = options.allowHtmlScripts
            ? "user scripts active"
            : "user scripts inactive";
          const commentAttributes = htmlCommentBlockAttributes(rawAttributes);
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

function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
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
html{color-scheme:${options.theme};background:${palette.background};}
body{background:${palette.background};color:${palette.text};}
body:not([data-vivi-preserve-spacing]){font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;}
a{color:${palette.accent};}
hr{border-color:${palette.line};}
blockquote{border-left:3px solid ${palette.line};color:${palette.muted};margin-left:0;padding-left:14px;}
pre,code{background:${palette.codeBackground};color:${palette.codeText};}
pre{border:1px solid ${palette.line};border-radius:8px;padding:12px;overflow:auto;}
table{border-collapse:collapse;}
th,td{border:1px solid ${palette.line};padding:6px 8px;}
.html-mermaid{margin:18px 0;}
.html-mermaid figcaption,.markdown-mermaid-source summary{color:${palette.muted};font-size:12px;}
.mermaid-render-target{overflow:auto;border:1px solid ${palette.line};border-radius:8px;background:${palette.panel};padding:14px;}
.mermaid-render-target svg{display:block;max-width:100%;height:auto;}
.html-mermaid[data-mermaid-status="rendered"] .markdown-mermaid-fallback{display:none;}
.markdown-mermaid-source{margin-top:10px;}
.markdown-mermaid-source summary{cursor:pointer;}
.markdown-mermaid-source pre{overflow:auto;border:1px solid ${palette.line};border-radius:8px;background:${palette.codeBackground};color:${palette.codeText};padding:10px;}
.html-mermaid.unsupported{border:1px solid ${palette.line};border-radius:8px;background:${palette.panel};padding:12px;}
.vivi-html-comment-block{position:relative;transition:background 140ms ease,box-shadow 140ms ease;}
.vivi-html-comment-block:hover{background:rgba(169,134,255,.06);}
.vivi-html-comment-block.has-vivi-comment,.vivi-html-comment-block.drafting-vivi-comment{background:linear-gradient(90deg,rgba(169,134,255,.19),rgba(169,134,255,.08) 68%,transparent);box-shadow:inset 2px 0 0 rgba(169,134,255,.54);}
.vivi-html-comment-block.active-vivi-comment{background:linear-gradient(90deg,rgba(169,134,255,.28),rgba(169,134,255,.12) 72%,transparent);box-shadow:inset 3px 0 0 rgba(169,134,255,.76),0 0 0 1px rgba(169,134,255,.18);}
.vivi-html-comment-marker{position:absolute;z-index:2147483646;right:4px;top:8px;width:18px;height:18px;border:1px solid rgba(169,134,255,.54);border-radius:999px;background:${palette.panel};box-shadow:0 0 0 4px rgba(169,134,255,.12);cursor:pointer;opacity:0;padding:0;transition:background 140ms ease,opacity 140ms ease,transform 140ms ease;}
.vivi-html-comment-marker::before{content:"";position:absolute;left:5px;top:4px;width:7px;height:6px;border:1.5px solid ${palette.accent};border-radius:5px;}
.vivi-html-comment-marker::after{content:"";position:absolute;left:8px;top:10px;border-width:3px 0 0 4px;border-style:solid;border-color:transparent transparent transparent ${palette.accent};}
.vivi-html-comment-action-host{position:relative;}
.vivi-html-comment-block:hover .vivi-html-comment-marker,.vivi-html-comment-block.has-vivi-comment .vivi-html-comment-marker,.vivi-html-comment-block.drafting-vivi-comment .vivi-html-comment-marker,.vivi-html-comment-marker:focus-visible{opacity:1;}
.vivi-html-comment-block:is(tr) .vivi-html-comment-marker{top:50%;transform:translateY(-50%);}
.vivi-html-comment-marker:hover,.vivi-html-comment-marker:focus-visible{outline:none;background:rgba(169,134,255,.18);transform:translateY(-1px);}
.vivi-html-comment-block:is(tr) .vivi-html-comment-marker:hover,.vivi-html-comment-block:is(tr) .vivi-html-comment-marker:focus-visible{transform:translateY(calc(-50% - 1px));}
</style>`;
  const selectionBridge = `<script nonce="${escapeAttribute(options.nonce)}">
(() => {
  const path = ${JSON.stringify(options.path)};
  const blockSelector = "[data-vivi-comment-block-id]";
  const preferredBlockSelectors = ["tr","li","pre","figure","aside","blockquote","h1","h2","h3","h4","h5","h6","p"];
  const interactiveSelector = "a,button,input,select,textarea,summary,[contenteditable]";
  let renderedComments = [];
  let activeCommentId = null;
  let draftingBlockId = null;
  const post = (message) => parent.postMessage({ path, ...message }, "*");
  const escapeSelectorValue = (value) => String(value).replace(/\\\\/g, "\\\\\\\\").replace(/"/g, '\\\\"');
  const escapeCssIdentifier = (value) => globalThis.CSS?.escape ? CSS.escape(value) : String(value).replace(/[^a-zA-Z0-9_-]/g, (character) => "\\\\" + character);
  const cssPath = (element) => {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return undefined;
    if (element.id) return "#" + escapeCssIdentifier(element.id);
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
  const readableText = (element) => (element?.innerText || element?.textContent || "").replace(/\\s+/g, " ").trim();
  const rectLike = (element) => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  };
  const closestBlock = (target) => {
    if (!target || target.nodeType !== Node.ELEMENT_NODE) return null;
    for (const selector of preferredBlockSelectors) {
      const block = target.closest(\`\${selector}\${blockSelector}\`);
      if (block) return block;
    }
    return target.closest(blockSelector);
  };
  const commentForBlock = (block) => {
    const commentId = block?.dataset.viviCommentId;
    return commentId ? renderedComments.find((comment) => comment.id === commentId) ?? null : null;
  };
  const findBlocksForComment = (comment) => {
    if (comment.blockId) {
      const byBlock = document.querySelector(\`[data-vivi-comment-block-id="\${escapeSelectorValue(comment.blockId)}"]\`);
      if (byBlock) return [byBlock];
    }
    if (comment.selector) {
      try {
        const bySelector = document.querySelector(comment.selector);
        if (bySelector?.matches(blockSelector)) return [bySelector];
        const nearest = bySelector?.closest(blockSelector);
        if (nearest) return [nearest];
      } catch {}
    }
    if (Number.isInteger(comment.sourceLineStart)) {
      const commentEnd = Number.isInteger(comment.sourceLineEnd) ? comment.sourceLineEnd : comment.sourceLineStart;
      const byRange = commentableBlocks().filter((block) => {
        const start = Number(block.dataset.viviSourceLineStart);
        const end = Number(block.dataset.viviSourceLineEnd);
        return Number.isInteger(start) && Number.isInteger(end) && start <= commentEnd && end >= comment.sourceLineStart;
      });
      if (byRange.length) return byRange;
    }
    const quote = comment.textQuote?.trim();
    const byQuote = quote ? Array.from(document.querySelectorAll(blockSelector)).find((block) => readableText(block).includes(quote)) ?? null : null;
    return byQuote ? [byQuote] : [];
  };
  const commentableBlocks = () => Array.from(document.querySelectorAll(blockSelector)).filter((block) => closestBlock(block) === block);
  const actionLabel = (count) => count <= 0 ? "Add comment" : count === 1 ? "Open comment" : \`Open \${count} comments\`;
  const ensureAction = (block) => {
    const host = block.localName === "tr" && block.lastElementChild ? block.lastElementChild : block;
    if (host !== block) host.classList.add("vivi-html-comment-action-host");
    let action = Array.from(host.children).find((child) => child.classList.contains("vivi-html-comment-marker"));
    if (!action) {
      action = document.createElement("button");
      action.type = "button";
      action.className = "vivi-html-comment-marker";
      host.append(action);
    }
    delete action.dataset.commentId;
    delete action.dataset.commentCount;
    action.setAttribute("aria-label", actionLabel(0));
    return action;
  };
  const applyHighlights = () => {
    document.querySelectorAll(blockSelector).forEach((block) => {
      block.classList.remove("vivi-html-comment-block", "has-vivi-comment", "active-vivi-comment", "drafting-vivi-comment");
      delete block.dataset.viviCommentId;
      delete block.dataset.viviCommentCount;
    });
    const blocks = commentableBlocks();
    blocks.forEach((block) => {
      block.classList.add("vivi-html-comment-block");
      ensureAction(block);
    });
    const commentsByBlock = new Map();
    for (const comment of renderedComments) {
      for (const block of findBlocksForComment(comment)) {
        const target = closestBlock(block);
        if (!target) continue;
        const list = commentsByBlock.get(target) || [];
        list.push(comment);
        commentsByBlock.set(target, list);
      }
    }
    for (const [block, comments] of commentsByBlock) {
      const firstComment = comments[0];
      block.classList.add("has-vivi-comment");
      if (comments.some((comment) => comment.id === activeCommentId)) block.classList.add("active-vivi-comment");
      block.dataset.viviCommentId = firstComment.id;
      block.dataset.viviCommentCount = String(comments.length);
      const action = ensureAction(block);
      action.dataset.commentId = firstComment.id;
      action.dataset.commentCount = String(comments.length);
      action.setAttribute("aria-label", actionLabel(comments.length));
    }
    const drafting = blocks.find((block) => block.dataset.viviCommentBlockId === draftingBlockId);
    drafting?.classList.add("drafting-vivi-comment");
  };
  const publishBlockTarget = (block) => {
    const text = readableText(block);
    const blockId = block?.dataset.viviCommentBlockId;
    if (!blockId || !text) return;
    post({
      type: "vivi-html-block-target",
      blockId,
      text,
      selector: cssPath(block),
      rect: rectLike(block)
    });
  };
  const publishSelectionBlock = () => {
    const selection = document.getSelection();
    if (!selection?.toString().trim() || !selection.rangeCount) return;
    const node = selection.getRangeAt(0).startContainer;
    const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    const block = closestBlock(element);
    if (block) publishBlockTarget(block);
  };
  const publishSoon = () => {
    window.requestAnimationFrame(() => window.setTimeout(publishSelectionBlock, 0));
  };
  window.addEventListener("message", (event) => {
    if (event.source !== parent) return;
    const data = event.data;
    if (data?.type !== "vivi-html-comments" || data.path !== path) return;
    renderedComments = Array.isArray(data.comments) ? data.comments : [];
    activeCommentId = typeof data.activeCommentId === "string" ? data.activeCommentId : null;
    draftingBlockId = typeof data.draftingBlockId === "string" ? data.draftingBlockId : null;
    applyHighlights();
  });
  document.addEventListener("click", (event) => {
    const marker = event.target.closest?.(".vivi-html-comment-marker");
    const block = closestBlock(marker || event.target);
    if (marker) {
      event.preventDefault();
      event.stopPropagation();
      if (marker.dataset.commentId) {
        post({ type: "vivi-html-comment-open", id: marker.dataset.commentId, rect: rectLike(block) });
      } else if (block) {
        publishBlockTarget(block);
      }
      return;
    }
    if (!block) {
      post({ type: "vivi-html-comment-clear" });
      return;
    }
    if (event.target.closest?.(interactiveSelector)) return;
    if (document.getSelection()?.toString().trim()) return;
    const comment = commentForBlock(block);
    if (comment) {
      post({ type: "vivi-html-comment-open", id: comment.id, rect: rectLike(block) });
      return;
    }
    publishBlockTarget(block);
  });
  document.addEventListener("mouseup", publishSoon);
  document.addEventListener("keyup", publishSoon);
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
  if (/<\/head>/i.test(html))
    return html.replace(/<\/head>/i, `${styles}${scripts}</head>`);
  if (/<body(\s[^>]*)?>/i.test(html))
    return html.replace(
      /<body(\s[^>]*)?>/i,
      (match) => `${styles}${scripts}${match}`,
    );
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
      line: "#d4c9b8",
      muted: "#66736f",
      panel: "#ffffff",
      text: "#172426",
    };
  }

  return {
    accent: "#7dd3c7",
    background: "#0e1316",
    codeBackground: "#11191d",
    codeText: "#edf7f5",
    line: "#34474d",
    muted: "#96aaa9",
    panel: "#152126",
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

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
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
