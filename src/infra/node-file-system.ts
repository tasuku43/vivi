import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { FileSystemPort } from "../app/contracts.js";
import type {
  FilePayload,
  FsNode,
  TreeReadStats,
  TreeSnapshot,
  ViewerConfig,
} from "../domain/fs-node.js";
import {
  defaultIgnoredNames,
  isIgnoredPath,
  normalizeRelativePath,
} from "../domain/path-policy.js";
import {
  isTextSearchableViewerKind,
  searchFilePayload,
  type FileSearchResult,
  type SearchStats,
  type TextSearchResult,
} from "../domain/search.js";
import { classifyViewer, type ViewerKind } from "../domain/viewer-kind.js";

export interface NodeFileSystemOptions {
  rootDir: string;
  ignoredNames?: Set<string>;
  version?: number;
  includeExtensions?: Set<string>;
  maxFileSizeBytes?: number;
  allowHtmlScripts?: boolean;
  fileIndexTtlMs?: number;
}

export class NodeFileSystem implements FileSystemPort {
  private readonly rootDir: string;
  private readonly ignoredNames: Set<string>;
  private readonly includeExtensions?: Set<string>;
  private readonly maxFileSizeBytes: number;
  private readonly allowHtmlScripts: boolean;
  private readonly fileIndexTtlMs: number;
  private readonly rootRealPath: Promise<string>;
  private fileIndexCache: {
    files: FileSearchResult[];
    createdAt: number;
  } | null = null;
  private version: number;

  constructor(options: NodeFileSystemOptions) {
    this.rootDir = path.resolve(options.rootDir);
    this.ignoredNames = options.ignoredNames ?? defaultIgnoredNames;
    this.includeExtensions = options.includeExtensions;
    this.maxFileSizeBytes = options.maxFileSizeBytes ?? 1024 * 1024;
    this.allowHtmlScripts = options.allowHtmlScripts ?? false;
    this.fileIndexTtlMs = options.fileIndexTtlMs ?? 5_000;
    this.version = options.version ?? 1;
    this.rootRealPath = realpathOrResolve(this.rootDir);
  }

  async readTree(): Promise<TreeSnapshot> {
    const stats = createTreeStats();
    const startedAt = performance.now();
    const nodes = await this.scanDirectory(
      "",
      null,
      Number.POSITIVE_INFINITY,
      stats,
    );
    return {
      root: this.rootDir,
      version: this.version,
      nodes,
      stats: finishTreeStats(stats, startedAt),
    };
  }

  async readDirectory(
    relativePath = "",
    options: { depth?: number } = {},
  ): Promise<TreeSnapshot> {
    const resolved = await this.resolveDirectoryInsideRoot(relativePath);
    const depth = Math.max(1, options.depth ?? 1);
    const stats = createTreeStats();
    const startedAt = performance.now();
    const nodes = await this.scanDirectory(
      resolved.relativePath,
      resolved.relativePath || null,
      depth,
      stats,
    );
    return {
      root: this.rootDir,
      version: this.version,
      path: resolved.relativePath,
      depth,
      nodes,
      stats: finishTreeStats(stats, startedAt),
    };
  }

  async readFile(relativePath: string): Promise<FilePayload> {
    const resolved = await this.resolveInsideRoot(relativePath);
    const stat = await fs.stat(resolved.absolutePath);
    if (!stat.isFile()) throw new Error("path is not a file");
    const viewerKind = classifyViewer(resolved.relativePath);
    const mimeType = mimeTypeFor(resolved.relativePath, viewerKind);

    if (stat.size > this.maxFileSizeBytes) {
      if (supportsPartialTextPreview(viewerKind)) {
        const bytes = await readLeadingBytes(
          resolved.absolutePath,
          this.maxFileSizeBytes,
        );
        return {
          path: resolved.relativePath,
          viewerKind,
          encoding: "utf8",
          content: bytes.toString("utf8"),
          etag: `mtime:${stat.mtimeMs}:size:${stat.size}:preview:${bytes.length}`,
          size: stat.size,
          mtimeMs: stat.mtimeMs,
          mimeType,
          truncated: true,
          maxSizeBytes: this.maxFileSizeBytes,
          previewBytes: bytes.length,
        };
      }
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

  async searchFiles(
    query: string,
    options: { limit?: number } = {},
  ): Promise<{
    query: string;
    results: FileSearchResult[];
    stats: SearchStats;
  }> {
    const normalizedQuery = query.trim();
    const terms = normalizedQuery.toLowerCase().split(/\s+/).filter(Boolean);
    const limit = options.limit ?? 40;
    const results: FileSearchResult[] = [];
    const stats = createSearchStats();
    const startedAt = performance.now();

    if (!terms.length) {
      await this.walkFiles("", stats, async (file) => {
        if (results.length >= limit) return false;
        insertRanked(results, { ...file, score: 1 }, limit, (a, b) =>
          a.path.localeCompare(b.path),
        );
        return true;
      });
    } else {
      const files = await this.readFileIndex(stats);
      for (const file of files) {
        const score = fileSearchScore(file.path.toLowerCase(), terms);
        if (score <= 0) continue;
        insertRanked(results, { ...file, score }, limit, (a, b) =>
          b.score - a.score || a.path.localeCompare(b.path),
        );
      }
    }

    return {
      query: normalizedQuery,
      results,
      stats: finishSearchStats(stats, startedAt),
    };
  }

  async searchText(
    query: string,
    options: { limit?: number; matchesPerFile?: number } = {},
  ): Promise<{
    query: string;
    results: TextSearchResult[];
    stats: SearchStats;
  }> {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      return {
        query: normalizedQuery,
        results: [],
        stats: finishSearchStats(createSearchStats(), performance.now()),
      };
    }

    const limit = options.limit ?? 40;
    const matchesPerFile = options.matchesPerFile ?? 3;
    const results: TextSearchResult[] = [];
    const stats = createSearchStats();
    const startedAt = performance.now();

    await this.walkFiles("", stats, async (file) => {
      if (results.length >= limit) return false;
      const viewerKind = file.viewerKind;
      if (!viewerKind || !isTextSearchableViewerKind(viewerKind)) {
        stats.skippedFiles += 1;
        return true;
      }
      if (file.size && file.size > this.maxFileSizeBytes) {
        stats.skippedFiles += 1;
        return true;
      }

      try {
        const bytes = await fs.readFile(path.join(this.rootDir, file.path));
        stats.readFiles += 1;
        if (bytes.includes(0)) {
          stats.skippedFiles += 1;
          return true;
        }
        results.push(
          ...searchFilePayload(
            {
              path: file.path,
              viewerKind,
              encoding: "utf8",
              content: bytes.toString("utf8"),
              etag: `mtime:${file.mtimeMs}:size:${file.size}`,
              size: file.size ?? bytes.byteLength,
              mtimeMs: file.mtimeMs ?? 0,
            },
            normalizedQuery,
            matchesPerFile,
          ),
        );
      } catch {
        stats.skippedFiles += 1;
      }
      return results.length < limit;
    });

    return {
      query: normalizedQuery,
      results: results.slice(0, limit),
      stats: finishSearchStats(stats, startedAt),
    };
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
    depth: number,
    stats: MutableTreeReadStats,
  ): Promise<FsNode[]> {
    const absoluteDir = path.join(this.rootDir, relativeDir);
    const entries = await fs.readdir(absoluteDir, { withFileTypes: true });
    const nodes: FsNode[] = [];
    stats.scannedDirectories += 1;

    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const relativePath = relativeDir
        ? `${relativeDir}/${entry.name}`
        : entry.name;
      if (isIgnoredPath(relativePath, this.ignoredNames)) continue;

      const absolutePath = path.join(this.rootDir, relativePath);
      if (!(await this.realPathIsInsideRoot(absolutePath))) continue;
      const stat = await fs.stat(absolutePath);
      if (entry.isSymbolicLink() && stat.isDirectory()) continue;
      if (stat.isDirectory()) {
        const children =
          depth > 1
            ? await this.scanDirectory(
                relativePath,
                relativePath,
                depth - 1,
                stats,
              )
            : undefined;
        nodes.push({
          id: relativePath,
          path: relativePath,
          name: entry.name,
          kind: "directory",
          parentPath,
          children,
          childrenLoaded: Boolean(children),
          mtimeMs: stat.mtimeMs,
          version: this.version,
        });
        stats.returnedNodes += 1;
      } else if (stat.isFile()) {
        stats.scannedFiles += 1;
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
        stats.returnedNodes += 1;
      }
    }

    return nodes;
  }

  private async resolveInsideRoot(input: string): Promise<{
    absolutePath: string;
    relativePath: string;
  }> {
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
    if (!(await this.realPathIsInsideRoot(absolutePath))) {
      throw new Error("path escapes root");
    }
    return { absolutePath, relativePath: normalized.relativePath };
  }

  private async resolveDirectoryInsideRoot(input: string): Promise<{
    absolutePath: string;
    relativePath: string;
  }> {
    const normalized = normalizeRelativePath(input);
    if (!normalized.ok) throw new Error(normalized.reason);
    if (
      normalized.relativePath &&
      isIgnoredPath(normalized.relativePath, this.ignoredNames)
    )
      throw new Error("path is ignored");
    const absolutePath = path.resolve(this.rootDir, normalized.relativePath);
    const relativeToRoot = path.relative(this.rootDir, absolutePath);
    if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
      throw new Error("path escapes root");
    }
    if (!(await this.realPathIsInsideRoot(absolutePath))) {
      throw new Error("path escapes root");
    }
    const stat = await fs.stat(absolutePath);
    if (!stat.isDirectory()) throw new Error("path is not a directory");
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

  private async walkFiles(
    relativeDir: string,
    stats: MutableSearchStats,
    onFile: (file: FileSearchResult) => Promise<boolean | void>,
  ): Promise<boolean> {
    const absoluteDir = path.join(this.rootDir, relativeDir);
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(absoluteDir, { withFileTypes: true });
    } catch {
      return true;
    }
    stats.scannedDirectories += 1;

    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const relativePath = relativeDir
        ? `${relativeDir}/${entry.name}`
        : entry.name;
      if (isIgnoredPath(relativePath, this.ignoredNames)) continue;

      const absolutePath = path.join(this.rootDir, relativePath);
      if (!(await this.realPathIsInsideRoot(absolutePath))) continue;
      const stat = await fs.stat(absolutePath);
      if (entry.isSymbolicLink() && stat.isDirectory()) continue;
      if (stat.isDirectory()) {
        const shouldContinue = await this.walkFiles(
          relativePath,
          stats,
          onFile,
        );
        if (!shouldContinue) return false;
        continue;
      }
      if (!stat.isFile()) continue;
      stats.scannedFiles += 1;
      if (!this.isIncluded(relativePath)) continue;

      try {
        const shouldContinue = await onFile({
          path: relativePath,
          name: entry.name,
          viewerKind: classifyViewer(relativePath),
          size: stat.size,
          mtimeMs: stat.mtimeMs,
          score: 0,
        });
        if (shouldContinue === false) return false;
      } catch {
        stats.skippedFiles += 1;
      }
    }
    return true;
  }

  private async realPathIsInsideRoot(absolutePath: string): Promise<boolean> {
    let targetRealPath: string;
    try {
      targetRealPath = await fs.realpath(absolutePath);
    } catch (error) {
      if (isMissingPathError(error)) return true;
      throw error;
    }
    const rootRealPath = await this.rootRealPath;
    const relative = path.relative(rootRealPath, targetRealPath);
    return (
      relative === "" ||
      (!relative.startsWith("..") && !path.isAbsolute(relative))
    );
  }

  private async readFileIndex(
    stats: MutableSearchStats,
  ): Promise<FileSearchResult[]> {
    const now = Date.now();
    if (
      this.fileIndexCache &&
      now - this.fileIndexCache.createdAt <= this.fileIndexTtlMs
    ) {
      stats.cached = true;
      return this.fileIndexCache.files;
    }

    const files: FileSearchResult[] = [];
    await this.walkFiles("", stats, async (file) => {
      files.push(file);
      return true;
    });
    this.fileIndexCache = { files, createdAt: now };
    return files;
  }
}

interface MutableTreeReadStats {
  scannedDirectories: number;
  scannedFiles: number;
  returnedNodes: number;
}

interface MutableSearchStats {
  scannedDirectories: number;
  scannedFiles: number;
  readFiles: number;
  skippedFiles: number;
  cached?: boolean;
}

function createTreeStats(): MutableTreeReadStats {
  return { scannedDirectories: 0, scannedFiles: 0, returnedNodes: 0 };
}

function finishTreeStats(
  stats: MutableTreeReadStats,
  startedAt: number,
): TreeReadStats {
  return { ...stats, durationMs: Math.round(performance.now() - startedAt) };
}

function createSearchStats(): MutableSearchStats {
  return {
    scannedDirectories: 0,
    scannedFiles: 0,
    readFiles: 0,
    skippedFiles: 0,
  };
}

function finishSearchStats(
  stats: MutableSearchStats,
  startedAt: number,
): SearchStats {
  return { ...stats, durationMs: Math.round(performance.now() - startedAt) };
}

function fileSearchScore(pathname: string, terms: string[]): number {
  if (!terms.length) return 1;
  let score = 0;
  for (const term of terms) {
    const contiguous = pathname.indexOf(term);
    if (contiguous >= 0) {
      score += 100 - contiguous;
      continue;
    }
    if (isSubsequence(term, pathname)) {
      score += 10;
      continue;
    }
    return 0;
  }
  return score;
}

function isSubsequence(needle: string, haystack: string): boolean {
  let cursor = 0;
  for (const char of haystack) {
    if (char === needle[cursor]) cursor += 1;
    if (cursor === needle.length) return true;
  }
  return false;
}

function insertRanked<T>(
  items: T[],
  item: T,
  limit: number,
  compare: (a: T, b: T) => number,
): void {
  items.push(item);
  items.sort(compare);
  if (items.length > limit) items.length = limit;
}

function mimeTypeFor(
  relativePath: string,
  viewerKind: ViewerKind,
): string | undefined {
  const extension = path.extname(relativePath).toLowerCase();
  if (viewerKind === "markdown") return "text/markdown; charset=utf-8";
  if (viewerKind === "html") return "text/html; charset=utf-8";
  if (viewerKind === "json") return "application/json; charset=utf-8";
  if (
    viewerKind === "code" ||
    viewerKind === "text" ||
    viewerKind === "mermaid"
  )
    return "text/plain; charset=utf-8";
  if (extension === ".png") return "image/png";
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".gif") return "image/gif";
  if (extension === ".webp") return "image/webp";
  if (extension === ".svg") return "image/svg+xml";
  return undefined;
}

async function readLeadingBytes(
  absolutePath: string,
  byteLimit: number,
): Promise<Buffer> {
  const handle = await fs.open(absolutePath, "r");
  try {
    const buffer = Buffer.alloc(byteLimit);
    const { bytesRead } = await handle.read(buffer, 0, byteLimit, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

function supportsPartialTextPreview(viewerKind: ViewerKind): boolean {
  return (
    viewerKind === "text" ||
    viewerKind === "code" ||
    viewerKind === "markdown" ||
    viewerKind === "json" ||
    viewerKind === "mermaid"
  );
}

async function realpathOrResolve(pathname: string): Promise<string> {
  try {
    return await fs.realpath(path.resolve(pathname));
  } catch {
    return path.resolve(pathname);
  }
}

function isMissingPathError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}
