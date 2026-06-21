import type { ViviClient } from "../../application/ports/ViviClient.js";
import type {
  CommentListFilters,
  CommentExportFilters,
  CommentStatus,
  CreateCommentInput,
  CommentThreadActivityEvent,
} from "../../domain/comments.js";
import {
  adaptGraphqlComment,
  adaptGraphqlCommentThread,
  adaptGraphqlConfig,
  adaptGraphqlDiff,
  adaptGraphqlFile,
  adaptGraphqlFileSearch,
  adaptGraphqlReviewQueue,
  adaptGraphqlTree,
  adaptGraphqlTextSearch,
  adaptGraphqlWorkspaceEvent,
  adaptGraphqlCommentActivity,
  adaptGraphqlDraftReviewComment,
} from "./adapters/graphql-adapters.js";
import type { GraphqlResponse } from "./dto/graphql-dto.js";
import { print } from "graphql";
import {
  CreateCommentDocument,
  CreateDraftReviewCommentDocument,
  DeleteDraftReviewCommentDocument,
  PublishDraftReviewCommentsDocument,
  UpdateCommentStatusDocument,
  UpdateCommentThreadStatusDocument,
  UpdateDraftReviewCommentDocument,
  ViviCommentExportDocument,
  ViviCommentsDocument,
  ViviCommentThreadsDocument,
  ViviConfigDocument,
  ViviDiffDocument,
  ViviDraftReviewCommentsDocument,
  ViviFileContextDocument,
  ViviFileSearchDocument,
  ViviReviewQueueDocument,
  ViviTextSearchDocument,
  ViviTreeDocument,
  ViviWorkspaceDocument,
  WorkspaceEventsDocument,
  CommentThreadActivityDocument,
  ViviCommentThreadActivitiesDocument,
} from "./graphql/generated/graphql.js";
import type {
  CreateCommentMutation,
  CreateDraftReviewCommentMutation,
  DeleteDraftReviewCommentMutation,
  PublishDraftReviewCommentsMutation,
  UpdateCommentStatusMutation,
  UpdateCommentThreadStatusMutation,
  UpdateDraftReviewCommentMutation,
  ViviCommentExportQuery,
  ViviCommentsQuery,
  ViviCommentThreadsQuery,
  ViviConfigQuery,
  ViviDiffQuery,
  ViviDraftReviewCommentsQuery,
  ViviFileContextQuery,
  ViviFileSearchQuery,
  ViviReviewQueueQuery,
  ViviTextSearchQuery,
  ViviTreeQuery,
  ViviWorkspaceQuery,
  WorkspaceEventsSubscription,
  CommentThreadActivitySubscription,
  ViviCommentThreadActivitiesQuery,
} from "./graphql/generated/graphql.js";

export interface GraphqlViviClientOptions {
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
  createEventSource?: (url: string) => EventSource;
}

export class GraphqlViviClient implements ViviClient {
  private readonly baseUrl: string;
  private readonly request: typeof globalThis.fetch;
  private readonly createEventSource: (url: string) => EventSource;

  constructor(options: GraphqlViviClientOptions = {}) {
    this.baseUrl = options.baseUrl?.replace(/\/$/, "") ?? "";
    this.request = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.createEventSource =
      options.createEventSource ?? ((url) => new EventSource(url));
  }

  async getWorkspace() {
    const data = await this.graphql<ViviWorkspaceQuery>({
      operationName: "ViviWorkspace",
      query: print(ViviWorkspaceDocument),
      variables: { depth: 1 },
    });
    return {
      tree: adaptGraphqlTree(data.workspace.tree),
      config: adaptGraphqlConfig(data.workspace.config),
    };
  }

  async getTree(input: { path?: string; depth?: number } = {}) {
    const data = await this.graphql<ViviTreeQuery>({
      operationName: "ViviTree",
      query: print(ViviTreeDocument),
      variables: { path: input.path, depth: input.depth ?? 1 },
    });
    return adaptGraphqlTree(data.tree);
  }

  async getConfig() {
    const data = await this.graphql<ViviConfigQuery>({
      operationName: "ViviConfig",
      query: print(ViviConfigDocument),
    });
    return adaptGraphqlConfig(data.config);
  }

  async getFileContext(input: {
    path: string;
    includeComments?: boolean;
    includeDiff?: boolean;
    diffBase?: string;
  }) {
    const data = await this.graphql<ViviFileContextQuery>({
      operationName: "ViviFileContext",
      query: print(ViviFileContextDocument),
      variables: input,
    });
    return {
      file: adaptGraphqlFile(data.fileContext.file),
      comments: data.fileContext.comments.map(adaptGraphqlComment),
      commentThreads: data.fileContext.commentThreads.map(
        adaptGraphqlCommentThread,
      ),
      diff: data.fileContext.diff
        ? adaptGraphqlDiff(data.fileContext.diff)
        : undefined,
    };
  }

  async getComments(input: CommentListFilters = {}) {
    const data = await this.graphql<ViviCommentsQuery>({
      operationName: "ViviComments",
      query: print(ViviCommentsDocument),
      variables: input,
    });
    return data.comments.map(adaptGraphqlComment);
  }

  async getCommentThreads(input: CommentListFilters = {}) {
    const data = await this.graphql<ViviCommentThreadsQuery>({
      operationName: "ViviCommentThreads",
      query: print(ViviCommentThreadsDocument),
      variables: input,
    });
    return data.commentThreads.map(adaptGraphqlCommentThread);
  }

  async getDraftReviewComments(input: { path?: string } = {}) {
    const data = await this.graphql<ViviDraftReviewCommentsQuery>({
      operationName: "ViviDraftReviewComments",
      query: print(ViviDraftReviewCommentsDocument),
      variables: input,
    });
    return data.draftReviewComments.map(adaptGraphqlDraftReviewComment);
  }

  async exportComments(input: CommentExportFilters = {}) {
    const data = await this.graphql<ViviCommentExportQuery>({
      operationName: "ViviCommentExport",
      query: print(ViviCommentExportDocument),
      variables: { ...input, format: input.format ?? "jsonl" },
    });
    return data.commentExport.content;
  }

  async getReviewQueue() {
    const data = await this.graphql<ViviReviewQueueQuery>({
      operationName: "ViviReviewQueue",
      query: print(ViviReviewQueueDocument),
    });
    return adaptGraphqlReviewQueue(data.reviewQueue);
  }

  async getDiff(input: { path: string; base?: string }) {
    const data = await this.graphql<ViviDiffQuery>({
      operationName: "ViviDiff",
      query: print(ViviDiffDocument),
      variables: input,
    });
    return adaptGraphqlDiff(data.diff);
  }

  async createComment(input: CreateCommentInput) {
    const data = await this.graphql<CreateCommentMutation>({
      operationName: "CreateComment",
      query: print(CreateCommentDocument),
      variables: { input },
    });
    return adaptGraphqlComment(data.createComment);
  }

  async createDraftReviewComment(input: Omit<CreateCommentInput, "threadId" | "status">) {
    const data = await this.graphql<CreateDraftReviewCommentMutation>({
      operationName: "CreateDraftReviewComment",
      query: print(CreateDraftReviewCommentDocument),
      variables: { input },
    });
    return adaptGraphqlDraftReviewComment(data.createDraftReviewComment);
  }

  async updateDraftReviewComment(input: { id: string; body: string }) {
    const data = await this.graphql<UpdateDraftReviewCommentMutation>({
      operationName: "UpdateDraftReviewComment",
      query: print(UpdateDraftReviewCommentDocument),
      variables: { id: input.id, input: { body: input.body } },
    });
    return adaptGraphqlDraftReviewComment(data.updateDraftReviewComment);
  }

  async deleteDraftReviewComment(id: string) {
    const data = await this.graphql<DeleteDraftReviewCommentMutation>({
      operationName: "DeleteDraftReviewComment",
      query: print(DeleteDraftReviewCommentDocument),
      variables: { id },
    });
    return adaptGraphqlDraftReviewComment(data.deleteDraftReviewComment);
  }

  async publishDraftReviewComments(input: { draftIds?: string[] } = {}) {
    const data = await this.graphql<PublishDraftReviewCommentsMutation>({
      operationName: "PublishDraftReviewComments",
      query: print(PublishDraftReviewCommentsDocument),
      variables: { input },
    });
    return {
      reviewBatchId: data.publishDraftReviewComments.reviewBatchId,
      publishedAt: data.publishDraftReviewComments.publishedAt,
      threads: data.publishDraftReviewComments.threads.map(
        adaptGraphqlCommentThread,
      ),
    };
  }

  async updateCommentStatus(input: { id: string; status: CommentStatus }) {
    const data = await this.graphql<UpdateCommentStatusMutation>({
      operationName: "UpdateCommentStatus",
      query: print(UpdateCommentStatusDocument),
      variables: input,
    });
    return adaptGraphqlComment(data.updateComment);
  }

  async updateCommentThreadStatus(input: {
    id: string;
    status: CommentStatus;
  }) {
    const data = await this.graphql<UpdateCommentThreadStatusMutation>({
      operationName: "UpdateCommentThreadStatus",
      query: print(UpdateCommentThreadStatusDocument),
      variables: input,
    });
    return adaptGraphqlCommentThread(data.updateCommentThread);
  }

  async getCommentThreadActivities(input: {
    threadId: string;
    after?: string;
    first?: number;
  }) {
    const data = await this.graphql<ViviCommentThreadActivitiesQuery>({
      operationName: "ViviCommentThreadActivities",
      query: print(ViviCommentThreadActivitiesDocument),
      variables: input,
    });
    return data.commentThreadActivities.map(adaptGraphqlCommentActivity);
  }

  subscribeCommentThreadActivities(
    threadId: string | undefined,
    onEvent: (event: CommentThreadActivityEvent) => void,
  ) {
    const params = new URLSearchParams({
      operationName: "CommentThreadActivity",
      query: print(CommentThreadActivityDocument),
      variables: JSON.stringify({ threadId }),
    });
    const source = this.createEventSource(this.url(`/graphql?${params}`));
    const listener = (raw: Event) => {
      const payload = JSON.parse((raw as MessageEvent<string>).data) as {
        data: CommentThreadActivitySubscription;
      };
      onEvent(adaptGraphqlCommentActivity(payload.data.commentThreadActivity));
    };
    source.addEventListener("next", listener);
    source.addEventListener("message", listener);
    return () => source.close();
  }

  async searchFiles(input: {
    query: string;
    limit?: number;
    signal?: AbortSignal;
  }) {
    const data = await this.graphql<ViviFileSearchQuery>(
      {
        operationName: "ViviFileSearch",
        query: print(ViviFileSearchDocument),
        variables: { query: input.query, limit: input.limit ?? 40 },
      },
      { signal: input.signal },
    );
    return adaptGraphqlFileSearch(data.fileSearch);
  }

  async searchText(input: {
    query: string;
    limit?: number;
    signal?: AbortSignal;
  }) {
    const data = await this.graphql<ViviTextSearchQuery>(
      {
        operationName: "ViviTextSearch",
        query: print(ViviTextSearchDocument),
        variables: { query: input.query, limit: input.limit ?? 40 },
      },
      { signal: input.signal },
    );
    return adaptGraphqlTextSearch(data.textSearch);
  }

  subscribeWorkspaceEvents(
    onEvent: (event: ReturnType<typeof adaptGraphqlWorkspaceEvent>) => void,
  ) {
    const params = new URLSearchParams({
      operationName: "WorkspaceEvents",
      query: print(WorkspaceEventsDocument),
    });
    const source = this.createEventSource(this.url(`/graphql?${params}`));
    const listener = (raw: Event) => {
      const event = parseWorkspaceEvent((raw as MessageEvent<string>).data);
      onEvent(adaptGraphqlWorkspaceEvent(event));
    };
    source.addEventListener("next", listener);
    source.addEventListener("message", listener);
    return () => source.close();
  }

  private async graphql<T>(
    body: { operationName: string; query: string; variables?: unknown },
    init: Pick<RequestInit, "signal"> = {},
  ): Promise<T> {
    const response = await this.request(this.url("/graphql"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: init.signal,
    });
    if (!response.ok) {
      throw new Error(`/graphql request failed: ${response.status}`);
    }
    const payload = (await response.json()) as GraphqlResponse<T>;
    if (payload.errors?.length) {
      throw new Error(payload.errors.map((error) => error.message).join("; "));
    }
    if (!payload.data) {
      throw new Error("/graphql response did not include data");
    }
    return payload.data;
  }

  private url(path: string) {
    return `${this.baseUrl}${path}`;
  }
}

function parseWorkspaceEvent(
  raw: string,
): WorkspaceEventsSubscription["workspaceEvents"] {
  const payload = JSON.parse(raw) as
    | WorkspaceEventsSubscription["workspaceEvents"]
    | { data?: WorkspaceEventsSubscription };
  if ("data" in payload && payload.data?.workspaceEvents) {
    return payload.data.workspaceEvents;
  }
  return payload as WorkspaceEventsSubscription["workspaceEvents"];
}
