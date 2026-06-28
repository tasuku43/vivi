import {
  buildCommentThreads,
  type CommentStatus,
  type CommentThread,
  type DraftReviewComment,
  type ViviComment,
} from "../../domain/comments.js";
import styles from "./Inspector.module.css";
import type { FilePayload } from "../../domain/fs-node.js";
import type { CommentActivitySummary } from "../../state/comment-activity.js";
import { activityLabel } from "../../state/comment-activity.js";
import type { LineRange } from "../../state/code-viewer.js";
import {
  commentLineLabel,
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
  reviewQueueItemHasAgentReply,
  reviewQueuePosition,
  type ReviewQueueItem,
} from "../../state/review-queue.js";
import {
  reviewFileStateLabel,
  reviewFileStateTone,
  reviewQueueItemState,
} from "../../state/review-state.js";
import { gitReviewUnavailableGuidance } from "../../state/git-review-refresh.js";
import type { OutlineHeading } from "../../state/outline.js";
import { CommentStatusBadge } from "../comments/components/CommentStatusBadge.js";
import fileIconStyles from "../../shared/components/FileIcon.module.css";
import sharedUiStyles from "../../shared/styles/SharedUi.module.css";

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
  knownMissingCommentPaths = emptyMissingCommentPaths,
  activeCommentId = null,
  activePath = file?.path ?? null,
  onOpenEventPath,
  onConfirmEventPath,
  onOpenNextChanged,
  onRestoreAcceptedReviewPath,
  onOpenComment,
}: Props) {
  const hiddenReviewThreads = summarizeActiveThreads(reviewComments).filter(
    (thread) =>
      thread.status !== "open" && !knownMissingCommentPaths.has(thread.path),
  );
  const queueItems: ReviewQueueItem[] =
    reviewItems ??
    reviewChanges.map((change) => ({
      path: change.path,
      change,
      threadCounts: { open: 0, resolved: 0, archived: 0 },
      commentCount: 0,
        unread: unreadReviewPaths.has(change.path),
      }));
  const needActionCount = queueItems.filter(
    (item) => item.unread || item.threadCounts.open > 0,
  ).length;
  const queuePosition = reviewQueuePosition(queueItems, activePath);
  const hiddenReviewWork =
    hiddenReviewThreads.length + acceptedReviewChanges.length;
  const hiddenReviewSummary = hiddenReviewHistorySummary(hiddenReviewWork);
  const hiddenReviewPreviewCount =
    Math.min(acceptedReviewChanges.length, 4) +
    Math.min(hiddenReviewThreads.length, 4);
  const hiddenReviewMoreCount = hiddenReviewWork - hiddenReviewPreviewCount;
  const queuedItems = queueItems.filter(
    (item) => reviewQueueItemState(item) === "queued",
  );
  const reviewingItems = queueItems.filter(
    (item) => reviewQueueItemState(item) === "reviewing",
  );
  const displayQueueItems = [...queuedItems, ...reviewingItems];
  const reviewedCount = hiddenReviewWork;
  const reviewStateSections = [
    {
      state: "queued" as const,
      count: queuedItems.length,
      items: queuedItems,
      detail: "waiting for review",
      defaultOpen: true,
    },
    {
      state: "reviewing" as const,
      count: reviewingItems.length,
      items: reviewingItems,
      detail: "open threads",
      defaultOpen: true,
    },
    {
      state: "reviewed" as const,
      count: reviewedCount,
      items: [],
      detail: "quiet until new changes",
      defaultOpen: false,
    },
  ];
  const keyboardQueueIndexes = displayQueueItems.flatMap((item, index) =>
    isReviewQueueItemOpenable(item) ? [index] : [],
  );
  const gitReviewGuidance = gitReviewUnavailableGuidance(
    reviewUnavailableReason,
  );
  function renderReviewQueueItem(item: ReviewQueueItem, index: number) {
    const { change } = item;
    const active = item.path === queuePosition.activePath;
    const keyboardIndex = keyboardQueueIndexes.indexOf(index);
    const reviewStop = reviewQueueStopForPath(item.path, reviewComments);
    const reviewQueueItemDescriptionId = `review-queue-item-${index + 1}-description`;
    const threadListId = `review-queue-item-${index + 1}-threads`;
    const threadToggleId = `review-queue-item-${index + 1}-thread-toggle`;
    const itemThreads = reviewQueueThreadsForPath(item.path, reviewComments);
    const itemStatusLabel = change
      ? changeStatusLabel(change.status, change.kind)
      : "comment";
    const directoryLabel = change
      ? reviewDirectoryLabel(change)
      : directoryForPath(item.path);
    const kindLabel = reviewQueueFileKindLabel(item.path);
    return (
      <div
        className={`review-queue-item${itemThreads.length ? " review-thread-expand-file" : ""}`}
        key={`${change?.source ?? "thread"}:${item.path}`}
      >
        <button
          className={`change-open${item.threadCounts.open ? " has-open-threads" : ""}${reviewQueueItemHasAgentReply(item) ? " has-agent-reply" : ""}${active ? " active" : ""}`}
          disabled={!isReviewQueueItemOpenable(item)}
          aria-current={active ? "true" : undefined}
          aria-describedby={`review-queue-interaction-help review-queue-keyboard-help ${reviewQueueItemDescriptionId}`}
          aria-keyshortcuts="ArrowDown ArrowUp Home End"
          aria-label={reviewQueueItemAriaLabel(item, {
            active,
            statusLabel: itemStatusLabel,
          })}
          data-review-index={index}
          data-review-path={item.path}
          data-testid="review-queue-item"
          onClick={() => {
            if (isReviewQueueItemOpenable(item)) onOpenEventPath(item.path);
          }}
          onDoubleClick={() => {
            if (isReviewQueueItemOpenable(item)) onConfirmEventPath(item.path);
          }}
          onKeyDown={(event) => {
            const nextKeyboardIndex = reviewQueueKeyboardTarget(
              event.key,
              keyboardIndex,
              keyboardQueueIndexes.length,
            );
            if (nextKeyboardIndex === null) return;
            event.preventDefault();
            focusReviewQueueTarget(keyboardQueueIndexes[nextKeyboardIndex]!);
          }}
          title="Click to preview; double-click to keep open as a tab"
          type="button"
        >
          <span
            className={`${sharedUiStyles.srOnly} sr-only`}
            id={reviewQueueItemDescriptionId}
          >
            {reviewQueueItemDescription(item, {
              active,
              reviewStop,
            })}
          </span>
          <span className={reviewQueueItemDotClass(item)} aria-hidden="true" />
          <span className={`${fileIconStyles.icon} file-icon change-icon`}>
            {iconForPath(item.path)}
          </span>
          <span className="change-main">
            <span className="change-heading">
              <span className="change-kind">{kindLabel}</span>
              <b>{basenameForPath(item.path)}</b>
            </span>
            <small
              className="change-path-line"
              title={change ? reviewPathLabel(change) : item.path}
            >
              <span className="change-path-text">{directoryLabel}</span>
              {change ? (
                <span className="change-source">
                  {reviewQueueSourceLabel(change.source)}
                </span>
              ) : null}
            </small>
            {reviewQueueVisibleSummary(item) ? (
              <small className="review-thread-summary">
                {reviewQueueVisibleSummary(item)}
              </small>
            ) : null}
          </span>
          {itemThreads.length ? (
            <span className="review-thread-count-space" aria-hidden="true" />
          ) : change ? (
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
        {itemThreads.length ? (
          <>
            <input
              className={`${sharedUiStyles.srOnly} sr-only review-thread-toggle-control`}
              id={threadToggleId}
              type="checkbox"
              aria-controls={threadListId}
              aria-label={`Toggle ${threadCountLabel(itemThreads.length)} for ${item.path}`}
            />
            <label
              className="review-thread-count-toggle"
              htmlFor={threadToggleId}
            >
              {threadCountLabel(itemThreads.length)}
            </label>
          </>
        ) : null}
        {itemThreads.length ? (
          <div
            className="review-thread-hairline-list"
            id={threadListId}
            aria-label={`Review threads for ${item.path}`}
          >
            {itemThreads.map((thread) => {
              const primaryComment = thread.comments[0]!;
              const latestComment =
                thread.comments[thread.comments.length - 1] ?? primaryComment;
              const activeThread = thread.comments.some(
                (comment) => comment.id === activeCommentId,
              );
              return (
                <div className="review-thread-hairline-item" key={thread.id}>
                  <button
                    className={`review-thread-hairline-row${activeThread ? " active" : ""}`}
                    type="button"
                    aria-label={`Open ${statusLabel(thread.status)} thread in ${thread.path}, ${surfaceLabel(primaryComment)}, ${commentLineLabel(primaryComment)}`}
                    onClick={() => onOpenComment?.(primaryComment)}
                  >
                    <span className="review-thread-hairline-main">
                      <span className="review-thread-hairline-title">
                        <span>
                          {surfaceLabel(primaryComment)} ·{" "}
                          {commentLineLabel(primaryComment)}
                        </span>
                        <span
                          className={`review-thread-status-badge ${thread.status}`}
                        >
                          {statusLabel(thread.status)}
                        </span>
                      </span>
                      <span className="review-thread-hairline-preview">
                        {truncateCommentPreview(latestComment.body, 96)}
                      </span>
                      <span className="review-thread-hairline-meta">
                        {totalMessageCountLabel(thread.comments.length)}
                      </span>
                    </span>
                  </button>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <aside
      className={`${styles.inspectorRoot} ${sharedUiStyles.inspector} inspector`}
      aria-label="Review inspector"
    >
      <div
        className={`${sharedUiStyles.panelTitle} panel-title review-panel-title`}
      >
        <span className="review-panel-heading">
          <span>Review</span>
          <strong>
            {needActionCount
              ? `${needActionCount} need action`
              : reviewLoading
                ? "loading"
                : "clear"}
          </strong>
        </span>
        {queueItems.length ? (
          <button
            className={`${sharedUiStyles.commandButton} ${sharedUiStyles.commandButtonSecondary} command-button command-button-secondary review-next-action`}
            type="button"
            onClick={onOpenNextChanged}
          >
            Next
          </button>
        ) : null}
      </div>
      <div className="inspect-body">
        <div className="inspector-review-mode">
          <section className="review-state-summary" aria-label="Review states">
            {reviewStateSections.map((section) => (
              <span
                className={`review-state-card ${reviewFileStateTone(section.state)}`}
                key={section.state}
              >
                <strong>{section.count}</strong>
                <span>{reviewFileStateLabel(section.state)}</span>
              </span>
            ))}
          </section>
          {queueItems.length || hiddenReviewWork ? (
            <div
              className="review-queue"
              role="group"
              aria-label={`Review queue, ${queuedItems.length} queued, ${reviewingItems.length} in review, ${reviewedCount} reviewed`}
              aria-describedby="review-queue-interaction-help review-queue-keyboard-help"
            >
              <p
                className={`${sharedUiStyles.srOnly} sr-only`}
                id="review-queue-interaction-help"
              >
                Click or press Enter to preview a review file. Double-click to
                keep it open as a tab.
              </p>
              <p
                className={`${sharedUiStyles.srOnly} sr-only`}
                id="review-queue-keyboard-help"
              >
                Use Down Arrow, Up Arrow, Home, and End to move between review
                files.
              </p>
              {reviewStateSections.slice(0, 2).map((section) => (
                <details
                  className={`review-state-section ${reviewFileStateTone(section.state)}`}
                  key={section.state}
                  open={section.defaultOpen}
                >
                  <summary>
                    <span>{reviewFileStateLabel(section.state)}</span>
                    <small>
                      {section.count} {section.count === 1 ? "file" : "files"}{" "}
                      {section.detail}
                    </small>
                  </summary>
                  {section.items.length ? (
                    <div className="review-state-section-list">
                      {section.items.map((item) =>
                        renderReviewQueueItem(item, displayQueueItems.indexOf(item)),
                      )}
                    </div>
                  ) : (
                    <ReviewStateEmptyRow
                      state={section.state === "queued" ? "queued" : "reviewing"}
                    />
                  )}
                </details>
              ))}
              <details className="review-state-section reviewed">
                <summary>
                  <span>Reviewed</span>
                  <small>{hiddenReviewSummary}</small>
                </summary>
                <div className="hidden-review-history-list">
                  {acceptedReviewChanges.slice(0, 4).map((change) => (
                    <button
                      className="hidden-review-history-item accepted"
                      key={`accepted:${change.path}`}
                      type="button"
                      aria-label={`Move reviewed change ${change.path} back to the review queue`}
                      onClick={() => onRestoreAcceptedReviewPath?.(change.path)}
                    >
                      <CommentStatusBadge status="reviewed">
                        Reviewed
                      </CommentStatusBadge>
                      <strong>{basenameForPath(change.path)}</strong>
                      <span>marked reviewed</span>
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
                        aria-label={`Open reviewed ${statusLabel(thread.status)} thread in ${thread.path}, ${commentLineLabel(primaryComment)}`}
                        onClick={() => onOpenComment?.(primaryComment)}
                      >
                        <CommentStatusBadge status={thread.status}>
                          {statusLabel(thread.status)}
                        </CommentStatusBadge>
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
                      {hiddenReviewMoreCount} more reviewed
                    </span>
                  ) : null}
                  {!hiddenReviewWork ? (
                    <p
                      className={`${styles.compactEmpty} ${sharedUiStyles.muted} muted compact-empty`}
                    >
                      No reviewed files yet.
                    </p>
                  ) : null}
                </div>
              </details>
            </div>
          ) : null}
          {queueItems.length && reviewUnavailableReason ? (
            <p
              className={`${styles.compactEmpty} ${sharedUiStyles.muted} muted compact-empty`}
            >
              Git review warning: {reviewUnavailableReason}
              {gitReviewGuidance ? ` ${gitReviewGuidance}` : ""}
            </p>
          ) : null}
          {reviewLoading ? (
            <p
              className={`${styles.compactEmpty} ${sharedUiStyles.muted} muted compact-empty`}
              aria-live="polite"
            >
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

      </div>
    </aside>
  );
}

function hiddenReviewHistorySummary(count: number): string {
  return `${count} reviewed`;
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
    reviewQueueItemHasAgentReply(item) ? "agent reply needs attention" : "",
    item.unread ? "unread review activity" : "read",
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

function reviewQueueItemDotClass(item: ReviewQueueItem): string {
  if (reviewQueueItemHasAgentReply(item)) return "unread-dot agent-reply";
  if (item.unread) return "unread-dot";
  if (item.threadCounts.open > 0) return "unread-dot muted";
  if (reviewQueueItemState(item) === "queued") return "unread-dot muted";
  return "unread-dot read";
}

function ReviewStateEmptyRow({
  state,
}: {
  state: "queued" | "reviewing";
}) {
  const title = state === "queued" ? "No queued files" : "No active review work";
  const detail =
    state === "queued"
      ? "New HEAD evidence will appear here."
      : "Agent replies and open threads will rise here.";
  return (
    <div className={`review-state-empty-row ${state}`} role="note">
      <span
        className={`${sharedUiStyles.muted} unread-dot muted`}
        aria-hidden="true"
      />
      <span className="review-state-empty-copy">
        <strong>{title}</strong>
        <span>{detail}</span>
      </span>
    </div>
  );
}

function reviewQueueVisibleSummary(item: ReviewQueueItem): string | null {
  if (reviewQueueItemHasAgentReply(item) && item.latestActivity) {
    return `${activityLabel(item.latestActivity)} · needs decision`;
  }
  if (item.threadCounts.open > 0) {
    return `${item.threadCounts.open} open ${item.threadCounts.open === 1 ? "thread" : "threads"} · ${
      item.unread ? "unread activity" : "no new movement"
    }`;
  }
  if (item.commentCount > 0) {
    return `No open threads · ${totalMessageCountLabel(item.commentCount)}`;
  }
  if (item.unread) return "unread HEAD diff";
  if (item.change) return `read ${reviewQueueSourceLabel(item.change.source)}`;
  return null;
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

function reviewQueueThreadsForPath(
  path: string,
  comments: ViviComment[],
): CommentThread[] {
  return summarizeActiveThreads(comments).filter(
    (thread) => thread.path === path,
  );
}

function threadCountLabel(count: number): string {
  return `${count} ${count === 1 ? "thread" : "threads"}`;
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
    .querySelector<HTMLElement>(
      `.review-queue .change-open[data-review-index="${index}"]`,
    )
    ?.focus();
}

function totalMessageCountLabel(count: number): string {
  return `${count} total ${count === 1 ? "message" : "messages"}`;
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

function commentStatusRank(status: CommentStatus): number {
  if (status === "open") return 0;
  if (status === "resolved") return 1;
  return 2;
}

function surfaceLabel(comment: ViviComment): string {
  if (comment.anchor.surface === "diff") return "diff";
  if (comment.anchor.surface === "rendered") {
    return `${comment.anchor.rendered?.kind ?? comment.viewerKind} rendered`;
  }
  return "source";
}

function DiffStatBadge({
  loading,
  stat,
}: {
  loading: boolean;
  stat: DiffStat | null;
}) {
  if (loading && !stat)
    return <span className={`${sharedUiStyles.muted} diff-stat muted`}>...</span>;
  if (!stat)
    return <span className={`${sharedUiStyles.muted} diff-stat muted`}>-</span>;
  if (stat.metadataOnly) {
    return (
      <span
        className={`${sharedUiStyles.muted} diff-stat muted`}
        aria-label="Metadata-only change"
      >
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
