import type { CommentStatus, ViviComment } from "../../../domain/comments.js";
import type { CommentActivitySummary } from "../../../state/comment-activity.js";
import { activityLabel } from "../../../state/comment-activity.js";
import {
  commentLineLabel,
  statusLabel,
  truncateCommentPreview,
} from "../../../state/comments.js";

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
  threadActivities = {},
}: {
  open: boolean;
  comments: ViviComment[];
  query: string;
  statusFilter: StatusFilter;
  onQueryChange: (query: string) => void;
  onStatusFilterChange: (status: StatusFilter) => void;
  onClose: () => void;
  onOpenComment: (comment: ViviComment) => void;
  threadActivities?: Record<string, CommentActivitySummary>;
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
          visibleComments.map((comment) => {
            const threadId = comment.threadId ?? comment.id;
            const activity = threadActivities[threadId];
            return (
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
                  {activity?.inline.length ? (
                    <span className="comment-activity-summary compact">
                      {activity.inline.map((label) => (
                        <span key={label}>{label}</span>
                      ))}
                      {activity.timeline.length > activity.inline.length ? (
                        <span>
                          {activity.timeline.length - activity.inline.length}{" "}
                          older
                        </span>
                      ) : null}
                    </span>
                  ) : null}
                  {activity &&
                  activity.timeline.length > activity.inline.length ? (
                    <details
                      className="comment-activity-timeline"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <summary>Activity timeline</summary>
                      <ol>
                        {activity.timeline.map((event) => (
                          <li key={event.id}>{activityLabel(event)}</li>
                        ))}
                      </ol>
                    </details>
                  ) : null}
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
            );
          })
        ) : (
          <p className="muted compact-empty">No matching comments.</p>
        )}
      </div>
    </aside>
  );
}

export type { StatusFilter as CommentStatusFilter };
