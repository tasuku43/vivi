import type { ViewerKind } from "./viewer-kind.js";

export type CommentStatus = "open" | "resolved" | "archived";
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
  lineStart: number;
  lineEnd: number;
  side: "current";
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
  path: string;
  viewerKind: CommentViewerKind;
  anchor: CommentAnchor;
  body: string;
  status: CommentStatus;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
  archivedAt?: string;
}

export interface CreateCommentInput {
  path: string;
  viewerKind?: CommentViewerKind;
  anchor: CommentAnchor;
  body: string;
  status?: CommentStatus;
}

export interface UpdateCommentInput {
  body?: string;
  status?: CommentStatus;
}

export interface CommentListFilters {
  path?: string;
  status?: CommentStatus;
}

export interface CommentExportFilters {
  status?: CommentStatus;
  format?: "jsonl";
}

const commentStatuses: CommentStatus[] = ["open", "resolved", "archived"];
const commentSurfaces: CommentSurface[] = ["source", "rendered", "diff"];

export function isCommentStatus(value: unknown): value is CommentStatus {
  return (
    typeof value === "string" &&
    commentStatuses.includes(value as CommentStatus)
  );
}

export function parseCommentStatus(
  value: string | null,
): CommentStatus | undefined {
  if (!value) return undefined;
  if (!isCommentStatus(value)) throw new Error("invalid comment status");
  return value;
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
    path,
    viewerKind:
      normalizeCommentViewerKind(input.viewerKind) ??
      commentViewerKindFor(options.viewerKind, path),
    anchor,
    body,
    status,
  };
}

export function normalizeCommentUpdateInput(
  input: unknown,
): UpdateCommentInput {
  if (!isRecord(input)) throw new Error("invalid comment update payload");
  const update: UpdateCommentInput = {};
  if (input.body !== undefined) {
    const body = stringField(input.body, "body").trim();
    if (!body) throw new Error("comment body is required");
    update.body = body;
  }
  if (input.status !== undefined) update.status = normalizeStatus(input.status);
  if (update.body === undefined && update.status === undefined) {
    throw new Error("comment update must include body or status");
  }
  return update;
}

export function normalizeCommentFilters(input: {
  path?: string | null;
  status?: string | null;
}): CommentListFilters {
  return {
    path: input.path?.trim() || undefined,
    status: parseCommentStatus(input.status ?? null),
  };
}

export function exportCommentAsJsonLine(comment: ViviComment): string {
  return JSON.stringify({
    id: comment.id,
    path: comment.path,
    viewerKind: comment.viewerKind,
    status: comment.status,
    body: comment.body,
    source: {
      path: comment.anchor.canonical.path,
      lineStart: comment.anchor.canonical.lineStart,
      lineEnd: comment.anchor.canonical.lineEnd,
      columnStart: comment.anchor.canonical.columnStart,
      columnEnd: comment.anchor.canonical.columnEnd,
      quote: comment.anchor.canonical.quote,
      fileHash: comment.anchor.canonical.fileHash,
    },
    surface: comment.anchor.surface,
    rendered: comment.anchor.rendered,
    diff: comment.anchor.diff,
    createdAt: comment.createdAt,
    updatedAt: comment.updatedAt,
    resolvedAt: comment.resolvedAt,
    archivedAt: comment.archivedAt,
  });
}

export function applyCommentUpdate(
  comment: ViviComment,
  update: UpdateCommentInput,
  now: string,
): ViviComment {
  const next: ViviComment = {
    ...comment,
    body: update.body ?? comment.body,
    status: update.status ?? comment.status,
    updatedAt: now,
  };
  if (update.status === "resolved" && comment.status !== "resolved") {
    next.resolvedAt = now;
  }
  if (update.status === "archived" && comment.status !== "archived") {
    next.archivedAt = now;
  }
  if (update.status === "open") {
    next.resolvedAt = undefined;
    next.archivedAt = undefined;
  }
  return next;
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
    canonical.lineStart ??= anchor.diff.lineStart;
    canonical.lineEnd ??= anchor.diff.lineEnd;
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
  const side = stringField(input.side, "diff.side");
  if (side !== "current") {
    throw new Error("diff comments can only target current-file lines");
  }
  const changeKind = optionalString(input.changeKind);
  if (
    changeKind !== undefined &&
    changeKind !== "context" &&
    changeKind !== "added"
  ) {
    throw new Error("diff comments can only target context or added lines");
  }
  const anchorPath = stringField(input.path ?? path, "diff.path");
  if (anchorPath !== path) throw new Error("diff comment path must match path");
  const lineStart = positiveInt(input.lineStart, "diff.lineStart");
  const lineEnd = positiveInt(input.lineEnd, "diff.lineEnd");
  if (lineEnd < lineStart) {
    throw new Error("diff lineEnd must be greater than or equal to lineStart");
  }
  return {
    path,
    lineStart,
    lineEnd,
    side,
    changeKind,
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
