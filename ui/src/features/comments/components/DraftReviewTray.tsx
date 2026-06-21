import { useEffect, useState } from "react";
import type { DraftReviewComment } from "../../../domain/comments.js";
import {
  commentLineLabelForAnchor,
  truncateCommentPreview,
} from "../../../state/comments.js";

export function DraftReviewTray({
  drafts,
  publishing = false,
  onOpenPath,
  onUpdateDraft,
  onDeleteDraft,
  onPublishAll,
}: {
  drafts: DraftReviewComment[];
  publishing?: boolean;
  onOpenPath?: (path: string) => void;
  onUpdateDraft?: (id: string, body: string) => void | Promise<void>;
  onDeleteDraft?: (id: string) => void | Promise<void>;
  onPublishAll?: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(() => drafts.length > 0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [body, setBody] = useState("");

  useEffect(() => {
    if (drafts.length) setOpen(true);
    else setOpen(false);
    if (editingId && !drafts.some((draft) => draft.id === editingId)) {
      setEditingId(null);
      setBody("");
    }
  }, [drafts, editingId]);

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
              <p>{drafts.length} unpublished comments</p>
            </div>
            <button
              type="button"
              disabled={!drafts.length || publishing}
              onClick={() => void onPublishAll?.()}
            >
              {publishing ? "Publishing..." : "Publish all"}
            </button>
          </div>
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
                    <span>{commentLineLabelForAnchor(draft.anchor.canonical)}</span>
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
