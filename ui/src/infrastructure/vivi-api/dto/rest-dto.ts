import type {
  ChangeReviewSummary,
  TextDiff,
} from "../../../domain/change-review.js";
import type { ViviComment } from "../../../domain/comments.js";
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

// REST wire types stay in infrastructure even while their shape mirrors the domain.
export type RestTreeDto = TreeSnapshot;
export type RestConfigDto = ViewerConfig;
export type RestFileDto = FilePayload;
export type RestCommentDto = ViviComment;
export type RestReviewQueueDto = ChangeReviewSummary;
export type RestDiffDto = TextDiff;
export type RestWorkspaceEventDto = FsEvent;
export interface RestFileSearchDto {
  results: FileSearchResult[];
}
export interface RestTextSearchDto {
  results: TextSearchResult[];
}
