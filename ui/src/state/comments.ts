import {
  buildCommentThreads,
  type CommentAnchor,
  type DraftReviewComment,
  type SourceAnchor,
  type CommentStatus,
  type CommentViewerKind,
  type ViviComment,
} from "../domain/comments.js";
import type { FilePayload } from "../domain/fs-node.js";
import type { LineRange } from "./code-viewer.js";

export interface CommentDraft {
  threadId?: string;
  path: string;
  viewerKind: CommentViewerKind;
  anchor: CommentAnchor;
}

export type CommentCreateHandler = (
  draft: CommentDraft,
  body: string,
  rect?: SelectionCommentTarget["rect"],
) => void | Promise<void>;

export type CommentStatusChangeHandler = (
  id: string,
  status: CommentStatus,
) => void | Promise<void>;

export interface CodeCommentThread {
  key: string;
  path: string;
  lineStart: number;
  lineEnd: number;
  status: CommentStatus;
  comments: ThreadComment[];
}

export type ThreadComment = ViviComment & {
  draft?: boolean;
  draftId?: string;
};

export interface SelectionCommentTarget {
  text: string;
  rect: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
}

export function commentViewerKindForFile(file: FilePayload): CommentViewerKind {
  if (file.viewerKind === "markdown") return "markdown";
  if (file.viewerKind === "html") return "html";
  if (file.viewerKind === "image") return "image";
  if (file.viewerKind === "json") return "json";
  if (file.viewerKind === "text" && /\.(csv|tsv)$/i.test(file.path))
    return "csv";
  if (file.viewerKind === "text" && /\.(ya?ml)$/i.test(file.path))
    return "yaml";
  if (
    file.viewerKind === "text" ||
    file.viewerKind === "code" ||
    file.viewerKind === "mermaid"
  ) {
    return "text";
  }
  return "unknown";
}

export function commentAnchorSourceChanged(
  comment: ViviComment,
  file: FilePayload | null | undefined,
): boolean {
  const anchorHash = comment.anchor.canonical.fileHash?.trim();
  return Boolean(
    file &&
      comment.path === file.path &&
      anchorHash &&
      file.etag &&
      anchorHash !== file.etag,
  );
}

export function sourceCommentDraft(
  file: FilePayload,
  range: LineRange | null,
  quote?: string,
): CommentDraft {
  return {
    path: file.path,
    viewerKind: commentViewerKindForFile(file),
    anchor: {
      surface: "source",
      canonical: {
        path: file.path,
        lineStart: range?.start,
        lineEnd: range?.end,
        quote: quote?.trim() || undefined,
        fileHash: file.etag,
      },
    },
  };
}

export function sourceLineCommentDraft(
  file: FilePayload,
  lineNumber: number,
): CommentDraft {
  const line = file.content.split(/\r?\n/)[Math.max(0, lineNumber - 1)] ?? "";
  return sourceCommentDraft(file, { start: lineNumber, end: lineNumber }, line);
}

export function codeCommentThreadKey(
  path: string,
  lineStart: number,
  lineEnd = lineStart,
): string {
  return JSON.stringify([path, lineStart, lineEnd]);
}

export function commentAnchorThreadKey(
  path: string,
  anchor: CommentAnchor,
): string {
  const canonical = anchor.canonical;
  return JSON.stringify([
    path,
    anchor.surface,
    canonical.lineStart ?? null,
    canonical.lineEnd ?? canonical.lineStart ?? null,
    anchor.rendered?.blockId ?? null,
    anchor.rendered?.selector ?? null,
    anchor.diff?.base ?? null,
    anchor.diff?.ref ?? null,
    anchor.diff?.hunkId ?? null,
    anchor.diff?.side ?? null,
    anchor.diff?.oldLineStart ?? null,
    anchor.diff?.oldLineEnd ?? null,
    anchor.diff?.newLineStart ?? null,
    anchor.diff?.newLineEnd ?? null,
  ]);
}

export function draftReviewCommentAsViviComment(
  draft: DraftReviewComment,
  publishedComments: ViviComment[],
): ThreadComment {
  const matchingPublishedThread = publishedComments.find(
    (comment) =>
      comment.path === draft.path &&
      commentAnchorThreadKey(comment.path, comment.anchor) ===
        commentAnchorThreadKey(draft.path, draft.anchor),
  );
  return {
    id: `draft:${draft.id}`,
    draftId: draft.id,
    draft: true,
    threadId:
      draft.threadId ??
      matchingPublishedThread?.threadId ??
      matchingPublishedThread?.id ??
      `draft-thread:${commentAnchorThreadKey(draft.path, draft.anchor)}`,
    path: draft.path,
    viewerKind: draft.viewerKind,
    anchor: draft.anchor,
    body: draft.body,
    createdBy: draft.createdBy,
    author: draft.author,
    source: draft.source,
    status: "open",
    createdAt: draft.createdAt,
    updatedAt: draft.updatedAt,
  };
}

export function codeCommentThreads(
  comments: ThreadComment[],
): CodeCommentThread[] {
  const byKey = new Map<string, CodeCommentThread>();
  for (const comment of visibleThreadComments(comments)) {
    const lineStart = comment.anchor.canonical.lineStart;
    if (!lineStart) continue;
    const lineEnd = comment.anchor.canonical.lineEnd ?? lineStart;
    const key = comment.threadId
      ? JSON.stringify(["thread", comment.threadId])
      : codeCommentThreadKey(comment.path, lineStart, lineEnd);
    const thread = byKey.get(key) ?? {
      key,
      path: comment.path,
      lineStart,
      lineEnd,
      status: "open",
      comments: [],
    };
    thread.comments.push(comment);
    thread.status = latestPublishedStatus(thread.comments);
    byKey.set(key, thread);
  }
  return [...byKey.values()]
    .map((thread) => ({
      ...thread,
      comments: [...thread.comments].sort((a, b) =>
        a.createdAt.localeCompare(b.createdAt),
      ),
    }))
    .sort(
      (a, b) =>
        a.lineEnd - b.lineEnd ||
        a.lineStart - b.lineStart ||
        a.key.localeCompare(b.key),
    );
}

export function matchingCodeCommentThread(
  threads: CodeCommentThread[],
  target: CodeCommentThread,
): CodeCommentThread | undefined {
  return (
    threads.find((thread) => thread.key === target.key) ??
    threads.find(
      (thread) =>
        thread.path === target.path &&
        thread.lineStart === target.lineStart &&
        thread.lineEnd === target.lineEnd,
    )
  );
}

export function preferredCodeCommentThread(
  threads: CodeCommentThread[],
  activeCommentId?: string | null,
): CodeCommentThread | undefined {
  if (activeCommentId) {
    const activeThread = threads.find((thread) =>
      thread.comments.some((comment) => comment.id === activeCommentId),
    );
    if (activeThread) return activeThread;
  }
  return (
    threads.find((thread) => thread.status === "open") ??
    threads.find((thread) => thread.status === "resolved") ??
    threads[0]
  );
}

export function lineCommentThreadActionLabel(
  lineNumber: number,
  thread?: CodeCommentThread,
): string {
  if (!thread) return `Add comment on line ${lineNumber}`;
  const count = thread.comments.length;
  const messageLabel = count === 1 ? "message" : "messages";
  if (thread.status === "open") {
    return `Open comment thread on line ${lineNumber} with ${count} ${messageLabel}; open to reply`;
  }
  return `Open ${thread.status} comment thread on line ${lineNumber} with ${count} ${messageLabel}; reopen to reply`;
}

function latestPublishedStatus(comments: ThreadComment[]): CommentStatus {
  const published = comments.filter((comment) => !isDraftThreadComment(comment));
  if (!published.length) return "open";
  return published.reduce((latest, comment) =>
    comment.updatedAt > latest.updatedAt ? comment : latest,
  ).status;
}

export function isDraftThreadComment(
  comment: ThreadComment,
): comment is ThreadComment & { draft: true } {
  return comment.draft === true || comment.id.startsWith("draft:");
}

export function visibleThreadComments<T extends ThreadComment>(
  comments: T[],
): T[] {
  const groups = new Map<string, T[]>();
  for (const comment of comments) {
    const threadId = comment.threadId ?? comment.id;
    groups.set(threadId, [...(groups.get(threadId) ?? []), comment]);
  }

  const hiddenThreadIds = new Set<string>();
  for (const [threadId, threadComments] of groups.entries()) {
    const published = threadComments.filter(
      (comment) => !isDraftThreadComment(comment),
    );
    if (!published.length) continue;
    const latest = published.reduce((current, comment) =>
      comment.updatedAt > current.updatedAt ? comment : current,
    );
    if (latest.status === "archived") hiddenThreadIds.add(threadId);
  }

  return comments.filter(
    (comment) => !hiddenThreadIds.has(comment.threadId ?? comment.id),
  );
}

export function activeCommentsForPath(
  comments: ViviComment[],
  path: string,
): ViviComment[] {
  return buildCommentThreads(
    comments.filter((comment) => comment.path === path),
  )
    .filter((thread) => thread.status === "open")
    .flatMap((thread) => thread.comments)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function renderedCommentDraft(
  file: FilePayload,
  kind: "markdown" | "html",
  selection: {
    text: string;
    blockId?: string;
    selector?: string;
    sourceLineStart?: number;
    sourceLineEnd?: number;
    sourceQuote?: string;
  },
): CommentDraft {
  return {
    path: file.path,
    viewerKind: commentViewerKindForFile(file),
    anchor: {
      surface: "rendered",
      canonical: {
        path: file.path,
        lineStart: selection.sourceLineStart,
        lineEnd: selection.sourceLineEnd,
        quote: selection.sourceQuote?.trim() || selection.text,
        fileHash: file.etag,
      },
      rendered: {
        kind,
        blockId: selection.blockId,
        selector: selection.selector,
        textQuote: selection.text,
        sourceLineStart: selection.sourceLineStart,
        sourceLineEnd: selection.sourceLineEnd,
      },
    },
  };
}

export function diffCommentDraft(
  file: FilePayload,
  lineStart: number,
  lineEnd: number,
  _changeKind: "context" | "added",
  quote?: string,
  context: {
    base?: string;
    ref?: string;
    hunkId?: string;
    diffHash?: string;
  } = {},
): CommentDraft {
  const canonicalQuote =
    sourceTextForLineRange(file.content, { start: lineStart, end: lineEnd }) ??
    quote;
  return {
    path: file.path,
    viewerKind: commentViewerKindForFile(file),
    anchor: {
      surface: "diff",
      canonical: {
        path: file.path,
        lineStart,
        lineEnd,
        quote: canonicalQuote?.trim() || undefined,
        fileHash: file.etag,
      },
      diff: {
        path: file.path,
        base: context.base ?? "HEAD",
        ref: context.ref ?? "working-tree",
        hunkId: context.hunkId ?? `new:${lineStart}-${lineEnd}`,
        side: "new",
        newLineStart: lineStart,
        newLineEnd: lineEnd,
        diffHash: context.diffHash,
        fileHash: file.etag,
        changeKind: _changeKind,
      },
    },
  };
}

export function lineRangeForQuote(
  content: string,
  quote: string,
): LineRange | null {
  const normalizedQuote = quote.trim();
  if (!normalizedQuote) return null;
  const index = content.indexOf(normalizedQuote);
  if (index < 0) return null;
  const before = content.slice(0, index);
  const lineStart = before.split(/\r?\n/).length;
  const lineCount = normalizedQuote.split(/\r?\n/).length;
  return {
    start: lineStart,
    end: lineStart + lineCount - 1,
  };
}

export function sourceTextForLineRange(
  content: string,
  range: LineRange | null,
): string | undefined {
  if (!range) return undefined;
  return content
    .split(/\r?\n/)
    .slice(range.start - 1, range.end)
    .join("\n");
}

export function selectedTextInElement(element: HTMLElement | null): string {
  return selectionCommentTargetInElement(element)?.text ?? "";
}

export function scheduleSelectionCommentUpdate(update: () => void): void {
  window.requestAnimationFrame(() => {
    window.setTimeout(update, 0);
  });
}

export function selectionCommentTargetInElement(
  element: HTMLElement | null,
): SelectionCommentTarget | null {
  if (!hasTextSelectionInElement(element)) return null;
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  const text = selection.toString().trim();
  const rect = range.getBoundingClientRect();
  return {
    text,
    rect: {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    },
  };
}

export function hasTextSelectionInElement(element: HTMLElement | null): boolean {
  if (!element) return false;
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return false;
  const range = selection.getRangeAt(0);
  if (
    !element.contains(range.commonAncestorContainer) &&
    range.commonAncestorContainer !== element
  ) {
    return false;
  }
  return Boolean(selection.toString().trim());
}

export interface DeferredSourceHighlightState {
  visible: string[] | null;
  pending: string[] | null;
}

export function nextDeferredSourceHighlightState(
  state: DeferredSourceHighlightState,
  incoming: string[] | null | undefined,
  hasActiveSelection: boolean,
): DeferredSourceHighlightState {
  const next = incoming ?? null;
  if (hasActiveSelection) {
    return { visible: state.visible, pending: next };
  }
  return { visible: next, pending: next };
}

export function flushDeferredSourceHighlightState(
  state: DeferredSourceHighlightState,
): DeferredSourceHighlightState {
  return { visible: state.pending, pending: state.pending };
}

export function selectedLineRangeInElement(
  element: HTMLElement | null,
): LineRange | null {
  if (!element) return null;
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  const start = selectedLineNumber(range.startContainer, element);
  const end = selectedLineNumber(range.endContainer, element);
  if (!start || !end) return null;
  return { start: Math.min(start, end), end: Math.max(start, end) };
}

export function statusLabel(status: CommentStatus): string {
  if (status === "resolved") return "Resolved";
  if (status === "archived") return "Archived";
  return "Open";
}

export function commentLineLabel(comment: ViviComment): string {
  return commentLineLabelForAnchor(comment.anchor.canonical);
}

export function commentLocationLabel(comment: ViviComment): string {
  if (comment.anchor.surface === "rendered") {
    const rendered = comment.anchor.rendered;
    const kind = rendered?.kind ?? comment.viewerKind;
    const parts = [`Rendered ${titleCase(kind)}`];
    if (rendered?.blockId) parts.push(`block ${rendered.blockId}`);
    else if (rendered?.selector) parts.push(`selector ${rendered.selector}`);
    else if (rendered?.textQuote) {
      parts.push(`text "${truncateCommentPreview(rendered.textQuote, 42)}"`);
    }
    const sourceLabel = lineRangeLabel(
      rendered?.sourceLineStart,
      rendered?.sourceLineEnd,
      "source ",
    );
    if (sourceLabel) parts.push(sourceLabel);
    return parts.join(" · ");
  }

  if (comment.anchor.surface === "diff") {
    const diff = comment.anchor.diff;
    if (!diff) return `Diff ${commentLineLabel(comment)}`;
    const side = diff.side === "old" ? "old" : "new";
    const lineLabel =
      diff.side === "old"
        ? lineRangeLabel(diff.oldLineStart, diff.oldLineEnd)
        : lineRangeLabel(diff.newLineStart, diff.newLineEnd);
    return lineLabel ? `Diff ${side} ${lineLabel}` : `Diff ${side} hunk`;
  }

  return `Source ${commentLineLabel(comment)}`;
}

export function commentLineLabelForAnchor(anchor: SourceAnchor): string {
  if (
    anchor.lineStart &&
    anchor.lineEnd &&
    anchor.lineStart !== anchor.lineEnd
  ) {
    return `L${anchor.lineStart}-L${anchor.lineEnd}`;
  }
  if (anchor.lineStart) return `L${anchor.lineStart}`;
  return "File";
}

function lineRangeLabel(
  start: number | undefined,
  end: number | undefined,
  prefix = "",
): string | null {
  if (!start) return null;
  if (end && end !== start) return `${prefix}L${start}-L${end}`;
  return `${prefix}L${start}`;
}

function titleCase(value: string): string {
  return value ? `${value[0]?.toUpperCase()}${value.slice(1)}` : value;
}

export function commentsForLine(
  comments: ViviComment[],
  line: number,
): ViviComment[] {
  return visibleThreadComments(comments).filter((comment) =>
    commentContainsLine(comment, line),
  );
}

export function commentContainsLine(
  comment: ViviComment,
  line: number,
): boolean {
  const start = comment.anchor.canonical.lineStart;
  if (!start) return false;
  const end = comment.anchor.canonical.lineEnd ?? start;
  return line >= start && line <= end;
}

function selectedLineNumber(node: Node, element: HTMLElement): number | null {
  const owner = node instanceof Element ? node : node.parentElement;
  const row = owner?.closest<HTMLElement>(".code-line[data-line]");
  if (!row || !element.contains(row)) return null;
  const line = Number(row.dataset.line);
  return Number.isInteger(line) && line > 0 ? line : null;
}

export function truncateCommentPreview(
  value: string,
  maxLength: number,
): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

export function rectLikeFromElement(
  element: Element,
): SelectionCommentTarget["rect"] {
  const rect = element.getBoundingClientRect();
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  };
}
