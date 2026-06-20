import { useEffect, useRef, useState } from "react";
import type { CommentStatus } from "../../../domain/comments.js";
import type {
  CodeCommentThread as CodeCommentThreadModel,
  CommentCreateHandler,
  CommentDraft,
  CommentStatusChangeHandler,
} from "../../../state/comments.js";
import { statusLabel } from "../../../state/comments.js";

export function CodeCommentThread({
  thread,
  draft,
  className,
  onCreateComment,
  onStatusChange,
  onClose,
}: {
  thread: CodeCommentThreadModel;
  draft: CommentDraft;
  className?: string;
  onCreateComment?: CommentCreateHandler;
  onStatusChange?: CommentStatusChangeHandler;
  onClose: () => void;
}) {
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const threadRef = useRef<HTMLElement | null>(null);
  const openComments = thread.comments.filter(
    (comment) => comment.status === "open",
  );
  const threadStatus: CommentStatus = openComments.length
    ? "open"
    : thread.comments.some((comment) => comment.status === "resolved")
      ? "resolved"
      : thread.comments.length
        ? "archived"
        : "open";
  const lineLabel =
    thread.lineStart === thread.lineEnd
      ? `Line ${thread.lineEnd}`
      : `Lines ${thread.lineStart}-${thread.lineEnd}`;

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && threadRef.current?.contains(target)) return;
      onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      onClose();
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown, { capture: true });
    };
  }, [onClose]);

  async function submit() {
    const trimmed = body.trim();
    if (!trimmed || !onCreateComment || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onCreateComment(draft, trimmed);
      setBody("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  }

  function updateThread(status: CommentStatus) {
    for (const comment of thread.comments) {
      if (comment.status !== status) void onStatusChange?.(comment.id, status);
    }
  }

  return (
    <article
      ref={threadRef}
      className={`code-comment-thread${className ? ` ${className}` : ""}`}
      aria-label={`Comment thread for ${lineLabel.toLowerCase()}`}
      onClick={(event) => event.stopPropagation()}
      onMouseUp={(event) => event.stopPropagation()}
      onKeyUp={(event) => event.stopPropagation()}
    >
      <header className="code-comment-thread-header">
        <div>
          <span className="code-comment-thread-icon" aria-hidden="true" />
          <strong>{lineLabel}</strong>
          <span>
            {thread.comments.length
              ? `${thread.comments.length} ${thread.comments.length === 1 ? "comment" : "comments"}`
              : "New thread"}
          </span>
          {thread.comments.length ? (
            <span className={`comment-status ${threadStatus}`}>
              {statusLabel(threadStatus)}
            </span>
          ) : null}
        </div>
        <button
          type="button"
          aria-label="Close comment thread"
          onClick={onClose}
        >
          ×
        </button>
      </header>

      {thread.comments.length ? (
        <div className="code-comment-thread-messages">
          {thread.comments.map((comment, index) => (
            <div
              className={`code-thread-comment ${comment.status}`}
              data-comment-id={comment.id}
              key={comment.id}
            >
              <div className="code-thread-comment-meta">
                <strong>{index === 0 ? "Started" : "Reply"}</strong>
                <time dateTime={comment.createdAt}>
                  {formatCommentTime(comment.createdAt)}
                </time>
                {comment.status !== "open" ? (
                  <span>{statusLabel(comment.status)}</span>
                ) : null}
              </div>
              <p>{comment.body}</p>
            </div>
          ))}
        </div>
      ) : null}

      <form
        className="code-comment-thread-reply"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <textarea
          autoFocus
          rows={2}
          value={body}
          placeholder={
            thread.comments.length ? "Reply to thread" : "Leave a comment"
          }
          aria-label={
            thread.comments.length ? "Reply to thread" : "New line comment"
          }
          onChange={(event) => setBody(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              (event.metaKey || event.ctrlKey || event.shiftKey)
            ) {
              event.preventDefault();
              void submit();
            }
          }}
        />
        <div className="code-comment-thread-footer">
          <div>
            {thread.comments.length ? (
              <>
                <button
                  type="button"
                  onClick={() =>
                    updateThread(threadStatus === "open" ? "resolved" : "open")
                  }
                >
                  {threadStatus === "open" ? "Resolve thread" : "Reopen thread"}
                </button>
                <button type="button" onClick={() => updateThread("archived")}>
                  Archive
                </button>
              </>
            ) : null}
          </div>
          <button
            className="code-comment-submit"
            disabled={!body.trim() || saving}
            type="submit"
            aria-label={
              thread.comments.length ? "Add reply" : "Save line comment"
            }
            title={thread.comments.length ? "Add reply" : "Save line comment"}
          >
            ↑
          </button>
        </div>
        {error ? <p className="code-comment-thread-error">{error}</p> : null}
      </form>
    </article>
  );
}

function formatCommentTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
