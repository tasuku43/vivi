import type { CommentStatus, PathlensComment } from "../../domain/comments.js";
import {
  commentLineLabel,
  statusLabel,
  truncateCommentPreview,
} from "../state/comments.js";

type StatusFilter = "all" | CommentStatus;

export function CommentsPanel({
  open,
  comments,
  query,
  statusFilter,
  onQueryChange,
  onStatusFilterChange,
  onClose,
  onOpenComment,
}: {
  open: boolean;
  comments: PathlensComment[];
  query: string;
  statusFilter: StatusFilter;
  onQueryChange: (query: string) => void;
  onStatusFilterChange: (status: StatusFilter) => void;
  onClose: () => void;
  onOpenComment: (comment: PathlensComment) => void;
}) {
  if (!open) return null;
  const visibleComments = comments.filter((comment) => {
    if (statusFilter !== "all" && comment.status !== statusFilter) return false;
    const haystack = [
      comment.path,
      comment.body,
      comment.anchor.canonical.quote ?? "",
      commentLineLabel(comment),
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(query.trim().toLowerCase());
  });

  return (
    <aside className="global-comments-panel" aria-label="Comments">
      <div className="global-comments-head">
        <div>
          <h2>Comments</h2>
          <p>
            {comments.filter((comment) => comment.status === "open").length}{" "}
            open across workspace
          </p>
        </div>
        <button type="button" aria-label="Close comments" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="global-comments-tools">
        <input
          value={query}
          placeholder="Search comments"
          aria-label="Search comments"
          onChange={(event) => onQueryChange(event.currentTarget.value)}
        />
        <div className="global-comment-filters" aria-label="Status filter">
          {(["all", "open", "resolved", "archived"] as StatusFilter[]).map(
            (status) => (
              <button
                className={statusFilter === status ? "active" : ""}
                type="button"
                key={status}
                onClick={() => onStatusFilterChange(status)}
              >
                {status === "all" ? "All" : statusLabel(status)}
              </button>
            ),
          )}
        </div>
      </div>
      <div className="global-comments-list">
        {visibleComments.length ? (
          visibleComments.map((comment) => (
            <button
              className={`global-comment-row ${comment.status}`}
              type="button"
              key={comment.id}
              onClick={() => onOpenComment(comment)}
            >
              <span className="global-comment-dot" aria-hidden="true" />
              <span className="global-comment-main">
                <span className="global-comment-meta">
                  <strong>{comment.path}</strong>
                  <span>{commentLineLabel(comment)}</span>
                  <span className={`comment-status ${comment.status}`}>
                    {statusLabel(comment.status)}
                  </span>
                </span>
                <span className="global-comment-body">
                  {truncateCommentPreview(comment.body, 130)}
                </span>
                {comment.anchor.canonical.quote ? (
                  <span className="global-comment-quote">
                    {truncateCommentPreview(
                      comment.anchor.canonical.quote,
                      140,
                    )}
                  </span>
                ) : null}
              </span>
            </button>
          ))
        ) : (
          <p className="muted compact-empty">No matching comments.</p>
        )}
      </div>
    </aside>
  );
}

export type { StatusFilter as CommentStatusFilter };
