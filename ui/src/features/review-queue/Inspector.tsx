import { useState } from "react";
import {
  buildCommentThreads,
  type DraftReviewComment,
  type ViviComment,
} from "../../domain/comments.js";
import styles from "./Inspector.module.css";
import type { FilePayload } from "../../domain/fs-node.js";
import {
  activityLabel,
  isHumanFeedback,
  type CommentActivitySummary,
} from "../../state/comment-activity.js";
import type { LineRange } from "../../state/code-viewer.js";
import {
  commentLineLabel,
  truncateCommentPreview,
} from "../../state/comments.js";
import {
  changeStatusLabel,
  type DiffStat,
  type ReviewChangeItem,
} from "../../state/git-review.js";
import {
  isReviewQueueItemOpenable,
  reviewQueuePosition,
  type ReviewQueueItem,
  type UnavailableFeedbackItem,
} from "../../state/review-queue.js";
import { gitReviewUnavailableGuidance } from "../../state/git-review-refresh.js";
import type { OutlineHeading } from "../../state/outline.js";
import { InspectorSurfaceTabs } from "../../shared/components/InspectorSurfaceTabs.js";
import sharedUiStyles from "../../shared/styles/SharedUi.module.css";

interface Props {
  onDismissRecent?: (path: string) => void;
  documentHeadings?: Record<string, string>;
  now?: number;
  file: FilePayload | null;
  fileRemoved?: boolean;
  reviewChanges: ReviewChangeItem[];
  reviewItems?: ReviewQueueItem[];
  unavailableFeedbackItems?: UnavailableFeedbackItem[];
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
  resumableInputs?: Array<{
    id: string;
    path: string;
    location: string;
  }>;
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
  onOpenNextChanged: () => void;
  onOpenPreviousChanged: () => void;
  onOpenAllChanged: () => void;
  onRevealInTree: () => void;
  onOutlineSelect?: (id: string) => void;
  onOpenDraft?: (draft: DraftReviewComment) => void;
  onPublishDrafts?: (draftIds?: string[]) => void | Promise<void>;
  publishDisabled?: boolean;
  onOpenDocument?: () => void;
  onResumeInput?: (id: string) => void;
}

export function Inspector(props: Props) {
  const [heldItems, setHeldItems] = useState<ReviewQueueItem[] | null>(null);
  return (
    <InspectorContent
      {...props}
      heldItems={heldItems}
      setHeldItems={setHeldItems}
    />
  );
}

export function InspectorContent({
  heldItems = null,
  setHeldItems = () => undefined,
  file,
  onDismissRecent,
  documentHeadings = {},
  now = Date.now(),
  reviewChanges,
  reviewItems,
  unavailableFeedbackItems = [],
  reviewLoading = false,
  reviewUnavailableReason = null,
  unreadReviewPaths,
  comments = [],
  reviewComments = comments,
  draftComments = [],
  unsavedInputCount = 0,
  resumableInput = null,
  resumableInputs,
  activePath = file?.path ?? null,
  onOpenEventPath,
  onConfirmEventPath,
  onPublishDrafts,
  publishDisabled = false,
  onOpenDocument,
  onResumeInput,
}: Props & {
  heldItems?: ReviewQueueItem[] | null;
  setHeldItems?: (items: ReviewQueueItem[] | null) => void;
}) {
  const visibleResumableInputs =
    resumableInputs ??
    (resumableInput ? [{ id: "resumable-input", ...resumableInput }] : []);
  const incomingItems: ReviewQueueItem[] =
    reviewItems ??
    reviewChanges.map((change) => ({
      path: change.path,
      change,
      commentCount: 0,
      unread: unreadReviewPaths.has(change.path),
    }));
  const queueItems = heldItems ?? incomingItems;
  const feedbackItems = queueItems.filter(
    (item) => item.unread || item.pendingDraftCount || item.pendingInputCount,
  );
  const recentItems = queueItems.filter(
    (item) => !feedbackItems.includes(item),
  );
  const reviewQueueCount = queueItems.filter(isReviewQueueItemOpenable).length;
  const queuePosition = reviewQueuePosition(queueItems, activePath);
  const gitReviewGuidance = gitReviewUnavailableGuidance(
    reviewUnavailableReason,
  );
  function renderReviewQueueItem(item: ReviewQueueItem, index: number) {
    const { change } = item;
    const active = item.path === queuePosition.activePath;
    const reviewStop = reviewQueueStopForPath(item.path, reviewComments);
    const reviewQueueItemDescriptionId = `review-queue-item-${index + 1}-description`;
    const itemDrafts = draftComments.filter(
      (draft) => draft.path === item.path,
    );
    const itemPendingCount = item.pendingDraftCount ?? itemDrafts.length;
    const itemDraftIds = item.pendingDraftIds?.length
      ? item.pendingDraftIds
      : itemDrafts.map((draft) => draft.id);
    const itemStatusLabel = change
      ? changeStatusLabel(change.status, change.kind)
      : "comment";
    const heading = documentHeadings[item.path];
    const collidingName = queueItems.some(
      (other) =>
        other.path !== item.path &&
        basenameForPath(other.path) === basenameForPath(item.path),
    );
    const reason =
      [
        itemPendingCount
          ? `${itemPendingCount} ${itemPendingCount === 1 ? "draft" : "drafts"}`
          : "",
        item.pendingInputCount ? "Input in progress" : "",
        item.unread ? "Unread by agent" : "",
      ]
        .filter(Boolean)
        .join(" · ") ||
      item.activityReason ||
      (item.change ? "Updated" : "Opened");
    return (
      <div
        className={[
          "review-queue-item",
          item.unread ? "is-unread" : "",
          itemDraftIds.length ? "has-drafts has-publish-action" : "",
          item.change ? "is-changed" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        key={`${change?.source ?? "thread"}:${item.path}`}
      >
        <button
          className={`change-open${active ? " active" : ""}`}
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
          <span className="change-main">
            <span className="change-heading">
              <b>{basenameForPath(item.path)}</b>
            </span>
            <small className="now-document-heading" title={item.path}>
              {heading || directoryForPath(item.path)}
            </small>
            {heading && collidingName ? (
              <small className="now-document-heading">
                {directoryForPath(item.path)}
              </small>
            ) : null}
            <span className="now-reason">
              <span>{reason}</span>
              <time>
                {item.lastActivityAt
                  ? relativeNowTime(item.lastActivityAt, now)
                  : ""}
              </time>
            </span>
          </span>
        </button>
        {!item.unread &&
        !itemPendingCount &&
        !item.pendingInputCount &&
        onDismissRecent ? (
          <button
            type="button"
            className="now-dismiss"
            aria-label={`Hide ${item.path} for now`}
            title="Hide for now"
            onClick={() => onDismissRecent(item.path)}
          >
            ×
          </button>
        ) : null}
        {itemDraftIds.length && onPublishDrafts ? (
          <button
            className="review-signal-publish"
            type="button"
            disabled={publishDisabled}
            aria-label={`Publish ${itemDraftIds.length} ${itemDraftIds.length === 1 ? "draft" : "drafts"} for ${item.path}`}
            onClick={() => void onPublishDrafts(itemDraftIds)}
          >
            Publish
          </button>
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
          {reviewLoading ? "Updating…" : "Worth a look now"}
        </span>
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
              {onResumeInput
                ? visibleResumableInputs.map((input) => (
                    <button
                      type="button"
                      key={input.id}
                      aria-label={`Resume input in ${input.path}, ${input.location}`}
                      onClick={() => onResumeInput(input.id)}
                    >
                      Resume {basenameForPath(input.path)} · {input.location}
                    </button>
                  ))
                : null}
            </div>
          ) : null}
          {queueItems.length ? (
            <div
              className="review-queue"
              role="group"
              aria-label={`For you, ${reviewQueueCount} ${reviewQueueCount === 1 ? "document" : "documents"}`}
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
              <section
                className="review-signal-ledger-list now-list"
                aria-label="Documents worth a look now"
                onMouseEnter={() => {
                  if (!heldItems) setHeldItems(incomingItems);
                }}
                onMouseLeave={(event) => {
                  if (!event.currentTarget.contains(document.activeElement))
                    setHeldItems(null);
                }}
                onFocusCapture={() => {
                  if (!heldItems) setHeldItems(incomingItems);
                }}
                onBlurCapture={(event) => {
                  if (
                    !event.currentTarget.contains(event.relatedTarget) &&
                    !event.currentTarget.matches(":hover")
                  )
                    setHeldItems(null);
                }}
              >
                {feedbackItems.length ? (
                  <section aria-label="Feedback">
                    <header className="now-group-heading">
                      <span>Feedback</span>
                      <small>Awaiting handoff</small>
                    </header>
                    {feedbackItems.map((item) =>
                      renderReviewQueueItem(item, queueItems.indexOf(item)),
                    )}
                  </section>
                ) : null}
                {recentItems.length ? (
                  <section aria-label="Recent">
                    <header className="now-group-heading">
                      <span>Recent</span>
                      <small>Last 30 minutes</small>
                    </header>
                    {recentItems.map((item) =>
                      renderReviewQueueItem(item, queueItems.indexOf(item)),
                    )}
                  </section>
                ) : null}
              </section>
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
              Loading Git review; unseen feedback may appear before changed
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
              <strong>Nothing to look at right now</strong>
              <span>
                Updated and opened documents will appear here for a while.
              </span>
            </div>
          ) : null}
          {unavailableFeedbackItems.length ? (
            <details className="review-unavailable-feedback">
              <summary>
                Unavailable feedback · {unavailableFeedbackItems.length}
              </summary>
              <p>
                These files are missing or outside the document scope. Feedback
                is preserved.
              </p>
              <ul>
                {unavailableFeedbackItems.map((item) => (
                  <li key={item.path}>
                    <strong>{basenameForPath(item.path)}</strong>
                    <span title={item.path}>{directoryForPath(item.path)}</span>
                    <small>
                      {item.publishedCount
                        ? `${item.publishedCount} published`
                        : ""}
                      {item.publishedCount && item.draftCount ? " · " : ""}
                      {item.draftCount ? `${item.draftCount} drafts` : ""}
                    </small>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      </div>
    </aside>
  );
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
    item.commentCount > 0
      ? item.unread
        ? "not yet seen by an agent"
        : "seen by an agent"
      : "",
    item.pendingDraftCount ? "not agent-visible until publish" : "",
    reviewStop
      ? `${reviewQueueStopTitle(active)} ${reviewStop.label}: ${reviewStop.preview}`
      : "",
    item.latestActivity ? activityLabel(item.latestActivity) : "",
  ]
    .filter(Boolean)
    .join(", ");
}

function reviewQueueStopTitle(active: boolean): string {
  return active ? "Queue stop" : "Next queue stop";
}

interface ReviewQueueStop {
  label: string;
  preview: string;
}

function reviewQueueStopForPath(
  path: string,
  comments: ViviComment[],
): ReviewQueueStop | null {
  const thread = buildCommentThreads(comments.filter(isHumanFeedback))
    .filter((candidate) => candidate.path === path)
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

function surfaceLabel(comment: ViviComment): string {
  if (comment.anchor.surface === "diff") return "diff";
  if (comment.anchor.surface === "rendered") {
    return `${comment.anchor.rendered?.kind ?? comment.viewerKind} rendered`;
  }
  return "source";
}

function basenameForPath(path: string): string {
  return path.split("/").filter(Boolean).at(-1) ?? path;
}

function directoryForPath(path: string): string {
  const parts = path.split("/").filter(Boolean);
  if (parts.length <= 1) return ".";
  return parts.slice(0, -1).join("/");
}

function relativeNowTime(at: number, now: number): string {
  const minutes = Math.max(0, Math.floor((now - at) / 60000));
  return minutes === 0
    ? "Just now"
    : minutes < 60
      ? `${minutes}m ago`
      : `${Math.floor(minutes / 60)}h ago`;
}
