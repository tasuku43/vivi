import {
  buildCommentThreads,
  type CommentAnchor,
  type CommentStatus,
  type CommentThread,
  type DraftReviewComment,
  type ViviComment,
} from "../../domain/comments.js";
import styles from "./Inspector.module.css";
import type { FilePayload } from "../../domain/fs-node.js";
import type { CommentActivitySummary } from "../../state/comment-activity.js";
import {
  activityLabel,
  commentThreadReviewReceipt,
} from "../../state/comment-activity.js";
import type { LineRange } from "../../state/code-viewer.js";
import {
  commentLineLabel,
  commentLineLabelForAnchor,
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
  reviewQueueSignalCounts,
  type ReviewQueueItem,
} from "../../state/review-queue.js";
import type { ReviewReceiptEntry } from "../../state/review-state.js";
import { gitReviewUnavailableGuidance } from "../../state/git-review-refresh.js";
import type { OutlineHeading } from "../../state/outline.js";
import { CommentStatusBadge } from "../comments/components/CommentStatusBadge.js";
import fileIconStyles from "../../shared/components/FileIcon.module.css";
import { InspectorSurfaceTabs } from "../../shared/components/InspectorSurfaceTabs.js";
import sharedUiStyles from "../../shared/styles/SharedUi.module.css";

interface Props {
  file: FilePayload | null;
  fileRemoved?: boolean;
  acceptedReviewChanges?: ReviewChangeItem[];
  reviewReceipts?: ReviewReceiptEntry[];
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
  unsavedInputCount?: number;
  resumableInput?: {
    path: string;
    location: string;
  } | null;
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
  onOpenComment?: (comment: ViviComment) => void;
  onOpenDraft?: (draft: DraftReviewComment) => void;
  onPublishDrafts?: (draftIds?: string[]) => void | Promise<void>;
  onOpenDocument?: () => void;
  onResumeInput?: () => void;
  onCommentStatusChange?: (threadId: string, status: CommentStatus) => void;
}

interface PendingDraftThreadGroup {
  id: string;
  drafts: DraftReviewComment[];
}

export function Inspector({
  file,
  acceptedReviewChanges = [],
  reviewReceipts,
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
  unsavedInputCount = 0,
  resumableInput = null,
  knownMissingCommentPaths = emptyMissingCommentPaths,
  threadActivities = {},
  activeCommentId = null,
  activePath = file?.path ?? null,
  onOpenEventPath,
  onConfirmEventPath,
  onOpenNextChanged,
  onRestoreAcceptedReviewPath,
  onOpenComment,
  onOpenDraft,
  onPublishDrafts,
  onOpenDocument,
  onResumeInput,
}: Props) {
  const hiddenReviewThreads = summarizeActiveThreads(reviewComments).filter(
    (thread) =>
      thread.status !== "open" && !knownMissingCommentPaths.has(thread.path),
  );
  const usesReceiptHistory = reviewReceipts !== undefined;
  const reviewedReceipts = reviewReceipts ?? [];
  const queueItems: ReviewQueueItem[] =
    reviewItems ??
    reviewChanges.map((change) => ({
      path: change.path,
      change,
      threadCounts: { open: 0, resolved: 0, archived: 0 },
      commentCount: 0,
      unread: unreadReviewPaths.has(change.path),
    }));
  const reviewQueueCount = queueItems.filter(isReviewQueueItemOpenable).length;
  const queuePosition = reviewQueuePosition(queueItems, activePath);
  const hiddenReviewWork = usesReceiptHistory
    ? reviewedReceipts.length
    : hiddenReviewThreads.length + acceptedReviewChanges.length;
  const hiddenReviewSummary = hiddenReviewHistorySummary(hiddenReviewWork);
  const hiddenReviewPreviewCount = usesReceiptHistory
    ? Math.min(reviewedReceipts.length, 4)
    : Math.min(acceptedReviewChanges.length, 4) +
      Math.min(hiddenReviewThreads.length, 4);
  const hiddenReviewMoreCount = hiddenReviewWork - hiddenReviewPreviewCount;
  const reviewedCount = hiddenReviewWork;
  const signalCounts = reviewQueueSignalCounts(queueItems);
  const gitReviewGuidance = gitReviewUnavailableGuidance(
    reviewUnavailableReason,
  );
  function renderReviewQueueItem(item: ReviewQueueItem, index: number) {
    const { change } = item;
    const active = item.path === queuePosition.activePath;
    const reviewStop = reviewQueueStopForPath(item.path, reviewComments);
    const reviewQueueItemDescriptionId = `review-queue-item-${index + 1}-description`;
    const threadListId = `review-queue-item-${index + 1}-threads`;
    const threadToggleId = `review-queue-item-${index + 1}-thread-toggle`;
    const itemThreads = reviewQueueThreadsForPath(item.path, reviewComments);
    const itemDrafts = reviewQueueDraftsForPath(item.path, draftComments);
    const itemDraftsByThreadId = reviewQueueDraftsByThreadId(
      itemThreads,
      itemDrafts,
    );
    const standaloneDrafts = itemDrafts.filter(
      (draft) => !draft.threadId || !itemDraftsByThreadId.has(draft.threadId),
    );
    const standaloneDraftGroups =
      reviewQueueStandaloneDraftGroups(standaloneDrafts);
    const itemPendingCount = item.pendingDraftCount ?? itemDrafts.length;
    const itemDraftIds = item.pendingDraftIds?.length
      ? item.pendingDraftIds
      : itemDrafts.map((draft) => draft.id);
    const itemOpenCount = item.threadCounts.open;
    const itemReviewCount = itemThreads.length + standaloneDraftGroups.length;
    const itemStatusLabel = change
      ? changeStatusLabel(change.status, change.kind)
      : "comment";
    const directoryLabel = change
      ? reviewDirectoryLabel(change)
      : directoryForPath(item.path);
    const kindLabel = reviewQueueFileKindLabel(item.path);
    return (
      <div
        className={[
          "review-queue-item",
          itemReviewCount ? "review-thread-expand-file" : "",
          item.unread ? "is-unread" : "",
          itemDraftIds.length ? "has-drafts has-publish-action" : "",
          item.change ? "is-changed" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        key={`${change?.source ?? "thread"}:${item.path}`}
      >
        <button
          className={`change-open${itemOpenCount || itemPendingCount ? " has-open-threads" : ""}${reviewQueueItemHasAgentReply(item) ? " has-agent-reply" : ""}${active ? " active" : ""}`}
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
            if (!isReviewQueueNavigationKey(event.key)) return;
            event.preventDefault();
            focusVisibleReviewQueueTarget(event.key, event.currentTarget);
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
              <span className="review-signal-badges" aria-hidden="true">
                {item.unread ? <span className="unread">Unread</span> : null}
                {itemDraftIds.length ? (
                  <span className="draft">
                    {itemDraftIds.length}{" "}
                    {itemDraftIds.length === 1 ? "draft" : "drafts"}
                  </span>
                ) : null}
                {change ? <span>Changed</span> : null}
              </span>
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
        {itemDraftIds.length && onPublishDrafts ? (
          <button
            className="review-signal-publish"
            type="button"
            aria-label={`Publish ${itemDraftIds.length} ${itemDraftIds.length === 1 ? "draft" : "drafts"} for ${item.path}`}
            onClick={() => void onPublishDrafts(itemDraftIds)}
          >
            Publish
          </button>
        ) : null}
        {itemReviewCount ? (
          <>
            <input
              className={`${sharedUiStyles.srOnly} sr-only review-thread-toggle-control`}
              id={threadToggleId}
              type="checkbox"
              aria-controls={threadListId}
              aria-label={`Toggle ${reviewItemCountLabel(itemOpenCount, itemPendingCount, itemReviewCount)} for ${item.path}`}
            />
            <label
              className={`review-thread-count-toggle${itemPendingCount ? " pending" : ""}`}
              htmlFor={threadToggleId}
            >
              {reviewItemCountLabel(
                itemOpenCount,
                itemPendingCount,
                itemReviewCount,
              )}
            </label>
          </>
        ) : null}
        {itemReviewCount ? (
          <div
            className="review-thread-hairline-list"
            id={threadListId}
            aria-label={`Review items for ${item.path}`}
          >
            {itemThreads.map((thread) => {
              const primaryComment = thread.comments[0]!;
              const quoteLines = reviewThreadQuoteLines(primaryComment.anchor);
              const sourceLineLabel = commentLineLabel(primaryComment);
              const pendingDrafts = itemDraftsByThreadId.get(thread.id) ?? [];
              const threadReceipt = commentThreadReviewReceipt(
                thread,
                threadActivities[thread.id]?.timeline,
              );
              const activeThread = thread.comments.some(
                (comment) => comment.id === activeCommentId,
              );
              const activePendingDraft = pendingDrafts.some(
                (draft) =>
                  activeCommentId === draft.id ||
                  activeCommentId === `draft:${draft.id}`,
              );
              return (
                <div className="review-thread-hairline-item" key={thread.id}>
                  <button
                    className={`review-thread-hairline-row${activeThread || activePendingDraft ? " active" : ""}`}
                    type="button"
                    aria-label={`Open ${threadReceipt.ariaLabel} thread in ${thread.path}, ${sourceLineLabel}${pendingDrafts.length ? `, ${pendingDraftCountLabel(pendingDrafts.length)}` : ""}`}
                    onClick={() => onOpenComment?.(primaryComment)}
                  >
                    <span className="review-thread-hairline-main">
                      <span className="review-thread-hairline-title">
                        <span>{sourceLineLabel}</span>
                        <span
                          className={`review-thread-status-badge ${threadReceipt.state}`}
                        >
                          {threadReceipt.label}
                        </span>
                        {pendingDrafts.length ? (
                          <span className="review-thread-status-badge pending">
                            {pendingDraftCountLabel(pendingDrafts.length)}
                          </span>
                        ) : null}
                      </span>
                      {quoteLines.length ? (
                        <span
                          className="review-thread-hairline-quote"
                          aria-label="Thread target excerpt"
                        >
                          {quoteLines.map((line, index) => (
                            <span key={`${index}:${line}`}>{line}</span>
                          ))}
                        </span>
                      ) : null}
                      <span className="review-thread-hairline-meta">
                        {[
                          totalMessageCountLabel(thread.comments.length),
                          threadReceipt.meta,
                          pendingDrafts.length
                            ? `${pendingDraftCountLabel(pendingDrafts.length)} not agent-visible`
                            : "",
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </span>
                  </button>
                </div>
              );
            })}
            {standaloneDraftGroups.map((group) => {
              const latestDraft = group.drafts[0]!;
              const sourceLineLabel = commentLineLabelForAnchor(
                latestDraft.anchor.canonical,
              );
              const activeDraft = group.drafts.some(
                (draft) =>
                  activeCommentId === draft.id ||
                  activeCommentId === `draft:${draft.id}`,
              );
              const groupedPendingLabel =
                group.drafts.length > 1
                  ? pendingDraftCountLabel(group.drafts.length)
                  : "Pending";
              const quoteLines = reviewThreadQuoteLines(latestDraft.anchor);
              const ariaAction =
                latestDraft.threadId || group.drafts.length > 1
                  ? "Open pending thread"
                  : "Open pending item";
              return (
                <div className="review-thread-hairline-item" key={group.id}>
                  <button
                    className={`review-thread-hairline-row${activeDraft ? " active" : ""}`}
                    type="button"
                    aria-label={`${ariaAction}, ${latestDraft.path}, ${sourceLineLabel}${group.drafts.length > 1 ? `, ${pendingDraftCountLabel(group.drafts.length)}` : ""}`}
                    onClick={() => onOpenDraft?.(latestDraft)}
                  >
                    <span className="review-thread-hairline-main">
                      <span className="review-thread-hairline-title">
                        <span>{sourceLineLabel}</span>
                        <span className="review-thread-status-badge pending">
                          {groupedPendingLabel}
                        </span>
                      </span>
                      {quoteLines.length ? (
                        <span
                          className="review-thread-hairline-quote"
                          aria-label="Thread target excerpt"
                        >
                          {quoteLines.map((line, index) => (
                            <span key={`${index}:${line}`}>{line}</span>
                          ))}
                        </span>
                      ) : null}
                      <span className="review-thread-hairline-meta">
                        {group.drafts.length > 1
                          ? `${pendingDraftCountLabel(group.drafts.length)} not agent-visible · publishes as open`
                          : "not agent-visible · publishes as open"}
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
      className={`${styles.inspectorRoot} ${sharedUiStyles.inspector} inspector review-thread-pattern-a`}
      aria-label="Review inspector"
    >
      <InspectorSurfaceTabs
        activeSurface="review"
        reviewQueueCount={reviewQueueCount}
        onSelectDocument={onOpenDocument}
      />
      <div
        className={`${sharedUiStyles.panelTitle} panel-title review-panel-title`}
      >
        <span className="review-panel-heading">
          <strong>
            {reviewQueueCount
              ? `${reviewQueueCount} active ${reviewQueueCount === 1 ? "file" : "files"}`
              : reviewLoading
                ? "loading"
                : "clear"}
          </strong>
          <span>Sorted by attention</span>
        </span>
        {queueItems.length ? (
          <button
            className={`${sharedUiStyles.commandButton} ${sharedUiStyles.commandButtonSecondary} command-button command-button-secondary review-next-action`}
            type="button"
            aria-label="Open next review queue item"
            onClick={onOpenNextChanged}
          >
            Next queued
          </button>
        ) : null}
      </div>
      <div className="inspect-body">
        <div className="inspector-review-mode">
          {unsavedInputCount ? (
            <div className="review-unsaved-input-summary" role="status">
              <p>
                <strong>{unsavedInputCount}</strong>{" "}
                {unsavedInputCount === 1 ? "input" : "inputs"} in progress
                <span>Not included in Publish until saved.</span>
              </p>
              {resumableInput && onResumeInput ? (
                <button
                  type="button"
                  aria-label={`Resume input in ${resumableInput.path}, ${resumableInput.location}`}
                  onClick={onResumeInput}
                >
                  Resume {basenameForPath(resumableInput.path)} ·{" "}
                  {resumableInput.location}
                </button>
              ) : null}
            </div>
          ) : null}
          {queueItems.length || hiddenReviewWork ? (
            <div
              className="review-queue"
              role="group"
              aria-label={`Review queue signal ledger, ${reviewQueueCount} active ${reviewQueueCount === 1 ? "file" : "files"}, ${signalCounts.unread} unread, ${signalCounts.drafts} with drafts, ${signalCounts.changed} changed, ${reviewedCount} reviewed`}
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
              <div className="review-signal-filter-shell">
                {reviewSignalFilters(signalCounts).map((filter) => (
                  <input
                    className={`${sharedUiStyles.srOnly} sr-only review-signal-filter-input review-signal-filter-${filter.id}`}
                    defaultChecked={filter.id === "all"}
                    disabled={filter.count === 0 && filter.id !== "all"}
                    id={`review-signal-filter-${filter.id}`}
                    key={filter.id}
                    name="review-signal-filter"
                    type="radio"
                    value={filter.id}
                  />
                ))}
                <div
                  className="review-signal-filter-controls"
                  role="radiogroup"
                  aria-label="Filter review queue by signal"
                >
                  {reviewSignalFilters(signalCounts).map((filter) => (
                    <label
                      className={
                        filter.count === 0 && filter.id !== "all"
                          ? "disabled"
                          : ""
                      }
                      htmlFor={`review-signal-filter-${filter.id}`}
                      key={filter.id}
                    >
                      {filter.label} <span>{filter.count}</span>
                    </label>
                  ))}
                </div>
                <section
                  className="review-signal-ledger-list"
                  aria-label="Active review files sorted by attention"
                >
                  {queueItems.map((item, index) =>
                    renderReviewQueueItem(item, index),
                  )}
                </section>
              </div>
              <details className="review-state-section reviewed">
                <summary>
                  <span>Reviewed</span>
                  <small>{hiddenReviewSummary}</small>
                </summary>
                <div className="hidden-review-history-list">
                  {usesReceiptHistory
                    ? reviewedReceipts.slice(0, 4).map((receipt) => (
                        <button
                          className={`hidden-review-history-item ${receipt.reason}`}
                          key={receipt.id}
                          type="button"
                          aria-label={`Open recently reviewed ${receipt.path}`}
                          onClick={() => onOpenEventPath(receipt.path)}
                        >
                          <CommentStatusBadge status="reviewed">
                            Reviewed
                          </CommentStatusBadge>
                          <strong>{basenameForPath(receipt.path)}</strong>
                          <span>{reviewReceiptReasonLabel(receipt)}</span>
                          <small>{receipt.path}</small>
                        </button>
                      ))
                    : null}
                  {!usesReceiptHistory
                    ? acceptedReviewChanges.slice(0, 4).map((change) => (
                        <button
                          className="hidden-review-history-item accepted"
                          key={`accepted:${change.path}`}
                          type="button"
                          aria-label={`Move reviewed change ${change.path} back to the review queue`}
                          onClick={() =>
                            onRestoreAcceptedReviewPath?.(change.path)
                          }
                        >
                          <CommentStatusBadge status="reviewed">
                            Reviewed
                          </CommentStatusBadge>
                          <strong>{basenameForPath(change.path)}</strong>
                          <span>marked reviewed</span>
                          <small>{reviewPathLabel(change)}</small>
                        </button>
                      ))
                    : null}
                  {!usesReceiptHistory
                    ? hiddenReviewThreads.slice(0, 4).map((thread) => {
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
                      })
                    : null}
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
                No recent document edits, open comment threads, or pending
                drafts need review right now. Resolved threads stay in Comments
                history; archived threads are hidden from the browser UI.
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

function reviewSignalFilters(
  counts: ReturnType<typeof reviewQueueSignalCounts>,
) {
  return [
    { id: "all", label: "All", count: counts.all },
    { id: "unread", label: "Unread", count: counts.unread },
    { id: "drafts", label: "Drafts", count: counts.drafts },
    { id: "changed", label: "Changed", count: counts.changed },
  ] as const;
}

function reviewReceiptReasonLabel(receipt: ReviewReceiptEntry): string {
  if (receipt.reason === "accepted_change") return "marked reviewed";
  if (receipt.reason === "threads_resolved") return "feedback resolved";
  if (receipt.reason === "drafts_cleared") return "drafts cleared";
  return "change cleared";
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
    item.threadCounts.open ? `${item.threadCounts.open} open` : "",
    item.pendingDraftCount ? `${item.pendingDraftCount} pending` : "",
    item.pendingDraftCount ? "not agent-visible until publish" : "",
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
  if (item.threadCounts.open > 0 || (item.pendingDraftCount ?? 0) > 0) {
    return "unread-dot muted";
  }
  if (item.change) return "unread-dot muted";
  return "unread-dot read";
}

function reviewQueueVisibleSummary(item: ReviewQueueItem): string | null {
  const pendingCount = item.pendingDraftCount ?? 0;
  if (reviewQueueItemHasAgentReply(item) && item.latestActivity) {
    return `${activityLabel(item.latestActivity)} · needs decision`;
  }
  if (item.threadCounts.open > 0 && pendingCount > 0) {
    return `${item.threadCounts.open} open · ${pendingCount} pending · ${
      item.unread ? "unread activity" : "not agent-visible"
    }`;
  }
  if (item.threadCounts.open > 0) {
    return `${item.threadCounts.open} open · ${
      item.unread ? "unread activity" : "no new movement"
    }`;
  }
  if (pendingCount > 0) {
    return `${pendingCount} pending · not agent-visible`;
  }
  if (item.commentCount > 0) {
    return `No open · ${totalMessageCountLabel(item.commentCount)}`;
  }
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
    (thread) => thread.path === path && thread.status === "open",
  );
}

function reviewQueueDraftsForPath(
  path: string,
  drafts: DraftReviewComment[],
): DraftReviewComment[] {
  return drafts
    .filter((draft) => draft.path === path)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function reviewQueueDraftsByThreadId(
  threads: CommentThread[],
  drafts: DraftReviewComment[],
): Map<string, DraftReviewComment[]> {
  const threadIds = new Set(threads.map((thread) => thread.id));
  const draftsByThreadId = new Map<string, DraftReviewComment[]>();
  for (const draft of drafts) {
    if (!draft.threadId || !threadIds.has(draft.threadId)) continue;
    draftsByThreadId.set(draft.threadId, [
      ...(draftsByThreadId.get(draft.threadId) ?? []),
      draft,
    ]);
  }
  return draftsByThreadId;
}

function reviewQueueStandaloneDraftGroups(
  drafts: DraftReviewComment[],
): PendingDraftThreadGroup[] {
  const draftIds = new Set(drafts.map((draft) => draft.id));
  const groupIds: string[] = [];
  const draftsByGroupId = new Map<string, DraftReviewComment[]>();
  for (const draft of drafts) {
    const groupId = reviewQueueStandaloneDraftGroupId(draft, draftIds);
    if (!draftsByGroupId.has(groupId)) {
      groupIds.push(groupId);
      draftsByGroupId.set(groupId, []);
    }
    draftsByGroupId.get(groupId)!.push(draft);
  }
  return groupIds.map((id) => ({
    id,
    drafts: draftsByGroupId.get(id)!,
  }));
}

function reviewQueueStandaloneDraftGroupId(
  draft: DraftReviewComment,
  draftIds: ReadonlySet<string>,
): string {
  if (!draft.threadId) return `draft:${draft.id}`;
  const targetDraftId = draftOnlyThreadTargetDraftId(draft.threadId);
  if (targetDraftId && draftIds.has(targetDraftId)) {
    return `draft:${targetDraftId}`;
  }
  return `thread:${draft.threadId}`;
}

function draftOnlyThreadTargetDraftId(threadId: string): string | null {
  if (!threadId.startsWith("draft-thread:")) return null;
  const withoutPrefix = threadId.slice("draft-thread:".length);
  const separatorIndex = withoutPrefix.indexOf(":");
  if (separatorIndex <= 0) return null;
  return withoutPrefix.slice(0, separatorIndex);
}

function reviewItemCountLabel(
  openCount: number,
  pendingCount: number,
  fallbackCount: number,
): string {
  if (openCount && pendingCount)
    return `${openCount} open · ${pendingCount} pending`;
  if (pendingCount) return `${pendingCount} pending`;
  if (openCount) return `${openCount} open`;
  return `${fallbackCount} open`;
}

function pendingDraftCountLabel(count: number): string {
  return `${count} pending`;
}

function draftSurfaceLabel(draft: DraftReviewComment): string {
  if (draft.anchor.surface === "diff") return "diff";
  if (draft.anchor.surface === "rendered") {
    return `${draft.anchor.rendered?.kind ?? draft.viewerKind} rendered`;
  }
  return "source";
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

function isReviewQueueNavigationKey(key: string): boolean {
  return ["ArrowDown", "ArrowUp", "Home", "End"].includes(key);
}

function focusVisibleReviewQueueTarget(
  key: string,
  currentTarget: HTMLButtonElement,
) {
  const list = currentTarget.closest(".review-signal-ledger-list");
  if (!list) return;
  const visibleRows = [
    ...list.querySelectorAll<HTMLButtonElement>(".change-open:not(:disabled)"),
  ].filter((row) => row.getClientRects().length > 0);
  const currentIndex = visibleRows.indexOf(currentTarget);
  const nextIndex = reviewQueueKeyboardTarget(
    key,
    currentIndex,
    visibleRows.length,
  );
  if (nextIndex !== null) visibleRows[nextIndex]?.focus();
}

function totalMessageCountLabel(count: number): string {
  return `${count} total ${count === 1 ? "message" : "messages"}`;
}

function reviewThreadQuoteLines(anchor: CommentAnchor): string[] {
  const quote = anchor.rendered?.textQuote ?? anchor.canonical.quote;
  if (!quote?.trim()) return [];
  const lines = quote
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+$/u, ""));
  while (lines[0]?.trim() === "") lines.shift();
  return lines.slice(0, 3).map((line) => line || " ");
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
    return (
      <span className={`${sharedUiStyles.muted} diff-stat muted`}>...</span>
    );
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
