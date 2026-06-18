import type {
  ChangeReviewSummary,
  DiffBaseSummary,
  TextDiff,
} from "../domain/change-review.js";
import type {
  FilePayload,
  FsEvent,
  TreeSnapshot,
  ViewerConfig,
} from "../domain/fs-node.js";
import type {
  FileSearchResult,
  SearchStats,
  TextSearchResult,
} from "../domain/search.js";
import type {
  CommentListFilters,
  PathlensComment,
} from "../domain/comments.js";

export interface FileSystemPort {
  readTree(): Promise<TreeSnapshot>;
  readDirectory?(
    relativePath: string,
    options?: { depth?: number },
  ): Promise<TreeSnapshot>;
  readFile(relativePath: string): Promise<FilePayload>;
  readHtmlPreview(relativePath: string): Promise<string>;
  searchFiles?(
    query: string,
    options?: { limit?: number },
  ): Promise<FileSearchResponse>;
  searchText?(
    query: string,
    options?: { limit?: number; matchesPerFile?: number },
  ): Promise<TextSearchResponse>;
  getConfig?(): ViewerConfig;
}

export interface FileSearchResponse {
  query: string;
  results: FileSearchResult[];
  stats?: SearchStats;
}

export interface TextSearchResponse {
  query: string;
  results: TextSearchResult[];
  stats?: SearchStats;
}

export interface WatcherPort {
  start(onEvent: (event: FsEvent) => void): Promise<void>;
  stop(): Promise<void>;
}

export interface ChangeReviewPort {
  readChanges(): Promise<ChangeReviewSummary>;
  readDiff(relativePath: string, baseRef?: string): Promise<TextDiff>;
  readDiffBases?(): Promise<DiffBaseSummary>;
  stop?(): Promise<void>;
}

export interface CommentStorePort {
  listComments(filters?: CommentListFilters): Promise<PathlensComment[]>;
  createComment(comment: PathlensComment): Promise<PathlensComment>;
  updateComment(comment: PathlensComment): Promise<PathlensComment>;
  getComment(id: string): Promise<PathlensComment | null>;
}

export interface ViewerServiceOptions {
  fileSystem: FileSystemPort;
  watcher?: WatcherPort;
  changeReview?: ChangeReviewPort;
  commentStore?: CommentStorePort;
}
