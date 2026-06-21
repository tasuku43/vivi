import type {
  ChangeReviewSummary,
  DiffBaseSummary,
  TextDiff,
} from "../domain/change-review.js";
import {
  applyCommentUpdate,
  buildCommentThreads,
  exportThreadAsJsonLine,
  normalizeCommentCreateInput,
  normalizeCommentUpdateInput,
  type CommentThread,
  type CommentActor,
  type CommentThreadActivityEvent,
  type CommentListFilters,
  type CreateCommentInput,
  type ViviComment,
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
  private activitySubscribers = new Set<
    (event: CommentThreadActivityEvent) => void
  >();

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

  async listComments(filters: CommentListFilters = {}): Promise<ViviComment[]> {
    return this.requireCommentStore().listComments(filters);
  }

  async listCommentThreads(
    filters: CommentListFilters = {},
  ): Promise<CommentThread[]> {
    const store = this.requireCommentStore();
    return (
      store.listCommentThreads?.(filters) ??
      buildCommentThreads(await this.listComments(filters))
    );
  }

  async createComment(input: unknown): Promise<ViviComment> {
    const requestedPath = pathFromCommentInput(input);
    const file = await this.fileSystem.readFile(requestedPath);
    const normalized = normalizeCommentCreateInput(input, {
      resolvedPath: file.path,
      fileHash: file.etag,
      viewerKind: file.viewerKind,
    });
    return this.createNormalizedComment(normalized);
  }

  async createCommentThread(input: unknown): Promise<CommentThread> {
    const comment = await this.createComment(input);
    return (await this.listCommentThreads()).find(
      (thread) => thread.id === comment.threadId,
    )!;
  }

  async addComment(threadId: string, input: unknown): Promise<ViviComment> {
    const thread = (await this.listCommentThreads()).find(
      (item) => item.id === threadId,
    );
    if (!thread) throw new Error("comment thread not found");
    if (thread.status !== "open")
      throw new Error(
        "comment thread must be reopened before adding a comment",
      );
    if (typeof input !== "object" || input === null || Array.isArray(input))
      throw new Error("invalid comment payload");
    const value = input as Record<string, unknown>;
    return this.createComment({
      threadId,
      path: thread.path,
      anchor: thread.anchor,
      body: value.body,
      actor: value.actor,
      author: value.author,
      source: value.source,
      status: "open",
    });
  }

  async updateComment(id: string, input: unknown): Promise<ViviComment> {
    if (!id.trim()) throw new Error("comment id is required");
    const store = this.requireCommentStore();
    const current = await store.getComment(id.trim());
    if (!current) throw new Error("comment not found");
    const update = normalizeCommentUpdateInput(input);
    const transitionedThread = update.status
      ? await this.updateCommentThreadStatus({
          id: current.threadId ?? current.id,
          status: update.status,
        })
      : undefined;
    const updated =
      update.body === undefined
        ? current
        : await store.updateComment(
            applyCommentUpdate(current, { body: update.body }, isoNow()),
          );
    const result = {
      ...updated,
      status: update.status ?? updated.status,
      resolvedAt: transitionedThread?.resolvedAt,
      archivedAt: transitionedThread?.archivedAt,
    };
    if (update.body !== undefined)
      await this.publishLatestActivity(
        result.threadId ?? result.id,
        "comment_updated",
      );
    return result;
  }

  async updateCommentThreadStatus(input: {
    id: string;
    status: ViviComment["status"];
    actor?: CommentActor;
  }): Promise<CommentThread> {
    if (!input.id.trim()) throw new Error("comment thread id is required");
    const store = this.requireCommentStore();
    const existing = (await this.listCommentThreads()).find(
      (thread) => thread.id === input.id,
    );
    if (!existing) throw new Error("comment thread not found");
    assertThreadTransition(existing.status, input.status);
    const now = isoNow();
    if (store.updateCommentThreadStatus) {
      const thread = await store.updateCommentThreadStatus(
        input.id,
        input.status,
        now,
        input.actor,
      );
      await this.publishLatestActivity(input.id, "thread_status_changed");
      return thread;
    }
    const comments = await store.listComments();
    const members = comments.filter(
      (comment) => (comment.threadId ?? comment.id) === input.id,
    );
    if (!members.length) throw new Error("comment thread not found");
    const updated: ViviComment[] = [];
    for (const comment of members) {
      updated.push(
        await store.updateComment(
          applyCommentUpdate(comment, { status: input.status }, now),
        ),
      );
    }
    return buildCommentThreads(updated)[0]!;
  }

  async exportCommentsAsJsonl(
    filters: CommentListFilters = {},
  ): Promise<string> {
    const threads = await this.listCommentThreads(filters);
    return threads.map(exportThreadAsJsonLine).join("\n");
  }

  async listCommentThreadActivities(
    threadId: string,
    after?: string,
    first = 100,
  ): Promise<CommentThreadActivityEvent[]> {
    const store = this.requireCommentStore();
    if (!store.listCommentThreadActivities) return [];
    return store.listCommentThreadActivities(threadId, after, first);
  }

  async observeCommentThreadRead(
    threadId: string,
    actor: CommentActor,
    clientEventId?: string,
  ): Promise<void> {
    const store = this.requireCommentStore();
    if (!store.appendThreadReadActivity) return;
    const event = await store.appendThreadReadActivity(
      threadId,
      actor,
      clientEventId,
    );
    for (const subscriber of this.activitySubscribers) subscriber(event);
  }

  subscribeCommentThreadActivities(
    listener: (event: CommentThreadActivityEvent) => void,
  ): () => void {
    this.activitySubscribers.add(listener);
    return () => this.activitySubscribers.delete(listener);
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
    this.activitySubscribers.clear();
  }

  private async createNormalizedComment(
    input: CreateCommentInput,
  ): Promise<ViviComment> {
    const now = isoNow();
    const id = randomUUID();
    const comment: ViviComment = {
      id,
      threadId: input.threadId ?? id,
      path: input.path,
      viewerKind: input.viewerKind ?? "unknown",
      anchor: input.anchor,
      body: input.body,
      createdBy: input.actor ?? legacyActor(input.source, input.author),
      author: input.author,
      source: input.source ?? "unknown",
      status: input.status ?? "open",
      createdAt: now,
      updatedAt: now,
      resolvedAt: input.status === "resolved" ? now : undefined,
      archivedAt: input.status === "archived" ? now : undefined,
    };
    const store = this.requireCommentStore();
    const created = await store.createComment(comment);
    if (!input.threadId && store.createCommentThread) {
      await store.createCommentThread(buildCommentThreads([created])[0]!);
    }
    await this.publishLatestActivity(
      created.threadId ?? created.id,
      input.threadId ? "comment_added" : "thread_created",
    );
    return created;
  }

  private async publishLatestActivity(
    threadId: string,
    type: CommentThreadActivityEvent["type"],
  ): Promise<void> {
    const events = await this.commentStore?.listCommentThreadActivities?.(
      threadId,
      undefined,
      500,
    );
    let event: CommentThreadActivityEvent | undefined;
    for (let index = (events?.length ?? 0) - 1; index >= 0; index--) {
      if (events?.[index]?.type === type) {
        event = events[index];
        break;
      }
    }
    if (event)
      for (const subscriber of this.activitySubscribers) subscriber(event);
  }

  private requireCommentStore() {
    if (!this.commentStore) {
      throw new Error("comments are not configured for this server");
    }
    return this.commentStore;
  }
}

function legacyActor(
  source: ViviComment["source"],
  author?: string,
): CommentActor {
  const kind = source ?? "unknown";
  return { id: author ? `${kind}:${author}` : kind, kind, displayName: author };
}

function assertThreadTransition(
  from: ViviComment["status"],
  to: ViviComment["status"],
): void {
  if (from === to) return;
  const allowed =
    from === "open"
      ? ["resolved", "archived"]
      : from === "resolved"
        ? ["open", "archived"]
        : ["open"];
  if (!allowed.includes(to))
    throw new Error(`invalid comment thread transition: ${from} -> ${to}`);
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
