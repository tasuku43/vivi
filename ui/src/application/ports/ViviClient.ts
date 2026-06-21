import type {
  ChangeReviewSummary,
  TextDiff,
} from "../../domain/change-review.js";
import type {
  CommentListFilters,
  CommentExportFilters,
  CommentStatus,
  CommentThreadActivityEvent,
  CommentThread,
  CreateDraftReviewCommentInput,
  CreateCommentInput,
  DraftReviewComment,
  PublishedReviewBatch,
  UpdateDraftReviewCommentInput,
  ViviComment,
} from "../../domain/comments.js";
import type { FileContext } from "../../domain/file-context.js";
import type {
  FsEvent,
  TreeSnapshot,
  ViewerConfig,
} from "../../domain/fs-node.js";
import type {
  FileSearchResult,
  TextSearchResult,
} from "../../domain/search.js";
import type { WorkspaceSnapshot } from "../../domain/workspace.js";

export interface ViviClient {
  getWorkspace(): Promise<WorkspaceSnapshot>;
  getTree(input?: { path?: string; depth?: number }): Promise<TreeSnapshot>;
  getConfig(): Promise<ViewerConfig>;
  getFileContext(input: {
    path: string;
    includeComments?: boolean;
    includeDiff?: boolean;
    diffBase?: string;
  }): Promise<FileContext>;
  getComments(input?: CommentListFilters): Promise<ViviComment[]>;
  getCommentThreads(input?: CommentListFilters): Promise<CommentThread[]>;
  exportComments(input?: CommentExportFilters): Promise<string>;
  getDraftReviewComments(input?: { path?: string }): Promise<DraftReviewComment[]>;
  getReviewQueue(): Promise<ChangeReviewSummary>;
  getDiff(input: { path: string; base?: string }): Promise<TextDiff>;
  createComment(input: CreateCommentInput): Promise<ViviComment>;
  createDraftReviewComment(
    input: CreateDraftReviewCommentInput,
  ): Promise<DraftReviewComment>;
  updateDraftReviewComment(
    input: UpdateDraftReviewCommentInput,
  ): Promise<DraftReviewComment>;
  deleteDraftReviewComment(id: string): Promise<DraftReviewComment>;
  publishDraftReviewComments(input?: {
    draftIds?: string[];
  }): Promise<PublishedReviewBatch>;
  updateCommentStatus(input: {
    id: string;
    status: CommentStatus;
  }): Promise<ViviComment>;
  updateCommentThreadStatus(input: {
    id: string;
    status: CommentStatus;
  }): Promise<CommentThread>;
  getCommentThreadActivities?(input: {
    threadId: string;
    after?: string;
    first?: number;
  }): Promise<CommentThreadActivityEvent[]>;
  subscribeCommentThreadActivities?(
    threadId: string | undefined,
    onEvent: (event: CommentThreadActivityEvent) => void,
  ): () => void;
  searchFiles(input: {
    query: string;
    limit?: number;
    signal?: AbortSignal;
  }): Promise<FileSearchResult[]>;
  searchText(input: {
    query: string;
    limit?: number;
    signal?: AbortSignal;
  }): Promise<TextSearchResult[]>;
  subscribeWorkspaceEvents(onEvent: (event: FsEvent) => void): () => void;
}
