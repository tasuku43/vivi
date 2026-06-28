import { useEffect, useState } from "react";
import type { DraftReviewComment } from "../../../domain/comments.js";
import {
  commentAnchorThreadKey,
  commentLineLabelForAnchor,
  truncateCommentPreview,
} from "../../../state/comments.js";
import sharedUiStyles from "../../../shared/styles/SharedUi.module.css";
import styles from "./DraftReviewTray.module.css";

export function DraftReviewTray({
  drafts,
  initialOpen = false,
  initialEditingDraftId = null,
  publishing = false,
  publishError = null,
  publishedBatchId = null,
  onOpenDraft,
  onUpdateDraft,
  onDeleteDraft,
  onPublishAll,
}: {
  drafts: DraftReviewComment[];
  initialOpen?: boolean;
  initialEditingDraftId?: string | null;
  publishing?: boolean;
  publishError?: string | null;
  publishedBatchId?: string | null;
  onOpenDraft?: (draft: DraftReviewComment) => void;
  onUpdateDraft?: (id: string, body: string) => void | Promise<void>;
  onDeleteDraft?: (id: string) => void | Promise<void>;
  onPublishAll?: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(
    () =>
      initialOpen ||
      drafts.length > 0 ||
      Boolean(publishError) ||
      Boolean(publishedBatchId),
  );
  const [editingId, setEditingId] = useState<string | null>(
    initialEditingDraftId,
  );
  const [body, setBody] = useState(
    () =>
      drafts.find((draft) => draft.id === initialEditingDraftId)?.body ?? "",
  );

  useEffect(() => {
    if (drafts.length || publishError || publishedBatchId) setOpen(true);
    else setOpen(initialOpen);
    if (editingId && !drafts.some((draft) => draft.id === editingId)) {
      setEditingId(null);
      setBody("");
    }
  }, [drafts, editingId, initialOpen, publishError, publishedBatchId]);

  const editing = editingId
    ? drafts.find((draft) => draft.id === editingId)
    : null;
  const publishSummary = summarizeDraftReview(drafts);
  const publishAction = publishActionState({
    draftCount: drafts.length,
    publishing,
    summary: publishSummary,
  });
  const tabSummary = draftReviewTabSummary(drafts.length);

  return (
    <aside
      className={`${styles.tray} draft-review-tray${open ? " open" : ""}`}
      aria-label="Draft review tray"
    >
      <button
        className={`draft-review-tab${drafts.length ? "" : " empty"}`}
        type="button"
        aria-label={`${open ? "Close" : "Open"} Draft Review tray, ${tabSummary}`}
        aria-expanded={open}
        title={tabSummary}
        onClick={() => setOpen((value) => !value)}
      >
        {drafts.length ? "Review drafts" : "Drafts"}{" "}
        <strong>{drafts.length}</strong>
      </button>
      {open ? (
        <div className="draft-review-panel">
          <div className="draft-review-head">
            <div>
              <h2>Draft Review</h2>
              <p>{draftCountLabel(drafts.length)}</p>
            </div>
            <button
              type="button"
              aria-label={publishAction.description}
              disabled={publishAction.disabled}
              title={publishAction.description}
              onClick={() => void onPublishAll?.()}
            >
              {publishAction.label}
            </button>
          </div>
          {drafts.length ? (
            <div className="draft-publish-summary" aria-label="Publish summary">
              <div>
                <strong>
                  {publishSummary.threadCount} open{" "}
                  {publishSummary.threadCount === 1 ? "thread" : "threads"}
                </strong>
                <span>
                  across {publishSummary.fileCount}{" "}
                  {publishSummary.fileCount === 1 ? "file" : "files"}
                </span>
              </div>
              <p>
                Publishing makes these comments visible to agents as active
                review work.
              </p>
              <div className="draft-publish-surfaces">
                {publishSummary.surfaces.map((surface) => (
                  <span key={surface.label}>
                    {surface.label} <strong>{surface.count}</strong>
                  </span>
                ))}
              </div>
            </div>
          ) : null}
          {publishError ? (
            <p className="draft-review-message error" role="alert">
              Publish failed. Drafts were kept. {publishError}
            </p>
          ) : null}
          {publishedBatchId && !drafts.length ? (
            <p className="draft-review-message success" aria-live="polite">
              Published review batch {publishedBatchId}. Open threads are now
              visible to agents.
            </p>
          ) : null}
          {drafts.length ? (
            <div className="draft-review-list">
              {drafts.map((draft) => (
                <article className="draft-review-item" key={draft.id}>
                  <button
                    className="draft-review-path"
                    type="button"
                    aria-label={draftOpenLabel(draft)}
                    title={draftOpenLabel(draft)}
                    onClick={() => onOpenDraft?.(draft)}
                  >
                    <strong>{draft.path}</strong>
                    <span>
                      {anchorSurfaceLabel(draft)} ·{" "}
                      {commentLineLabelForAnchor(draft.anchor.canonical)}
                    </span>
                  </button>
                  {editing?.id === draft.id ? (
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        const trimmed = body.trim();
                        if (!trimmed) return;
                        void Promise.resolve(
                          onUpdateDraft?.(draft.id, trimmed),
                        ).then(() => {
                          setEditingId(null);
                          setBody("");
                        });
                      }}
                    >
                      <p
                        className={`${sharedUiStyles.srOnly} sr-only`}
                        id={draftEditHintId(draft.id)}
                      >
                        This draft stays private until published.
                      </p>
                      <textarea
                        autoFocus
                        value={body}
                        aria-label={`Edit private draft comment for ${draft.path}`}
                        aria-describedby={draftEditHintId(draft.id)}
                        onChange={(event) => setBody(event.currentTarget.value)}
                      />
                      <div className="draft-review-actions">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingId(null);
                            setBody("");
                          }}
                        >
                          Cancel
                        </button>
                        <button disabled={!body.trim()} type="submit">
                          Save
                        </button>
                      </div>
                    </form>
                  ) : (
                    <>
                      <p>{truncateCommentPreview(draft.body, 160)}</p>
                      {draft.anchor.canonical.quote ? (
                        <blockquote>
                          {truncateCommentPreview(
                            draft.anchor.canonical.quote,
                            120,
                          )}
                        </blockquote>
                      ) : null}
                      <div className="draft-review-actions">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingId(draft.id);
                            setBody(draft.body);
                          }}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => void onDeleteDraft?.(draft.id)}
                        >
                          Delete
                        </button>
                      </div>
                    </>
                  )}
                </article>
              ))}
            </div>
          ) : (
            <p
              className={`${styles.compactEmpty} ${sharedUiStyles.muted} muted compact-empty`}
            >
              No draft comments.
            </p>
          )}
        </div>
      ) : null}
    </aside>
  );
}

function draftCountLabel(count: number): string {
  if (count === 0) return "No unpublished comments";
  if (count === 1) return "1 unpublished comment";
  return `${count} unpublished comments`;
}

function draftReviewTabSummary(count: number): string {
  if (count === 0) return "no unpublished comments";
  const draftLabel =
    count === 1 ? "1 unpublished comment" : `${count} unpublished comments`;
  return `${draftLabel} kept private until publish`;
}

function publishActionState({
  draftCount,
  publishing,
  summary,
}: {
  draftCount: number;
  publishing: boolean;
  summary: ReturnType<typeof summarizeDraftReview>;
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
    description: `Publish ${draftCount} draft ${draftCount === 1 ? "comment" : "comments"} as ${summary.threadCount} open ${summary.threadCount === 1 ? "thread" : "threads"} across ${summary.fileCount} ${summary.fileCount === 1 ? "file" : "files"}`,
    disabled: false,
    label: "Publish review comments",
  };
}

function anchorSurfaceLabel(draft: DraftReviewComment): string {
  if (draft.anchor.surface === "diff") return "diff";
  if (draft.anchor.surface === "rendered") {
    return `${draft.anchor.rendered?.kind ?? draft.viewerKind} rendered`;
  }
  return "source";
}

function draftOpenLabel(draft: DraftReviewComment): string {
  return [
    `Open private draft in ${draft.path}`,
    anchorSurfaceLabel(draft),
    commentLineLabelForAnchor(draft.anchor.canonical),
    "kept private until publish",
  ].join(", ");
}

function draftEditHintId(id: string): string {
  return `draft-edit-hint-${id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

function summarizeDraftReview(drafts: DraftReviewComment[]): {
  fileCount: number;
  threadCount: number;
  surfaces: Array<{ label: string; count: number }>;
} {
  const paths = new Set<string>();
  const threads = new Set<string>();
  const surfaces = new Map<string, number>();
  for (const draft of drafts) {
    paths.add(draft.path);
    threads.add(
      draft.threadId ?? commentAnchorThreadKey(draft.path, draft.anchor),
    );
    const label = anchorSurfaceLabel(draft);
    surfaces.set(label, (surfaces.get(label) ?? 0) + 1);
  }
  return {
    fileCount: paths.size,
    threadCount: threads.size,
    surfaces: [...surfaces.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  };
}
