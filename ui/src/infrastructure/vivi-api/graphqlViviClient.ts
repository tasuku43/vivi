import type { ViviClient } from "../../application/ports/ViviClient.js";
import type {
  CommentListFilters,
  CommentExportFilters,
  CommentStatus,
  CreateCommentInput,
} from "../../domain/comments.js";
import {
  adaptGraphqlComment,
  adaptGraphqlCommentThread,
  adaptGraphqlConfig,
  adaptGraphqlDiff,
  adaptGraphqlFile,
  adaptGraphqlReviewQueue,
  adaptGraphqlTree,
  adaptGraphqlWorkspaceEvent,
} from "./adapters/graphql-adapters.js";
import type {
  GraphqlCommentDto,
  GraphqlCommentExportDto,
  GraphqlCommentThreadDto,
  GraphqlConfigDto,
  GraphqlDiffDto,
  GraphqlFileDto,
  GraphqlFileSearchDto,
  GraphqlResponse,
  GraphqlReviewQueueDto,
  GraphqlTextSearchDto,
  GraphqlTreeDto,
  GraphqlWorkspaceEventDto,
} from "./dto/graphql-dto.js";

const treeSelection = `{
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

const configSelection = `{
  root
  allowHtmlScripts
  maxFileSizeBytes
}`;

const fileSelection = `{
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

const commentSelection = `{
  id
  threadId
  path
  viewerKind
  anchor
  body
  status
  createdAt
  updatedAt
  resolvedAt
  archivedAt
}`;

const commentThreadSelection = `{
  id
  path
  status
  anchor
  updatedAt
  comments ${commentSelection}
}`;

const diffSelection = `{
  path
  status
  kind
  baseLabel
  compareLabel
  content
  reason
}`;

const reviewQueueSelection = `{
  available
  reason
  changes {
    path
    status
    kind
    originalPath
  }
}`;

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
    const data = await this.graphql<{
      workspace: { tree: GraphqlTreeDto; config: GraphqlConfigDto };
    }>({
      operationName: "ViviWorkspace",
      query: `query ViviWorkspace($path: String, $depth: Int) {
        workspace(path: $path, depth: $depth) {
          tree ${treeSelection}
          config ${configSelection}
        }
      }`,
      variables: { depth: 1 },
    });
    return {
      tree: adaptGraphqlTree(data.workspace.tree),
      config: adaptGraphqlConfig(data.workspace.config),
    };
  }

  async getTree(input: { path?: string; depth?: number } = {}) {
    const data = await this.graphql<{ tree: GraphqlTreeDto }>({
      operationName: "ViviTree",
      query: `query ViviTree($path: String, $depth: Int) {
        tree(path: $path, depth: $depth) ${treeSelection}
      }`,
      variables: { path: input.path, depth: input.depth ?? 1 },
    });
    return adaptGraphqlTree(data.tree);
  }

  async getConfig() {
    const data = await this.graphql<{ config: GraphqlConfigDto }>({
      operationName: "ViviConfig",
      query: `query ViviConfig { config ${configSelection} }`,
    });
    return adaptGraphqlConfig(data.config);
  }

  async getFileContext(input: {
    path: string;
    includeComments?: boolean;
    includeDiff?: boolean;
    diffBase?: string;
  }) {
    const data = await this.graphql<{
      fileContext: {
        file: GraphqlFileDto;
        comments: GraphqlCommentDto[];
        commentThreads: GraphqlCommentThreadDto[];
        diff?: GraphqlDiffDto;
      };
    }>({
      operationName: "ViviFileContext",
      query: `query ViviFileContext(
        $path: String!
        $includeComments: Boolean
        $includeDiff: Boolean
        $diffBase: String
      ) {
        fileContext(
          path: $path
          includeComments: $includeComments
          includeDiff: $includeDiff
          diffBase: $diffBase
        ) {
          file ${fileSelection}
          comments ${commentSelection}
          commentThreads ${commentThreadSelection}
          diff ${diffSelection}
        }
      }`,
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
    const data = await this.graphql<{ comments: GraphqlCommentDto[] }>({
      operationName: "ViviComments",
      query: `query ViviComments($path: String, $status: CommentStatus) {
        comments(path: $path, status: $status) ${commentSelection}
        commentThreads(path: $path, status: $status) {
          id
          path
          status
          anchor
          updatedAt
          comments ${commentSelection}
        }
      }`,
      variables: input,
    });
    return data.comments.map(adaptGraphqlComment);
  }

  async getCommentThreads(input: CommentListFilters = {}) {
    const data = await this.graphql<{
      commentThreads: GraphqlCommentThreadDto[];
    }>({
      operationName: "ViviCommentThreads",
      query: `query ViviCommentThreads($path: String, $status: CommentStatus) {
        commentThreads(path: $path, status: $status) ${commentThreadSelection}
      }`,
      variables: input,
    });
    return data.commentThreads.map(adaptGraphqlCommentThread);
  }

  async exportComments(input: CommentExportFilters = {}) {
    const data = await this.graphql<{
      commentExport: GraphqlCommentExportDto;
    }>({
      operationName: "ViviCommentExport",
      query: `query ViviCommentExport(
        $path: String
        $status: CommentStatus
        $format: CommentExportFormat
      ) {
        commentExport(path: $path, status: $status, format: $format) {
          format
          contentType
          content
        }
      }`,
      variables: { ...input, format: input.format ?? "jsonl" },
    });
    return data.commentExport.content;
  }

  async getReviewQueue() {
    const data = await this.graphql<{ reviewQueue: GraphqlReviewQueueDto }>({
      operationName: "ViviReviewQueue",
      query: `query ViviReviewQueue { reviewQueue ${reviewQueueSelection} }`,
    });
    return adaptGraphqlReviewQueue(data.reviewQueue);
  }

  async getDiff(input: { path: string; base?: string }) {
    const data = await this.graphql<{ diff: GraphqlDiffDto }>({
      operationName: "ViviDiff",
      query: `query ViviDiff($path: String!, $base: String) {
        diff(path: $path, base: $base) ${diffSelection}
      }`,
      variables: input,
    });
    return adaptGraphqlDiff(data.diff);
  }

  async createComment(input: CreateCommentInput) {
    const data = await this.graphql<{ createComment: GraphqlCommentDto }>({
      operationName: "CreateComment",
      query: `mutation CreateComment($input: CommentInput!) {
        createComment(input: $input) ${commentSelection}
      }`,
      variables: { input },
    });
    return adaptGraphqlComment(data.createComment);
  }

  async updateCommentStatus(input: { id: string; status: CommentStatus }) {
    const data = await this.graphql<{ updateComment: GraphqlCommentDto }>({
      operationName: "UpdateCommentStatus",
      query: `mutation UpdateCommentStatus($id: ID!, $status: CommentStatus!) {
        updateComment(id: $id, input: { status: $status }) ${commentSelection}
      }`,
      variables: input,
    });
    return adaptGraphqlComment(data.updateComment);
  }

  async updateCommentThreadStatus(input: {
    id: string;
    status: CommentStatus;
  }) {
    const data = await this.graphql<{
      updateCommentThread: GraphqlCommentThreadDto;
    }>({
      operationName: "UpdateCommentThreadStatus",
      query: `mutation UpdateCommentThreadStatus($id: ID!, $status: CommentStatus!) {
        updateCommentThread(id: $id, input: { status: $status }) ${commentThreadSelection}
      }`,
      variables: input,
    });
    return adaptGraphqlCommentThread(data.updateCommentThread);
  }

  async searchFiles(input: {
    query: string;
    limit?: number;
    signal?: AbortSignal;
  }) {
    const data = await this.graphql<{ fileSearch: GraphqlFileSearchDto }>(
      {
        operationName: "ViviFileSearch",
        query: `query ViviFileSearch($query: String!, $limit: Int) {
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
        variables: { query: input.query, limit: input.limit ?? 40 },
      },
      { signal: input.signal },
    );
    return data.fileSearch.results;
  }

  async searchText(input: {
    query: string;
    limit?: number;
    signal?: AbortSignal;
  }) {
    const data = await this.graphql<{ textSearch: GraphqlTextSearchDto }>(
      {
        operationName: "ViviTextSearch",
        query: `query ViviTextSearch($query: String!, $limit: Int) {
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
        variables: { query: input.query, limit: input.limit ?? 40 },
      },
      { signal: input.signal },
    );
    return data.textSearch.results;
  }

  subscribeWorkspaceEvents(onEvent: (event: GraphqlWorkspaceEventDto) => void) {
    const params = new URLSearchParams({
      operationName: "WorkspaceEvents",
      query:
        "subscription WorkspaceEvents { workspaceEvents { type path kind version } }",
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

function parseWorkspaceEvent(raw: string): GraphqlWorkspaceEventDto {
  const payload = JSON.parse(raw) as
    | GraphqlWorkspaceEventDto
    | { data?: { workspaceEvents?: GraphqlWorkspaceEventDto } };
  if ("data" in payload && payload.data?.workspaceEvents) {
    return payload.data.workspaceEvents;
  }
  return payload as GraphqlWorkspaceEventDto;
}
