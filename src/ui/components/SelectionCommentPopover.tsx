import type { CommentDraft } from "../state/comments.js";

export function SelectionCommentPopover({
  draft,
  left,
  top,
  onCreateComment,
  onDismiss,
}: {
  draft: CommentDraft | null;
  left: number;
  top: number;
  onCreateComment?: (draft: CommentDraft) => void;
  onDismiss: () => void;
}) {
  if (!draft || !onCreateComment) return null;
  return (
    <div
      className="selection-comment-popover"
      style={{ left, top }}
      role="dialog"
      aria-label="Selection comment action"
    >
      <button
        type="button"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          onCreateComment(draft);
          onDismiss();
        }}
      >
        Comment
      </button>
    </div>
  );
}
