import { useEffect, useRef } from "react";
import type {
  CommentSource,
  CommentStatus,
  DraftReviewComment,
  ViviComment,
} from "../../../domain/comments.js";
import type { FilePayload } from "../../../domain/fs-node.js";
import type { CommentActivitySummary } from "../../../state/comment-activity.js";
import { activityLabel, actorLabel } from "../../../state/comment-activity.js";
import {
  commentAnchorThreadKey,
  commentLineLabelForAnchor,
  commentAnchorSourceChanged,
  commentLineLabel,
  commentLocationLabel,
  statusLabel,
  truncateCommentPreview,
  visibleThreadComments,
} from "../../../state/comments.js";

type VisibleCommentStatus = Exclude<CommentStatus, "archived">;
type StatusFilter = "all" | "attention" | "drafts" | VisibleCommentStatus;

export function CommentsPanel({
  open,
  comments,
  query,
  statusFilter,
  unreadReviewPaths = emptyUnreadReviewPaths,
  knownMissingPaths = emptyMissingPaths,
  currentFile = null,
  activeCommentId = null,
  draftComments = [],
  draftPublishing = false,
  draftPublishError = null,
  publishedBatchId = null,
  onQueryChange,
  onStatusFilterChange,
  onClose,
  onOpenComment,
  onOpenDraft,
  onDeleteDraft,
  onPublishDrafts,
  onStatusChange,
  threadActivities = {},
}: {
  open: boolean;
  comments: ViviComment[];
  query: string;
  statusFilter: StatusFilter;
  unreadReviewPaths?: ReadonlySet<string>;
  knownMissingPaths?: ReadonlySet<string>;
  currentFile?: FilePayload | null;
  activeCommentId?: string | null;
  draftComments?: DraftReviewComment[];
  draftPublishing?: boolean;
  draftPublishError?: string | null;
  publishedBatchId?: string | null;
  onQueryChange: (query: string) => void;
  onStatusFilterChange: (status: StatusFilter) => void;
  onClose: () => void;
  onOpenComment: (comment: ViviComment) => void;
  onOpenDraft?: (draft: DraftReviewComment) => void;
  onDeleteDraft?: (id: string) => void | Promise<void>;
  onPublishDrafts?: () => void | Promise<void>;
  onStatusChange?: (threadId: string, status: CommentStatus) => void;
  threadActivities?: Record<string, CommentActivitySummary>;
}) {
  if (!open) return null;
  const visibleComments = visibleThreadComments(comments);
  const allThreads = groupCommentsByThread(visibleComments, unreadReviewPaths);
  const allStats = summarizeCommentThreads(allThreads);
  const matchingThreads = allThreads.filter((thread) =>
    commentThreadMatchesQuery(thread, query),
  );
  const matchingDrafts = draftComments.filter((draft) =>
    draftCommentMatchesQuery(draft, query),
  );
  const draftSummary = summarizeDraftReviewComments(draftComments);
  const draftPublishAction = draftPublishActionState({
    draftCount: draftComments.length,
    publishing: draftPublishing,
    summary: draftSummary,
  });
  const showingDrafts = statusFilter === "drafts";
  const matchingStats = summarizeCommentThreads(matchingThreads);
  const visibleThreads = showingDrafts
    ? []
    : matchingThreads
        .filter((thread) => {
          if (statusFilter === "attention") return thread.needsAttention;
          if (statusFilter !== "all" && thread.status !== statusFilter)
            return false;
          return true;
        })
        .sort(compareCommentThreads);
  const currentStop = currentCommentStop(allThreads, activeCommentId);
  const currentStopVisible =
    currentStop !== null &&
    visibleThreads.some(
      (thread) => thread.threadId === currentStop.thread.threadId,
    );
  const totalVisibleMessages = visibleThreads.reduce(
    (count, thread) => count + thread.comments.length,
    0,
  );
  const visibleAttentionThreads = visibleThreads.filter(
    (thread) => thread.needsAttention,
  ).length;
  const emptyState = commentInboxEmptyState(
    statusFilter,
    query,
    matchingStats,
    matchingDrafts.length,
  );
  const visibleResultLabel = visibleThreads.length
    ? commentResultSummaryLabel(
        visibleThreads.length,
        totalVisibleMessages,
        visibleAttentionThreads,
      )
    : showingDrafts && matchingDrafts.length
      ? draftResultSummaryLabel(matchingDrafts.length, draftSummary)
      : emptyState.title;
  const resultSummaryId = "comments-panel-result-summary";
  const keyboardHelpId = "comments-panel-keyboard-help";
  const keyboardRowCount = showingDrafts
    ? matchingDrafts.length
    : visibleThreads.length;

  return (
    <aside className="global-comments-panel" aria-label="Comments">
      <div className="global-comments-head">
        <div>
          <p className="global-comments-eyebrow">Comments Hub</p>
          <h2>Comments</h2>
          <p>
            {allStats.open} open ·{" "}
            {countNoun(draftComments.length, "private draft")} ·{" "}
            {allStats.resolved} history
            {allStats.needsAttention
              ? ` · ${countNoun(allStats.needsAttention, "attention thread")}`
              : ""}
          </p>
        </div>
        <button type="button" aria-label="Close comments" onClick={onClose}>
          ×
        </button>
      </div>
      <div
        className="global-comments-overview"
        aria-label="Comment state counts"
      >
        <button
          className={
            statusFilter === "attention" ? "active attention" : "attention"
          }
          type="button"
          aria-label={commentFilterAriaLabel(
            "attention",
            matchingStats,
            matchingDrafts.length,
          )}
          aria-pressed={statusFilter === "attention"}
          onClick={() => onStatusFilterChange("attention")}
        >
          <strong>{allStats.needsAttention}</strong>
          <span>Attention</span>
        </button>
        <button
          className={statusFilter === "drafts" ? "active drafts" : "drafts"}
          type="button"
          aria-label={commentFilterAriaLabel(
            "drafts",
            matchingStats,
            matchingDrafts.length,
          )}
          aria-pressed={statusFilter === "drafts"}
          onClick={() => onStatusFilterChange("drafts")}
        >
          <strong>{draftComments.length}</strong>
          <span>Private drafts</span>
        </button>
        <button
          className={statusFilter === "open" ? "active" : ""}
          type="button"
          aria-label={commentFilterAriaLabel(
            "open",
            matchingStats,
            matchingDrafts.length,
          )}
          aria-pressed={statusFilter === "open"}
          onClick={() => onStatusFilterChange("open")}
        >
          <strong>{allStats.open}</strong>
          <span>Open threads</span>
        </button>
        <button
          className={statusFilter === "resolved" ? "active" : ""}
          type="button"
          aria-label={commentFilterAriaLabel(
            "resolved",
            matchingStats,
            matchingDrafts.length,
          )}
          aria-pressed={statusFilter === "resolved"}
          onClick={() => onStatusFilterChange("resolved")}
        >
          <strong>{allStats.resolved}</strong>
          <span>History</span>
        </button>
      </div>
      <div className="global-comments-tools">
        <CommentsSearchInput
          query={query}
          resultSummaryId={resultSummaryId}
          keyboardHelpId={keyboardHelpId}
          visibleThreadCount={keyboardRowCount}
          onQueryChange={onQueryChange}
        />
        <p className="sr-only" id={keyboardHelpId}>
          Press Down Arrow from search to move into visible comment threads. Use
          Up Arrow from the first thread to return to search. Use Down Arrow,
          Home, and End to move between threads.
        </p>
        <div
          className="global-comment-filters"
          role="group"
          aria-label="Comment status filters"
        >
          {(
            ["attention", "drafts", "all", "open", "resolved"] as StatusFilter[]
          ).map((status) => (
            <button
              className={statusFilter === status ? "active" : ""}
              type="button"
              aria-label={commentFilterAriaLabel(
                status,
                matchingStats,
                matchingDrafts.length,
              )}
              aria-pressed={statusFilter === status}
              key={status}
              onClick={() => onStatusFilterChange(status)}
              title={commentFilterAriaLabel(
                status,
                matchingStats,
                matchingDrafts.length,
              )}
            >
              {commentFilterLabel(status, matchingStats, matchingDrafts.length)}
            </button>
          ))}
        </div>
      </div>
      <div
        className="global-comments-results"
        id={resultSummaryId}
        aria-live="polite"
      >
        {visibleResultLabel}
      </div>
      {showingDrafts &&
      (draftComments.length || draftPublishError || publishedBatchId) ? (
        <div
          className="global-draft-publish"
          aria-label="Draft publish summary"
        >
          <div>
            <strong>{draftCountLabel(draftComments.length)}</strong>
            <span>
              {draftComments.length
                ? `Will publish as ${countNoun(draftSummary.threadCount, "open thread")} across ${countNoun(draftSummary.fileCount, "file")}.`
                : "Draft comments stay private until they are published."}
            </span>
          </div>
          <button
            type="button"
            aria-label={draftPublishAction.description}
            disabled={draftPublishAction.disabled}
            title={draftPublishAction.description}
            onClick={() => void onPublishDrafts?.()}
          >
            {draftPublishAction.label}
          </button>
          {draftPublishError ? (
            <p className="global-draft-message error" role="alert">
              Publish failed. Drafts were kept. {draftPublishError}
            </p>
          ) : null}
          {publishedBatchId && !draftComments.length ? (
            <p className="global-draft-message success" aria-live="polite">
              Published review batch {publishedBatchId}. Open threads are now
              visible to agents.
            </p>
          ) : null}
        </div>
      ) : null}
      {!showingDrafts && currentStop ? (
        <div
          className="global-comments-current-stop"
          aria-label="Current review stop"
        >
          <span className="global-comments-current-dot" aria-hidden="true" />
          <span className="global-comments-current-main">
            <span className="global-comments-current-kicker">Current stop</span>
            <strong>{currentStop.thread.path}</strong>
            <span>
              {currentStop.thread.locationLabel} ·{" "}
              {currentStop.thread.lineLabel} · {currentStop.thread.surfaceLabel}
            </span>
            <span>
              {currentStopVisible
                ? "Visible below"
                : "Hidden by current filter"}
              {" · "}
              {truncateCommentPreview(currentStop.comment.body, 88)}
            </span>
          </span>
          <span className="global-comments-current-actions">
            <button
              type="button"
              aria-label={currentStopActionLabel(currentStop)}
              onClick={() => onOpenComment(currentStop.comment)}
            >
              Return
            </button>
            {onStatusChange && !currentStopVisible ? (
              <>
                <button
                  type="button"
                  aria-keyshortcuts="Meta+Shift+Enter Control+Shift+Enter"
                  title={`${currentStop.thread.status === "open" ? "Resolve" : "Reopen"} current thread (Cmd/Ctrl Shift Enter)`}
                  onClick={() =>
                    onStatusChange(
                      currentStop.thread.threadId,
                      currentStop.thread.status === "open"
                        ? "resolved"
                        : "open",
                    )
                  }
                >
                  {currentStop.thread.status === "open"
                    ? "Resolve current thread"
                    : "Reopen current thread"}
                </button>
                {currentStop.thread.status !== "archived" ? (
                  <button
                    type="button"
                    aria-keyshortcuts="Meta+Shift+Backspace Control+Shift+Backspace"
                    title="Archive current thread (Cmd/Ctrl Shift Backspace)"
                    onClick={() =>
                      onStatusChange(currentStop.thread.threadId, "archived")
                    }
                  >
                    Archive current thread
                  </button>
                ) : null}
              </>
            ) : null}
          </span>
        </div>
      ) : null}
      <div
        className="global-comments-list"
        role="list"
        aria-describedby={keyboardHelpId}
        aria-label={`${showingDrafts ? "Private draft comments" : "Comment threads"}, ${visibleResultLabel}`}
      >
        {showingDrafts ? (
          matchingDrafts.length ? (
            matchingDrafts.map((draft, index) => {
              return (
                <div
                  className="global-comment-listitem"
                  role="listitem"
                  aria-posinset={index + 1}
                  aria-setsize={matchingDrafts.length}
                  key={draft.id}
                >
                  <button
                    className="global-comment-row draft"
                    type="button"
                    aria-keyshortcuts="ArrowDown ArrowUp Home End"
                    aria-label={draftOpenLabel(draft)}
                    data-comment-id={`draft:${draft.id}`}
                    onClick={() => onOpenDraft?.(draft)}
                    onKeyDown={(event) => {
                      const nextTarget = commentInboxKeyboardTarget(
                        event.key,
                        index,
                        matchingDrafts.length,
                      );
                      if (nextTarget === null) return;
                      event.preventDefault();
                      focusCommentInboxTarget(nextTarget);
                    }}
                  >
                    <span className="global-comment-dot" aria-hidden="true" />
                    <span className="global-comment-main">
                      <span className="global-comment-meta">
                        <strong>{draft.path}</strong>
                        <span>
                          {commentLineLabelForAnchor(draft.anchor.canonical)}
                        </span>
                        <span className="global-comment-surface">
                          {draftSurfaceLabel(draft)}
                        </span>
                        <span className="comment-status draft">
                          Private draft
                        </span>
                        <span className="global-comment-author">
                          Not agent-visible
                        </span>
                      </span>
                      <span className="global-comment-location">
                        {draftLocationLabel(draft)}
                      </span>
                      <span className="global-comment-body">
                        {truncateCommentPreview(draft.body, 130)}
                      </span>
                      <span className="global-comment-thread-foot">
                        <span className="global-comment-thread-meta">
                          saved {formatCommentTime(draft.updatedAt)}
                        </span>
                        <span className="global-comment-open-hint">
                          Open draft anchor
                        </span>
                      </span>
                      {draft.anchor.canonical.quote ? (
                        <span className="global-comment-quote">
                          {truncateCommentPreview(
                            draft.anchor.canonical.quote,
                            140,
                          )}
                        </span>
                      ) : null}
                    </span>
                  </button>
                  <div
                    className="global-comment-row-actions"
                    aria-label={`Draft actions for ${draft.path}, ${commentLineLabelForAnchor(draft.anchor.canonical)}`}
                  >
                    <button
                      type="button"
                      aria-label={`Open private draft comment for ${draft.path}`}
                      onClick={() => onOpenDraft?.(draft)}
                    >
                      Open
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete private draft comment for ${draft.path}`}
                      onClick={() => void onDeleteDraft?.(draft.id)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="global-comments-empty">
              <strong>{emptyState.title}</strong>
              <span>{emptyState.detail}</span>
            </div>
          )
        ) : visibleThreads.length ? (
          visibleThreads.map((thread, index) => {
            const activity = threadActivities[thread.threadId];
            const latest = thread.latestComment;
            const sourceMissing = knownMissingPaths.has(thread.path);
            const sourceChanged = thread.comments.some((comment) =>
              commentAnchorSourceChanged(comment, currentFile),
            );
            const sourceState = sourceMissing
              ? {
                  label: "Source missing",
                  aria: "This comment points to a path that is not present in the current workspace tree",
                }
              : sourceChanged
                ? {
                    label: "Source changed",
                    aria: "Current file content differs from this comment anchor",
                  }
                : null;
            const searchMatch = commentThreadSearchMatch(thread, query);
            const active = commentThreadContainsComment(
              thread,
              activeCommentId,
            );
            const toggleStatusLabel =
              thread.status === "open"
                ? active
                  ? "Resolve current thread"
                  : "Resolve"
                : active
                  ? "Reopen current thread"
                  : "Reopen";
            const archiveLabel = active ? "Archive current thread" : "Archive";
            const actionContext = `${thread.path}, ${thread.lineLabel}`;
            const toggleStatusActionLabel =
              thread.status === "open"
                ? active
                  ? "Resolve current thread"
                  : `Resolve comment for ${actionContext}`
                : active
                  ? "Reopen current thread"
                  : `Reopen comment for ${actionContext}`;
            const archiveActionLabel = active
              ? "Archive current thread"
              : `Archive comment for ${actionContext}`;
            return (
              <div
                className="global-comment-listitem"
                role="listitem"
                aria-posinset={index + 1}
                aria-setsize={visibleThreads.length}
                key={thread.threadId}
              >
                <button
                  className={`global-comment-row ${thread.status}${thread.needsAttention ? " needs-attention" : ""}${active ? " active" : ""}`}
                  type="button"
                  aria-current={active ? "true" : undefined}
                  aria-keyshortcuts="ArrowDown ArrowUp Home End"
                  aria-label={commentThreadAriaLabel(
                    thread,
                    latest,
                    searchMatch,
                    active,
                  )}
                  data-comment-thread-id={thread.threadId}
                  data-comment-id={latest.id}
                  onClick={() => onOpenComment(latest)}
                  onKeyDown={(event) => {
                    const nextTarget = commentInboxKeyboardTarget(
                      event.key,
                      index,
                      visibleThreads.length,
                    );
                    if (nextTarget === null) return;
                    event.preventDefault();
                    focusCommentInboxTarget(nextTarget);
                  }}
                >
                  <span className="global-comment-dot" aria-hidden="true" />
                  <span className="global-comment-main">
                    <span className="global-comment-meta">
                      <strong>{thread.path}</strong>
                      <span>{thread.lineLabel}</span>
                      <span className="global-comment-surface">
                        {thread.surfaceLabel}
                      </span>
                      {thread.anchorDetailLabel ? (
                        <span className="global-comment-anchor">
                          {thread.anchorDetailLabel}
                        </span>
                      ) : null}
                      <span className={`comment-status ${thread.status}`}>
                        {statusLabel(thread.status)}
                      </span>
                      {thread.needsAttention ? (
                        <span className="global-comment-attention">
                          Needs attention
                        </span>
                      ) : null}
                      {sourceState ? (
                        <span
                          className="comment-anchor-warning"
                          aria-label={sourceState.aria}
                        >
                          {sourceState.label}
                        </span>
                      ) : null}
                      {active ? (
                        <span className="global-comment-current">
                          Current thread
                        </span>
                      ) : null}
                      <span className="global-comment-author">
                        Latest by {commentAuthorLabel(latest)}
                      </span>
                    </span>
                    <span className="global-comment-location">
                      {thread.locationLabel}
                    </span>
                    {thread.needsAttention ? (
                      <span className="global-comment-review-stop">
                        <strong>Next review stop</strong>
                        <span>Unseen review activity</span>
                      </span>
                    ) : null}
                    <span className="global-comment-body">
                      {truncateCommentPreview(latest.body, 130)}
                    </span>
                    {searchMatch ? (
                      <span className="global-comment-search-match">
                        <span>Matched {searchMatch.label}</span>
                        <SearchMatchText
                          query={query}
                          text={commentSearchSnippet(searchMatch.text, query)}
                        />
                      </span>
                    ) : null}
                    <span className="global-comment-thread-foot">
                      <span className="global-comment-thread-meta">
                        {thread.comments.length}{" "}
                        {thread.comments.length === 1 ? "message" : "messages"}{" "}
                        · updated {formatCommentTime(thread.updatedAt)}
                        {thread.reviewBatchId
                          ? ` · batch ${shortBatchId(thread.reviewBatchId)}`
                          : ""}
                      </span>
                      <span className="global-comment-open-hint">
                        {threadFootHintLabel(thread.status)}
                      </span>
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
                    {latest.anchor.canonical.quote ? (
                      <span className="global-comment-quote">
                        {truncateCommentPreview(
                          latest.anchor.canonical.quote,
                          140,
                        )}
                      </span>
                    ) : null}
                  </span>
                </button>
                {onStatusChange ? (
                  <div
                    className="global-comment-row-actions"
                    aria-label={`Thread actions for ${thread.path}, ${thread.lineLabel}`}
                  >
                    {thread.status === "open" ? (
                      <button
                        type="button"
                        aria-label={toggleStatusActionLabel}
                        aria-keyshortcuts={
                          active
                            ? "Meta+Shift+Enter Control+Shift+Enter"
                            : undefined
                        }
                        title={
                          active
                            ? "Resolve current thread (Cmd/Ctrl Shift Enter)"
                            : toggleStatusActionLabel
                        }
                        onClick={() =>
                          onStatusChange(thread.threadId, "resolved")
                        }
                      >
                        {toggleStatusLabel}
                      </button>
                    ) : (
                      <button
                        type="button"
                        aria-label={toggleStatusActionLabel}
                        aria-keyshortcuts={
                          active
                            ? "Meta+Shift+Enter Control+Shift+Enter"
                            : undefined
                        }
                        title={
                          active
                            ? "Reopen current thread (Cmd/Ctrl Shift Enter)"
                            : toggleStatusActionLabel
                        }
                        onClick={() => onStatusChange(thread.threadId, "open")}
                      >
                        {toggleStatusLabel}
                      </button>
                    )}
                    {thread.status !== "archived" ? (
                      <button
                        type="button"
                        aria-label={archiveActionLabel}
                        aria-keyshortcuts={
                          active
                            ? "Meta+Shift+Backspace Control+Shift+Backspace"
                            : undefined
                        }
                        title={
                          active
                            ? "Archive current thread (Cmd/Ctrl Shift Backspace)"
                            : archiveActionLabel
                        }
                        onClick={() =>
                          onStatusChange(thread.threadId, "archived")
                        }
                      >
                        {archiveLabel}
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })
        ) : (
          <div className="global-comments-empty">
            <strong>{emptyState.title}</strong>
            <span>{emptyState.detail}</span>
          </div>
        )}
      </div>
    </aside>
  );
}

interface CommentThreadSummary {
  threadId: string;
  path: string;
  status: CommentStatus;
  lineLabel: string;
  surfaceLabel: string;
  anchorDetailLabel: string | null;
  locationLabel: string;
  updatedAt: string;
  reviewBatchId: string | null;
  comments: ViviComment[];
  primaryComment: ViviComment;
  latestComment: ViviComment;
  needsAttention: boolean;
}

function CommentsSearchInput({
  query,
  resultSummaryId,
  keyboardHelpId,
  visibleThreadCount,
  onQueryChange,
}: {
  query: string;
  resultSummaryId: string;
  keyboardHelpId: string;
  visibleThreadCount: number;
  onQueryChange: (query: string) => void;
}) {
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    const timeout = window.setTimeout(() => searchInputRef.current?.focus(), 0);
    return () => window.clearTimeout(timeout);
  }, []);

  return (
    <div className="global-comments-search-control">
      <input
        ref={searchInputRef}
        value={query}
        placeholder="Search comments, paths, quotes"
        aria-label="Search comments"
        aria-describedby={`${resultSummaryId} ${keyboardHelpId}`}
        onChange={(event) => onQueryChange(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && query.trim()) {
            event.preventDefault();
            onQueryChange("");
            window.setTimeout(() => searchInputRef.current?.focus(), 0);
            return;
          }
          const nextTarget = commentInboxKeyboardTarget(
            event.key,
            -1,
            visibleThreadCount,
          );
          if (nextTarget === null) return;
          event.preventDefault();
          focusCommentInboxTarget(nextTarget);
        }}
      />
      {query.trim() ? (
        <button
          type="button"
          className="global-comments-clear-search"
          aria-label="Clear comments search"
          title="Clear comments search"
          onClick={() => {
            onQueryChange("");
            window.setTimeout(() => searchInputRef.current?.focus(), 0);
          }}
        >
          Clear
        </button>
      ) : null}
    </div>
  );
}

type CommentInboxKeyboardFocusTarget = number | "search";

export function commentInboxKeyboardTarget(
  key: string,
  currentIndex: number,
  count: number,
): CommentInboxKeyboardFocusTarget | null {
  if (count <= 0) return null;
  if (currentIndex < 0) return key === "ArrowDown" ? 0 : null;
  if (key === "ArrowDown") return Math.min(currentIndex + 1, count - 1);
  if (key === "ArrowUp")
    return currentIndex === 0 ? "search" : currentIndex - 1;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}

function focusCommentInboxTarget(target: CommentInboxKeyboardFocusTarget) {
  if (target === "search") {
    document
      .querySelector<HTMLInputElement>(".global-comments-panel input")
      ?.focus();
    return;
  }
  focusCommentThreadRow(target);
}

function focusCommentThreadRow(index: number) {
  const rows = document.querySelectorAll<HTMLButtonElement>(
    ".global-comments-list .global-comment-row",
  );
  rows[index]?.focus();
}

function commentThreadContainsComment(
  thread: CommentThreadSummary,
  commentId: string | null,
): boolean {
  return (
    !!commentId && thread.comments.some((comment) => comment.id === commentId)
  );
}

const emptyUnreadReviewPaths = new Set<string>();
const emptyMissingPaths = new Set<string>();

function groupCommentsByThread(
  comments: ViviComment[],
  unreadReviewPaths: ReadonlySet<string> = emptyUnreadReviewPaths,
): CommentThreadSummary[] {
  const groups = new Map<string, ViviComment[]>();
  for (const comment of comments) {
    const threadId = comment.threadId ?? comment.id;
    groups.set(threadId, [...(groups.get(threadId) ?? []), comment]);
  }

  return [...groups.entries()].map(([threadId, threadComments]) => {
    const sorted = [...threadComments].sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    );
    const primaryComment = sorted[0];
    const latestState = latestThreadState(sorted);
    return {
      threadId,
      path: primaryComment.path,
      status: latestState.status,
      lineLabel: commentLineLabel(primaryComment),
      surfaceLabel: surfaceLabel(primaryComment),
      anchorDetailLabel: anchorDetailLabel(primaryComment),
      locationLabel: commentLocationLabel(primaryComment),
      updatedAt: latestState.updatedAt,
      reviewBatchId: primaryComment.reviewBatchId ?? null,
      comments: sorted,
      primaryComment,
      latestComment: latestState,
      needsAttention:
        latestState.status === "open" &&
        unreadReviewPaths.has(primaryComment.path),
    };
  });
}

function latestThreadState(comments: ViviComment[]): ViviComment {
  return comments.reduce((latest, comment) =>
    comment.updatedAt > latest.updatedAt ? comment : latest,
  );
}

function compareCommentThreads(
  a: CommentThreadSummary,
  b: CommentThreadSummary,
): number {
  const attentionDelta = Number(b.needsAttention) - Number(a.needsAttention);
  if (attentionDelta) return attentionDelta;
  const statusRank = (status: CommentStatus) =>
    status === "open" ? 0 : status === "resolved" ? 1 : 2;
  const statusDelta = statusRank(a.status) - statusRank(b.status);
  if (statusDelta) return statusDelta;
  return b.updatedAt.localeCompare(a.updatedAt);
}

function summarizeComments(
  comments: ViviComment[],
  unreadReviewPaths: ReadonlySet<string> = emptyUnreadReviewPaths,
): CommentInboxStats {
  return summarizeCommentThreads(
    groupCommentsByThread(comments, unreadReviewPaths),
  );
}

function summarizeCommentThreads(
  summaries: CommentThreadSummary[],
): CommentInboxStats {
  return {
    all: summaries.length,
    open: summaries.filter((thread) => thread.status === "open").length,
    resolved: summaries.filter((thread) => thread.status === "resolved").length,
    archived: summaries.filter((thread) => thread.status === "archived").length,
    needsAttention: summaries.filter((thread) => thread.needsAttention).length,
  };
}

function currentCommentStop(
  summaries: CommentThreadSummary[],
  activeCommentId: string | null,
): { thread: CommentThreadSummary; comment: ViviComment } | null {
  if (!activeCommentId) return null;
  for (const thread of summaries) {
    const comment = thread.comments.find(
      (candidate) => candidate.id === activeCommentId,
    );
    if (comment) return { thread, comment };
  }
  return null;
}

function currentStopActionLabel({
  thread,
  comment,
}: {
  thread: CommentThreadSummary;
  comment: ViviComment;
}): string {
  return [
    "Return to current thread",
    thread.path,
    thread.locationLabel,
    commentLineLabel(comment),
  ].join(", ");
}

interface CommentInboxStats extends Record<CommentStatus, number> {
  all: number;
  needsAttention: number;
}

function commentFilterLabel(
  status: StatusFilter,
  stats: CommentInboxStats,
  draftCount: number,
): string {
  if (status === "all") return countLabel("All", stats.all);
  if (status === "attention") {
    return countLabel("Attention", stats.needsAttention);
  }
  if (status === "drafts") return countLabel("Drafts", draftCount);
  return countLabel(statusLabel(status), stats[status]);
}

function commentFilterAriaLabel(
  status: StatusFilter,
  stats: CommentInboxStats,
  draftCount: number,
): string {
  if (status === "all") return `Show all ${countNoun(stats.all, "thread")}`;
  if (status === "attention") {
    return `Show ${countNoun(stats.needsAttention, "attention thread")}`;
  }
  if (status === "drafts") {
    return `Show ${countNoun(draftCount, "private draft comment")}`;
  }
  return `Show ${countNoun(stats[status], `${statusLabel(status).toLowerCase()} thread`)}`;
}

function countLabel(label: string, count: number): string {
  return count ? `${label} ${count}` : label;
}

function commentThreadMatchesQuery(
  thread: CommentThreadSummary,
  query: string,
): boolean {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return true;
  const haystack = [
    thread.path,
    thread.locationLabel,
    thread.lineLabel,
    thread.surfaceLabel,
    thread.anchorDetailLabel ?? "",
    ...thread.comments.flatMap((comment) => [
      comment.body,
      comment.anchor.canonical.quote ?? "",
    ]),
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(normalizedQuery);
}

function commentResultSummaryLabel(
  threadCount: number,
  messageCount: number,
  attentionThreadCount: number,
): string {
  return [
    countNoun(threadCount, "thread"),
    countNoun(messageCount, "message"),
    attentionThreadCount
      ? countNoun(attentionThreadCount, "attention thread")
      : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

function countNoun(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function commentInboxEmptyState(
  statusFilter: StatusFilter,
  query: string,
  stats: CommentInboxStats,
  _draftCount: number,
): { title: string; detail: string } {
  const searching = query.trim().length > 0;
  if (searching && stats.all === 0) {
    return {
      title: "No threads match this search",
      detail: "Try a path, quoted text, or a phrase from the comment body.",
    };
  }

  if (statusFilter === "attention") {
    return {
      title: searching
        ? "No matching threads need attention"
        : "No threads need attention",
      detail: searching
        ? "Try another status filter or broaden your search."
        : "Open threads with unseen activity will appear here.",
    };
  }

  if (statusFilter === "drafts") {
    return {
      title: searching ? "No matching private drafts" : "No private drafts",
      detail: searching
        ? "Try another status filter or broaden your search."
        : "Draft comments saved from rendered, source, or diff surfaces will collect here before publish.",
    };
  }

  if (statusFilter === "open") {
    return {
      title: searching ? "No matching open threads" : "No open threads",
      detail: searching
        ? "Try another status filter or broaden your search."
        : stats.resolved
          ? "Resolved threads remain available in the history filter."
          : "New review comments will appear here after they are published.",
    };
  }

  if (statusFilter === "resolved") {
    return {
      title: searching ? "No matching resolved threads" : "No resolved threads",
      detail: searching
        ? "Try another status filter or broaden your search."
        : "Resolved feedback will stay here without returning to the review queue.",
    };
  }

  return {
    title: "No comment threads yet",
    detail:
      "Comments created from rendered, source, or diff surfaces will collect here.",
  };
}

function draftCountLabel(count: number): string {
  if (count === 0) return "No unpublished comments";
  if (count === 1) return "1 private draft ready";
  return `${count} private drafts ready`;
}

function draftResultSummaryLabel(
  draftCount: number,
  summary: DraftReviewSummary,
): string {
  return [
    countNoun(draftCount, "private draft"),
    countNoun(summary.threadCount, "open thread after publish"),
    countNoun(summary.fileCount, "file"),
  ].join(" · ");
}

interface DraftReviewSummary {
  fileCount: number;
  threadCount: number;
}

function summarizeDraftReviewComments(
  drafts: DraftReviewComment[],
): DraftReviewSummary {
  const paths = new Set<string>();
  const threads = new Set<string>();
  for (const draft of drafts) {
    paths.add(draft.path);
    threads.add(
      draft.threadId ?? commentAnchorThreadKey(draft.path, draft.anchor),
    );
  }
  return {
    fileCount: paths.size,
    threadCount: threads.size,
  };
}

function draftPublishActionState({
  draftCount,
  publishing,
  summary,
}: {
  draftCount: number;
  publishing: boolean;
  summary: DraftReviewSummary;
}): {
  description: string;
  disabled: boolean;
  label: string;
} {
  if (publishing) {
    return {
      description: "Publishing draft review comments",
      disabled: true,
      label: "Publishing...",
    };
  }
  if (!draftCount) {
    return {
      description: "No draft comments to publish",
      disabled: true,
      label: "Publish review comments",
    };
  }
  return {
    description: `Publish ${countNoun(draftCount, "draft comment")} as ${countNoun(summary.threadCount, "open thread")} across ${countNoun(summary.fileCount, "file")}`,
    disabled: false,
    label: "Publish review comments",
  };
}

function draftSurfaceLabel(draft: DraftReviewComment): string {
  if (draft.anchor.surface === "diff") return "diff";
  if (draft.anchor.surface === "rendered") {
    return `${draft.anchor.rendered?.kind ?? draft.viewerKind} rendered`;
  }
  return "source";
}

function draftLocationLabel(draft: DraftReviewComment): string {
  if (draft.anchor.surface === "rendered") {
    return draft.anchor.rendered?.textQuote
      ? `Rendered text "${truncateCommentPreview(draft.anchor.rendered.textQuote, 48)}"`
      : "Rendered surface";
  }
  if (draft.anchor.surface === "diff") return "Diff comment";
  return commentLineLabelForAnchor(draft.anchor.canonical);
}

function draftOpenLabel(draft: DraftReviewComment): string {
  return [
    `Open private draft in ${draft.path}`,
    draftSurfaceLabel(draft),
    commentLineLabelForAnchor(draft.anchor.canonical),
    "not agent-visible until publish",
  ].join(", ");
}

function draftCommentMatchesQuery(
  draft: DraftReviewComment,
  query: string,
): boolean {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return true;
  const haystack = [
    draft.path,
    draft.body,
    draftSurfaceLabel(draft),
    draftLocationLabel(draft),
    commentLineLabelForAnchor(draft.anchor.canonical),
    draft.anchor.canonical.quote ?? "",
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(normalizedQuery);
}

function surfaceLabel(comment: ViviComment): string {
  if (comment.anchor.surface === "diff") return "diff";
  if (comment.anchor.surface === "rendered") {
    return `${comment.anchor.rendered?.kind ?? comment.viewerKind} rendered`;
  }
  return "source";
}

function anchorDetailLabel(comment: ViviComment): string | null {
  if (comment.anchor.surface === "rendered") {
    const rendered = comment.anchor.rendered;
    if (!rendered) return null;
    const sourceLabel = lineRangeLabel(
      rendered.sourceLineStart,
      rendered.sourceLineEnd,
      "source ",
    );
    if (rendered.blockId) {
      return [`Block ${rendered.blockId}`, sourceLabel]
        .filter(Boolean)
        .join(", ");
    }
    if (rendered.selector) {
      return [`Selector ${rendered.selector}`, sourceLabel]
        .filter(Boolean)
        .join(", ");
    }
    if (rendered.textQuote) {
      return `Text "${truncateCommentPreview(rendered.textQuote, 48)}"`;
    }
    return sourceLabel;
  }

  if (comment.anchor.surface === "diff") {
    const diff = comment.anchor.diff;
    if (!diff) return null;
    const sideLabel = diff.side === "old" ? "Old diff" : "New diff";
    const lineLabel =
      diff.side === "old"
        ? lineRangeLabel(diff.oldLineStart, diff.oldLineEnd)
        : lineRangeLabel(diff.newLineStart, diff.newLineEnd);
    return lineLabel ? `${sideLabel} ${lineLabel}` : `${sideLabel} hunk`;
  }

  return null;
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

function commentAuthorLabel(comment: ViviComment): string {
  if (comment.createdBy) return actorLabel(comment.createdBy);
  if (comment.author?.trim()) return comment.author.trim();
  return sourceLabel(comment.source);
}

interface CommentSearchMatch {
  label: string;
  text: string;
}

function SearchMatchText({ text, query }: { text: string; query: string }) {
  const normalizedQuery = query.trim().toLowerCase();
  const index = normalizedQuery
    ? text.toLowerCase().indexOf(normalizedQuery)
    : -1;
  if (index < 0) return <>{text}</>;

  const before = text.slice(0, index);
  const match = text.slice(index, index + normalizedQuery.length);
  const after = text.slice(index + normalizedQuery.length);
  return (
    <>
      {before}
      <mark className="global-comment-search-hit">{match}</mark>
      {after}
    </>
  );
}

function commentSearchSnippet(
  text: string,
  query: string,
  maxLength = 140,
): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  const normalizedQuery = query.trim().toLowerCase();
  const matchIndex = normalizedQuery
    ? normalized.toLowerCase().indexOf(normalizedQuery)
    : -1;
  if (matchIndex < 0 || normalized.length <= maxLength) {
    return truncateCommentPreview(normalized, maxLength);
  }

  const sideBudget = Math.max(
    12,
    Math.floor((maxLength - normalizedQuery.length) / 2),
  );
  const start = Math.max(0, matchIndex - sideBudget);
  const end = Math.min(
    normalized.length,
    matchIndex + normalizedQuery.length + sideBudget,
  );
  return `${start > 0 ? "..." : ""}${normalized
    .slice(start, end)
    .trim()}${end < normalized.length ? "..." : ""}`;
}

function commentThreadSearchMatch(
  thread: CommentThreadSummary,
  query: string,
): CommentSearchMatch | null {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return null;

  if (thread.path.toLowerCase().includes(normalizedQuery)) {
    return { label: "path", text: thread.path };
  }
  if (thread.locationLabel.toLowerCase().includes(normalizedQuery)) {
    return { label: "location", text: thread.locationLabel };
  }
  if (thread.lineLabel.toLowerCase().includes(normalizedQuery)) {
    return { label: "line", text: thread.lineLabel };
  }
  if (thread.surfaceLabel.toLowerCase().includes(normalizedQuery)) {
    return { label: "surface", text: thread.surfaceLabel };
  }
  if (thread.anchorDetailLabel?.toLowerCase().includes(normalizedQuery)) {
    return { label: "anchor", text: thread.anchorDetailLabel };
  }

  const commentsByLatestFirst = [...thread.comments].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );
  for (const comment of commentsByLatestFirst) {
    if (comment.body.toLowerCase().includes(normalizedQuery)) {
      return {
        label: commentAuthorLabel(comment),
        text: comment.body,
      };
    }
  }

  for (const comment of commentsByLatestFirst) {
    const quote = comment.anchor.canonical.quote;
    if (quote?.toLowerCase().includes(normalizedQuery)) {
      return {
        label: "quote",
        text: quote,
      };
    }
  }

  return null;
}

function commentThreadAriaLabel(
  thread: CommentThreadSummary,
  latest: ViviComment,
  searchMatch?: CommentSearchMatch | null,
  active = false,
): string {
  return [
    `${statusLabel(thread.status)} thread in ${thread.path}`,
    active ? "current thread" : "",
    thread.locationLabel,
    thread.lineLabel,
    thread.surfaceLabel,
    thread.anchorDetailLabel ?? "",
    `${thread.comments.length} ${thread.comments.length === 1 ? "message" : "messages"}`,
    `latest by ${commentAuthorLabel(latest)}`,
    searchMatch ? `matched ${searchMatch.label}, ${searchMatch.text}` : "",
    thread.needsAttention ? "next review stop" : "",
    thread.needsAttention ? "unseen review activity" : "",
    thread.needsAttention ? "needs attention" : "",
  ]
    .filter(Boolean)
    .join(", ");
}

function threadFootHintLabel(status: CommentStatus): string {
  if (status === "open") return "Open feedback";
  if (status === "resolved") return "Resolved feedback";
  return "Archived feedback";
}

function sourceLabel(source: CommentSource | undefined): string {
  if (source === "codex") return "Codex";
  if (source === "claude-code") return "Claude Code";
  if (source === "human") return "Human";
  return "Unknown";
}

function formatCommentTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function shortBatchId(id: string): string {
  return id.replace(/^review-batch-/, "").slice(0, 8);
}

export type { StatusFilter as CommentStatusFilter };
