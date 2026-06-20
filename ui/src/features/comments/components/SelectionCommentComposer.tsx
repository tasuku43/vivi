import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { CommentDraft } from "../../../state/comments.js";
import { commentLineLabelForAnchor } from "../../../state/comments.js";

const composerWidth = 384;
const composerMargin = 12;

export function SelectionCommentComposer({
  draft,
  rect,
  onSave,
  onDismiss,
}: {
  draft: CommentDraft | null;
  rect: DOMRectLike | null;
  onSave?: (
    draft: CommentDraft,
    body: string,
    rect: DOMRectLike,
  ) => void | Promise<void>;
  onDismiss: () => void;
}) {
  const [body, setBody] = useState("");
  const [position, setPosition] = useState<{
    left: number;
    top: number;
    placement: "above" | "below" | "side";
    arrowLeft: number;
    arrowTop: number;
  } | null>(null);
  const composerRef = useRef<HTMLFormElement | null>(null);

  useEffect(() => {
    setBody("");
  }, [draft]);

  useLayoutEffect(() => {
    if (!draft || !rect) return;
    const element = composerRef.current;
    const width = element?.offsetWidth || composerWidth;
    const height = element?.offsetHeight || 170;
    const prefersSide = draft.anchor.surface === "rendered";
    const sideLeft = rect.left + rect.width + 16;
    if (prefersSide && sideLeft + width + composerMargin <= window.innerWidth) {
      const top = clamp(
        rect.top - 8,
        composerMargin,
        Math.max(composerMargin, window.innerHeight - height - composerMargin),
      );
      setPosition({
        left: sideLeft,
        top,
        placement: "side",
        arrowLeft: 0,
        arrowTop: clamp(rect.top - top + 18, 18, height - 18),
      });
      return;
    }
    const rawLeft = rect.left;
    const left = clamp(
      rawLeft,
      composerMargin,
      Math.max(composerMargin, window.innerWidth - width - composerMargin),
    );
    const belowTop = rect.top + rect.height + 10;
    const aboveTop = rect.top - height - 10;
    const placement =
      belowTop + height + composerMargin <= window.innerHeight ||
      aboveTop < composerMargin
        ? "below"
        : "above";
    const top =
      placement === "below"
        ? clamp(
            belowTop,
            composerMargin,
            Math.max(
              composerMargin,
              window.innerHeight - height - composerMargin,
            ),
          )
        : clamp(
            aboveTop,
            composerMargin,
            Math.max(
              composerMargin,
              window.innerHeight - height - composerMargin,
            ),
          );
    setPosition({
      left,
      top,
      placement,
      arrowLeft: clamp(
        rect.left - left + Math.min(rect.width / 2, 28),
        18,
        width - 18,
      ),
      arrowTop: 24,
    });
  }, [draft, rect, body]);

  useEffect(() => {
    if (!draft) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && composerRef.current?.contains(target)) return;
      onDismiss();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDismiss();
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [draft, onDismiss]);

  if (!draft || !rect || !onSave) return null;

  const save = () => {
    const trimmed = body.trim();
    if (!trimmed || !rect) return;
    void Promise.resolve(onSave(draft, trimmed, rect)).then(onDismiss);
  };

  return (
    <form
      ref={composerRef}
      className={`selection-comment-composer ${position?.placement ?? "below"}`}
      aria-label="New comment"
      style={
        {
          left: position?.left ?? rect.left,
          top: position?.top ?? rect.top + rect.height + 10,
          "--comment-arrow-left": `${position?.arrowLeft ?? 24}px`,
          "--comment-arrow-top": `${position?.arrowTop ?? 24}px`,
        } as CSSProperties
      }
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <div className="selection-comment-meta">
        <strong>{draft.path}</strong>
        <span>{commentLineLabelForAnchor(draft.anchor.canonical)}</span>
      </div>
      <textarea
        autoFocus
        value={body}
        placeholder="Leave a comment"
        onChange={(event) => setBody(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (
            event.key === "Enter" &&
            (event.shiftKey || event.metaKey || event.ctrlKey)
          ) {
            event.preventDefault();
            save();
          }
        }}
      />
      <div className="selection-comment-footer">
        <span>Shift+Enter to save</span>
        <div>
          <button type="button" onClick={onDismiss}>
            Cancel
          </button>
          <button disabled={!body.trim()} type="submit">
            Save
          </button>
        </div>
      </div>
    </form>
  );
}

export interface DOMRectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
