import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import type { AddressInfo, Socket } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ViewerService } from "../app/viewer-service.js";

export interface ServerOptions {
  host: string;
  port: number;
  service: ViewerService;
  staticDir?: string;
  allowHtmlScripts?: boolean;
}

export async function startHttpServer(
  options: ServerOptions,
): Promise<{ url: string; close: () => Promise<void> }> {
  const sockets = new Set<Socket>();
  const server = createServer(async (req, res) => {
    try {
      await routeRequest(req, res, options);
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      sendJson(res, statusForError(message), { error: message });
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
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    },
  };
}

async function routeRequest(
  req: IncomingMessage,
  res: ServerResponse,
  options: ServerOptions,
): Promise<void> {
  const host = req.headers.host ?? `${options.host}:${options.port}`;
  const url = new URL(req.url ?? "/", `http://${host}`);

  if (url.pathname === "/api/tree") {
    sendJson(res, 200, await options.service.readTree());
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

  if (url.pathname === "/api/diff") {
    const requestedPath = url.searchParams.get("path") ?? "";
    sendJson(res, 200, await options.service.readDiff(requestedPath));
    return;
  }

  if (url.pathname === "/api/file") {
    const requestedPath = url.searchParams.get("path") ?? "";
    sendJson(res, 200, await options.service.readFile(requestedPath));
    return;
  }

  if (url.pathname === "/preview/html") {
    const requestedPath = url.searchParams.get("path") ?? "";
    const html = await options.service.readHtmlPreview(requestedPath);
    const previewHtml = addHtmlHeadingIds(withPreviewBase(html, requestedPath));
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "x-content-type-options": "nosniff",
      "cache-control": "no-store",
      "content-security-policy": htmlPreviewCsp(
        options.allowHtmlScripts ??
          options.service.getConfig().allowHtmlScripts,
      ),
    });
    res.end(previewHtml);
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

function statusForError(message: string): number {
  if (message.includes("too large")) return 413;
  if (
    message.includes("no such file") ||
    message.includes("ENOENT") ||
    message.includes("not a file") ||
    message.includes("not an HTML file")
  ) {
    return 404;
  }
  if (
    message.includes("path") ||
    message.includes("absolute") ||
    message.includes("root") ||
    message.includes("ignored") ||
    message.includes("excluded") ||
    message.includes("invalid")
  ) {
    return 400;
  }
  return 500;
}

function defaultStaticDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, "../ui"),
    path.resolve(process.cwd(), "dist/ui"),
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

function htmlPreviewCsp(allowHtmlScripts: boolean): string {
  const base = [
    "default-src 'self' data: blob:",
    "object-src 'none'",
    "base-uri 'self'",
  ];
  base.push("style-src 'self' 'unsafe-inline'");
  base.push(
    allowHtmlScripts
      ? "script-src 'self' 'unsafe-inline'"
      : "script-src 'none'",
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
