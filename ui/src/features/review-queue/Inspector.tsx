import { useEffect } from "react";
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
  commentLineLabelForAnchor,
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
import { summarizeReviewLifecycle } from "../../state/review-lifecycle.js";
import { buildReviewNextAction } from "../../state/review-next-action.js";
import { gitReviewUnavailableGuidance } from "../../state/git-review-refresh.js";
import type { OutlineHeading } from "../../state/outline.js";

type InspectorMode = "review" | "threads" | "map";

const inspectorModeOptions: Array<{
  detail: string;
  id: InspectorMode;
  key: string;
  label: string;
  shortcut: string;
  title: string;
}> = [
  {
    id: "review",
    key: "r",
    label: "A Review",
    detail: "active work",
    shortcut: "Meta+Alt+R Control+Alt+R",
    title: "Switch inspector to Review mode (Cmd/Ctrl+Alt+R)",
  },
  {
    id: "threads",
    key: "t",
    label: "B Threads",
    detail: "conversation",
    shortcut: "Meta+Alt+T Control+Alt+T",
    title: "Switch inspector to Threads mode (Cmd/Ctrl+Alt+T)",
  },
  {
    id: "map",
    key: "m",
    label: "C Map",
    detail: "reading",
    shortcut: "Meta+Alt+M Control+Alt+M",
    title: "Switch inspector to Map mode (Cmd/Ctrl+Alt+M)",
  },
];

interface Props {
  file: FilePayload | null;
  fileRemoved?: boolean;
  acceptedReviewChanges?: ReviewChangeItem[];
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
  knownMissingCommentPaths?: ReadonlySet<string>;
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
  onAcceptReviewPath?: (path: string) => void;
  onRestoreAcceptedReviewPath?: (path: string) => void;
  onRevealInTree: () => void;
  onOutlineSelect?: (id: string) => void;
  onOpenComments?: () => void;
  onOpenComment?: (comment: ViviComment) => void;
  onOpenDraft?: (draft: DraftReviewComment) => void;
  onCommentStatusChange?: (threadId: string, status: CommentStatus) => void;
}

export function Inspector({
  file,
  acceptedReviewChanges = [],
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
  knownMissingCommentPaths = emptyMissingCommentPaths,
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
  onAcceptReviewPath,
  onRestoreAcceptedReviewPath,
  onOutlineSelect,
  onOpenComments,
  onOpenComment,
  onOpenDraft,
  onCommentStatusChange,
}: Props) {
  const codeMetadata =
    file && (file.viewerKind === "code" || file.viewerKind === "json")
      ? buildCodeMetadata(file, selectedCodeRange)
      : null;
  const fileKindLabel = file ? viewerKindLabel(file.viewerKind) : "No file";
  const activeThreads = summarizeActiveThreads(comments);
  const hiddenReviewThreads = summarizeActiveThreads(reviewComments).filter(
    (thread) =>
      thread.status !== "open" && !knownMissingCommentPaths.has(thread.path),
  );
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
  const needActionCount = queueItems.filter(
    (item) => item.unread || item.threadCounts.open > 0,
  ).length;
  const queuePosition = reviewQueuePosition(queueItems, activePath);
  const nextReviewAction = buildReviewNextAction({
    activePath,
    items: queueItems,
    reviewLoading,
  });
  const nextReviewActionItem =
    nextReviewAction.targetPath !== null
      ? queueItems.find((item) => item.path === nextReviewAction.targetPath)
      : null;
  const canAcceptNextReviewAction = Boolean(
    nextReviewActionItem?.change &&
      nextReviewActionItem.threadCounts.open === 0 &&
      onAcceptReviewPath,
  );
  const visibleReviewWork = queueItems.filter(isReviewQueueItemOpenable).length;
  const hiddenReviewWork =
    hiddenReviewThreads.length + acceptedReviewChanges.length;
  const hiddenReviewSummary = hiddenReviewHistorySummary(hiddenReviewWork);
  const hiddenReviewPreviewCount =
    Math.min(acceptedReviewChanges.length, 4) +
    Math.min(hiddenReviewThreads.length, 4);
  const hiddenReviewMoreCount = hiddenReviewWork - hiddenReviewPreviewCount;
  const lifecycleSummary = summarizeReviewLifecycle(
    queueItems,
    hiddenReviewWork,
  );
  const queueProgressValueText = reviewQueueProgressValueText(
    queueProgress,
    reviewLoading,
  );
  const displayQueueItems = pinActiveReviewQueueItem(queueItems, activePath);
  const activeDisplayIndex = displayQueueItems.findIndex(
    (item) => item.path === queuePosition.activePath,
  );
  const activePinned =
    queuePosition.activeIndex >= 0 &&
    activeDisplayIndex >= 0 &&
    activeDisplayIndex !== queuePosition.activeIndex;
  const keyboardQueueIndexes = displayQueueItems.flatMap((item, index) =>
    isReviewQueueItemOpenable(item) ? [index] : [],
  );
  const publishedBatches = publishedBatchSummary(comments);
  const codeSymbols = codeMetadata?.symbols.slice(0, 10) ?? [];
  const activeOutlineHeading = activeOutlineHeadingFor(
    outline,
    activeOutlineId,
  );
  const currentThread =
    activeThreads.find(
      (thread) =>
        thread.status === "open" &&
        commentThreadContainsComment(thread, activeCommentId),
    ) ??
    activeThreads.find((thread) => thread.status === "open") ??
    activeThreads[0] ??
    null;
  const currentThreadComment = currentThread?.comments[0] ?? null;
  const currentThreadLatestComment =
    currentThread?.comments[currentThread.comments.length - 1] ??
    currentThreadComment;
  const compactQueueContext = displayQueueItems
    .filter((item) => isReviewQueueItemOpenable(item))
    .slice(0, 3);
  const fileMapSummary = fileMapSummaryLabel({
    outlineCount: outline.length,
    activeHeading: activeOutlineHeading,
    symbolCount: codeSymbols.length,
  });
  const gitReviewGuidance = gitReviewUnavailableGuidance(
    reviewUnavailableReason,
  );
  return (
    <aside className="inspector" aria-label="Review inspector">
      <div className="panel-title">
        <span className="panel-mode-title review-title">Review</span>
        <span className="panel-mode-title threads-title">Threads</span>
        <span className="panel-mode-title map-title">Reader</span>
        <span className="pill mode-pill review-pill">
          <span
            className={`panel-status-dot ${needActionCount ? "warn" : "good"}`}
            aria-hidden="true"
          />
          {needActionCount
            ? `${needActionCount} need action`
            : reviewLoading
              ? "loading"
              : "clear"}
        </span>
        <span className="pill mode-pill threads-pill">
          <span className="panel-status-dot comment" aria-hidden="true" />
          {activeThreadCounts.open} open
        </span>
        <span className="pill mode-pill map-pill">
          <span
            className={`panel-status-dot ${queueProgress.openThreads ? "comment" : "good"}`}
            aria-hidden="true"
          />
          {queueProgress.openThreads ? "review nearby" : "clear"}
        </span>
      </div>
      <div className="inspect-body">
        <InspectorModeSwitch name={`inspector-mode-${activePaneId}`} />
        <div className="inspector-review-mode">
          <section
            className={`hero-card review-next-action ${nextReviewAction.emphasis}`}
            aria-label="Recommended review action"
          >
            <div className="review-next-copy">
              <span>Next action</span>
              <strong>{nextReviewAction.title}</strong>
              <p>{nextReviewAction.description}</p>
            </div>
            <div
              className="review-next-controls"
              aria-label="Recommended review controls"
            >
              <button
                className="review-next-primary"
                disabled={nextReviewAction.kind === "clear"}
                type="button"
                onClick={() => {
                  if (nextReviewAction.kind === "clear") return;
                  if (
                    nextReviewAction.kind === "open-comments" &&
                    onOpenComments
                  ) {
                    onOpenComments();
                    return;
                  }
                  if (nextReviewAction.targetPath) {
                    onOpenEventPath(nextReviewAction.targetPath);
                  }
                }}
              >
                {nextReviewAction.primaryLabel}
              </button>
              {canAcceptNextReviewAction && nextReviewAction.targetPath ? (
                <button
                  type="button"
                  onClick={() =>
                    onAcceptReviewPath?.(nextReviewAction.targetPath!)
                  }
                >
                  Accept change
                </button>
              ) : queueProgress.unread && onOpenNextUnread ? (
                <button type="button" onClick={onOpenNextUnread}>
                  Next unseen
                </button>
              ) : null}
            </div>
            <div className="review-next-metrics" aria-label="Review summary">
              <span>
                <strong>{queueProgress.total}</strong> files
              </span>
              <span>
                <strong>{queueProgress.unread}</strong> unseen
              </span>
              <span>
                <strong>{queueProgress.openThreads}</strong> open threads
              </span>
            </div>
            <div
              className="review-next-progress"
              aria-label="Active review work"
            >
              <span>
                <span>Active review work</span>
                <strong>
                  {visibleReviewWork} visible · {hiddenReviewWork} hidden
                </strong>
              </span>
              <span className="review-next-track" aria-hidden="true">
                <span
                  style={{
                    width: `${queueItems.length ? (visibleReviewWork / Math.max(queueItems.length, visibleReviewWork + hiddenReviewWork)) * 100 : 0}%`,
                  }}
                />
              </span>
            </div>
          </section>
          <section
            className="review-lifecycle"
            role="group"
            aria-label="Review target lifecycle"
          >
            <div className="review-lifecycle-head">
              <span>Lifecycle</span>
              <small>Attention state + review state</small>
            </div>
            <div className="review-lifecycle-grid">
              <span
                className={`review-lifecycle-cell ${lifecycleSummary.detected ? "active" : ""}`}
              >
                <strong>{lifecycleSummary.detected}</strong>
                <span>Detected</span>
                <small>unseen candidates</small>
              </span>
              <span
                className={`review-lifecycle-cell ${lifecycleSummary.seen ? "active" : ""}`}
              >
                <strong>{lifecycleSummary.seen}</strong>
                <span>Seen</span>
                <small>needs decision</small>
              </span>
              <span
                className={`review-lifecycle-cell ${lifecycleSummary.reviewing ? "reviewing" : ""}`}
              >
                <strong>{lifecycleSummary.reviewing}</strong>
                <span>In review</span>
                <small>open threads</small>
              </span>
              <span
                className={`review-lifecycle-cell ${lifecycleSummary.hidden ? "done" : ""}`}
              >
                <strong>{lifecycleSummary.hidden}</strong>
                <span>Done history</span>
                <small>hidden from queue</small>
              </span>
            </div>
          </section>
          <div className="section-title with-action primary-section">
            <span>
              <span aria-hidden="true">Queue</span>
              <span className="sr-only">Review Queue</span>
            </span>
            <small className="section-title-detail">
              Unread, then reviewing, then candidates
            </small>
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
                {reviewLoading
                  ? " · loading changed files"
                  : queueProgress.unread
                    ? ` · ${queueProgress.unread} unseen`
                    : " · all seen"}
                {queueProgress.openThreads
                  ? ` · ${queueProgress.openThreads} open ${queueProgress.openThreads === 1 ? "thread" : "threads"}`
                  : ""}
                {queuePosition.activeIndex >= 0
                  ? activePinned
                    ? ` · pinned from ${queuePosition.activeIndex + 1}/${queuePosition.reviewableTotal}`
                    : ` · viewing ${queuePosition.activeIndex + 1}/${queuePosition.reviewableTotal}`
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
                      data-testid="review-queue-item"
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
                              ? ` · ${totalMessageCountLabel(item.commentCount)}`
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
              {gitReviewGuidance ? ` ${gitReviewGuidance}` : ""}
            </p>
          ) : null}
          {reviewLoading ? (
            <p className="muted compact-empty" aria-live="polite">
              Loading Git review; open comment threads may appear before changed
              files.
            </p>
          ) : null}
          {!queueItems.length && reviewUnavailableReason ? (
            <div
              className="review-empty-state"
              role="status"
              aria-label="Git review unavailable"
            >
              <strong>Git review unavailable</strong>
              <span>{reviewUnavailableReason}</span>
              {gitReviewGuidance ? <span>{gitReviewGuidance}</span> : null}
            </div>
          ) : null}
          {!queueItems.length && !reviewUnavailableReason && !reviewLoading ? (
            <div className="review-empty-state" aria-label="Review queue empty">
              <strong>Active queue clear</strong>
              <span>
                No Git changes or open comment threads need review right now.
                Resolved threads stay in Comments history; archived threads are
                hidden from the browser UI.
              </span>
            </div>
          ) : null}
        </div>

        {hiddenReviewWork ? (
          <div className="inspector-review-mode">
            <details className="hidden-review-history">
              <summary>
                <span>Hidden from queue</span>
                <small>{hiddenReviewSummary}</small>
              </summary>
              <div className="hidden-review-history-list">
                {acceptedReviewChanges.slice(0, 4).map((change) => (
                  <button
                    className="hidden-review-history-item accepted"
                    key={`accepted:${change.path}`}
                    type="button"
                    aria-label={`Restore accepted change ${change.path} to the review queue`}
                    onClick={() => onRestoreAcceptedReviewPath?.(change.path)}
                  >
                    <span className="comment-status accepted">Accepted</span>
                    <strong>{basenameForPath(change.path)}</strong>
                    <span>accepted as-is</span>
                    <small>{reviewPathLabel(change)}</small>
                  </button>
                ))}
                {hiddenReviewThreads.slice(0, 4).map((thread) => {
                  const primaryComment = thread.comments[0]!;
                  const latestComment =
                    thread.comments[thread.comments.length - 1] ??
                    primaryComment;
                  return (
                    <button
                      className={`hidden-review-history-item ${thread.status}`}
                      key={thread.id}
                      type="button"
                      aria-label={`Open hidden ${statusLabel(thread.status)} thread in ${thread.path}, ${commentLineLabel(primaryComment)}`}
                      onClick={() => onOpenComment?.(primaryComment)}
                    >
                      <span className={`comment-status ${thread.status}`}>
                        {statusLabel(thread.status)}
                      </span>
                      <strong>{surfaceLabel(primaryComment)}</strong>
                      <span>{commentLineLabel(primaryComment)}</span>
                      <small>
                        {truncateCommentPreview(latestComment.body, 72)}
                      </small>
                    </button>
                  );
                })}
                {hiddenReviewMoreCount ? (
                  <span className="hidden-review-history-more">
                    {hiddenReviewMoreCount} more in history
                  </span>
                ) : null}
              </div>
            </details>
          </div>
        ) : null}

        <div className="inspector-comments-mode">
          {currentThread && currentThreadComment ? (
            <section className="hero-card thread-hero-card">
              <span className={`comment-status ${currentThread.status}`}>
                {statusLabel(currentThread.status)}
              </span>
              <strong>
                Current thread: {surfaceLabel(currentThreadComment)}{" "}
                {commentLineLabel(currentThreadComment)}
              </strong>
              <p>
                {truncateCommentPreview(
                  currentThreadLatestComment?.body ?? currentThreadComment.body,
                  116,
                )}
              </p>
              <div className="hero-actions">
                <button
                  className="primary"
                  type="button"
                  onClick={() => onOpenComment?.(currentThreadComment)}
                >
                  Reply
                </button>
                {onCommentStatusChange ? (
                  <button
                    type="button"
                    onClick={() =>
                      onCommentStatusChange(
                        currentThread.id,
                        currentThread.status === "open" ? "resolved" : "open",
                      )
                    }
                  >
                    {currentThread.status === "open" ? "Resolve" : "Reopen"}
                  </button>
                ) : null}
              </div>
            </section>
          ) : (
            <section className="hero-card thread-hero-card calm">
              <strong>No active thread</strong>
              <p>Open comments and drafts for this file will appear here.</p>
            </section>
          )}
          <div className="split-tabs" role="tablist" aria-label="Thread scope">
            <button type="button" role="tab" aria-selected="true">
              Open
            </button>
            <button type="button" role="tab" aria-selected="false">
              Drafts
            </button>
            <button type="button" role="tab" aria-selected="false">
              History
            </button>
          </div>
          <h3 className="section-title with-action thread-file-title">
            <span>
              This file <span className="sr-only">Comments</span>
            </span>
            <small>{file ? basenameForPath(file.path) : "No file"}</small>
          </h3>
          {commentsLoading ? (
            <p className="muted compact-empty">Loading comments...</p>
          ) : (
            <div className="comment-summary">
              <strong>
                {activeThreadCounts.open} open{" "}
                {activeThreadCounts.open === 1 ? "thread" : "threads"}
              </strong>
              <span>
                {totalMessageCountLabel(comments.length)} in this file
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
              {activeThreads.length ? (
                <div
                  className="active-comment-threads"
                  aria-label="Active file comment threads"
                >
                  {activeThreads.slice(0, 4).map((thread) => {
                    const activity = threadActivities[thread.id];
                    const primaryComment = thread.comments[0]!;
                    const latestComment =
                      thread.comments[thread.comments.length - 1] ??
                      primaryComment;
                    const latestActivity = activity?.inline[0];
                    const locationLabel = commentLocationLabel(primaryComment);
                    const sourceMissing = knownMissingCommentPaths.has(
                      thread.path,
                    );
                    const sourceChanged = thread.comments.some((comment) =>
                      commentAnchorSourceChanged(comment, file),
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
                          ? "Resolve current thread"
                          : "Resolve"
                        : active
                          ? "Reopen current thread"
                          : "Reopen";
                    const archiveLabel = active
                      ? "Archive current thread"
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
                      <div
                        className="active-comment-thread-item"
                        key={thread.id}
                      >
                        <button
                          className={`active-comment-thread ${thread.status}${active ? " active" : ""}`}
                          type="button"
                          aria-current={active ? "true" : undefined}
                          aria-label={rowLabel}
                          data-comment-thread-id={thread.id}
                          data-testid="review-comment-thread"
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
                            {sourceState ? (
                              <span
                                className="comment-anchor-warning"
                                aria-label={sourceState.aria}
                              >
                                {sourceState.label}
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
                            {thread.comments.length === 1
                              ? "message"
                              : "messages"}
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
                                    ? "Resolve current thread (Cmd/Ctrl Shift Enter)"
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
                                    ? "Reopen current thread (Cmd/Ctrl Shift Enter)"
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
                                    ? "Archive current thread (Cmd/Ctrl Shift Backspace)"
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
              {draftComments.length ? (
                <div
                  className="active-draft-comments"
                  aria-label="Active file draft comments"
                >
                  {draftComments.slice(0, 4).map((draft) => (
                    <button
                      className="active-draft-comment"
                      type="button"
                      key={draft.id}
                      aria-label={`Open private draft in ${draft.path}, ${draftSurfaceLabel(draft)}, ${commentLineLabelForAnchor(draft.anchor.canonical)}`}
                      onClick={() => onOpenDraft?.(draft)}
                    >
                      <span className="active-draft-comment-head">
                        <span className="comment-status draft">
                          Private draft
                        </span>
                        <strong>{draftSurfaceLabel(draft)}</strong>
                        <span>
                          {commentLineLabelForAnchor(draft.anchor.canonical)}
                        </span>
                      </span>
                      <span className="active-draft-comment-preview">
                        {truncateCommentPreview(draft.body, 104)}
                      </span>
                      {draft.anchor.canonical.quote ? (
                        <span className="active-draft-comment-quote">
                          {truncateCommentPreview(
                            draft.anchor.canonical.quote,
                            112,
                          )}
                        </span>
                      ) : null}
                    </button>
                  ))}
                  {draftComments.length > 4 ? (
                    <span className="active-comment-thread-more">
                      {draftComments.length - 4} more in Draft Review
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>
          )}
          {compactQueueContext.length ? (
            <section className="section thread-queue-context">
              <div className="section-title with-action">
                <span>Queue context</span>
                <small>
                  {reviewLoading
                    ? "loading changed files"
                    : queueProgress.unread
                      ? `${queueProgress.unread} unseen`
                      : "all seen"}
                </small>
              </div>
              <div className="compact-queue-list">
                {compactQueueContext.map((item) => (
                  <button
                    className={`compact-queue-item${item.path === activePath ? " active" : ""}`}
                    key={item.path}
                    type="button"
                    onClick={() => onOpenEventPath(item.path)}
                  >
                    <span
                      className={item.unread ? "unread-dot" : "unread-dot read"}
                      aria-hidden="true"
                    />
                    <span className="compact-queue-main">
                      <strong>{basenameForPath(item.path)}</strong>
                      <small>
                        {item.threadCounts.open
                          ? `${item.threadCounts.open} open`
                          : item.change
                            ? changeStatusLabel(
                                item.change.status,
                                item.change.kind,
                              )
                            : "comment"}
                        {item.path === activePath ? " · current" : ""}
                      </small>
                    </span>
                  </button>
                ))}
              </div>
            </section>
          ) : null}
          {comments.some((comment) => {
            const activity = threadActivities[comment.threadId ?? comment.id];
            return (
              activity && activity.timeline.length > activity.inline.length
            );
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
        </div>

        <div className="inspector-map-mode">
          {file ? (
            <div className="reader-mini">
              <span className="file-icon">{iconForPath(file.path)}</span>
              <span className="reader-mini-main">
                <strong>{basenameForPath(file.path)}</strong>
                <small>
                  {fileKindLabel} · {outline.length || codeSymbols.length}{" "}
                  {outline.length ? "headings" : "symbols"}
                </small>
              </span>
              <span className="badge live">live</span>
            </div>
          ) : null}
          {file ? (
            <FileOutlinePanel
              activeOutlineId={activeOutlineId}
              codeSymbols={codeSymbols}
              fileMapSummary={fileMapSummary}
              onCodeSymbolSelect={(line) =>
                scrollCodeLineIntoView(activePaneId, line)
              }
              onOutlineSelect={onOutlineSelect}
              outline={outline}
            />
          ) : null}

          <section className="section reader-review-summary">
            <div className="section-title with-action">
              <span>Review</span>
              <small>
                {queueProgress.openThreads
                  ? `${queueProgress.openThreads} open threads`
                  : "No active work"}
              </small>
            </div>
            <div className="review-focus-metrics reader-metrics">
              <span>
                <strong>{queueProgress.total}</strong> queue files
              </span>
              <span>
                <strong>{queueProgress.openThreads}</strong> open threads
              </span>
            </div>
          </section>
          <details className="file-details">
            <summary>File details</summary>
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
      </div>
    </aside>
  );
}

function InspectorModeSwitch({ name }: { name: string }) {
  return (
    <fieldset className="inspector-mode-switch" aria-label="Inspector mode">
      <InspectorModeShortcuts name={name} />
      {inspectorModeOptions.map((item) => (
        <label key={item.id}>
          <input
            aria-label={`${item.label} ${item.detail}`}
            aria-keyshortcuts={item.shortcut}
            defaultChecked={item.id === "review"}
            name={name}
            title={item.title}
            type="radio"
            value={item.id}
          />
          <span className="mode-full-label">{item.label}</span>
          <small className="mode-detail">{item.detail}</small>
        </label>
      ))}
    </fieldset>
  );
}

function InspectorModeShortcuts({ name }: { name: string }) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        !(event.metaKey || event.ctrlKey) ||
        !event.altKey ||
        event.shiftKey ||
        isTextEntryTarget(event.target)
      ) {
        return;
      }

      const mode = inspectorModeOptions.find(
        (item) => item.key === event.key.toLowerCase(),
      );
      if (!mode) return;

      const target = Array.from(
        document.querySelectorAll<HTMLInputElement>(
          'input[type="radio"][name]',
        ),
      ).find((input) => input.name === name && input.value === mode.id);
      if (!target || target.checked) return;

      event.preventDefault();
      target.checked = true;
      target.dispatchEvent(new Event("input", { bubbles: true }));
      target.dispatchEvent(new Event("change", { bubbles: true }));
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [name]);

  return null;
}

function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;

  const entry = target.closest("input, textarea, select");
  if (!(entry instanceof HTMLElement)) return false;
  if (entry.tagName === "TEXTAREA" || entry.tagName === "SELECT") return true;
  if (!(entry instanceof HTMLInputElement)) return false;

  return !["button", "checkbox", "radio", "reset", "submit"].includes(
    entry.type,
  );
}

function draftSurfaceLabel(draft: DraftReviewComment): string {
  if (draft.anchor.surface === "diff") return "Diff";
  if (draft.anchor.surface === "rendered") {
    const kind = draft.anchor.rendered?.kind ?? draft.viewerKind;
    return `${commentViewerKindLabel(kind)} rendered`;
  }
  return "Source";
}

function commentViewerKindLabel(
  kind: DraftReviewComment["viewerKind"],
): string {
  if (kind === "markdown") return "Markdown";
  if (kind === "html") return "HTML";
  if (kind === "json") return "JSON";
  if (kind === "image") return "Image";
  if (kind === "yaml") return "YAML";
  if (kind === "csv") return "CSV";
  if (kind === "binary") return "Binary";
  if (kind === "unknown") return "Unknown";
  return "Text";
}

function hiddenReviewHistorySummary(count: number): string {
  return `${count} done`;
}

function reviewQueueProgressValueText(
  queueProgress: {
    seen: number;
    total: number;
    unread: number;
  },
  reviewLoading: boolean,
): string {
  return [
    `${queueProgress.seen} of ${queueProgress.total} ${reviewLoading ? "loaded review files" : "review files"} seen`,
    reviewLoading
      ? "loading changed files"
      : queueProgress.unread
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
    "Review queue item",
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
    item.commentCount ? totalMessageCountLabel(item.commentCount) : "",
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
  return active ? "Queue stop" : "Next queue stop";
}

const emptyMissingCommentPaths = new Set<string>();

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

function totalMessageCountLabel(count: number): string {
  return `${count} total ${count === 1 ? "message" : "messages"}`;
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

function FileOutlinePanel({
  activeOutlineId,
  className,
  codeSymbols,
  fileMapSummary,
  onCodeSymbolSelect,
  onOutlineSelect,
  outline,
}: {
  activeOutlineId: string | null;
  className?: string;
  codeSymbols: CodeSymbol[];
  fileMapSummary: string;
  onCodeSymbolSelect: (line: number) => void;
  onOutlineSelect?: (id: string) => void;
  outline: OutlineHeading[];
}) {
  return (
    <div
      className={`inspector-file-outline${className ? ` ${className}` : ""}`}
    >
      <div className="section-title with-action file-map-title">
        <span>In this file</span>
        <span className="file-map-summary">{fileMapSummary}</span>
      </div>
      {outline.length ? (
        <nav className="inspector-outline-list" aria-label="Document outline">
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
                  <span className="outline-current">Current section</span>
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
          onSelect={onCodeSymbolSelect}
        />
      ) : (
        <p className="muted compact-empty">
          No document outline for this file.
        </p>
      )}
    </div>
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
    resolved: threads.filter((thread) => thread.status === "resolved").length,
    archived: threads.filter((thread) => thread.status === "archived").length,
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
      const statusDelta =
        commentStatusRank(a.status) - commentStatusRank(b.status);
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

function viewerKindLabel(viewerKind: FilePayload["viewerKind"]): string {
  if (viewerKind === "markdown") return "Markdown";
  if (viewerKind === "html") return "HTML";
  if (viewerKind === "json") return "JSON";
  if (viewerKind === "image") return "Image";
  if (viewerKind === "code") return "Code";
  if (viewerKind === "mermaid") return "Mermaid";
  if (viewerKind === "unsupported") return "Unsupported";
  return "Text";
}
