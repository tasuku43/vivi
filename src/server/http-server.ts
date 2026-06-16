import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import type { AddressInfo, Socket } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ViewerService } from "../app/viewer-service.js";
import { normalizeCommentFilters } from "../domain/comments.js";
import {
  pathlensMermaidThemeVariables,
  type MermaidPreviewTheme,
} from "../domain/mermaid-theme.js";
import {
  escapeHtml,
  hasCustomMermaidStyle,
} from "../domain/mermaid-preview.js";

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
      addHtmlHeadingIds(withPreviewBase(html, requestedPath)),
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

  if (url.pathname === "/pathlens/vendor/mermaid.min.js") {
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
          const id = `pathlens-html-mermaid-${index}`;
          index += 1;
          const scriptStatus = options.allowHtmlScripts
            ? "user scripts active"
            : "user scripts inactive";
          return `<figure class="html-mermaid" id="${id}" data-pathlens-html-mermaid data-mermaid-status="pending" data-mermaid-custom-style="${hasCustomMermaidStyle(source) ? "true" : "false"}" data-mermaid-source="${escapeAttribute(source)}"><figcaption>Mermaid preview · ${scriptStatus}</figcaption><div class="mermaid-render-target" aria-live="polite"></div><div class="markdown-mermaid-fallback unsupported"><p>Mermaid preview is loading. Source is shown below if rendering fails.</p><details class="markdown-mermaid-source"><summary>Mermaid source</summary><pre><code>${escapeHtml(source)}</code></pre></details></div></figure>`;
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
  if (/data-pathlens-mermaid-preview/i.test(html)) return html;
  const palette = htmlPreviewPalette(options.theme);
  const styles = `<style data-pathlens-mermaid-preview data-pathlens-html-theme="${options.theme}">
html{color-scheme:${options.theme};background:${palette.background};}
body{background:${palette.background};color:${palette.text};}
body:not([data-pathlens-preserve-spacing]){font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;}
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
</style>`;
  const selectionBridge = `<script nonce="${escapeAttribute(options.nonce)}">
(() => {
  const path = ${JSON.stringify(options.path)};
  const cssPath = (element) => {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return undefined;
    if (element.id) return "#" + CSS.escape(element.id);
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
  const publish = () => {
    const selection = document.getSelection();
    const text = selection?.toString().trim() ?? "";
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    const node = range?.commonAncestorContainer ?? null;
    const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
    const rect = range?.getBoundingClientRect();
    parent.postMessage({
      type: "pathlens-html-selection",
      path,
      text,
      selector: cssPath(element),
      rect: rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : undefined
    }, window.location.origin);
  };
  const publishSoon = () => {
    window.requestAnimationFrame(() => window.setTimeout(publish, 0));
  };
  document.addEventListener("selectionchange", publish);
  document.addEventListener("mouseup", publishSoon);
  document.addEventListener("keyup", publishSoon);
})();
</script>`;
  const mermaidScripts = options.includeMermaidRuntime
    ? `<script nonce="${escapeAttribute(options.nonce)}" src="/pathlens/vendor/mermaid.min.js"></script><script nonce="${escapeAttribute(options.nonce)}">
(() => {
  const previewTheme = ${JSON.stringify(options.theme)};
  const themeVariables = ${JSON.stringify(pathlensMermaidThemeVariables(options.theme))};
  const renderBlocks = async () => {
    const mermaid = globalThis.mermaid;
    if (!mermaid) return;
    const blocks = Array.from(document.querySelectorAll("[data-pathlens-html-mermaid]"));
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
        const result = await mermaid.render(\`pathlens-html-mermaid-\${index}-\${Date.now()}\`, source);
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
