import type {
  ChangeReviewSummary,
  TextDiff,
} from "../../../domain/change-review.js";
import type {
  CommentThread,
  CommentThreadActivityEvent,
  DraftReviewComment,
  ViviComment,
} from "../../../domain/comments.js";
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
import type {
  CommentFieldsFragment,
  ConfigFieldsFragment,
  DiffFieldsFragment,
  DraftReviewCommentFieldsFragment,
  FileFieldsFragment,
  ThreadFieldsFragment,
  TreeFieldsFragment,
  ViviFileSearchQuery,
  ViviReviewQueueQuery,
  ViviTextSearchQuery,
  WorkspaceEventsSubscription,
  CommentThreadActivitySubscription,
  ViviCommentThreadActivitiesQuery,
} from "../graphql/generated/graphql.js";

export const adaptGraphqlTree = (dto: TreeFieldsFragment): TreeSnapshot =>
  dto as unknown as TreeSnapshot;
export const adaptGraphqlConfig = (dto: ConfigFieldsFragment): ViewerConfig =>
  dto as ViewerConfig;
export const adaptGraphqlFile = (dto: FileFieldsFragment): FilePayload =>
  dto as unknown as FilePayload;
export const adaptGraphqlComment = (
  dto: CommentFieldsFragment,
): ViviComment => {
  const result = { ...(dto as unknown as ViviComment) };
  if (dto.source) {
    result.source = dto.source === "claude_code" ? "claude-code" : dto.source;
  }
  if (dto.createdBy) {
    result.createdBy = adaptGraphqlActor(dto.createdBy, dto.source, dto.author);
  }
  return result;
};
export const adaptGraphqlDraftReviewComment = (
  dto: DraftReviewCommentFieldsFragment,
): DraftReviewComment => {
  const result = { ...(dto as unknown as DraftReviewComment) };
  if (dto.source) {
    result.source = dto.source === "claude_code" ? "claude-code" : dto.source;
  }
  if (dto.createdBy) {
    result.createdBy = adaptGraphqlActor(dto.createdBy, dto.source, dto.author);
  }
  return result;
};
export const adaptGraphqlCommentActivity = (
  dto:
    | CommentThreadActivitySubscription["commentThreadActivity"]
    | ViviCommentThreadActivitiesQuery["commentThreadActivities"][number],
): CommentThreadActivityEvent => ({
  ...(dto as unknown as CommentThreadActivityEvent),
  actor: adaptGraphqlActor(dto.actor),
});

function adaptGraphqlActor(
  actor:
    | {
        id: string;
        kind: "human" | "claude_code" | "codex" | "unknown";
        displayName?: string | null;
      }
    | undefined,
  legacyKind: "human" | "claude_code" | "codex" | "unknown" = "unknown",
  legacyName?: string | null,
) {
  const kind = actor?.kind ?? legacyKind;
  const domainKind = kind === "claude_code" ? "claude-code" : kind;
  return {
    id: actor?.id ?? (legacyName ? `${domainKind}:${legacyName}` : domainKind),
    kind: domainKind,
    displayName: actor?.displayName ?? legacyName ?? undefined,
  } as const;
}
export const adaptGraphqlCommentThread = (
  dto: ThreadFieldsFragment,
): CommentThread => ({
  ...(dto as unknown as CommentThread),
  comments: dto.comments.map(adaptGraphqlComment),
});
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
