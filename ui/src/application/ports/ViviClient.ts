import type {
  ChangeReviewSummary,
  TextDiff,
} from "../../domain/change-review.js";
import type {
  CommentListFilters,
  CommentStatus,
  CreateCommentInput,
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
  getReviewQueue(): Promise<ChangeReviewSummary>;
  getDiff(input: { path: string; base?: string }): Promise<TextDiff>;
  createComment(input: CreateCommentInput): Promise<ViviComment>;
  updateCommentStatus(input: {
    id: string;
    status: CommentStatus;
  }): Promise<ViviComment>;
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
