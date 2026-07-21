import { useEffect, useRef, useState } from "react";
import type { CommentStatus } from "../../../domain/comments.js";
import type { CommentActivitySummary } from "../../../state/comment-activity.js";
import { activityLabel } from "../../../state/comment-activity.js";
import type {
  CodeCommentThread as CodeCommentThreadModel,
  CommentCreateHandler,
  CommentDraft,
  CommentStatusChangeHandler,
} from "../../../state/comments.js";
import {
  draftForCommentComposerIntent,
  isDraftThreadComment,
  statusLabel,
} from "../../../state/comments.js";
import { commentAgentIdentity } from "../comment-agent-identity.js";
import sharedUiStyles from "../../../shared/styles/SharedUi.module.css";
import activityStyles from "./CommentActivity.module.css";
import { CommentStatusBadge } from "./CommentStatusBadge.js";
import { useCommentInputSession } from "../CommentInputSessionProvider.js";
import styles from "./CodeCommentThread.module.css";

export function CodeCommentThread({
  thread,
  draft,
  className,
  onCreateComment,
  onStatusChange,
  onClose,
  activity,
  activeCommentId = null,
  currentActorId,
}: {
  thread: CodeCommentThreadModel;
  draft: CommentDraft;
  className?: string;
  onCreateComment?: CommentCreateHandler;
  onStatusChange?: CommentStatusChangeHandler;
  onClose: () => void;
  activity?: CommentActivitySummary;
  activeCommentId?: string | null;
  currentActorId?: string;
}) {
  const hasThreadMessages = thread.comments.length > 0;
  const hasPublishedComments = thread.comments.some(
    (comment) => !isDraftThreadComment(comment),
  );
  const canContinueThread = hasThreadMessages && Boolean(draft.threadId);
  const input = useCommentInputSession(draft);
  const body = input.session?.body ?? "";
  const stale = input.session?.status === "stale";
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const threadRef = useRef<HTMLElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const threadStatus: CommentStatus = thread.status;
  const threadBadgeStatus = hasPublishedComments ? threadStatus : "draft";
  const threadBadgeLabel = hasPublishedComments
    ? statusLabel(threadStatus)
    : "Pending";
  const lineLabel =
    thread.lineStart === thread.lineEnd
      ? `Line ${thread.lineEnd}`
      : `Lines ${thread.lineStart}-${thread.lineEnd}`;
  const isReplyComposer = canContinueThread;
  const composerModeId = commentComposerModeId(thread.key);
  const replyHintId = commentReplyHintId(thread.key);
  const submitLabel = isReplyComposer
    ? "Add follow-up"
    : "Save pending draft comment";
  const submitHint = isReplyComposer
    ? "to add follow-up"
    : "to save pending draft";
  const composerModeLabel = isReplyComposer
    ? "Continue thread"
    : `Add comment on ${lineLabel}`;
  const toggleStatusLabel = threadStatus === "open" ? "Resolve" : "Reopen";
  const archiveLabel = "Archive";
  const requestClose = () => {
    input.collapse(input.id);
    onClose();
  };

  useEffect(() => {
    if (hasThreadMessages) return;
    textareaRef.current?.focus();
  }, [hasThreadMessages, thread.key]);

  async function submit() {
    const trimmed = body.trim();
    if (!trimmed || !onCreateComment || saving || stale) return;
    setSaving(true);
    setError(null);
    try {
      await onCreateComment(
        draftForCommentComposerIntent(
          draft,
          isReplyComposer ? "reply" : "new-thread",
        ),
        trimmed,
      );
      input.markSaved(input.id);
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
      className={`${styles.threadRoot} ${activityStyles.activityStyles} code-comment-thread${className ? ` ${className}` : ""}`}
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
            {hasThreadMessages
              ? `${thread.comments.length} ${thread.comments.length === 1 ? "message" : "messages"}`
              : "Composing"}
          </span>
          {hasThreadMessages ? (
            <CommentStatusBadge status={threadBadgeStatus}>
              {threadBadgeLabel}
            </CommentStatusBadge>
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
        <div
          className="comment-activity-summary"
          role="group"
          aria-label="Thread activity"
        >
          {activity.inline.map((label) => (
            <span key={label}>{label}</span>
          ))}
          {activity.timeline.length > activity.inline.length ? (
            <details className="comment-activity-timeline">
              <summary>{activity.timeline.length} events</summary>
              <ol>
                {activity.timeline.map((event) => (
                  <li key={event.id}>
                    <span>{activityLabel(event)}</span>
                    {activityMetadataLabel(event) ? (
                      <small>{activityMetadataLabel(event)}</small>
                    ) : null}
                  </li>
                ))}
              </ol>
            </details>
          ) : null}
        </div>
      ) : null}

      {thread.comments.length ? (
        <div
          className="code-comment-thread-messages"
          role="group"
          aria-label="Thread messages"
          tabIndex={0}
        >
          {thread.comments.map((comment, index) => {
            const active = comment.id === activeCommentId;
            const agent = commentAgentIdentity(comment);
            const draftComment = isDraftThreadComment(comment);
            const currentUserComment =
              Boolean(currentActorId) &&
              comment.createdBy?.id === currentActorId;
            return (
              <div
                className={`code-thread-comment ${comment.status}${draftComment ? " draft" : ""}${active ? " active" : ""}${currentUserComment ? " current-user" : ""}`}
                data-comment-id={comment.id}
                aria-current={active ? "true" : undefined}
                tabIndex={active ? -1 : undefined}
                key={comment.id}
              >
                <div className="code-thread-comment-meta">
                  <img
                    className={`code-thread-comment-avatar ${agent.key}`}
                    src={agent.avatarSrc}
                    alt=""
                    aria-hidden="true"
                    loading="lazy"
                  />
                  <strong>
                    {draftComment
                      ? "Pending draft"
                      : index === 0
                        ? `Started by ${agent.label}`
                        : `Reply by ${agent.label}`}
                  </strong>
                  <time dateTime={comment.createdAt}>
                    {formatCommentTime(comment.createdAt)}
                  </time>
                  {currentUserComment ? (
                    <span className="code-thread-self-chip">You</span>
                  ) : null}
                  {draftComment ? (
                    <CommentStatusBadge status="draft">
                      Pending
                    </CommentStatusBadge>
                  ) : (
                    <CommentStatusBadge status="published">
                      Published
                    </CommentStatusBadge>
                  )}
                  {!draftComment && comment.status !== "open" ? (
                    <span>{statusLabel(comment.status)}</span>
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
        {stale ? (
          <div className="code-comment-stale" role="alert">
            <strong>File changed since this comment was started.</strong>
            <span>Check the selected lines, then re-anchor or discard.</span>
            <div>
              <button
                type="button"
                onClick={() => input.reanchor(input.id, draft)}
              >
                Re-anchor here
              </button>
              <button
                type="button"
                onClick={() => {
                  input.discard(input.id);
                  onClose();
                }}
              >
                Discard
              </button>
            </div>
          </div>
        ) : null}
        <textarea
          ref={textareaRef}
          autoFocus={!hasThreadMessages}
          rows={2}
          value={body}
          disabled={stale}
          placeholder={isReplyComposer ? "Add a follow-up" : "Add a comment"}
          aria-label={isReplyComposer ? "Continue thread" : "New line comment"}
          aria-describedby={`${composerModeId} ${replyHintId}`}
          aria-keyshortcuts="Meta+Enter Control+Enter"
          onChange={(event) => {
            input.change(draft, event.currentTarget.value);
            if (error) setError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              requestClose();
              return;
            }
            if (isCommentSubmitShortcut(event)) {
              event.preventDefault();
              void submit();
            }
          }}
        />
        <p className="code-comment-thread-hint" id={replyHintId}>
          <kbd className={sharedUiStyles.keycap}>Cmd/Ctrl Enter</kbd>{" "}
          {submitHint} <span>Esc collapses · input is kept</span>
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
              </>
            ) : null}
            {body.trim() && !stale ? (
              <button
                type="button"
                onClick={() => {
                  input.discard(input.id);
                  onClose();
                }}
              >
                Discard
              </button>
            ) : null}
          </div>
          <button
            className="code-comment-submit"
            disabled={!body.trim() || saving || stale}
            type="submit"
            aria-label={submitLabel}
            aria-keyshortcuts="Meta+Enter Control+Enter"
            title={`${submitLabel} (Cmd/Ctrl Enter)`}
          >
            ↑
          </button>
        </div>
        {error ? (
          <p className="code-comment-thread-error" role="alert">
            {error}
          </p>
        ) : null}
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

function activityMetadataLabel(event: {
  clientEventId?: string;
  leaseExpiresAt?: string;
}): string | null {
  const details = [
    event.clientEventId ? `client ${shortMetadataId(event.clientEventId)}` : "",
    event.leaseExpiresAt
      ? `lease until ${formatCommentTime(event.leaseExpiresAt)}`
      : "",
  ].filter(Boolean);
  return details.length ? details.join(" · ") : null;
}

function shortMetadataId(value: string): string {
  return value.length > 12 ? `${value.slice(0, 8)}...` : value;
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
