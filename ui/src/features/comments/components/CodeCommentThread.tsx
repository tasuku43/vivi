import { useEffect, useRef, useState } from "react";
import {
  isHumanFeedback,
  type CommentActivitySummary,
} from "../../../state/comment-activity.js";
import type {
  CodeCommentThread as CodeCommentThreadModel,
  CommentCreateHandler,
  CommentDraft,
} from "../../../state/comments.js";
import {
  draftForNewComment,
  isDraftThreadComment,
} from "../../../state/comments.js";
import { commentAgentIdentity } from "../comment-agent-identity.js";
import sharedUiStyles from "../../../shared/styles/SharedUi.module.css";
import activityStyles from "./CommentActivity.module.css";
import { CommentStatusBadge } from "./CommentStatusBadge.js";
import { useCommentInputSession } from "../CommentInputSessionProvider.js";
import {
  useDraftReviewCommentDelete,
  type DraftReviewCommentDeleteHandler,
} from "../DraftReviewCommentActions.js";
import styles from "./CodeCommentThread.module.css";

export function CodeCommentThread({
  thread,
  draft,
  className,
  onCreateComment,
  onClose,
  activity,
  activeCommentId = null,
  currentActorId,
  onDeleteDraft,
  keepOpenAfterCreate = false,
  focusRevision = 0,
  reanchorDraft,
}: {
  thread: CodeCommentThreadModel;
  draft: CommentDraft;
  className?: string;
  onCreateComment?: CommentCreateHandler;
  onClose: () => void;
  activity?: CommentActivitySummary;
  activeCommentId?: string | null;
  currentActorId?: string;
  onDeleteDraft?: DraftReviewCommentDeleteHandler;
  keepOpenAfterCreate?: boolean;
  focusRevision?: number;
  /** Current-file anchor to adopt while retaining the persisted draft identity. */
  reanchorDraft?: CommentDraft;
}) {
  const visibleComments = thread.comments.filter(
    (comment) => isDraftThreadComment(comment) || isHumanFeedback(comment),
  );
  const hasThreadMessages = visibleComments.length > 0;
  const hasPublishedComments = visibleComments.some(
    (comment) => !isDraftThreadComment(comment),
  );
  const canContinuePendingDraft =
    hasThreadMessages && !hasPublishedComments && Boolean(draft.threadId);
  const [adoptedDraft, setAdoptedDraft] = useState<CommentDraft | null>(null);
  const activeDraft = adoptedDraft ?? draft;
  const input = useCommentInputSession(activeDraft);
  const body = input.session?.body ?? "";
  const hasPreservedNewFeedback = hasPublishedComments && Boolean(body.trim());
  const showComposer =
    !hasThreadMessages || canContinuePendingDraft || hasPreservedNewFeedback;
  const stale = input.session?.status === "stale";
  const [saving, setSaving] = useState(false);
  const [deletingDraftId, setDeletingDraftId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inheritedDeleteDraft = useDraftReviewCommentDelete();
  const deleteDraft = onDeleteDraft ?? inheritedDeleteDraft;
  const threadRef = useRef<HTMLElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const refocusAfterSubmitRef = useRef(false);
  const latestBodyRef = useRef(body);
  latestBodyRef.current = body;
  const lineLabel =
    thread.lineStart === thread.lineEnd
      ? `Line ${thread.lineEnd}`
      : `Lines ${thread.lineStart}-${thread.lineEnd}`;
  const composerModeId = commentComposerModeId(thread.key);
  const inputHintId = commentInputHintId(thread.key);
  const submitLabel = "Save pending draft comment";
  const composerModeLabel = canContinuePendingDraft
    ? "Add another pending note"
    : `Add comment on ${lineLabel}`;
  const receiptLabel = reviewReceiptLabel(visibleComments, activity);
  const requestClose = () => {
    input.collapse(input.id);
    onClose();
  };

  useEffect(() => {
    if (!showComposer) return;
    textareaRef.current?.focus();
  }, [showComposer, thread.key]);

  useEffect(() => {
    if (!focusRevision || !showComposer) return;
    const frame = window.requestAnimationFrame(() => {
      if (stale) {
        threadRef.current
          ?.querySelector<HTMLButtonElement>("button[data-stale-reanchor]")
          ?.focus({ preventScroll: true });
      } else {
        textareaRef.current?.focus({ preventScroll: true });
      }
      threadRef.current?.scrollIntoView({ block: "center", inline: "nearest" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusRevision, showComposer, stale]);

  useEffect(() => {
    if (!refocusAfterSubmitRef.current || body) return;
    const frame = window.requestAnimationFrame(() => {
      if (!textareaRef.current || textareaRef.current.disabled) return;
      textareaRef.current.focus();
      refocusAfterSubmitRef.current = false;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [body, canContinuePendingDraft, saving, thread.comments.length]);

  async function submit() {
    const trimmed = body.trim();
    if (!trimmed || !onCreateComment || saving || stale) return;
    const keepComposerOpen =
      canContinuePendingDraft || (!hasThreadMessages && keepOpenAfterCreate);
    setSaving(true);
    setError(null);
    if (keepComposerOpen) {
      refocusAfterSubmitRef.current = true;
      latestBodyRef.current = "";
      input.change(activeDraft, "");
    }
    try {
      await onCreateComment(
        canContinuePendingDraft
          ? activeDraft
          : draftForNewComment(activeDraft),
        trimmed,
      );
      if (keepComposerOpen) {
        if (!canContinuePendingDraft) input.discard(input.id);
        return;
      }
      input.discard(input.id);
      onClose();
    } catch (cause) {
      if (keepComposerOpen) {
        const nextThought = latestBodyRef.current.trim();
        const restoredBody = nextThought
          ? `${trimmed}\n\n${latestBodyRef.current}`
          : body;
        latestBodyRef.current = restoredBody;
        input.change(activeDraft, restoredBody);
        refocusAfterSubmitRef.current = true;
      }
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  }

  async function deletePendingDraft(id: string) {
    if (!deleteDraft || deletingDraftId || saving) return;
    const closesDraftOnlyThread =
      !hasPublishedComments && visibleComments.length === 1;
    setDeletingDraftId(id);
    setError(null);
    try {
      await deleteDraft(id);
      if (closesDraftOnlyThread) {
        input.discard(input.id);
        onClose();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setDeletingDraftId(null);
    }
  }

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
              ? `${visibleComments.length} ${visibleComments.length === 1 ? "message" : "messages"}`
              : "Composing"}
          </span>
          {hasThreadMessages ? (
            hasPublishedComments ? (
              <>
                <CommentStatusBadge status="published">
                  Published
                </CommentStatusBadge>
                <span>{receiptLabel}</span>
              </>
            ) : (
              <CommentStatusBadge status="draft">Pending</CommentStatusBadge>
            )
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
      {receiptLabel === "Seen" && activity?.inline[0] ? (
        <div
          className="comment-activity-summary"
          role="group"
          aria-label="Thread activity"
        >
          <span>{activity.inline[0]}</span>
        </div>
      ) : null}

      {visibleComments.length ? (
        <div
          className="code-comment-thread-messages"
          role="group"
          aria-label="Thread messages"
          tabIndex={0}
        >
          {visibleComments.map((comment, index) => {
            const active = comment.id === activeCommentId;
            const agent = commentAgentIdentity(comment);
            const draftComment = isDraftThreadComment(comment);
            const draftId = draftComment
              ? (comment.draftId ?? comment.id.replace(/^draft:/, ""))
              : null;
            const currentUserComment =
              Boolean(currentActorId) &&
              comment.createdBy?.id === currentActorId;
            return (
              <div
                className={`code-thread-comment${draftComment ? " draft" : ""}${active ? " active" : ""}${currentUserComment ? " current-user" : ""}`}
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
                        ? `Comment by ${agent.label}`
                        : `Additional comment by ${agent.label}`}
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
                  {draftId && deleteDraft ? (
                    <button
                      className="code-thread-comment-delete"
                      type="button"
                      aria-label={`Delete pending draft comment ${index + 1}`}
                      disabled={deletingDraftId === draftId || saving}
                      onClick={() => void deletePendingDraft(draftId)}
                    >
                      {deletingDraftId === draftId ? "Deleting…" : "Delete"}
                    </button>
                  ) : null}
                </div>
                <p>{comment.body}</p>
              </div>
            );
          })}
        </div>
      ) : null}

      {showComposer ? (
        <form
          className="code-comment-thread-composer"
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
                  data-stale-reanchor
                  onClick={() => {
                    const nextDraft = reanchorDraft ?? draft;
                    setAdoptedDraft(nextDraft);
                    input.reanchor(input.id, nextDraft);
                  }}
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
            autoFocus={showComposer}
            rows={2}
            value={body}
            disabled={stale || (saving && !canContinuePendingDraft)}
            placeholder="Add a comment"
            aria-label={
              canContinuePendingDraft
                ? "Add another pending note"
                : "New line comment"
            }
            aria-describedby={`${composerModeId} ${inputHintId}`}
            aria-keyshortcuts="Meta+Enter Control+Enter"
            onChange={(event) => {
              latestBodyRef.current = event.currentTarget.value;
              input.change(activeDraft, event.currentTarget.value);
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
          <p className="code-comment-thread-hint" id={inputHintId}>
            <kbd className={sharedUiStyles.keycap}>Cmd/Ctrl Enter</kbd> to save
            pending draft <span>Esc collapses · input is kept</span>
          </p>
          <div className="code-comment-thread-footer">
            <div>
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
      ) : null}
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

function commentInputHintId(threadKey: string): string {
  return `comment-input-hint-${safeCommentThreadKey(threadKey)}`;
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

function reviewReceiptLabel(
  comments: CodeCommentThreadModel["comments"],
  activity: CommentActivitySummary | undefined,
): "Seen" | "Unseen" {
  const latestFeedbackAt = comments
    .filter(
      (comment) => !isDraftThreadComment(comment) && isHumanFeedback(comment),
    )
    .reduce(
      (latest, comment) => Math.max(latest, Date.parse(comment.updatedAt)),
      0,
    );
  const latestReadAt =
    activity?.timeline.reduce(
      (latest, event) => Math.max(latest, Date.parse(event.createdAt)),
      0,
    ) ?? 0;
  return latestFeedbackAt > 0 && latestReadAt >= latestFeedbackAt
    ? "Seen"
    : "Unseen";
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
