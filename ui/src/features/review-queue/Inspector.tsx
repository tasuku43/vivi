import {
  buildCommentThreads,
  type CommentStatus,
  type CommentThread,
  type DraftReviewComment,
  type ViviComment,
} from "../../domain/comments.js";
import type { FilePayload } from "../../domain/fs-node.js";
import type { CommentActivitySummary } from "../../state/comment-activity.js";
import { activityLabel } from "../../state/comment-activity.js";
import {
  buildCodeMetadata,
  type CodeSymbol,
  type LineRange,
} from "../../state/code-viewer.js";
import {
  commentAnchorSourceChanged,
  commentLineLabel,
  commentLocationLabel,
  statusLabel,
  truncateCommentPreview,
} from "../../state/comments.js";
import {
  changeStatusLabel,
  reviewQueueSourceLabel,
  type DiffStat,
  type ReviewChangeItem,
} from "../../state/git-review.js";
import { iconForPath, languageForPath } from "../../state/file-icons.js";
import {
  isReviewQueueItemOpenable,
  pinActiveReviewQueueItem,
  reviewQueuePosition,
  summarizeReviewQueue,
  type ReviewQueueItem,
} from "../../state/review-queue.js";
import type { OutlineHeading } from "../../state/outline.js";

interface Props {
  file: FilePayload | null;
  fileRemoved?: boolean;
  reviewChanges: ReviewChangeItem[];
  reviewItems?: ReviewQueueItem[];
  reviewLoading?: boolean;
  reviewUnavailableReason?: string | null;
  reviewDiffStats: Record<string, DiffStat | null>;
  loadingReviewDiffs: Record<string, boolean>;
  unreadReviewPaths: Set<string>;
  comments?: ViviComment[];
  reviewComments?: ViviComment[];
  draftComments?: DraftReviewComment[];
  commentsLoading?: boolean;
  threadActivities?: Record<string, CommentActivitySummary>;
  activeCommentId?: string | null;
  selectedCodeRange: LineRange | null;
  outline?: OutlineHeading[];
  activeOutlineId?: string | null;
  activePath?: string | null;
  refreshedAt?: number;
  activePaneId: string;
  onOpenEventPath: (path: string) => void;
  onConfirmEventPath: (path: string) => void;
  onOpenNextUnread?: () => void;
  onOpenNextChanged: () => void;
  onOpenPreviousChanged: () => void;
  onOpenAllChanged: () => void;
  onRevealInTree: () => void;
  onOutlineSelect?: (id: string) => void;
  onOpenComments?: () => void;
  onOpenComment?: (comment: ViviComment) => void;
  onCommentStatusChange?: (threadId: string, status: CommentStatus) => void;
}

export function Inspector({
  file,
  reviewChanges,
  reviewItems,
  reviewLoading = false,
  reviewUnavailableReason = null,
  reviewDiffStats,
  loadingReviewDiffs,
  unreadReviewPaths,
  comments = [],
  reviewComments = comments,
  draftComments = [],
  commentsLoading = false,
  threadActivities = {},
  activeCommentId = null,
  selectedCodeRange,
  outline = [],
  activeOutlineId = null,
  activePath = file?.path ?? null,
  refreshedAt,
  activePaneId,
  onOpenEventPath,
  onConfirmEventPath,
  onOpenNextUnread,
  onOpenNextChanged,
  onOpenPreviousChanged,
  onOpenAllChanged,
  onOutlineSelect,
  onOpenComments,
  onOpenComment,
  onCommentStatusChange,
}: Props) {
  const codeMetadata =
    file && (file.viewerKind === "code" || file.viewerKind === "json")
      ? buildCodeMetadata(file, selectedCodeRange)
      : null;
  const activeThreads = summarizeActiveThreads(comments);
  const activeThreadCounts = countThreadsByStatus(activeThreads);
  const queueItems: ReviewQueueItem[] =
    reviewItems ??
    reviewChanges.map((change) => ({
      path: change.path,
      change,
      threadCounts: { open: 0, resolved: 0, archived: 0 },
      commentCount: 0,
      unread: unreadReviewPaths.has(change.path),
    }));
  const queueProgress = summarizeReviewQueue(queueItems);
  const queuePosition = reviewQueuePosition(queueItems, activePath);
  const queueProgressValueText = reviewQueueProgressValueText(queueProgress);
  const displayQueueItems = pinActiveReviewQueueItem(queueItems, activePath);
  const keyboardQueueIndexes = displayQueueItems.flatMap((item, index) =>
    isReviewQueueItemOpenable(item) ? [index] : [],
  );
  const publishedBatches = publishedBatchSummary(comments);
  const codeSymbols = codeMetadata?.symbols.slice(0, 10) ?? [];
  const activeOutlineHeading = activeOutlineHeadingFor(
    outline,
    activeOutlineId,
  );
  const fileMapSummary = fileMapSummaryLabel({
    outlineCount: outline.length,
    activeHeading: activeOutlineHeading,
    symbolCount: codeSymbols.length,
  });
  const commentsPanelAction = commentsPanelActionState({
    canOpen: Boolean(onOpenComments),
    messageCount: comments.length,
  });
  return (
    <aside className="inspector" aria-label="Review inspector">
      <div className="panel-title">
        <span>Review</span>
        <span className="pill">Read-only</span>
      </div>
      <div className="inspect-body">
        <div className="section-title with-action primary-section">
          <span>Review Queue</span>
          {queueItems.length ? (
            <span className="queue-actions">
              {queueProgress.unread && onOpenNextUnread ? (
                <button
                  aria-keyshortcuts="Meta+Shift+U Control+Shift+U"
                  title="Open next unseen review item (Cmd/Ctrl+Shift+U)"
                  type="button"
                  onClick={onOpenNextUnread}
                >
                  Unseen
                </button>
              ) : null}
              <button
                aria-keyshortcuts="Meta+Shift+K Control+Shift+K"
                disabled={!queuePosition.reviewableTotal}
                title="Previous review item (Cmd/Ctrl+Shift+K)"
                type="button"
                onClick={onOpenPreviousChanged}
              >
                Previous
              </button>
              <button
                aria-keyshortcuts="Meta+Shift+J Control+Shift+J"
                disabled={!queuePosition.reviewableTotal}
                title="Next review item (Cmd/Ctrl+Shift+J)"
                type="button"
                onClick={onOpenNextChanged}
              >
                Next
              </button>
            </span>
          ) : null}
        </div>
        {queueItems.length ? (
          <div className="review-progress" aria-label="Review queue progress">
            <span>
              <strong>
                {queueProgress.seen}/{queueProgress.total}
              </strong>{" "}
              files seen
              {queueProgress.unread
                ? ` · ${queueProgress.unread} unseen`
                : " · all seen"}
              {queueProgress.openThreads
                ? ` · ${queueProgress.openThreads} open ${queueProgress.openThreads === 1 ? "thread" : "threads"}`
                : ""}
              {queuePosition.activeIndex >= 0
                ? ` · viewing ${queuePosition.activeIndex + 1}/${queuePosition.reviewableTotal}`
                : ""}
            </span>
            <span
              className="review-progress-track"
              role="progressbar"
              aria-label={`${queueProgress.seen} of ${queueProgress.total} review files seen`}
              aria-valuemin={0}
              aria-valuemax={queueProgress.total}
              aria-valuenow={queueProgress.seen}
              aria-valuetext={queueProgressValueText}
            >
              <span
                style={{
                  width: `${queueProgress.total ? (queueProgress.seen / queueProgress.total) * 100 : 0}%`,
                }}
              />
            </span>
          </div>
        ) : null}
        {queueItems.length ? (
          <div
            className="review-queue"
            role="list"
            aria-label={`Review queue, ${queueProgressValueText}`}
            aria-describedby="review-queue-interaction-help review-queue-keyboard-help"
          >
            <p className="sr-only" id="review-queue-interaction-help">
              Click or press Enter to preview a review file. Double-click to
              keep it open as a tab.
            </p>
            <p className="sr-only" id="review-queue-keyboard-help">
              Use Down Arrow, Up Arrow, Home, and End to move between review
              files.
            </p>
            {displayQueueItems.map((item, index) => {
              const { change } = item;
              const active = item.path === queuePosition.activePath;
              const keyboardIndex = keyboardQueueIndexes.indexOf(index);
              const reviewStop = reviewQueueStopForPath(
                item.path,
                reviewComments,
              );
              const reviewQueueItemDescriptionId = `review-queue-item-${index + 1}-description`;
              const statusLabel = change
                ? changeStatusLabel(change.status, change.kind)
                : "comment";
              const directoryLabel = change
                ? reviewDirectoryLabel(change)
                : directoryForPath(item.path);
              const kindLabel = reviewQueueFileKindLabel(item.path);
              return (
                <div
                  className="review-queue-item"
                  role="listitem"
                  aria-posinset={index + 1}
                  aria-setsize={displayQueueItems.length}
                  key={`${change?.source ?? "thread"}:${item.path}`}
                >
                  <button
                    className={`change-open${item.threadCounts.open ? " has-open-threads" : ""}${active ? " active" : ""}`}
                    disabled={!isReviewQueueItemOpenable(item)}
                    aria-current={active ? "true" : undefined}
                    aria-describedby={`review-queue-interaction-help review-queue-keyboard-help ${reviewQueueItemDescriptionId}`}
                    aria-keyshortcuts="ArrowDown ArrowUp Home End"
                    aria-label={reviewQueueItemAriaLabel(item, {
                      active,
                      statusLabel,
                    })}
                    data-review-index={index}
                    data-review-path={item.path}
                    onClick={() => onOpenEventPath(item.path)}
                    onDoubleClick={() => onConfirmEventPath(item.path)}
                    onKeyDown={(event) => {
                      const nextKeyboardIndex = reviewQueueKeyboardTarget(
                        event.key,
                        keyboardIndex,
                        keyboardQueueIndexes.length,
                      );
                      if (nextKeyboardIndex === null) return;
                      event.preventDefault();
                      focusReviewQueueTarget(
                        keyboardQueueIndexes[nextKeyboardIndex]!,
                      );
                    }}
                    title="Click to preview; double-click to keep open as a tab"
                    type="button"
                  >
                    <span
                      className="sr-only"
                      id={reviewQueueItemDescriptionId}
                    >
                      {reviewQueueItemDescription(item, {
                        active,
                        reviewStop,
                      })}
                    </span>
                    <span
                      className={
                        item.unread ? "unread-dot" : "unread-dot read"
                      }
                      aria-hidden="true"
                    />
                    <span className="file-icon change-icon">
                      {iconForPath(item.path)}
                    </span>
                    <span className="change-main">
                      <span className="change-heading">
                        <span className="change-kind">{kindLabel}</span>
                        <span
                          className={`change-status ${change ? (change.kind ?? change.status) : "comment"}`}
                        >
                          {statusLabel}
                        </span>
                        <b>{basenameForPath(item.path)}</b>
                      </span>
                      <small
                        className="change-path-line"
                        title={change ? reviewPathLabel(change) : item.path}
                      >
                        <span className="change-path-text">
                          {directoryLabel}
                        </span>
                        {change ? (
                          <span className="change-source">
                            {reviewQueueSourceLabel(change.source)}
                          </span>
                        ) : null}
                      </small>
                      {item.threadCounts.open || item.commentCount ? (
                        <small className="review-thread-summary">
                          {item.threadCounts.open
                            ? `${item.threadCounts.open} open ${item.threadCounts.open === 1 ? "thread" : "threads"}`
                            : "No open threads"}
                          {item.commentCount
                            ? ` · ${item.commentCount} ${item.commentCount === 1 ? "message" : "messages"}`
                            : ""}
                        </small>
                      ) : null}
                      {reviewStop ? (
                        <small className="review-stop-summary">
                          <strong>{reviewQueueStopTitle(active)}</strong>
                          <span>{reviewStop.label}</span>
                          <span>{reviewStop.preview}</span>
                        </small>
                      ) : null}
                      {item.latestActivity ? (
                        <small className="change-activity">
                          {activityLabel(item.latestActivity)}
                        </small>
                      ) : null}
                    </span>
                    {change ? (
                      <DiffStatBadge
                        loading={Boolean(loadingReviewDiffs[item.path])}
                        stat={reviewDiffStats[item.path] ?? null}
                      />
                    ) : (
                      <span className="review-next" aria-hidden="true">
                        ›
                      </span>
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        ) : null}
        {queueItems.length && reviewUnavailableReason ? (
          <p className="muted compact-empty">
            Git review warning: {reviewUnavailableReason}
          </p>
        ) : null}
        {reviewLoading ? (
          <p className="muted compact-empty" aria-live="polite">
            Loading Git review; open comment threads may appear before changed
            files.
          </p>
        ) : null}
        {!queueItems.length && reviewUnavailableReason ? (
          <p className="muted compact-empty">
            Git review unavailable: {reviewUnavailableReason}
          </p>
        ) : null}
        {!queueItems.length && !reviewUnavailableReason && !reviewLoading ? (
          <div className="review-empty-state" aria-label="Review queue empty">
            <strong>Active queue clear</strong>
            <span>
              No Git changes or open comment threads need review right now.
              Resolved and archived threads stay in Comments history.
            </span>
          </div>
        ) : null}

        {file ? (
          <div className="review-focus-card" aria-label="Active file review">
            <div className="review-focus-head">
              <span>Active File</span>
              <strong>{activeFileReviewLabel(activeThreadCounts.open)}</strong>
            </div>
            <div className="review-focus-metrics">
              <span>
                <strong>{activeThreadCounts.open}</strong> open
              </span>
              <span>
                <strong>{draftComments.length}</strong> drafts
              </span>
              <span>
                <strong>
                  {activeThreadCounts.resolved + activeThreadCounts.archived}
                </strong>{" "}
                history
              </span>
            </div>
            {draftComments.length ? (
              <p>
                Drafts stay private until published; agents only see open
                threads.
              </p>
            ) : activeThreadCounts.open ? (
              <p>Open threads are agent-visible review work.</p>
            ) : activeThreadCounts.resolved || activeThreadCounts.archived ? (
              <p>Only history remains for this file.</p>
            ) : (
              <p>
                No comments yet. Select rendered text or source lines to draft
                feedback.
              </p>
            )}
            {comments.length && onOpenComments ? (
              <button
                className="review-focus-action"
                type="button"
                onClick={onOpenComments}
              >
                {activeThreadCounts.open
                  ? "Open active threads"
                  : "Open comment history"}
              </button>
            ) : null}
          </div>
        ) : null}

        <h3 className="section-title">Comments</h3>
        {commentsLoading ? (
          <p className="muted compact-empty">Loading comments...</p>
        ) : (
          <div className="comment-summary">
            <strong>
              {activeThreadCounts.open} open{" "}
              {activeThreadCounts.open === 1 ? "thread" : "threads"}
            </strong>
            <span>
              {comments.length}{" "}
              {comments.length === 1 ? "message" : "messages"} in this file
            </span>
            {draftComments.length ? (
              <span className="draft-comment-summary">
                {draftComments.length} draft{" "}
                {draftComments.length === 1 ? "comment" : "comments"} not
                visible to agents
              </span>
            ) : null}
            {publishedBatches.length ? (
              <div className="published-batch-summary">
                {publishedBatches.map((batch) => (
                  <span key={batch.id}>
                    Batch {shortBatchId(batch.id)} · {batch.threadCount}{" "}
                    {batch.threadCount === 1 ? "thread" : "threads"}
                  </span>
                ))}
              </div>
            ) : null}
            <button
              aria-label={commentsPanelAction.description}
              disabled={commentsPanelAction.disabled}
              title={commentsPanelAction.description}
              type="button"
              onClick={onOpenComments}
            >
              {commentsPanelAction.label}
            </button>
            {activeThreads.length ? (
              <div className="active-comment-threads" aria-label="Active file comment threads">
                {activeThreads.slice(0, 4).map((thread) => {
                  const activity = threadActivities[thread.id];
                  const primaryComment = thread.comments[0]!;
                  const latestComment =
                    thread.comments[thread.comments.length - 1] ??
                    primaryComment;
                  const latestActivity = activity?.inline[0];
                  const locationLabel = commentLocationLabel(primaryComment);
                  const sourceChanged = thread.comments.some((comment) =>
                    commentAnchorSourceChanged(comment, file),
                  );
                  const latestPreview = truncateCommentPreview(
                    latestComment.body,
                    96,
                  );
                  const active = commentThreadContainsComment(
                    thread,
                    activeCommentId,
                  );
                  const toggleStatusLabel =
                    thread.status === "open"
                      ? active
                        ? "Resolve current stop"
                        : "Resolve"
                      : active
                        ? "Reopen current stop"
                        : "Reopen";
                  const archiveLabel = active
                    ? "Archive current stop"
                    : "Archive";
                  const rowLabel = [
                    `${statusLabel(thread.status)} thread in ${thread.path}`,
                    active ? "current thread" : "",
                    locationLabel,
                    surfaceLabel(primaryComment),
                    commentLineLabel(primaryComment),
                    `latest: ${latestPreview}`,
                  ]
                    .filter(Boolean)
                    .join(", ");
                  return (
                    <div className="active-comment-thread-item" key={thread.id}>
                      <button
                        className={`active-comment-thread ${thread.status}${active ? " active" : ""}`}
                        type="button"
                        aria-current={active ? "true" : undefined}
                        aria-label={rowLabel}
                        onClick={() => onOpenComment?.(primaryComment)}
                      >
                        <span className="active-comment-thread-head">
                          <span className={`comment-status ${thread.status}`}>
                            {statusLabel(thread.status)}
                          </span>
                          <strong>{surfaceLabel(primaryComment)}</strong>
                          <span>{commentLineLabel(primaryComment)}</span>
                          {active ? (
                            <span className="active-comment-current">
                              Current thread
                            </span>
                          ) : null}
                          {sourceChanged ? (
                            <span
                              className="comment-anchor-warning"
                              aria-label="Current file content differs from this comment anchor"
                            >
                              Source changed
                            </span>
                          ) : null}
                        </span>
                        <span className="active-comment-thread-location">
                          {locationLabel}
                        </span>
                        <span className="active-comment-thread-preview">
                          {latestPreview}
                        </span>
                        <span className="active-comment-thread-meta">
                          {thread.comments.length}{" "}
                          {thread.comments.length === 1 ? "message" : "messages"}
                          {" · "}
                          updated {formatThreadTime(thread.updatedAt)}
                        </span>
                        {latestActivity ? (
                          <span className="active-comment-thread-activity">
                            {latestActivity}
                          </span>
                        ) : null}
                      </button>
                      {onCommentStatusChange ? (
                        <div
                          className="active-comment-thread-actions"
                          aria-label={`Thread actions for ${thread.path}, ${commentLineLabel(primaryComment)}`}
                        >
                          {thread.status === "open" ? (
                            <button
                              type="button"
                              aria-keyshortcuts={
                                active
                                  ? "Meta+Shift+Enter Control+Shift+Enter"
                                  : undefined
                              }
                              title={
                                active
                                  ? "Resolve current stop (Cmd/Ctrl Shift Enter)"
                                  : undefined
                              }
                              onClick={() =>
                                onCommentStatusChange(thread.id, "resolved")
                              }
                            >
                              {toggleStatusLabel}
                            </button>
                          ) : (
                            <button
                              type="button"
                              aria-keyshortcuts={
                                active
                                  ? "Meta+Shift+Enter Control+Shift+Enter"
                                  : undefined
                              }
                              title={
                                active
                                  ? "Reopen current stop (Cmd/Ctrl Shift Enter)"
                                  : undefined
                              }
                              onClick={() =>
                                onCommentStatusChange(thread.id, "open")
                              }
                            >
                              {toggleStatusLabel}
                            </button>
                          )}
                          {thread.status !== "archived" ? (
                            <button
                              type="button"
                              aria-keyshortcuts={
                                active
                                  ? "Meta+Shift+Backspace Control+Shift+Backspace"
                                  : undefined
                              }
                              title={
                                active
                                  ? "Archive current stop (Cmd/Ctrl Shift Backspace)"
                                  : undefined
                              }
                              onClick={() =>
                                onCommentStatusChange(thread.id, "archived")
                              }
                            >
                              {archiveLabel}
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
                {activeThreads.length > 4 ? (
                  <span className="active-comment-thread-more">
                    {activeThreads.length - 4} more in Comments panel
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
        )}
        {comments.some((comment) => {
          const activity = threadActivities[comment.threadId ?? comment.id];
          return activity && activity.timeline.length > activity.inline.length;
        }) ? (
          <details className="comment-activity-timeline inspector-timeline">
            <summary>Activity timeline</summary>
            <ol>
              {comments.flatMap((comment) => {
                const activity =
                  threadActivities[comment.threadId ?? comment.id];
                return (activity?.timeline ?? []).map((event) => (
                  <li key={`${comment.id}-${event.id}`}>
                    {activityLabel(event)}
                  </li>
                ));
              })}
            </ol>
          </details>
        ) : null}

        {file ? (
          <div className="inspector-file-outline">
            <div className="section-title with-action file-map-title">
              <span>In this file</span>
              <span className="file-map-summary">{fileMapSummary}</span>
            </div>
            {outline.length ? (
              <nav
                className="inspector-outline-list"
                aria-label="Document outline"
              >
                {outline.slice(0, 12).map((heading, index) => {
                  const active = activeOutlineId
                    ? heading.id === activeOutlineId
                    : index === 0;
                  return (
                    <button
                      className={`${heading.level === 2 ? "h2 " : ""}${active ? "active" : ""}`}
                      key={heading.id}
                      type="button"
                      aria-current={active ? "location" : undefined}
                      onClick={() => onOutlineSelect?.(heading.id)}
                    >
                      <span className="outline-level">H{heading.level}</span>
                      <span className="outline-text">{heading.text}</span>
                      {heading.lineStart ? (
                        <span className="outline-line">L{heading.lineStart}</span>
                      ) : null}
                      {active ? (
                        <span className="outline-current">
                          Current section
                        </span>
                      ) : null}
                    </button>
                  );
                })}
                {outline.length > 12 ? (
                  <span className="inspector-outline-more">
                    {outline.length - 12} more headings
                  </span>
                ) : null}
              </nav>
            ) : codeSymbols.length ? (
              <CodeSymbolOutline
                symbols={codeSymbols}
                onSelect={(line) => scrollCodeLineIntoView(activePaneId, line)}
              />
            ) : (
              <p className="muted compact-empty">
                No document outline for this file.
              </p>
            )}
          </div>
        ) : null}

        <details className="file-details">
          <summary>Details</summary>
          <div className="kv">
            <span>Type</span>
            <strong>{file?.viewerKind ?? "none"}</strong>
          </div>
          <div className="kv">
            <span>Path</span>
            <strong>{file?.path ?? "No file selected"}</strong>
          </div>
          <div className="kv">
            <span>Status</span>
            <strong>{refreshedAt ? "Refreshed" : "Watching"}</strong>
          </div>
          <div className="kv">
            <span>Size</span>
            <strong>{file ? formatBytes(file.size) : "-"}</strong>
          </div>
          <div className="kv">
            <span>Updated</span>
            <strong>
              {file ? new Date(file.mtimeMs).toLocaleTimeString() : "-"}
            </strong>
          </div>
          {refreshedAt ? (
            <div className="kv">
              <span>Reloaded</span>
              <strong>{new Date(refreshedAt).toLocaleTimeString()}</strong>
            </div>
          ) : null}
          {codeMetadata ? (
            <>
              <div className="kv">
                <span>Language</span>
                <strong>{codeMetadata.language}</strong>
              </div>
              <div className="kv">
                <span>Lines</span>
                <strong>{codeMetadata.lineCount}</strong>
              </div>
              <div className="kv">
                <span>Selection</span>
                <strong>{codeMetadata.selectedReference ?? "None"}</strong>
              </div>
            </>
          ) : null}
          {reviewChanges.length ? (
            <button
              className="secondary-action"
              type="button"
              onClick={onOpenAllChanged}
            >
              Open all changed files as tabs
            </button>
          ) : null}
        </details>
      </div>
    </aside>
  );
}

function activeFileReviewLabel(openComments: number): string {
  if (openComments === 0) return "Clear";
  if (openComments === 1) return "1 open thread";
  return `${openComments} open threads`;
}

function reviewQueueProgressValueText(queueProgress: {
  seen: number;
  total: number;
  unread: number;
}): string {
  return [
    `${queueProgress.seen} of ${queueProgress.total} review files seen`,
    queueProgress.unread
      ? `${queueProgress.unread} unseen`
      : "all review files seen",
  ].join(", ");
}

function reviewQueueItemAriaLabel(
  item: ReviewQueueItem,
  {
    active,
    statusLabel,
  }: {
    active: boolean;
    statusLabel: string;
  },
): string {
  return [
    `${statusLabel} ${item.path}`,
    active ? "current review file" : "",
  ]
    .filter(Boolean)
    .join(", ");
}

function reviewQueueItemDescription(
  item: ReviewQueueItem,
  {
    active,
    reviewStop,
  }: {
    active: boolean;
    reviewStop: ReviewQueueStop | null;
  },
): string {
  return [
    item.unread ? "unseen review work" : "seen",
    item.threadCounts.open
      ? `${item.threadCounts.open} open ${item.threadCounts.open === 1 ? "thread" : "threads"}`
      : "",
    item.commentCount
      ? `${item.commentCount} ${item.commentCount === 1 ? "message" : "messages"}`
      : "",
    reviewStop
      ? `${reviewQueueStopTitle(active)} ${reviewStop.label}: ${reviewStop.preview}`
      : "",
    item.change ? `from ${reviewQueueSourceLabel(item.change.source)}` : "",
    item.latestActivity ? activityLabel(item.latestActivity) : "",
  ]
    .filter(Boolean)
    .join(", ");
}

function reviewQueueStopTitle(active: boolean): string {
  return active ? "Current stop" : "Next stop";
}

interface ReviewQueueStop {
  label: string;
  preview: string;
}

function reviewQueueStopForPath(
  path: string,
  comments: ViviComment[],
): ReviewQueueStop | null {
  const thread = buildCommentThreads(comments)
    .filter(
      (candidate) => candidate.path === path && candidate.status === "open",
    )
    .sort((a, b) => {
      return b.updatedAt.localeCompare(a.updatedAt);
    })[0];
  const primary = thread?.comments[0];
  if (!primary) return null;
  return {
    label: [surfaceLabel(primary), commentLineLabel(primary)]
      .filter(Boolean)
      .join(" · "),
    preview: truncateCommentPreview(primary.body, 72),
  };
}

export function reviewQueueKeyboardTarget(
  key: string,
  currentIndex: number,
  count: number,
): number | null {
  if (count <= 0) return null;
  if (currentIndex < 0) return key === "ArrowDown" ? 0 : null;
  if (key === "ArrowDown") return Math.min(currentIndex + 1, count - 1);
  if (key === "ArrowUp") return Math.max(currentIndex - 1, 0);
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}

function focusReviewQueueTarget(index: number) {
  document
    .querySelector<HTMLButtonElement>(
      `.review-queue .change-open[data-review-index="${index}"]:not(:disabled)`,
    )
    ?.focus();
}

function commentsPanelActionState({
  canOpen,
  messageCount,
}: {
  canOpen: boolean;
  messageCount: number;
}): {
  description: string;
  disabled: boolean;
  label: string;
} {
  if (!messageCount) {
    return {
      description: "No comments in this file yet",
      disabled: true,
      label: "Open in Comments panel",
    };
  }
  if (!canOpen) {
    return {
      description: "Comments panel is not available in this view",
      disabled: true,
      label: "Open in Comments panel",
    };
  }
  return {
    description: `Open ${messageCount} ${messageCount === 1 ? "message" : "messages"} in Comments panel`,
    disabled: false,
    label: "Open in Comments panel",
  };
}

function activeOutlineHeadingFor(
  outline: OutlineHeading[],
  activeOutlineId: string | null,
): OutlineHeading | null {
  if (!outline.length) return null;
  if (activeOutlineId) {
    return outline.find((heading) => heading.id === activeOutlineId) ?? null;
  }
  return outline[0] ?? null;
}

function fileMapSummaryLabel({
  outlineCount,
  activeHeading,
  symbolCount,
}: {
  outlineCount: number;
  activeHeading: OutlineHeading | null;
  symbolCount: number;
}): string {
  if (outlineCount) {
    return [
      `${outlineCount} ${outlineCount === 1 ? "heading" : "headings"}`,
      activeHeading?.text,
    ]
      .filter(Boolean)
      .join(" · ");
  }
  if (symbolCount) {
    return `${symbolCount} ${symbolCount === 1 ? "symbol" : "symbols"}`;
  }
  return "No map";
}

function CodeSymbolOutline({
  symbols,
  onSelect,
}: {
  symbols: CodeSymbol[];
  onSelect: (line: number) => void;
}) {
  return (
    <nav className="inspector-symbol-list" aria-label="Code symbols">
      {symbols.map((symbol) => (
        <button
          key={`${symbol.kind}-${symbol.name}-${symbol.line}`}
          type="button"
          onClick={() => onSelect(symbol.line)}
        >
          <span>{symbol.kind}</span>
          <strong>{symbol.name}</strong>
          <small>L{symbol.line}</small>
        </button>
      ))}
    </nav>
  );
}

function scrollCodeLineIntoView(activePaneId: string, line: number) {
  document
    .querySelector<HTMLElement>(
      `[data-pane-id="${activePaneId}"] .code-line[data-line="${line}"]`,
    )
    ?.scrollIntoView({ block: "center", behavior: "smooth" });
}

function countThreadsByStatus(
  threads: CommentThread[],
): Record<CommentStatus, number> {
  return {
    open: threads.filter((thread) => thread.status === "open").length,
    resolved: threads.filter((thread) => thread.status === "resolved")
      .length,
    archived: threads.filter((thread) => thread.status === "archived")
      .length,
  };
}

function summarizeActiveThreads(comments: ViviComment[]): CommentThread[] {
  return buildCommentThreads(comments)
    .map((thread) => ({
      ...thread,
      comments: [...thread.comments].sort((a, b) =>
        a.createdAt.localeCompare(b.createdAt),
      ),
    }))
    .sort((a, b) => {
      const statusDelta = commentStatusRank(a.status) - commentStatusRank(b.status);
      if (statusDelta) return statusDelta;
      return b.updatedAt.localeCompare(a.updatedAt);
    });
}

function commentThreadContainsComment(
  thread: CommentThread,
  commentId: string | null,
): boolean {
  return (
    !!commentId && thread.comments.some((comment) => comment.id === commentId)
  );
}

function commentStatusRank(status: CommentStatus): number {
  if (status === "open") return 0;
  if (status === "resolved") return 1;
  return 2;
}

function publishedBatchSummary(comments: ViviComment[]): Array<{
  id: string;
  threadCount: number;
}> {
  const byBatch = new Map<string, Set<string>>();
  for (const comment of comments) {
    if (!comment.reviewBatchId) continue;
    const threads = byBatch.get(comment.reviewBatchId) ?? new Set<string>();
    threads.add(comment.threadId ?? comment.id);
    byBatch.set(comment.reviewBatchId, threads);
  }
  return [...byBatch.entries()]
    .map(([id, threads]) => ({ id, threadCount: threads.size }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function shortBatchId(id: string): string {
  return id.replace(/^review-batch-/, "").slice(0, 8);
}

function surfaceLabel(comment: ViviComment): string {
  if (comment.anchor.surface === "diff") return "diff";
  if (comment.anchor.surface === "rendered") {
    return `${comment.anchor.rendered?.kind ?? comment.viewerKind} rendered`;
  }
  return "source";
}

function formatThreadTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function DiffStatBadge({
  loading,
  stat,
}: {
  loading: boolean;
  stat: DiffStat | null;
}) {
  if (loading && !stat) return <span className="diff-stat muted">...</span>;
  if (!stat) return <span className="diff-stat muted">-</span>;
  if (stat.metadataOnly) {
    return (
      <span className="diff-stat muted" aria-label="Metadata-only change">
        metadata
      </span>
    );
  }
  return (
    <span className="diff-stat" aria-label="Diff line changes">
      <span className="diff-add">+{stat.additions}</span>
      <span className="diff-remove">-{stat.deletions}</span>
    </span>
  );
}

function basenameForPath(path: string): string {
  return path.split("/").filter(Boolean).at(-1) ?? path;
}

function reviewPathLabel(change: ReviewChangeItem): string {
  if (change.status === "renamed" && change.originalPath) {
    return `${change.originalPath} -> ${change.path}`;
  }
  return change.path;
}

function reviewDirectoryLabel(change: ReviewChangeItem): string {
  if (change.status === "renamed" && change.originalPath) {
    return `${directoryForPath(change.originalPath)} -> ${directoryForPath(change.path)}`;
  }
  return directoryForPath(change.path);
}

function directoryForPath(path: string): string {
  const parts = path.split("/").filter(Boolean);
  if (parts.length <= 1) return ".";
  return parts.slice(0, -1).join("/");
}

function reviewQueueFileKindLabel(path: string): string {
  const language = languageForPath(path).toUpperCase();
  if (language === "TYPESCRIPT") return "TS";
  if (language === "JAVASCRIPT") return "JS";
  if (language === "MARKDOWN") return "MD";
  if (language === "MAKEFILE") return "MAKE";
  if (language === "DOCKERFILE") return "DOCK";
  return language;
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}
