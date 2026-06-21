import type { DraftReviewComment, ViviComment } from "../../domain/comments.js";
import type { FilePayload } from "../../domain/fs-node.js";
import type { CommentActivitySummary } from "../../state/comment-activity.js";
import { activityLabel } from "../../state/comment-activity.js";
import { buildCodeMetadata, type LineRange } from "../../state/code-viewer.js";
import {
  changeStatusLabel,
  reviewQueueSourceLabel,
  type DiffStat,
  type ReviewChangeItem,
} from "../../state/git-review.js";
import { iconForPath } from "../../state/file-icons.js";
import type { OutlineHeading } from "../../state/outline.js";
import {
  isReviewQueueItemOpenable,
  summarizeReviewQueue,
  type ReviewQueueItem,
} from "../../state/review-queue.js";

interface Props {
  file: FilePayload | null;
  fileRemoved?: boolean;
  outline: OutlineHeading[];
  reviewChanges: ReviewChangeItem[];
  reviewItems?: ReviewQueueItem[];
  reviewUnavailableReason?: string | null;
  reviewDiffStats: Record<string, DiffStat | null>;
  loadingReviewDiffs: Record<string, boolean>;
  unreadReviewPaths: Set<string>;
  comments?: ViviComment[];
  draftComments?: DraftReviewComment[];
  commentsLoading?: boolean;
  threadActivities?: Record<string, CommentActivitySummary>;
  selectedCodeRange: LineRange | null;
  refreshedAt?: number;
  activePaneId: string;
  onOutlineSelect: (id: string) => void;
  onOpenEventPath: (path: string) => void;
  onConfirmEventPath: (path: string) => void;
  onOpenNextChanged: () => void;
  onOpenPreviousChanged: () => void;
  onOpenAllChanged: () => void;
  onTargetHoverChange: (hovering: boolean) => void;
  onRevealTarget: () => void;
  onRevealInTree: () => void;
  onOpenComments?: () => void;
}

export function Inspector({
  file,
  fileRemoved = false,
  outline,
  reviewChanges,
  reviewItems,
  reviewUnavailableReason = null,
  reviewDiffStats,
  loadingReviewDiffs,
  unreadReviewPaths,
  comments = [],
  draftComments = [],
  commentsLoading = false,
  threadActivities = {},
  selectedCodeRange,
  refreshedAt,
  activePaneId,
  onOutlineSelect,
  onOpenEventPath,
  onConfirmEventPath,
  onOpenNextChanged,
  onOpenPreviousChanged,
  onOpenAllChanged,
  onTargetHoverChange,
  onRevealTarget,
  onRevealInTree,
  onOpenComments,
}: Props) {
  const codeMetadata =
    file && (file.viewerKind === "code" || file.viewerKind === "json")
      ? buildCodeMetadata(file, selectedCodeRange)
      : null;
  const fileKindLabel = file ? viewerKindLabel(file.viewerKind) : "No file";
  const activeChange = file
    ? reviewChanges.find((change) => change.path === file.path)
    : null;
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
  const publishedBatches = publishedBatchSummary(comments);
  return (
    <aside className="inspector">
      <div className="panel-title">
        <span>Review</span>
        <span className="pill">Read-only</span>
      </div>
      <div className="inspect-body">
        <div className="section-title with-action primary-section">
          <span>Review Queue</span>
          {queueItems.length ? (
            <span className="queue-actions">
              <button
                aria-keyshortcuts="Meta+Shift+K Control+Shift+K"
                title="Previous review item (Cmd/Ctrl+Shift+K)"
                type="button"
                onClick={onOpenPreviousChanged}
              >
                Previous
              </button>
              <button
                aria-keyshortcuts="Meta+Shift+J Control+Shift+J"
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
              <strong>{queueProgress.total}</strong> files
              {queueProgress.unread
                ? ` · ${queueProgress.unread} unseen`
                : " · all seen"}
              {queueProgress.openThreads
                ? ` · ${queueProgress.openThreads} open ${queueProgress.openThreads === 1 ? "thread" : "threads"}`
                : ""}
            </span>
            <span
              className="review-progress-track"
              role="progressbar"
              aria-label={`${queueProgress.seen} of ${queueProgress.total} review files seen`}
              aria-valuemin={0}
              aria-valuemax={queueProgress.total}
              aria-valuenow={queueProgress.seen}
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
          <div className="review-queue">
            {queueItems.map((item) => {
              const { change } = item;
              const statusLabel = change
                ? changeStatusLabel(change.status, change.kind)
                : "comment";
              return (
                <button
                  className={`change-open${item.threadCounts.open ? " has-open-threads" : ""}`}
                  disabled={!isReviewQueueItemOpenable(item)}
                  aria-label={`${statusLabel} ${item.path}${item.threadCounts.open ? `, ${item.threadCounts.open} open threads` : ""}${change ? ` from ${reviewQueueSourceLabel(change.source)}` : ""}`}
                  key={`${change?.source ?? "thread"}:${item.path}`}
                  onClick={() => onOpenEventPath(item.path)}
                  onDoubleClick={() => onConfirmEventPath(item.path)}
                  title="Double-click to keep open as a tab"
                  type="button"
                >
                  <span
                    className={item.unread ? "unread-dot" : "unread-dot read"}
                    aria-hidden="true"
                  />
                  <span className="file-icon change-icon">
                    {iconForPath(item.path)}
                  </span>
                  <span className="change-main">
                    <span className="change-heading">
                      <span
                        className={`change-status ${change ? (change.kind ?? change.status) : "comment"}`}
                      >
                        {statusLabel}
                      </span>
                      <b>{basenameForPath(item.path)}</b>
                    </span>
                    <small>
                      {change ? reviewPathLabel(change) : item.path}
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
              );
            })}
          </div>
        ) : null}
        {queueItems.length && reviewUnavailableReason ? (
          <p className="muted compact-empty">
            Git review warning: {reviewUnavailableReason}
          </p>
        ) : null}
        {!queueItems.length && reviewUnavailableReason ? (
          <p className="muted compact-empty">
            Git review unavailable: {reviewUnavailableReason}
          </p>
        ) : null}
        {!queueItems.length && !reviewUnavailableReason ? (
          <p className="muted compact-empty">No files to review.</p>
        ) : null}

        <p className="active-file-line">
          {file ? (
            <>
              <span>{file.path}</span> · {fileKindLabel}
              {fileRemoved ? " · removed from disk" : ""}
              {activeChange ? " · in review queue" : ""}
            </>
          ) : (
            "No file selected"
          )}
        </p>
        <button
          className="secondary-action inline-action"
          disabled={!file}
          onClick={() => onRevealInTree()}
          type="button"
        >
          Show in Explorer
        </button>

        <h3 className="section-title">Comments</h3>
        {commentsLoading ? (
          <p className="muted compact-empty">Loading comments...</p>
        ) : (
          <div className="comment-summary">
            <strong>
              {comments.filter((comment) => comment.status === "open").length}{" "}
              open comments
            </strong>
            <span>{comments.length} total in this file</span>
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
              disabled={!comments.length}
              type="button"
              onClick={onOpenComments}
            >
              Open in Comments panel
            </button>
            {comments.length ? (
              <div className="inspector-comment-activity">
                {comments.slice(0, 3).map((comment) => {
                  const threadId = comment.threadId ?? comment.id;
                  const activity = threadActivities[threadId];
                  return activity?.inline[0] ? (
                    <span key={comment.id}>{activity.inline[0]}</span>
                  ) : null;
                })}
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
                  <li key={event.id}>{activityLabel(event)}</li>
                ));
              })}
            </ol>
          </details>
        ) : null}

        <h3 className="section-title">In this file</h3>
        {codeMetadata ? (
          codeMetadata.symbols.length ? (
            <nav className="symbol-list">
              {codeMetadata.symbols.slice(0, 14).map((symbol) => (
                <a
                  href={`#L${symbol.line}`}
                  key={`${symbol.kind}-${symbol.name}-${symbol.line}`}
                  onClick={(event) => {
                    event.preventDefault();
                    document
                      .querySelector<HTMLElement>(
                        `.code-line[data-line="${symbol.line}"]`,
                      )
                      ?.scrollIntoView({
                        block: "center",
                        behavior: "smooth",
                      });
                  }}
                >
                  <span>{symbol.kind}</span>
                  <strong>{symbol.name}</strong>
                  <small>{symbol.line}</small>
                </a>
              ))}
            </nav>
          ) : (
            <p className="muted compact-empty">No symbols for this file.</p>
          )
        ) : outline.length ? (
          <nav className="outline">
            {outline.map((heading, index) => (
              <a
                key={heading.id}
                className={`${heading.level === 2 ? "h2 " : ""}${index === 0 ? "active" : ""}`}
                href={`#${heading.id}`}
                onClick={(event) => {
                  event.preventDefault();
                  onOutlineSelect(heading.id);
                }}
              >
                {heading.text}
              </a>
            ))}
          </nav>
        ) : (
          <p className="muted compact-empty">No outline for this file.</p>
        )}

        <details className="file-details">
          <summary>Details</summary>
          <button
            className="focus-target"
            onClick={onRevealTarget}
            onMouseEnter={() => onTargetHoverChange(true)}
            onMouseLeave={() => onTargetHoverChange(false)}
            type="button"
          >
            <span>Inspector target</span>
            <strong>{inspectorTargetLabel(file, activePaneId)}</strong>
          </button>
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

function DiffStatBadge({
  loading,
  stat,
}: {
  loading: boolean;
  stat: DiffStat | null;
}) {
  if (loading && !stat) return <span className="diff-stat muted">...</span>;
  if (!stat) return <span className="diff-stat muted">-</span>;
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

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export function inspectorTargetLabel(
  file: FilePayload | null,
  paneId: string,
): string {
  const name = file?.path.split("/").filter(Boolean).at(-1) ?? "No file";
  return `${name} · ${paneId}`;
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
