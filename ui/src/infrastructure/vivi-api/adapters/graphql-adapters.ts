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
import type { FileSearchResult, TextSearchResult } from "../../../domain/search.js";
import type {
  CommentFieldsFragment,
  ConfigFieldsFragment,
  DiffFieldsFragment,
  FileFieldsFragment,
  ThreadFieldsFragment,
  TreeFieldsFragment,
  ViviFileSearchQuery,
  ViviReviewQueueQuery,
  ViviTextSearchQuery,
  WorkspaceEventsSubscription,
} from "../graphql/generated/graphql.js";

export const adaptGraphqlTree = (dto: TreeFieldsFragment): TreeSnapshot =>
  dto as unknown as TreeSnapshot;
export const adaptGraphqlConfig = (
  dto: ConfigFieldsFragment,
): ViewerConfig => dto as ViewerConfig;
export const adaptGraphqlFile = (dto: FileFieldsFragment): FilePayload =>
  dto as unknown as FilePayload;
export const adaptGraphqlComment = (
  dto: CommentFieldsFragment,
): ViviComment => dto as unknown as ViviComment;
export const adaptGraphqlCommentThread = (
  dto: ThreadFieldsFragment,
): CommentThread => dto as unknown as CommentThread;
export const adaptGraphqlReviewQueue = (
  dto: ViviReviewQueueQuery["reviewQueue"],
): ChangeReviewSummary => dto as unknown as ChangeReviewSummary;
export const adaptGraphqlDiff = (dto: DiffFieldsFragment): TextDiff =>
  dto as unknown as TextDiff;
export const adaptGraphqlWorkspaceEvent = (
  dto: WorkspaceEventsSubscription["workspaceEvents"],
): FsEvent => dto as FsEvent;
export const adaptGraphqlFileSearch = (
  dto: ViviFileSearchQuery["fileSearch"],
): FileSearchResult[] => dto.results as unknown as FileSearchResult[];
export const adaptGraphqlTextSearch = (
  dto: ViviTextSearchQuery["textSearch"],
): TextSearchResult[] => dto.results as unknown as TextSearchResult[];
