import { useEffect, useState } from "react";
import type { DraftReviewComment } from "../../../domain/comments.js";
import {
  commentLineLabelForAnchor,
  truncateCommentPreview,
} from "../../../state/comments.js";

export function DraftReviewTray({
  drafts,
  initialOpen = false,
  initialEditingDraftId = null,
  publishing = false,
  publishError = null,
  publishedBatchId = null,
  onOpenPath,
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
  onOpenPath?: (path: string) => void;
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

  return (
    <aside
      className={`draft-review-tray${open ? " open" : ""}`}
      aria-label="Draft review tray"
    >
      <button
        className={`draft-review-tab${drafts.length ? "" : " empty"}`}
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        Drafts <strong>{drafts.length}</strong>
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
              disabled={!drafts.length || publishing}
              onClick={() => void onPublishAll?.()}
            >
              {publishing ? "Publishing..." : "Publish review comments"}
            </button>
          </div>
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
                    onClick={() => onOpenPath?.(draft.path)}
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
                      <textarea
                        autoFocus
                        value={body}
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
            <p className="muted compact-empty">No draft comments.</p>
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

function anchorSurfaceLabel(draft: DraftReviewComment): string {
  if (draft.anchor.surface === "diff") return "diff";
  if (draft.anchor.surface === "rendered") {
    return `${draft.anchor.rendered?.kind ?? draft.viewerKind} rendered`;
  }
  return "source";
}
