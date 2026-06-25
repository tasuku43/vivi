import { useCallback, useEffect, useRef, useState } from "react";
import type { CommentStatus } from "../../../domain/comments.js";
import type { CommentActivitySummary } from "../../../state/comment-activity.js";
import { activityLabel } from "../../../state/comment-activity.js";
import type {
  CodeCommentThread as CodeCommentThreadModel,
  CommentCreateHandler,
  CommentDraft,
  CommentStatusChangeHandler,
} from "../../../state/comments.js";
import { isDraftThreadComment, statusLabel } from "../../../state/comments.js";

export function CodeCommentThread({
  thread,
  draft,
  className,
  onCreateComment,
  onStatusChange,
  onStartNewThread,
  onClose,
  activity,
  activeCommentId = null,
}: {
  thread: CodeCommentThreadModel;
  draft: CommentDraft;
  className?: string;
  onCreateComment?: CommentCreateHandler;
  onStatusChange?: CommentStatusChangeHandler;
  onStartNewThread?: () => void;
  onClose: () => void;
  activity?: CommentActivitySummary;
  activeCommentId?: string | null;
}) {
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const threadRef = useRef<HTMLElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const threadStatus: CommentStatus = thread.status;
  const lineLabel =
    thread.lineStart === thread.lineEnd
      ? `Line ${thread.lineEnd}`
      : `Lines ${thread.lineStart}-${thread.lineEnd}`;
  const isReplyComposer = thread.comments.length > 0;
  const composerModeId = commentComposerModeId(thread.key);
  const replyHintId = commentReplyHintId(thread.key);
  const submitLabel = isReplyComposer
    ? "Add reply"
    : "Save private draft comment";
  const submitHint = isReplyComposer ? "to send" : "to save private draft";
  const composerModeLabel = isReplyComposer
    ? "Replying in this thread"
    : "New separate thread";
  const hasActiveComment = Boolean(
    activeCommentId &&
    thread.comments.some((comment) => comment.id === activeCommentId),
  );
  const toggleStatusLabel =
    threadStatus === "open"
      ? hasActiveComment
        ? "Resolve current thread"
        : "Resolve thread"
      : hasActiveComment
        ? "Reopen current thread"
        : "Reopen thread";
  const archiveLabel = hasActiveComment ? "Archive current thread" : "Archive";
  const requestClose = useCallback(() => {
    if (body.trim() && !window.confirm("Discard this unsent comment?")) {
      return;
    }
    onClose();
  }, [body, onClose]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      requestClose();
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => {
      window.removeEventListener("keydown", onKeyDown, { capture: true });
    };
  }, [requestClose]);

  useEffect(() => {
    if (thread.comments.length) return;
    textareaRef.current?.focus();
  }, [thread.comments.length, thread.key]);

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
    const first = thread.comments.find(
      (comment) => !isDraftThreadComment(comment),
    );
    if (first && threadStatus !== status) {
      void onStatusChange?.(first.threadId ?? first.id, status);
    }
  }

  if (threadStatus === "archived") return null;

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
              ? `${thread.comments.length} ${thread.comments.length === 1 ? "message" : "messages"}`
              : "New draft"}
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
          onClick={requestClose}
        >
          ×
        </button>
      </header>
      {activity?.inline.length ? (
        <div className="comment-activity-summary" aria-label="Thread activity">
          {activity.inline.map((label) => (
            <span key={label}>{label}</span>
          ))}
          {activity.timeline.length > activity.inline.length ? (
            <details className="comment-activity-timeline">
              <summary>{activity.timeline.length} events</summary>
              <ol>
                {activity.timeline.map((event) => (
                  <li key={event.id}>{activityLabel(event)}</li>
                ))}
              </ol>
            </details>
          ) : null}
        </div>
      ) : null}

      {thread.comments.length ? (
        <div className="code-comment-thread-messages">
          {thread.comments.map((comment, index) => {
            const active = comment.id === activeCommentId;
            return (
              <div
                className={`code-thread-comment ${comment.status}${isDraftThreadComment(comment) ? " draft" : ""}${active ? " active" : ""}`}
                data-comment-id={comment.id}
                aria-current={active ? "true" : undefined}
                tabIndex={active ? -1 : undefined}
                key={comment.id}
              >
                <div className="code-thread-comment-meta">
                  <strong>
                    {isDraftThreadComment(comment)
                      ? "Draft"
                      : index === 0
                        ? "Started"
                        : "Reply"}
                    {comment.author
                      ? ` by ${comment.author}`
                      : comment.source && comment.source !== "human"
                        ? ` by ${comment.source}`
                        : ""}
                  </strong>
                  <time dateTime={comment.createdAt}>
                    {formatCommentTime(comment.createdAt)}
                  </time>
                  {isDraftThreadComment(comment) ? (
                    <span className="comment-status draft">Draft</span>
                  ) : (
                    <span className="comment-status published">Published</span>
                  )}
                  {!isDraftThreadComment(comment) &&
                  comment.status !== "open" ? (
                    <span>{statusLabel(comment.status)}</span>
                  ) : null}
                  {active ? (
                    <span className="code-thread-current-stop">
                      Current stop
                    </span>
                  ) : null}
                </div>
                <p>{comment.body}</p>
              </div>
            );
          })}
        </div>
      ) : null}

      <form
        className="code-comment-thread-reply"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="code-comment-composer-mode" id={composerModeId}>
          <span aria-hidden="true" />
          {composerModeLabel}
        </div>
        <textarea
          ref={textareaRef}
          autoFocus={!isReplyComposer}
          rows={2}
          value={body}
          placeholder={isReplyComposer ? "Reply to thread" : "Leave a comment"}
          aria-label={isReplyComposer ? "Reply to thread" : "New line comment"}
          aria-describedby={`${composerModeId} ${replyHintId}`}
          aria-keyshortcuts="Meta+Enter Control+Enter"
          onChange={(event) => setBody(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (isCommentSubmitShortcut(event)) {
              event.preventDefault();
              void submit();
            }
          }}
        />
        <p className="code-comment-thread-hint" id={replyHintId}>
          <kbd>Cmd/Ctrl Enter</kbd> {submitHint} <span>Esc closes</span>
        </p>
        <div className="code-comment-thread-footer">
          <div>
            {thread.comments.some(
              (comment) => !isDraftThreadComment(comment),
            ) ? (
              <>
                <button
                  type="button"
                  aria-keyshortcuts="Meta+Shift+Enter Control+Shift+Enter"
                  title={`${toggleStatusLabel} (Cmd/Ctrl Shift Enter)`}
                  onClick={() =>
                    updateThread(threadStatus === "open" ? "resolved" : "open")
                  }
                >
                  {toggleStatusLabel}
                </button>
                <button
                  type="button"
                  aria-keyshortcuts="Meta+Shift+Backspace Control+Shift+Backspace"
                  title={`${archiveLabel} (Cmd/Ctrl Shift Backspace)`}
                  onClick={() => updateThread("archived")}
                >
                  {archiveLabel}
                </button>
                {onStartNewThread ? (
                  <button type="button" onClick={onStartNewThread}>
                    Start separate thread
                  </button>
                ) : null}
              </>
            ) : null}
          </div>
          <button
            className="code-comment-submit"
            disabled={!body.trim() || saving}
            type="submit"
            aria-label={submitLabel}
            aria-keyshortcuts="Meta+Enter Control+Enter"
            title={`${submitLabel} (Cmd/Ctrl Enter)`}
          >
            ↑
          </button>
        </div>
        {error ? <p className="code-comment-thread-error">{error}</p> : null}
      </form>
    </article>
  );
}

export function isCommentSubmitShortcut(event: {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
}): boolean {
  return (
    event.key === "Enter" &&
    !event.shiftKey &&
    Boolean(event.metaKey || event.ctrlKey)
  );
}

function commentReplyHintId(threadKey: string): string {
  return `comment-reply-hint-${safeCommentThreadKey(threadKey)}`;
}

function commentComposerModeId(threadKey: string): string {
  return `comment-composer-mode-${safeCommentThreadKey(threadKey)}`;
}

function safeCommentThreadKey(threadKey: string): string {
  const safeKey = threadKey
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return safeKey || "thread";
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
