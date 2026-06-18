import type {
  ChangeReviewSummary,
  DiffBaseSummary,
  TextDiff,
} from "../domain/change-review.js";
import {
  applyCommentUpdate,
  exportCommentAsJsonLine,
  normalizeCommentCreateInput,
  normalizeCommentUpdateInput,
  type CommentListFilters,
  type CreateCommentInput,
  type PathlensComment,
} from "../domain/comments.js";
import type {
  FilePayload,
  FsEvent,
  TreeSnapshot,
  ViewerConfig,
} from "../domain/fs-node.js";
import {
  collectSearchableFiles,
  type FileSearchResult,
  searchFilePayload,
  type TextSearchResult,
} from "../domain/search.js";
import type { ViewerServiceOptions } from "./contracts.js";
import { randomUUID } from "node:crypto";

export class ViewerService {
  private readonly fileSystem: ViewerServiceOptions["fileSystem"];
  private readonly watcher?: ViewerServiceOptions["watcher"];
  private readonly changeReview?: ViewerServiceOptions["changeReview"];
  private readonly commentStore?: ViewerServiceOptions["commentStore"];
  private subscribers = new Set<(event: FsEvent) => void>();

  constructor(options: ViewerServiceOptions) {
    this.fileSystem = options.fileSystem;
    this.watcher = options.watcher;
    this.changeReview = options.changeReview;
    this.commentStore = options.commentStore;
  }

  readTree(): Promise<TreeSnapshot> {
    return this.fileSystem.readTree();
  }

  readDirectory(
    relativePath = "",
    options: { depth?: number } = {},
  ): Promise<TreeSnapshot> {
    return (
      this.fileSystem.readDirectory?.(relativePath, options) ??
      this.fileSystem.readTree()
    );
  }

  readFile(relativePath: string): Promise<FilePayload> {
    return this.fileSystem.readFile(relativePath);
  }

  readHtmlPreview(relativePath: string): Promise<string> {
    return this.fileSystem.readHtmlPreview(relativePath);
  }

  async searchText(
    query: string,
    options: { limit?: number; matchesPerFile?: number } = {},
  ): Promise<{ query: string; results: TextSearchResult[] }> {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) return { query: normalizedQuery, results: [] };

    if (this.fileSystem.searchText) {
      return this.fileSystem.searchText(normalizedQuery, options);
    }

    const limit = options.limit ?? 40;
    const matchesPerFile = options.matchesPerFile ?? 3;
    const tree = await this.fileSystem.readTree();
    const results: TextSearchResult[] = [];

    for (const file of collectSearchableFiles(tree.nodes)) {
      try {
        const payload = await this.fileSystem.readFile(file.path);
        results.push(
          ...searchFilePayload(payload, normalizedQuery, matchesPerFile),
        );
      } catch {
        // Search is best-effort because files may change between tree scan and read.
      }
      if (results.length >= limit) break;
    }

    return { query: normalizedQuery, results: results.slice(0, limit) };
  }

  async searchFiles(
    query: string,
    options: { limit?: number } = {},
  ): Promise<{ query: string; results: FileSearchResult[] }> {
    const normalizedQuery = query.trim();
    if (this.fileSystem.searchFiles) {
      return this.fileSystem.searchFiles(normalizedQuery, options);
    }

    const limit = options.limit ?? 40;
    const tree = await this.fileSystem.readTree();
    const terms = normalizedQuery.toLowerCase().split(/\s+/).filter(Boolean);
    const results = collectSearchableFiles(tree.nodes)
      .map((file) => ({
        path: file.path,
        name: file.name,
        viewerKind: file.viewerKind,
        size: file.size,
        mtimeMs: file.mtimeMs,
        score: fallbackFileScore(file.path.toLowerCase(), terms),
      }))
      .filter((result) => !terms.length || result.score > 0)
      .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
      .slice(0, limit);

    return { query: normalizedQuery, results };
  }

  getConfig(): ViewerConfig {
    return (
      this.fileSystem.getConfig?.() ?? {
        root: ".",
        allowHtmlScripts: false,
        maxFileSizeBytes: 1024 * 1024,
      }
    );
  }

  readChanges(): Promise<ChangeReviewSummary> {
    return (
      this.changeReview?.readChanges() ??
      Promise.resolve({
        available: false,
        reason: "Git change review is unavailable for this workspace.",
        changes: [],
      })
    );
  }

  readDiff(relativePath: string, baseRef?: string): Promise<TextDiff> {
    return (
      this.changeReview?.readDiff(relativePath, baseRef) ??
      Promise.resolve({
        path: relativePath,
        status: "unavailable",
        baseLabel: baseRef ?? "HEAD",
        compareLabel: "working tree",
        content: "",
        reason: "Git change review is unavailable for this workspace.",
      })
    );
  }

  readDiffBases(): Promise<DiffBaseSummary> {
    return (
      this.changeReview?.readDiffBases?.() ??
      Promise.resolve({
        available: false,
        reason: "Git diff base selection is unavailable for this workspace.",
        options: [],
      })
    );
  }

  async listComments(
    filters: CommentListFilters = {},
  ): Promise<PathlensComment[]> {
    return this.requireCommentStore().listComments(filters);
  }

  async createComment(input: unknown): Promise<PathlensComment> {
    const requestedPath = pathFromCommentInput(input);
    const file = await this.fileSystem.readFile(requestedPath);
    const normalized = normalizeCommentCreateInput(input, {
      resolvedPath: file.path,
      fileHash: file.etag,
      viewerKind: file.viewerKind,
    });
    return this.createNormalizedComment(normalized);
  }

  async updateComment(id: string, input: unknown): Promise<PathlensComment> {
    if (!id.trim()) throw new Error("comment id is required");
    const store = this.requireCommentStore();
    const current = await store.getComment(id.trim());
    if (!current) throw new Error("comment not found");
    const update = normalizeCommentUpdateInput(input);
    return store.updateComment(applyCommentUpdate(current, update, isoNow()));
  }

  async exportCommentsAsJsonl(
    filters: CommentListFilters = {},
  ): Promise<string> {
    const comments = await this.listComments(filters);
    return comments.map(exportCommentAsJsonLine).join("\n");
  }

  subscribe(listener: (event: FsEvent) => void): () => void {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  }

  async start(): Promise<void> {
    await this.watcher?.start((event) => {
      for (const subscriber of this.subscribers) subscriber(event);
    });
  }

  async stop(): Promise<void> {
    await this.watcher?.stop();
    await this.changeReview?.stop?.();
    this.subscribers.clear();
  }

  private async createNormalizedComment(
    input: CreateCommentInput,
  ): Promise<PathlensComment> {
    const now = isoNow();
    const comment: PathlensComment = {
      id: randomUUID(),
      path: input.path,
      viewerKind: input.viewerKind ?? "unknown",
      anchor: input.anchor,
      body: input.body,
      status: input.status ?? "open",
      createdAt: now,
      updatedAt: now,
      resolvedAt: input.status === "resolved" ? now : undefined,
      archivedAt: input.status === "archived" ? now : undefined,
    };
    return this.requireCommentStore().createComment(comment);
  }

  private requireCommentStore() {
    if (!this.commentStore) {
      throw new Error("comments are not configured for this server");
    }
    return this.commentStore;
  }
}

function fallbackFileScore(path: string, terms: string[]): number {
  if (!terms.length) return 1;
  let score = 0;
  for (const term of terms) {
    const index = path.indexOf(term);
    if (index < 0) return 0;
    score += 100 - index;
  }
  return score;
}

function pathFromCommentInput(input: unknown): string {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("invalid comment payload");
  }
  const path = (input as { path?: unknown }).path;
  if (typeof path !== "string" || !path.trim()) {
    throw new Error("path is required");
  }
  return path.trim();
}

function isoNow(): string {
  return new Date().toISOString();
}
