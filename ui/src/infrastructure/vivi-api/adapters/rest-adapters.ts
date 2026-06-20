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
  RestCommentDto,
  RestConfigDto,
  RestDiffDto,
  RestFileDto,
  RestReviewQueueDto,
  RestTreeDto,
  RestWorkspaceEventDto,
} from "../dto/rest-dto.js";

export const adaptTree = (dto: RestTreeDto): TreeSnapshot => dto;
export const adaptConfig = (dto: RestConfigDto): ViewerConfig => dto;
export const adaptFile = (dto: RestFileDto): FilePayload => dto;
export const adaptComment = (dto: RestCommentDto): ViviComment => dto;
export const adaptReviewQueue = (
  dto: RestReviewQueueDto,
): ChangeReviewSummary => dto;
export const adaptDiff = (dto: RestDiffDto): TextDiff => dto;
export const adaptWorkspaceEvent = (dto: RestWorkspaceEventDto): FsEvent => dto;
