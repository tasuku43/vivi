import { buildCommentThreads } from "../../domain/comments.js";
import type { ReactNode } from "react";
import type { DraftReviewComment, ViviComment } from "../../domain/comments.js";
import type { FilePayload } from "../../domain/fs-node.js";
import {
  commentLineLabel,
  commentLineLabelForAnchor,
  statusLabel,
  truncateCommentPreview,
} from "../../state/comments.js";
import type { DiffStat, ReviewChangeItem } from "../../state/git-review.js";
import type { OutlineHeading } from "../../state/outline.js";
import sharedUiStyles from "../../shared/styles/SharedUi.module.css";
import styles from "./DocumentInspector.module.css";

export interface DocumentInspectorProps {
  file: FilePayload | null;
  outline?: OutlineHeading[];
  activeOutlineId?: string | null;
  comments?: ViviComment[];
  draftComments?: DraftReviewComment[];
  commentsLoading?: boolean;
  activeCommentId?: string | null;
  unsavedInputCount?: number;
  resumableInput?: { path: string; location: string } | null;
  change?: ReviewChangeItem | null;
  diffStat?: DiffStat | null;
  diffLoading?: boolean;
  changesVisible?: boolean;
  onOutlineSelect?: (id: string) => void;
  onOpenComment?: (comment: ViviComment) => void;
  onOpenDraft?: (draft: DraftReviewComment) => void;
  onPublishDrafts?: (draftIds?: string[]) => void | Promise<void>;
  onResumeInput?: () => void;
  onToggleChanges?: () => void;
  reviewQueueCount?: number;
  onOpenReviewQueue?: () => void;
}

export function DocumentInspector({
  file,
  outline = [],
  activeOutlineId = null,
  comments = [],
  draftComments = [],
  commentsLoading = false,
  activeCommentId = null,
  unsavedInputCount = 0,
  resumableInput = null,
  change = null,
  diffStat = null,
  diffLoading = false,
  changesVisible = false,
  onOutlineSelect,
  onOpenComment,
  onOpenDraft,
  onPublishDrafts,
  onResumeInput,
  onToggleChanges,
  reviewQueueCount = 0,
  onOpenReviewQueue,
}: DocumentInspectorProps) {
  const documentDrafts = file
    ? draftComments.filter((draft) => draft.path === file.path)
    : [];
  const threads = buildCommentThreads(comments)
    .filter((thread) => thread.status !== "archived")
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  const openCount = threads.filter((thread) => thread.status === "open").length;
  const feedbackCount = openCount + documentDrafts.length;

  return (
    <aside
      className={`${styles.root} ${sharedUiStyles.inspector}`}
      aria-label="Document inspector"
    >
      <header className={styles.header}>
        <span>Document</span>
        <div className={styles.headerActions}>
          <strong>{file ? formatKind(file.viewerKind) : "No document"}</strong>
          {onOpenReviewQueue ? (
            <button
              className={styles.surfaceSwitch}
              type="button"
              aria-label={`Open review queue${reviewQueueCount ? `, ${reviewQueueCount} items` : ""}`}
              onClick={onOpenReviewQueue}
            >
              Review{reviewQueueCount ? ` ${reviewQueueCount}` : ""}
            </button>
          ) : null}
        </div>
      </header>

      <div className={styles.body}>
        {file ? (
          <>
            <section className={styles.identity} aria-label="Current document">
              <span className={styles.kindDot} data-kind={file.viewerKind} />
              <div>
                <strong>{basename(file.path)}</strong>
                <span title={file.path}>{directory(file.path)}</span>
              </div>
            </section>

            <InspectorSection
              title="In this document"
              count={outline.length || undefined}
            >
              {outline.length ? (
                <nav className={styles.outline} aria-label="Document outline">
                  {outline.map((heading) => (
                    <button
                      key={heading.id}
                      type="button"
                      className={`${styles.outlineItem} ${
                        heading.level === 2 ? styles.outlineNested : ""
                      } ${activeOutlineId === heading.id ? styles.active : ""}`}
                      aria-current={
                        activeOutlineId === heading.id ? "location" : undefined
                      }
                      onClick={() => onOutlineSelect?.(heading.id)}
                    >
                      <span>{heading.text}</span>
                      {heading.lineStart ? (
                        <small>:{heading.lineStart}</small>
                      ) : null}
                    </button>
                  ))}
                </nav>
              ) : (
                <p className={styles.empty}>No H1 or H2 headings.</p>
              )}
            </InspectorSection>

            <InspectorSection
              title="Feedback"
              count={feedbackCount || undefined}
            >
              <p className={styles.gestureHint}>
                Double-click a rendered block to comment. Drag still selects
                text.
              </p>

              {unsavedInputCount ? (
                <div className={styles.unsaved} role="status">
                  <span>
                    {unsavedInputCount} unsaved{" "}
                    {unsavedInputCount === 1 ? "input" : "inputs"}
                  </span>
                  {resumableInput && onResumeInput ? (
                    <button
                      type="button"
                      aria-label={`Resume input in ${resumableInput.path}, ${resumableInput.location}`}
                      onClick={onResumeInput}
                    >
                      Resume {basename(resumableInput.path)} ·{" "}
                      {resumableInput.location}
                    </button>
                  ) : null}
                </div>
              ) : null}

              {documentDrafts.length ? (
                <div
                  className={styles.feedbackList}
                  aria-label="Pending feedback"
                >
                  {documentDrafts.map((draft) => (
                    <div className={styles.feedbackRow} key={draft.id}>
                      <button
                        type="button"
                        onClick={() => onOpenDraft?.(draft)}
                      >
                        <span className={`${styles.status} ${styles.pending}`}>
                          Pending
                        </span>
                        <strong>
                          {commentLineLabelForAnchor(draft.anchor.canonical)}
                        </strong>
                        <small>{truncateCommentPreview(draft.body, 72)}</small>
                      </button>
                    </div>
                  ))}
                  <button
                    className={styles.publish}
                    type="button"
                    aria-label={`Publish all ${documentDrafts.length} pending`}
                    onClick={() =>
                      void onPublishDrafts?.(
                        documentDrafts.map((draft) => draft.id),
                      )
                    }
                  >
                    Publish{" "}
                    {documentDrafts.length === 1
                      ? "comment"
                      : `${documentDrafts.length} comments`}
                  </button>
                </div>
              ) : null}

              {threads.length ? (
                <div
                  className={styles.feedbackList}
                  aria-label="Document feedback threads"
                >
                  {threads.map((thread) => {
                    const comment = thread.comments[0]!;
                    const active = thread.comments.some(
                      (item) => item.id === activeCommentId,
                    );
                    const latest = thread.comments[thread.comments.length - 1]!;
                    return (
                      <button
                        className={`${styles.thread} ${active ? styles.activeThread : ""}`}
                        key={thread.id}
                        type="button"
                        onClick={() => onOpenComment?.(comment)}
                      >
                        <span
                          className={`${styles.status} ${styles[thread.status]}`}
                        >
                          {statusLabel(thread.status)}
                        </span>
                        <strong>{commentLineLabel(comment)}</strong>
                        <small>{truncateCommentPreview(latest.body, 72)}</small>
                        <span className={styles.messageCount}>
                          {thread.comments.length}{" "}
                          {thread.comments.length === 1
                            ? "message"
                            : "messages"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : commentsLoading ? (
                <p className={styles.empty}>Loading feedback…</p>
              ) : !documentDrafts.length ? (
                <p className={styles.empty}>
                  No feedback on this document yet.
                </p>
              ) : null}
            </InspectorSection>

            <InspectorSection title="Changes">
              <div
                className={`${styles.changeCard} ${changesVisible ? styles.changeActive : ""}`}
              >
                <div>
                  <strong>
                    {change ? changeLabel(change) : "No working-tree changes"}
                  </strong>
                  <span>
                    {change
                      ? changeDetail(diffStat, diffLoading)
                      : "The document stays in normal reading mode."}
                  </span>
                </div>
                {change && onToggleChanges ? (
                  <button
                    type="button"
                    aria-pressed={changesVisible}
                    onClick={onToggleChanges}
                  >
                    {changesVisible ? "Back to document" : "Show changes"}
                  </button>
                ) : null}
              </div>
            </InspectorSection>

            <details className={styles.details}>
              <summary>Source details</summary>
              <dl>
                <div>
                  <dt>Path</dt>
                  <dd>{file.path}</dd>
                </div>
                <div>
                  <dt>Size</dt>
                  <dd>{formatBytes(file.size)}</dd>
                </div>
                <div>
                  <dt>Updated</dt>
                  <dd>{formatTimestamp(file.mtimeMs)}</dd>
                </div>
                {file.viewerKind === "html" ? (
                  <div>
                    <dt>Preview</dt>
                    <dd>Sandboxed</dd>
                  </div>
                ) : null}
              </dl>
            </details>
          </>
        ) : (
          <div className={styles.noDocument}>
            <strong>Open a document</strong>
            <span>Select Markdown or HTML from the document tree.</span>
          </div>
        )}
      </div>
    </aside>
  );
}

function InspectorSection({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: ReactNode;
}) {
  return (
    <section className={styles.section}>
      <header>
        <h2>{title}</h2>
        {count ? <span>{count}</span> : null}
      </header>
      {children}
    </section>
  );
}

function basename(path: string): string {
  return path.split("/").pop() ?? path;
}

function directory(path: string): string {
  const parts = path.split("/");
  parts.pop();
  return parts.join("/") || "workspace root";
}

function formatKind(kind: FilePayload["viewerKind"]): string {
  if (kind === "html") return "HTML";
  if (kind === "markdown") return "Markdown";
  return kind;
}

function changeLabel(change: ReviewChangeItem): string {
  if (change.status === "added") return "Added document";
  if (change.status === "deleted") return "Deleted document";
  if (change.status === "renamed") return "Renamed document";
  return "Changed document";
}

function changeDetail(stat: DiffStat | null, loading: boolean): string {
  if (loading) return "Loading change evidence…";
  if (!stat) return "Change evidence is available when needed.";
  return `+${stat.additions} −${stat.deletions} against HEAD`;
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}
