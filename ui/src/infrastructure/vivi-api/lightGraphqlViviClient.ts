import type {
  ViviClient,
  WorkspaceEventSubscriptionOptions,
} from "../../application/ports/ViviClient.js";
import type {
  CommentListFilters,
  CommentExportFilters,
  CommentStatus,
  CreateDraftReviewCommentInput,
  CreateCommentInput,
  CommentThreadActivityEvent,
} from "../../domain/comments.js";
import type { ReviewLedgerSnapshot } from "../../domain/review-ledger.js";
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

export interface LightGraphqlViviClientOptions {
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
  createEventSource?: (url: string) => EventSource;
}

export class LightGraphqlViviClient implements ViviClient {
  private readonly baseUrl: string;
  private readonly request: typeof globalThis.fetch;
  private readonly createEventSource: (url: string) => EventSource;

  constructor(options: LightGraphqlViviClientOptions = {}) {
    this.baseUrl = options.baseUrl?.replace(/\/$/, "") ?? "";
    this.request = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.createEventSource =
      options.createEventSource ?? ((url) => new EventSource(url));
  }

  async getWorkspace() {
    const data = await this.graphql<ViviWorkspaceQuery>({
      operationName: "ViviWorkspace",
      query: operations.ViviWorkspace,
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
      query: operations.ViviTree,
      variables: { path: input.path, depth: input.depth ?? 1 },
    });
    return adaptGraphqlTree(data.tree);
  }

  async getConfig() {
    const data = await this.graphql<ViviConfigQuery>({
      operationName: "ViviConfig",
      query: operations.ViviConfig,
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
      query: operations.ViviFileContext,
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
      query: operations.ViviComments,
      variables: input,
    });
    return data.comments.map(adaptGraphqlComment);
  }

  async getCommentThreads(input: CommentListFilters = {}) {
    const data = await this.graphql<ViviCommentThreadsQuery>({
      operationName: "ViviCommentThreads",
      query: operations.ViviCommentThreads,
      variables: input,
    });
    return data.commentThreads.map(adaptGraphqlCommentThread);
  }

  async getDraftReviewComments(input: { path?: string } = {}) {
    const data = await this.graphql<ViviDraftReviewCommentsQuery>({
      operationName: "ViviDraftReviewComments",
      query: operations.ViviDraftReviewComments,
      variables: input,
    });
    return data.draftReviewComments.map(adaptGraphqlDraftReviewComment);
  }

  async exportComments(input: CommentExportFilters = {}) {
    const data = await this.graphql<ViviCommentExportQuery>({
      operationName: "ViviCommentExport",
      query: operations.ViviCommentExport,
      variables: { ...input, format: input.format ?? "jsonl" },
    });
    return data.commentExport.content;
  }

  async getReviewQueue() {
    const data = await this.graphql<ViviReviewQueueQuery>({
      operationName: "ViviReviewQueue",
      query: operations.ViviReviewQueue,
    });
    return adaptGraphqlReviewQueue(data.reviewQueue);
  }

  async getReviewLedger(): Promise<ReviewLedgerSnapshot> {
    return this.getJson<ReviewLedgerSnapshot>("/api/v1/review-ledger");
  }

  async saveReviewLedger(
    input: ReviewLedgerSnapshot,
  ): Promise<ReviewLedgerSnapshot> {
    return this.getJson<ReviewLedgerSnapshot>("/api/v1/review-ledger", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
  }

  async getDiff(input: { path: string; base?: string }) {
    const data = await this.graphql<ViviDiffQuery>({
      operationName: "ViviDiff",
      query: operations.ViviDiff,
      variables: input,
    });
    return adaptGraphqlDiff(data.diff);
  }

  async createComment(input: CreateCommentInput) {
    const data = await this.graphql<CreateCommentMutation>({
      operationName: "CreateComment",
      query: operations.CreateComment,
      variables: { input },
    });
    return adaptGraphqlComment(data.createComment);
  }

  async createDraftReviewComment(input: CreateDraftReviewCommentInput) {
    const data = await this.graphql<CreateDraftReviewCommentMutation>({
      operationName: "CreateDraftReviewComment",
      query: operations.CreateDraftReviewComment,
      variables: { input },
    });
    return adaptGraphqlDraftReviewComment(data.createDraftReviewComment);
  }

  async updateDraftReviewComment(input: { id: string; body: string }) {
    const data = await this.graphql<UpdateDraftReviewCommentMutation>({
      operationName: "UpdateDraftReviewComment",
      query: operations.UpdateDraftReviewComment,
      variables: { id: input.id, input: { body: input.body } },
    });
    return adaptGraphqlDraftReviewComment(data.updateDraftReviewComment);
  }

  async deleteDraftReviewComment(id: string) {
    const data = await this.graphql<DeleteDraftReviewCommentMutation>({
      operationName: "DeleteDraftReviewComment",
      query: operations.DeleteDraftReviewComment,
      variables: { id },
    });
    return adaptGraphqlDraftReviewComment(data.deleteDraftReviewComment);
  }

  async publishDraftReviewComments(input: { draftIds?: string[] } = {}) {
    const data = await this.graphql<PublishDraftReviewCommentsMutation>({
      operationName: "PublishDraftReviewComments",
      query: operations.PublishDraftReviewComments,
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
      query: operations.UpdateCommentStatus,
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
      query: operations.UpdateCommentThreadStatus,
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
      query: operations.ViviCommentThreadActivities,
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
      query: operations.CommentThreadActivity,
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
        query: operations.ViviFileSearch,
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
        query: operations.ViviTextSearch,
        variables: { query: input.query, limit: input.limit ?? 40 },
      },
      { signal: input.signal },
    );
    return adaptGraphqlTextSearch(data.textSearch);
  }

  subscribeWorkspaceEvents(
    onEvent: (event: ReturnType<typeof adaptGraphqlWorkspaceEvent>) => void,
    options: WorkspaceEventSubscriptionOptions = {},
  ) {
    const params = new URLSearchParams({
      operationName: "WorkspaceEvents",
      query: operations.WorkspaceEvents,
    });
    const source = this.createEventSource(this.url(`/graphql?${params}`));
    options.onStatus?.("connecting");
    source.addEventListener("open", () => options.onStatus?.("connected"));
    source.addEventListener("error", () =>
      options.onStatus?.("disconnected"),
    );
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

  private async getJson<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await this.request(this.url(path), init);
    if (!response.ok) {
      throw new Error(`${path} request failed: ${response.status}`);
    }
    return response.json() as Promise<T>;
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

const treeFields = `
fragment TreeFields on TreeSnapshot {
  root
  version
  path
  depth
  stats {
    durationMs
    scannedDirectories
    scannedFiles
    returnedNodes
  }
  nodes {
    id
    path
    name
    kind
    parentPath
    viewerKind
    childrenLoaded
    size
    mtimeMs
    version
    children {
      id
      path
      name
      kind
      parentPath
      viewerKind
      childrenLoaded
      size
      mtimeMs
      version
    }
  }
}`;

const configFields = `
fragment ConfigFields on ViewerConfig {
  root
  allowHtmlScripts
  maxFileSizeBytes
  reviewActor {
    id
    kind
    displayName
  }
}`;

const fileFields = `
fragment FileFields on FilePayload {
  path
  viewerKind
  encoding
  content
  etag
  size
  mtimeMs
  mimeType
  truncated
  maxSizeBytes
  previewBytes
}`;

const commentFields = `
fragment CommentFields on Comment {
  id
  threadId
  path
  viewerKind
  reviewBatchId
  anchor
  diffAnchor {
    path
    base
    ref
    hunkId
    side
    oldLineStart
    oldLineEnd
    newLineStart
    newLineEnd
    diffHash
    fileHash
  }
  body
  createdBy {
    id
    kind
    displayName
  }
  author
  source
  status
  createdAt
  updatedAt
  resolvedAt
  archivedAt
}`;

const threadFields = `
fragment ThreadFields on CommentThread {
  id
  path
  status
  reviewBatchId
  anchor
  diffAnchor {
    path
    base
    ref
    hunkId
    side
    oldLineStart
    oldLineEnd
    newLineStart
    newLineEnd
    diffHash
    fileHash
  }
  updatedAt
  createdAt
  resolvedAt
  archivedAt
  comments {
    ...CommentFields
  }
}`;

const draftReviewCommentFields = `
fragment DraftReviewCommentFields on DraftReviewComment {
  id
  threadId
  path
  viewerKind
  anchor
  diffAnchor {
    path
    base
    ref
    hunkId
    side
    oldLineStart
    oldLineEnd
    newLineStart
    newLineEnd
    diffHash
    fileHash
  }
  body
  createdBy {
    id
    kind
    displayName
  }
  author
  source
  createdAt
  updatedAt
}`;

const diffFields = `
fragment DiffFields on TextDiff {
  path
  status
  kind
  baseLabel
  baseRef
  compareLabel
  diffHash
  content
  reason
}`;

const commentActivityFields = `
id
threadId
type
actor {
  id
  kind
  displayName
}
commentId
previousStatus
status
clientEventId
leaseExpiresAt
createdAt`;

const operations = {
  ViviWorkspace: `${treeFields}${configFields}
query ViviWorkspace($path: String, $depth: Int) {
  workspace(path: $path, depth: $depth) {
    tree { ...TreeFields }
    config { ...ConfigFields }
  }
}`,
  ViviTree: `${treeFields}
query ViviTree($path: String, $depth: Int) {
  tree(path: $path, depth: $depth) { ...TreeFields }
}`,
  ViviConfig: `${configFields}
query ViviConfig {
  config { ...ConfigFields }
}`,
  ViviFileContext: `${fileFields}${commentFields}${threadFields}${diffFields}
query ViviFileContext($path: String!, $includeComments: Boolean, $includeDiff: Boolean, $diffBase: String) {
  fileContext(path: $path, includeComments: $includeComments, includeDiff: $includeDiff, diffBase: $diffBase) {
    file { ...FileFields }
    comments { ...CommentFields }
    commentThreads { ...ThreadFields }
    diff { ...DiffFields }
  }
}`,
  ViviComments: `${commentFields}
query ViviComments($path: String, $status: CommentStatus) {
  comments(path: $path, status: $status) { ...CommentFields }
}`,
  ViviCommentThreads: `${commentFields}${threadFields}
query ViviCommentThreads($path: String, $status: CommentStatus) {
  commentThreads(path: $path, status: $status) { ...ThreadFields }
}`,
  ViviDraftReviewComments: `${draftReviewCommentFields}
query ViviDraftReviewComments($path: String) {
  draftReviewComments(path: $path) { ...DraftReviewCommentFields }
}`,
  ViviCommentThreadActivities: `
query ViviCommentThreadActivities($threadId: ID!, $after: ID, $first: Int) {
  commentThreadActivities(threadId: $threadId, after: $after, first: $first) {
    ${commentActivityFields}
  }
}`,
  ViviCommentExport: `
query ViviCommentExport($path: String, $status: CommentStatus, $format: CommentExportFormat) {
  commentExport(path: $path, status: $status, format: $format) {
    format
    contentType
    content
  }
}`,
  ViviReviewQueue: `
query ViviReviewQueue {
  reviewQueue {
    available
    reason
    changes {
      path
      status
      kind
      originalPath
    }
  }
}`,
  ViviDiff: `${diffFields}
query ViviDiff($path: String!, $base: String) {
  diff(path: $path, base: $base) { ...DiffFields }
}`,
  ViviFileSearch: `
query ViviFileSearch($query: String!, $limit: Int) {
  fileSearch(query: $query, limit: $limit) {
    results {
      path
      name
      viewerKind
      size
      mtimeMs
      score
    }
  }
}`,
  ViviTextSearch: `
query ViviTextSearch($query: String!, $limit: Int) {
  textSearch(query: $query, limit: $limit) {
    results {
      path
      viewerKind
      lineNumber
      lineText
      matchStart
      matchLength
    }
  }
}`,
  CreateComment: `${commentFields}
mutation CreateComment($input: CommentInput!) {
  createComment(input: $input) { ...CommentFields }
}`,
  CreateDraftReviewComment: `${draftReviewCommentFields}
mutation CreateDraftReviewComment($input: DraftReviewCommentInput!) {
  createDraftReviewComment(input: $input) { ...DraftReviewCommentFields }
}`,
  UpdateDraftReviewComment: `${draftReviewCommentFields}
mutation UpdateDraftReviewComment($id: ID!, $input: DraftReviewCommentUpdateInput!) {
  updateDraftReviewComment(id: $id, input: $input) { ...DraftReviewCommentFields }
}`,
  DeleteDraftReviewComment: `${draftReviewCommentFields}
mutation DeleteDraftReviewComment($id: ID!) {
  deleteDraftReviewComment(id: $id) { ...DraftReviewCommentFields }
}`,
  PublishDraftReviewComments: `${commentFields}${threadFields}
mutation PublishDraftReviewComments($input: PublishDraftReviewCommentsInput) {
  publishDraftReviewComments(input: $input) {
    reviewBatchId
    publishedAt
    threads { ...ThreadFields }
  }
}`,
  UpdateCommentStatus: `${commentFields}
mutation UpdateCommentStatus($id: ID!, $status: CommentStatus!) {
  updateComment(id: $id, input: { status: $status }) { ...CommentFields }
}`,
  UpdateCommentThreadStatus: `${commentFields}${threadFields}
mutation UpdateCommentThreadStatus($id: ID!, $status: CommentStatus!) {
  updateCommentThread(id: $id, input: { status: $status }) { ...ThreadFields }
}`,
  WorkspaceEvents: `
subscription WorkspaceEvents {
  workspaceEvents {
    type
    path
    kind
    version
  }
}`,
  CommentThreadActivity: `
subscription CommentThreadActivity($threadId: ID) {
  commentThreadActivity(threadId: $threadId) {
    ${commentActivityFields}
  }
}`,
} as const;
