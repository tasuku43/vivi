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
  CommentStatus,
  CommentThread,
  CommentActor,
  CommentThreadActivityEvent,
  DraftReviewComment,
  ViviComment,
} from "../domain/comments.js";
import type { ReviewLedgerSnapshot } from "../domain/review-ledger.js";

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
  listComments(filters?: CommentListFilters): Promise<ViviComment[]>;
  createComment(comment: ViviComment): Promise<ViviComment>;
  updateComment(comment: ViviComment): Promise<ViviComment>;
  getComment(id: string): Promise<ViviComment | null>;
  listDraftReviewComments?(
    filters?: CommentListFilters,
  ): Promise<DraftReviewComment[]>;
  createDraftReviewComment?(
    draft: DraftReviewComment,
  ): Promise<DraftReviewComment>;
  updateDraftReviewComment?(
    id: string,
    body: string,
    at: string,
  ): Promise<DraftReviewComment>;
  deleteDraftReviewComment?(id: string): Promise<DraftReviewComment>;
  listCommentThreads?(filters?: CommentListFilters): Promise<CommentThread[]>;
  createCommentThread?(thread: CommentThread): Promise<CommentThread>;
  updateCommentThreadStatus?(
    id: string,
    status: CommentStatus,
    at: string,
    actor?: CommentActor,
  ): Promise<CommentThread>;
  listCommentThreadActivities?(
    threadId: string,
    after?: string,
    first?: number,
  ): Promise<CommentThreadActivityEvent[]>;
  appendThreadReadActivity?(
    threadId: string,
    actor: CommentActor,
    clientEventId?: string,
  ): Promise<CommentThreadActivityEvent>;
}

export interface ReviewLedgerPort {
  readReviewLedger(now?: Date): Promise<ReviewLedgerSnapshot>;
  saveReviewLedger(
    snapshot: ReviewLedgerSnapshot,
    now?: Date,
  ): Promise<ReviewLedgerSnapshot>;
}

export interface ViewerServiceOptions {
  fileSystem: FileSystemPort;
  watcher?: WatcherPort;
  changeReview?: ChangeReviewPort;
  commentStore?: CommentStorePort;
  reviewLedger?: ReviewLedgerPort;
  reviewActor?: CommentActor;
}
