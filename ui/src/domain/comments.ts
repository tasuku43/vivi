import type { ViewerKind } from "./viewer-kind.js";

export type CommentStatus = "open" | "resolved" | "archived";
export type CommentSource = "human" | "claude-code" | "codex" | "unknown";
export type CommentActorKind = "human" | "claude-code" | "codex" | "unknown";
export interface CommentActor {
  id: string;
  kind: CommentActorKind;
  displayName?: string;
}
export type CommentThreadActivityType =
  | "thread_created"
  | "thread_read"
  | "comment_added"
  | "comment_updated"
  | "thread_status_changed"
  | "thread_claimed"
  | "thread_claim_released";
export type CommentSurface = "source" | "rendered" | "diff";
export type CommentViewerKind =
  | "text"
  | "markdown"
  | "html"
  | "image"
  | "json"
  | "yaml"
  | "csv"
  | "binary"
  | "unknown";

export interface SourceAnchor {
  path: string;
  lineStart?: number;
  lineEnd?: number;
  columnStart?: number;
  columnEnd?: number;
  quote?: string;
  fileHash?: string;
}

export interface RenderedAnchor {
  kind: "markdown" | "html";
  blockId?: string;
  selector?: string;
  textQuote?: string;
  sourceLineStart?: number;
  sourceLineEnd?: number;
}

export interface DiffAnchor {
  path: string;
  base: string;
  ref: string;
  hunkId: string;
  side: "old" | "new";
  oldLineStart?: number;
  oldLineEnd?: number;
  newLineStart?: number;
  newLineEnd?: number;
  diffHash?: string;
  fileHash?: string;
  changeKind?: "context" | "added";
}

export interface CommentAnchor {
  canonical: SourceAnchor;
  surface: CommentSurface;
  rendered?: RenderedAnchor;
  diff?: DiffAnchor;
}

export interface ViviComment {
  id: string;
  threadId?: string;
  path: string;
  viewerKind: CommentViewerKind;
  reviewBatchId?: string;
  anchor: CommentAnchor;
  body: string;
  createdBy?: CommentActor;
  author?: string;
  source?: CommentSource;
  status: CommentStatus;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
  archivedAt?: string;
}

export interface CreateCommentInput {
  threadId?: string;
  path: string;
  viewerKind?: CommentViewerKind;
  anchor: CommentAnchor;
  body: string;
  actor?: CommentActor;
  author?: string;
  source?: CommentSource;
  status?: CommentStatus;
}

export interface CommentListFilters {
  path?: string;
  status?: CommentStatus;
  reviewBatchId?: string;
}

export interface CommentThread {
  id: string;
  path: string;
  status: CommentStatus;
  reviewBatchId?: string;
  anchor: CommentAnchor;
  updatedAt: string;
  createdAt: string;
  resolvedAt?: string;
  archivedAt?: string;
  comments: ViviComment[];
}

export interface DraftReviewComment {
  id: string;
  threadId?: string;
  path: string;
  viewerKind: CommentViewerKind;
  anchor: CommentAnchor;
  body: string;
  createdBy?: CommentActor;
  author?: string;
  source?: CommentSource;
  createdAt: string;
  updatedAt: string;
}

export type CreateDraftReviewCommentInput = Omit<CreateCommentInput, "status">;

export interface UpdateDraftReviewCommentInput {
  id: string;
  body: string;
}

export interface PublishedReviewBatch {
  reviewBatchId: string;
  publishedAt: string;
  threads: CommentThread[];
}

export interface CommentExportFilters {
  path?: string;
  status?: CommentStatus;
  format?: "jsonl";
}

export interface CommentThreadActivityEvent {
  id: string;
  threadId: string;
  type: CommentThreadActivityType;
  actor: CommentActor;
  commentId?: string;
  previousStatus?: CommentStatus;
  status?: CommentStatus;
  clientEventId?: string;
  leaseExpiresAt?: string;
  createdAt: string;
}

const commentStatuses: CommentStatus[] = ["open", "resolved", "archived"];
const commentSurfaces: CommentSurface[] = ["source", "rendered", "diff"];
const commentSources: CommentSource[] = [
  "human",
  "claude-code",
  "codex",
  "unknown",
];

function isCommentStatus(value: unknown): value is CommentStatus {
  return (
    typeof value === "string" &&
    commentStatuses.includes(value as CommentStatus)
  );
}

export function normalizeCommentCreateInput(
  input: unknown,
  options: { resolvedPath: string; fileHash?: string; viewerKind: ViewerKind },
): CreateCommentInput {
  if (!isRecord(input)) throw new Error("invalid comment payload");
  const path = stringField(input.path, "path");
  if (path !== options.resolvedPath) {
    throw new Error("comment path does not match resolved file path");
  }
  const body = stringField(input.body, "body").trim();
  if (!body) throw new Error("comment body is required");
  const anchor = normalizeAnchor(input.anchor, path, options.fileHash);
  const status =
    input.status === undefined ? "open" : normalizeStatus(input.status);
  return {
    threadId: optionalString(input.threadId),
    path,
    viewerKind:
      normalizeCommentViewerKind(input.viewerKind) ??
      commentViewerKindFor(options.viewerKind, path),
    anchor,
    body,
    actor: normalizeCommentActor(input.actor),
    author: optionalString(input.author),
    source: normalizeCommentSource(input.source),
    status,
  };
}

function normalizeCommentActor(value: unknown): CommentActor | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error("invalid comment actor");
  const kind = normalizeCommentSource(value.kind);
  return {
    id: stringField(value.id, "actor.id"),
    kind,
    displayName: optionalString(value.displayName),
  };
}

export function buildCommentThreads(comments: ViviComment[]): CommentThread[] {
  const threads = new Map<string, CommentThread>();
  for (const comment of comments) {
    const threadId = comment.threadId ?? comment.id;
    const thread =
      threads.get(threadId) ??
      ({
        id: threadId,
        path: comment.path,
        status: comment.status,
        reviewBatchId: comment.reviewBatchId,
        anchor: comment.anchor,
        updatedAt: comment.updatedAt,
        createdAt: comment.createdAt,
        comments: [],
      } satisfies CommentThread);
    thread.comments.push(comment);
    if (comment.updatedAt > thread.updatedAt) {
      thread.status = comment.status;
      thread.updatedAt = comment.updatedAt;
    }
    if (!thread.reviewBatchId && comment.reviewBatchId)
      thread.reviewBatchId = comment.reviewBatchId;
    if (comment.createdAt < thread.createdAt)
      thread.createdAt = comment.createdAt;
    if (
      comment.resolvedAt &&
      (!thread.resolvedAt || comment.resolvedAt > thread.resolvedAt)
    )
      thread.resolvedAt = comment.resolvedAt;
    if (
      comment.archivedAt &&
      (!thread.archivedAt || comment.archivedAt > thread.archivedAt)
    )
      thread.archivedAt = comment.archivedAt;
    threads.set(threadId, thread);
  }
  return [...threads.values()];
}

function normalizeAnchor(
  input: unknown,
  path: string,
  fileHash?: string,
): CommentAnchor {
  if (!isRecord(input)) throw new Error("invalid comment anchor");
  const surface = normalizeSurface(input.surface);
  const canonical = normalizeSourceAnchor(input.canonical, path, fileHash);
  const anchor: CommentAnchor = { canonical, surface };

  if (surface === "rendered") {
    anchor.rendered = normalizeRenderedAnchor(input.rendered);
    if (
      canonical.lineStart === undefined &&
      anchor.rendered.sourceLineStart !== undefined
    ) {
      canonical.lineStart = anchor.rendered.sourceLineStart;
      canonical.lineEnd = anchor.rendered.sourceLineEnd;
    }
  }

  if (surface === "diff") {
    anchor.diff = normalizeDiffAnchor(input.diff, path);
    canonical.lineStart ??= anchor.diff.newLineStart;
    canonical.lineEnd ??= anchor.diff.newLineEnd;
  }

  return anchor;
}

function normalizeSourceAnchor(
  input: unknown,
  path: string,
  fileHash?: string,
): SourceAnchor {
  if (!isRecord(input)) throw new Error("invalid canonical comment anchor");
  const anchorPath = stringField(input.path ?? path, "anchor.canonical.path");
  if (anchorPath !== path) {
    throw new Error("canonical comment anchor path must match comment path");
  }
  const anchor: SourceAnchor = {
    path,
    lineStart: optionalPositiveInt(input.lineStart, "lineStart"),
    lineEnd: optionalPositiveInt(input.lineEnd, "lineEnd"),
    columnStart: optionalPositiveInt(input.columnStart, "columnStart"),
    columnEnd: optionalPositiveInt(input.columnEnd, "columnEnd"),
    quote: optionalString(input.quote),
    fileHash: optionalString(input.fileHash) ?? fileHash,
  };
  if (
    anchor.lineStart !== undefined &&
    anchor.lineEnd !== undefined &&
    anchor.lineEnd < anchor.lineStart
  ) {
    throw new Error(
      "comment lineEnd must be greater than or equal to lineStart",
    );
  }
  return anchor;
}

function normalizeRenderedAnchor(input: unknown): RenderedAnchor {
  if (!isRecord(input)) throw new Error("rendered comment anchor is required");
  const kind = stringField(input.kind, "rendered.kind");
  if (kind !== "markdown" && kind !== "html") {
    throw new Error("invalid rendered comment anchor kind");
  }
  const anchor: RenderedAnchor = {
    kind,
    blockId: optionalString(input.blockId),
    selector: optionalString(input.selector),
    textQuote: optionalString(input.textQuote),
    sourceLineStart: optionalPositiveInt(
      input.sourceLineStart,
      "sourceLineStart",
    ),
    sourceLineEnd: optionalPositiveInt(input.sourceLineEnd, "sourceLineEnd"),
  };
  if (
    anchor.sourceLineStart !== undefined &&
    anchor.sourceLineEnd !== undefined &&
    anchor.sourceLineEnd < anchor.sourceLineStart
  ) {
    throw new Error(
      "rendered comment sourceLineEnd must be greater than or equal to sourceLineStart",
    );
  }
  return anchor;
}

function normalizeDiffAnchor(input: unknown, path: string): DiffAnchor {
  if (!isRecord(input)) throw new Error("diff comment anchor is required");
  const legacySide = input.side === "current";
  const side = legacySide ? "new" : stringField(input.side, "diff.side");
  if (side !== "old" && side !== "new") throw new Error("invalid diff side");
  const anchorPath = stringField(input.path ?? path, "diff.path");
  if (anchorPath !== path) throw new Error("diff comment path must match path");
  const oldLineStart = optionalPositiveInt(input.oldLineStart, "oldLineStart");
  const oldLineEnd = optionalPositiveInt(input.oldLineEnd, "oldLineEnd");
  const newLineStart = legacySide
    ? positiveInt(input.lineStart, "diff.lineStart")
    : optionalPositiveInt(input.newLineStart, "newLineStart");
  const newLineEnd = legacySide
    ? positiveInt(input.lineEnd, "diff.lineEnd")
    : optionalPositiveInt(input.newLineEnd, "newLineEnd");
  const start = side === "old" ? oldLineStart : newLineStart;
  const end = side === "old" ? oldLineEnd : newLineEnd;
  if (!start || !end || end < start)
    throw new Error("diff line range is invalid");
  return {
    path,
    base: optionalString(input.base) ?? "HEAD",
    ref: optionalString(input.ref) ?? "working-tree",
    hunkId: optionalString(input.hunkId) ?? `legacy:${side}:${start}-${end}`,
    side,
    oldLineStart,
    oldLineEnd,
    newLineStart,
    newLineEnd,
    diffHash: optionalString(input.diffHash),
    fileHash: optionalString(input.fileHash),
    changeKind:
      input.changeKind === "context" || input.changeKind === "added"
        ? input.changeKind
        : undefined,
  };
}

function normalizeSurface(value: unknown): CommentSurface {
  if (
    typeof value === "string" &&
    commentSurfaces.includes(value as CommentSurface)
  ) {
    return value as CommentSurface;
  }
  throw new Error("invalid comment surface");
}

function normalizeStatus(value: unknown): CommentStatus {
  if (isCommentStatus(value)) return value;
  throw new Error("invalid comment status");
}

function normalizeCommentViewerKind(
  value: unknown,
): CommentViewerKind | undefined {
  if (value === undefined) return undefined;
  if (
    value === "text" ||
    value === "markdown" ||
    value === "html" ||
    value === "image" ||
    value === "json" ||
    value === "yaml" ||
    value === "csv" ||
    value === "binary" ||
    value === "unknown"
  ) {
    return value;
  }
  throw new Error("invalid comment viewerKind");
}

function normalizeCommentSource(value: unknown): CommentSource {
  if (value === undefined) return "unknown";
  if (
    typeof value === "string" &&
    commentSources.includes(value as CommentSource)
  ) {
    return value as CommentSource;
  }
  throw new Error("invalid comment source");
}

export function commentViewerKindFor(
  viewerKind: ViewerKind,
  path: string,
): CommentViewerKind {
  if (viewerKind === "markdown") return "markdown";
  if (viewerKind === "html") return "html";
  if (viewerKind === "image") return "image";
  if (viewerKind === "json") return "json";
  if (viewerKind === "text" && /\.(csv|tsv)$/i.test(path)) return "csv";
  if (viewerKind === "text" && /\.(ya?ml)$/i.test(path)) return "yaml";
  if (
    viewerKind === "text" ||
    viewerKind === "code" ||
    viewerKind === "mermaid"
  ) {
    return "text";
  }
  if (viewerKind === "unsupported") return "unknown";
  return "unknown";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${name} is required`);
  }
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function optionalPositiveInt(value: unknown, name: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  return positiveInt(value, name);
}

function positiveInt(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}
