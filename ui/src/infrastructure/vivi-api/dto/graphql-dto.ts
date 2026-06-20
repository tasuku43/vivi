import type {
  ChangeReviewSummary,
  TextDiff,
} from "../../../domain/change-review.js";
import type { CommentThread, ViviComment } from "../../../domain/comments.js";
import type {
  FilePayload,
  FsEvent,
  TreeSnapshot,
  ViewerConfig,
} from "../../../domain/fs-node.js";
import type {
  FileSearchResult,
  TextSearchResult,
} from "../../../domain/search.js";

// GraphQL transport DTOs stay in infrastructure even while the first slice
// deliberately mirrors the domain contract.
export type GraphqlTreeDto = TreeSnapshot;
export type GraphqlConfigDto = ViewerConfig;
export type GraphqlFileDto = FilePayload;
export type GraphqlCommentDto = ViviComment;
export type GraphqlCommentThreadDto = CommentThread;
export type GraphqlReviewQueueDto = ChangeReviewSummary;
export type GraphqlDiffDto = TextDiff;
export type GraphqlWorkspaceEventDto = FsEvent;

export interface GraphqlFileSearchDto {
  results: FileSearchResult[];
}

export interface GraphqlTextSearchDto {
  results: TextSearchResult[];
}

export interface GraphqlCommentExportDto {
  format: "jsonl";
  contentType: string;
  content: string;
}

export interface GraphqlResponse<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}
