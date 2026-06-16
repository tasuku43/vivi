import type { CommentStatus, PathlensComment } from "../../domain/comments.js";
import {
  commentLineLabel,
  statusLabel,
  truncateCommentPreview,
} from "../state/comments.js";

export function InlineCommentCard({
  comment,
  rect,
  onClose,
  onStatusChange,
}: {
  comment: PathlensComment | null;
  rect: DOMRectLike | null;
  onClose: () => void;
  onStatusChange?: (id: string, status: CommentStatus) => void;
}) {
  if (!comment || !rect) return null;
  const width = 340;
  const left = clamp(
    rect.left + rect.width + 12,
    12,
    Math.max(12, window.innerWidth - width - 12),
  );
  const top = clamp(rect.top - 10, 12, Math.max(12, window.innerHeight - 220));
  const pointsLeft = left > rect.left;

  return (
    <article
      className={`inline-comment-card ${pointsLeft ? "points-left" : "points-top"}`}
      style={{ left, top }}
      aria-label="Comment"
    >
      <div className="inline-comment-top">
        <div>
          <strong>{comment.path}</strong>
          <span>{commentLineLabel(comment)}</span>
        </div>
        <button type="button" aria-label="Close comment" onClick={onClose}>
          ×
        </button>
      </div>
      <span className={`comment-status ${comment.status}`}>
        {statusLabel(comment.status)}
      </span>
      <p>{comment.body}</p>
      {comment.anchor.canonical.quote ? (
        <blockquote>
          {truncateCommentPreview(comment.anchor.canonical.quote, 180)}
        </blockquote>
      ) : null}
      <div className="inline-comment-actions">
        <button
          disabled={comment.status === "open"}
          type="button"
          onClick={() => onStatusChange?.(comment.id, "open")}
        >
          Open
        </button>
        <button
          disabled={comment.status === "resolved"}
          type="button"
          onClick={() => onStatusChange?.(comment.id, "resolved")}
        >
          Resolve
        </button>
        <button
          disabled={comment.status === "archived"}
          type="button"
          onClick={() => onStatusChange?.(comment.id, "archived")}
        >
          Archive
        </button>
      </div>
    </article>
  );
}

export interface DOMRectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
