import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { CommentDraft } from "../../../state/comments.js";
import { commentLineLabelForAnchor } from "../../../state/comments.js";
import { commentInputSessionId } from "../../../state/comment-input-session.js";
import { useCommentInputSessions } from "../CommentInputSessionProvider.js";
import styles from "./SelectionCommentComposer.module.css";

const composerWidth = 384;
const composerMargin = 12;

export function SelectionCommentComposer({
  draft,
  rect,
  onSave,
  onDismiss,
  restorePath,
  currentFileHash,
}: {
  draft: CommentDraft | null;
  rect: DOMRectLike | null;
  onSave?: (
    draft: CommentDraft,
    body: string,
    rect: DOMRectLike,
  ) => void | Promise<void>;
  onDismiss: () => void;
  restorePath?: string;
  currentFileHash?: string;
}) {
  const inputs = useCommentInputSessions();
  const restoredSession = [...inputs.sessions]
    .reverse()
    .find(
      (session) =>
        session.draft.path === restorePath &&
        session.rect &&
        session.status !== "collapsed",
    );
  const effectiveDraft = draft ?? restoredSession?.draft ?? null;
  const effectiveRect = rect ?? restoredSession?.rect ?? null;
  const inputId = effectiveDraft ? commentInputSessionId(effectiveDraft) : null;
  const inputSession = inputId
    ? inputs.sessions.find((session) => session.id === inputId)
    : undefined;
  const body = inputSession?.body ?? "";
  const stale = inputSession?.status === "stale";
  const [position, setPosition] = useState<{
    left: number;
    top: number;
    placement: "above" | "below" | "side";
    arrowLeft: number;
    arrowTop: number;
  } | null>(null);
  const composerRef = useRef<HTMLFormElement | null>(null);

  useEffect(() => {
    if (draft && rect) inputs.start(draft, rect);
  }, [draft, inputs.start, rect]);

  useEffect(() => {
    if (restorePath && currentFileHash) {
      inputs.markPathVersion(restorePath, currentFileHash);
    }
  }, [currentFileHash, inputs.markPathVersion, restorePath]);

  useLayoutEffect(() => {
    if (!effectiveDraft || !effectiveRect) return;
    const element = composerRef.current;
    const width = element?.offsetWidth || composerWidth;
    const height = element?.offsetHeight || 170;
    const prefersSide = effectiveDraft.anchor.surface === "rendered";
    const sideLeft = effectiveRect.left + effectiveRect.width + 16;
    if (prefersSide && sideLeft + width + composerMargin <= window.innerWidth) {
      const top = clamp(
        effectiveRect.top - 8,
        composerMargin,
        Math.max(composerMargin, window.innerHeight - height - composerMargin),
      );
      setPosition({
        left: sideLeft,
        top,
        placement: "side",
        arrowLeft: 0,
        arrowTop: clamp(effectiveRect.top - top + 18, 18, height - 18),
      });
      return;
    }
    const rawLeft = effectiveRect.left;
    const left = clamp(
      rawLeft,
      composerMargin,
      Math.max(composerMargin, window.innerWidth - width - composerMargin),
    );
    const belowTop = effectiveRect.top + effectiveRect.height + 10;
    const aboveTop = effectiveRect.top - height - 10;
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
        effectiveRect.left - left + Math.min(effectiveRect.width / 2, 28),
        18,
        width - 18,
      ),
      arrowTop: 24,
    });
  }, [body, effectiveDraft, effectiveRect]);

  if (!effectiveDraft || !effectiveRect || !onSave || !inputId) return null;
  const placement = position?.placement ?? "below";

  const save = () => {
    const trimmed = body.trim();
    if (!trimmed || stale) return;
    void Promise.resolve(onSave(effectiveDraft, trimmed, effectiveRect)).then(
      () => {
        inputs.discard(inputId);
        onDismiss();
      },
    );
  };

  const collapse = () => {
    inputs.collapse(inputId);
    onDismiss();
  };

  return (
    <form
      ref={composerRef}
      className={`${styles.composer} selection-comment-composer ${styles[placement]} ${placement}`}
      aria-label="New comment"
      style={
        {
          left: position?.left ?? effectiveRect.left,
          top: position?.top ?? effectiveRect.top + effectiveRect.height + 10,
          "--comment-arrow-left": `${position?.arrowLeft ?? 24}px`,
          "--comment-arrow-top": `${position?.arrowTop ?? 24}px`,
        } as CSSProperties
      }
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        collapse();
      }}
    >
      <div className={`${styles.meta} selection-comment-meta`}>
        <strong>{effectiveDraft.path}</strong>
        <span>
          {commentLineLabelForAnchor(effectiveDraft.anchor.canonical)}
        </span>
      </div>
      {stale ? (
        <div className={styles.stale} role="alert">
          <strong>File changed since this comment was started.</strong>
          <div>
            <button
              type="button"
              onClick={() =>
                inputs.reanchor(inputId, {
                  ...effectiveDraft,
                  anchor: {
                    ...effectiveDraft.anchor,
                    canonical: {
                      ...effectiveDraft.anchor.canonical,
                      fileHash: currentFileHash,
                    },
                  },
                })
              }
            >
              Re-anchor here
            </button>
            <button
              type="button"
              onClick={() => {
                inputs.discard(inputId);
                onDismiss();
              }}
            >
              Discard
            </button>
          </div>
        </div>
      ) : null}
      <textarea
        autoFocus
        value={body}
        disabled={stale}
        placeholder="Draft a review comment"
        onChange={(event) =>
          inputs.change(
            effectiveDraft,
            event.currentTarget.value,
            effectiveRect,
          )
        }
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
      <div className={`${styles.footer} selection-comment-footer`}>
        <span>Shift+Enter to save draft</span>
        <div>
          <button type="button" onClick={collapse}>
            Collapse
          </button>
          {inputSession && !stale ? (
            <button
              type="button"
              onClick={() => {
                inputs.discard(inputId);
                onDismiss();
              }}
            >
              Discard
            </button>
          ) : null}
          <button disabled={!body.trim() || stale} type="submit">
            Save draft
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
