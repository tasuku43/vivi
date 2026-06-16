import type {
  CommentAnchor,
  SourceAnchor,
  CommentStatus,
  CommentViewerKind,
  PathlensComment,
} from "../../domain/comments.js";
import type { FilePayload } from "../../domain/fs-node.js";
import type { LineRange } from "./code-viewer.js";

export interface CommentDraft {
  path: string;
  viewerKind: CommentViewerKind;
  anchor: CommentAnchor;
}

export type CommentCreateHandler = (
  draft: CommentDraft,
  body: string,
  rect?: SelectionCommentTarget["rect"],
) => void | Promise<void>;

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

export function renderedCommentDraft(
  file: FilePayload,
  kind: "markdown" | "html",
  selection: {
    text: string;
    selector?: string;
    sourceLineStart?: number;
    sourceLineEnd?: number;
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
        quote: selection.text,
        fileHash: file.etag,
      },
      rendered: {
        kind,
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
  changeKind: "context" | "added",
  quote?: string,
): CommentDraft {
  return {
    path: file.path,
    viewerKind: commentViewerKindForFile(file),
    anchor: {
      surface: "diff",
      canonical: {
        path: file.path,
        lineStart,
        lineEnd,
        quote: quote?.trim() || undefined,
        fileHash: file.etag,
      },
      diff: {
        path: file.path,
        lineStart,
        lineEnd,
        side: "current",
        changeKind,
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
  if (!element) return null;
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (
    !element.contains(range.commonAncestorContainer) &&
    range.commonAncestorContainer !== element
  ) {
    return null;
  }
  const text = selection.toString().trim();
  if (!text) return null;
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

export function statusLabel(status: CommentStatus): string {
  if (status === "resolved") return "Resolved";
  if (status === "archived") return "Archived";
  return "Open";
}

export function commentLineLabel(comment: PathlensComment): string {
  return commentLineLabelForAnchor(comment.anchor.canonical);
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

export function commentsForLine(
  comments: PathlensComment[],
  line: number,
): PathlensComment[] {
  return comments.filter((comment) => commentContainsLine(comment, line));
}

export function commentContainsLine(
  comment: PathlensComment,
  line: number,
): boolean {
  const start = comment.anchor.canonical.lineStart;
  if (!start) return false;
  const end = comment.anchor.canonical.lineEnd ?? start;
  return line >= start && line <= end;
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
