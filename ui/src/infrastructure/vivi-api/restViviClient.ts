import type {
  ViviClient,
  WorkspaceEventSubscriptionOptions,
} from "../../application/ports/ViviClient.js";
import {
  buildCommentThreads,
  type CommentExportFilters,
  type CreateCommentInput,
} from "../../domain/comments.js";
import {
  adaptComment,
  adaptConfig,
  adaptDiff,
  adaptFile,
  adaptReviewQueue,
  adaptTree,
  adaptWorkspaceEvent,
} from "./adapters/rest-adapters.js";
import type {
  RestCommentDto,
  RestConfigDto,
  RestDiffDto,
  RestFileDto,
  RestFileSearchDto,
  RestReviewQueueDto,
  RestTextSearchDto,
  RestTreeDto,
  RestWorkspaceEventDto,
} from "./dto/rest-dto.js";

export interface RestViviClientOptions {
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
  createEventSource?: (url: string) => EventSource;
}

export class RestViviClient implements ViviClient {
  private readonly baseUrl: string;
  private readonly request: typeof globalThis.fetch;
  private readonly createEventSource: (url: string) => EventSource;

  constructor(options: RestViviClientOptions = {}) {
    this.baseUrl = options.baseUrl?.replace(/\/$/, "") ?? "";
    this.request = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.createEventSource =
      options.createEventSource ?? ((url) => new EventSource(url));
  }

  async getWorkspace() {
    const [tree, config] = await Promise.all([
      this.getTree(),
      this.getConfig(),
    ]);
    return { tree, config };
  }

  async getTree(input: { path?: string; depth?: number } = {}) {
    const params = new URLSearchParams({ depth: String(input.depth ?? 1) });
    if (input.path) params.set("path", input.path);
    return adaptTree(await this.getJson<RestTreeDto>(`/api/tree?${params}`));
  }

  async getConfig() {
    return adaptConfig(await this.getJson<RestConfigDto>("/api/config"));
  }

  async getFileContext(input: {
    path: string;
    includeComments?: boolean;
    includeDiff?: boolean;
    diffBase?: string;
  }) {
    const filePromise = this.getJson<RestFileDto>(
      `/api/file?path=${encodeURIComponent(input.path)}`,
    ).then(adaptFile);
    const commentsPromise = input.includeComments
      ? this.getComments({ path: input.path })
      : Promise.resolve([]);
    const diffPromise = input.includeDiff
      ? this.getDiff({ path: input.path, base: input.diffBase })
      : Promise.resolve(undefined);
    const [file, comments, diff] = await Promise.all([
      filePromise,
      commentsPromise,
      diffPromise,
    ]);
    return { file, comments, commentThreads: buildCommentThreads(comments), diff };
  }

  async getComments(input: { path?: string; status?: string } = {}) {
    const params = new URLSearchParams();
    if (input.path) params.set("path", input.path);
    if (input.status) params.set("status", input.status);
    const dtos = await this.getJson<RestCommentDto[]>(
      `/api/v1/comments?${params}`,
    );
    return dtos.map(adaptComment);
  }

  async getCommentThreads(input: { path?: string; status?: string } = {}) {
    return buildCommentThreads(await this.getComments(input));
  }

  async exportComments(input: CommentExportFilters = {}) {
    const params = new URLSearchParams({ format: input.format ?? "jsonl" });
    if (input.path) params.set("path", input.path);
    if (input.status) params.set("status", input.status);
    const response = await this.request(
      this.url(`/api/v1/comments/export?${params}`),
    );
    if (!response.ok) {
      throw new Error(`/api/v1/comments/export request failed: ${response.status}`);
    }
    return response.text();
  }

  async getDraftReviewComments() {
    return [];
  }

  async getReviewQueue() {
    return adaptReviewQueue(
      await this.getJson<RestReviewQueueDto>("/api/changes"),
    );
  }

  async getDiff(input: { path: string; base?: string }) {
    const params = new URLSearchParams({
      path: input.path,
      base: input.base ?? "HEAD",
    });
    return adaptDiff(await this.getJson<RestDiffDto>(`/api/diff?${params}`));
  }

  async createComment(input: CreateCommentInput) {
    return adaptComment(
      await this.getJson<RestCommentDto>("/api/v1/comments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      }),
    );
  }

  async createDraftReviewComment(): Promise<never> {
    throw new Error("draft review comments require the GraphQL Vivi client");
  }

  async updateDraftReviewComment(): Promise<never> {
    throw new Error("draft review comments require the GraphQL Vivi client");
  }

  async deleteDraftReviewComment(): Promise<never> {
    throw new Error("draft review comments require the GraphQL Vivi client");
  }

  async publishDraftReviewComments(): Promise<never> {
    throw new Error("draft review comments require the GraphQL Vivi client");
  }

  async updateCommentStatus(input: {
    id: string;
    status: "open" | "resolved" | "archived";
  }) {
    return adaptComment(
      await this.getJson<RestCommentDto>(
        `/api/v1/comments/${encodeURIComponent(input.id)}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ status: input.status }),
        },
      ),
    );
  }

  async updateCommentThreadStatus(input: {
    id: string;
    status: "open" | "resolved" | "archived";
  }) {
    const comments = await this.getComments();
    const members = comments.filter(
      (comment) => (comment.threadId ?? comment.id) === input.id,
    );
    if (!members.length) throw new Error("comment thread not found");
    const updated = await Promise.all(
      members.map((comment) =>
        this.updateCommentStatus({ id: comment.id, status: input.status }),
      ),
    );
    return buildCommentThreads(updated)[0]!;
  }

  async searchFiles(input: {
    query: string;
    limit?: number;
    signal?: AbortSignal;
  }) {
    const params = new URLSearchParams({
      q: input.query,
      limit: String(input.limit ?? 40),
    });
    const result = await this.getJson<RestFileSearchDto>(
      `/api/files?${params}`,
      {
        signal: input.signal,
      },
    );
    return result.results;
  }

  async searchText(input: {
    query: string;
    limit?: number;
    signal?: AbortSignal;
  }) {
    const params = new URLSearchParams({
      q: input.query,
      limit: String(input.limit ?? 40),
    });
    const result = await this.getJson<RestTextSearchDto>(
      `/api/search?${params}`,
      {
        signal: input.signal,
      },
    );
    return result.results;
  }

  subscribeWorkspaceEvents(
    onEvent: (event: RestWorkspaceEventDto) => void,
    options: WorkspaceEventSubscriptionOptions = {},
  ) {
    const source = this.createEventSource(this.url("/events"));
    options.onStatus?.("connecting");
    source.addEventListener("open", () => options.onStatus?.("connected"));
    source.addEventListener("error", () =>
      options.onStatus?.("disconnected"),
    );
    const listener = (raw: Event) => {
      const event = JSON.parse(
        (raw as MessageEvent<string>).data,
      ) as RestWorkspaceEventDto;
      onEvent(adaptWorkspaceEvent(event));
    };
    source.addEventListener("fs", listener);
    return () => source.close();
  }

  private async getJson<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await this.request(this.url(path), init);
    if (!response.ok) {
      throw new Error(
        `${path.split("?")[0]} request failed: ${response.status}`,
      );
    }
    return (await response.json()) as T;
  }

  private url(path: string) {
    return `${this.baseUrl}${path}`;
  }
}
