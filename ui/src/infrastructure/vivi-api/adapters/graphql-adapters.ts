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
  GraphqlCommentDto,
  GraphqlCommentThreadDto,
  GraphqlConfigDto,
  GraphqlDiffDto,
  GraphqlFileDto,
  GraphqlReviewQueueDto,
  GraphqlTreeDto,
  GraphqlWorkspaceEventDto,
} from "../dto/graphql-dto.js";

export const adaptGraphqlTree = (dto: GraphqlTreeDto): TreeSnapshot => dto;
export const adaptGraphqlConfig = (
  dto: GraphqlConfigDto,
): ViewerConfig => dto;
export const adaptGraphqlFile = (dto: GraphqlFileDto): FilePayload => dto;
export const adaptGraphqlComment = (
  dto: GraphqlCommentDto,
): ViviComment => dto;
export const adaptGraphqlCommentThread = (
  dto: GraphqlCommentThreadDto,
): CommentThread => dto;
export const adaptGraphqlReviewQueue = (
  dto: GraphqlReviewQueueDto,
): ChangeReviewSummary => dto;
export const adaptGraphqlDiff = (dto: GraphqlDiffDto): TextDiff => dto;
export const adaptGraphqlWorkspaceEvent = (
  dto: GraphqlWorkspaceEventDto,
): FsEvent => dto;
