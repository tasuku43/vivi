import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { FileSystemPort } from "../app/contracts.js";
import type {
  FilePayload,
  FsNode,
  TreeSnapshot,
  ViewerConfig,
} from "../domain/fs-node.js";
import {
  defaultIgnoredNames,
  isIgnoredPath,
  normalizeRelativePath,
} from "../domain/path-policy.js";
import { classifyViewer, type ViewerKind } from "../domain/viewer-kind.js";

export interface NodeFileSystemOptions {
  rootDir: string;
  ignoredNames?: Set<string>;
  version?: number;
  includeExtensions?: Set<string>;
  maxFileSizeBytes?: number;
  allowHtmlScripts?: boolean;
}

export class NodeFileSystem implements FileSystemPort {
  private readonly rootDir: string;
  private readonly ignoredNames: Set<string>;
  private readonly includeExtensions?: Set<string>;
  private readonly maxFileSizeBytes: number;
  private readonly allowHtmlScripts: boolean;
  private version: number;

  constructor(options: NodeFileSystemOptions) {
    this.rootDir = path.resolve(options.rootDir);
    this.ignoredNames = options.ignoredNames ?? defaultIgnoredNames;
    this.includeExtensions = options.includeExtensions;
    this.maxFileSizeBytes = options.maxFileSizeBytes ?? 1024 * 1024;
    this.allowHtmlScripts = options.allowHtmlScripts ?? true;
    this.version = options.version ?? 1;
  }

  async readTree(): Promise<TreeSnapshot> {
    const nodes = await this.scanDirectory("", null);
    return { root: this.rootDir, version: this.version, nodes };
  }

  async readFile(relativePath: string): Promise<FilePayload> {
    const resolved = this.resolveInsideRoot(relativePath);
    const stat = await fs.stat(resolved.absolutePath);
    if (!stat.isFile()) throw new Error("path is not a file");
    const viewerKind = classifyViewer(resolved.relativePath);
    const mimeType = mimeTypeFor(resolved.relativePath, viewerKind);

    if (stat.size > this.maxFileSizeBytes) {
      return {
        path: resolved.relativePath,
        viewerKind,
        encoding: "none",
        content: "",
        etag: `mtime:${stat.mtimeMs}:size:${stat.size}`,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        mimeType,
        truncated: true,
        maxSizeBytes: this.maxFileSizeBytes,
      };
    }

    const bytes = await fs.readFile(resolved.absolutePath);
    const etag = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    const binary = viewerKind === "image";
    return {
      path: resolved.relativePath,
      viewerKind,
      encoding: binary ? "base64" : "utf8",
      content: binary ? bytes.toString("base64") : bytes.toString("utf8"),
      etag,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      mimeType,
    };
  }

  async readHtmlPreview(relativePath: string): Promise<string> {
    const file = await this.readFile(relativePath);
    if (file.viewerKind !== "html") throw new Error("path is not an HTML file");
    if (file.truncated) throw new Error("file is too large to preview");
    return file.content;
  }

  getConfig(): ViewerConfig {
    return {
      root: this.rootDir,
      allowHtmlScripts: this.allowHtmlScripts,
      maxFileSizeBytes: this.maxFileSizeBytes,
    };
  }

  private async scanDirectory(
    relativeDir: string,
    parentPath: string | null,
  ): Promise<FsNode[]> {
    const absoluteDir = path.join(this.rootDir, relativeDir);
    const entries = await fs.readdir(absoluteDir, { withFileTypes: true });
    const nodes: FsNode[] = [];

    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const relativePath = relativeDir
        ? `${relativeDir}/${entry.name}`
        : entry.name;
      if (isIgnoredPath(relativePath, this.ignoredNames)) continue;

      const absolutePath = path.join(this.rootDir, relativePath);
      const stat = await fs.stat(absolutePath);
      if (entry.isDirectory()) {
        nodes.push({
          id: relativePath,
          path: relativePath,
          name: entry.name,
          kind: "directory",
          parentPath,
          children: await this.scanDirectory(relativePath, relativePath),
          mtimeMs: stat.mtimeMs,
          version: this.version,
        });
      } else if (entry.isFile()) {
        if (!this.isIncluded(relativePath)) continue;
        nodes.push({
          id: relativePath,
          path: relativePath,
          name: entry.name,
          kind: "file",
          parentPath,
          viewerKind: classifyViewer(relativePath),
          size: stat.size,
          mtimeMs: stat.mtimeMs,
          version: this.version,
        });
      }
    }

    return nodes;
  }

  private resolveInsideRoot(input: string): {
    absolutePath: string;
    relativePath: string;
  } {
    const normalized = normalizeRelativePath(input);
    if (!normalized.ok) throw new Error(normalized.reason);
    if (!normalized.relativePath) throw new Error("file path is required");
    if (isIgnoredPath(normalized.relativePath, this.ignoredNames))
      throw new Error("path is ignored");
    if (!this.isIncluded(normalized.relativePath))
      throw new Error("path is excluded");
    const absolutePath = path.resolve(this.rootDir, normalized.relativePath);
    const relativeToRoot = path.relative(this.rootDir, absolutePath);
    if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
      throw new Error("path escapes root");
    }
    return { absolutePath, relativePath: normalized.relativePath };
  }

  private isIncluded(relativePath: string): boolean {
    if (!this.includeExtensions?.size) return true;
    const extension = path
      .extname(relativePath)
      .toLowerCase()
      .replace(/^\./, "");
    return this.includeExtensions.has(extension);
  }
}

function mimeTypeFor(
  relativePath: string,
  viewerKind: ViewerKind,
): string | undefined {
  const extension = path.extname(relativePath).toLowerCase();
  if (viewerKind === "markdown") return "text/markdown; charset=utf-8";
  if (viewerKind === "html") return "text/html; charset=utf-8";
  if (viewerKind === "json") return "application/json; charset=utf-8";
  if (viewerKind === "code" || viewerKind === "text")
    return "text/plain; charset=utf-8";
  if (extension === ".png") return "image/png";
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".gif") return "image/gif";
  if (extension === ".webp") return "image/webp";
  if (extension === ".svg") return "image/svg+xml";
  return undefined;
}
