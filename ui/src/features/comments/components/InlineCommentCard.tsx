import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { CommentStatus, ViviComment } from "../../../domain/comments.js";
import {
  commentLineLabel,
  statusLabel,
  truncateCommentPreview,
} from "../../../state/comments.js";
import { CommentStatusBadge } from "./CommentStatusBadge.js";
import styles from "./InlineCommentCard.module.css";

export function InlineCommentCard({
  comment,
  rect,
  onClose,
  onStatusChange,
}: {
  comment: ViviComment | null;
  rect: DOMRectLike | null;
  onClose: () => void;
  onStatusChange?: (id: string, status: CommentStatus) => void;
}) {
  const cardRef = useRef<HTMLElement | null>(null);
  const [position, setPosition] = useState<InlineCommentCardPosition | null>(
    null,
  );

  useLayoutEffect(() => {
    if (!comment || !rect) return;
    const update = () => {
      const card = cardRef.current;
      setPosition(
        positionInlineCommentCard(
          rect,
          { width: window.innerWidth, height: window.innerHeight },
          {
            width: card?.offsetWidth || 340,
            height: card?.offsetHeight || 220,
          },
        ),
      );
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [comment, rect]);

  useEffect(() => {
    if (!comment) return;
    const onClick = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (target && cardRef.current?.contains(target)) return;
      if (isTopbarTarget(target)) return;
      onClose();
    };
    window.addEventListener("click", onClick);
    return () => window.removeEventListener("click", onClick);
  }, [comment, rect, onClose]);

  if (!comment || !rect) return null;
  const fallback = positionInlineCommentCard(
    rect,
    { width: window.innerWidth, height: window.innerHeight },
    { width: 340, height: 220 },
  );
  const placed = position ?? fallback;
  const arrowClass = arrowClassNames[placed.arrow];

  return (
    <article
      ref={cardRef}
      className={`${styles.card} ${arrowClass} inline-comment-card points-${placed.arrow}`}
      style={
        {
          left: placed.left,
          top: placed.top,
          "--comment-card-arrow-x": `${placed.arrowX}px`,
          "--comment-card-arrow-y": `${placed.arrowY}px`,
          maxHeight: placed.maxHeight,
        } as CSSProperties
      }
      aria-label="Comment"
      tabIndex={-1}
    >
      <div className={`${styles.top} inline-comment-top`}>
        <div className={styles.topContent}>
          <strong className={styles.path}>{comment.path}</strong>
          <span className={styles.lineLabel}>{commentLineLabel(comment)}</span>
        </div>
        <button
          className={styles.closeButton}
          type="button"
          aria-label="Close comment"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <CommentStatusBadge status={comment.status}>
        {statusLabel(comment.status)}
      </CommentStatusBadge>
      <p className={styles.body}>{comment.body}</p>
      {comment.anchor.canonical.quote ? (
        <blockquote className={styles.quote}>
          {truncateCommentPreview(comment.anchor.canonical.quote, 180)}
        </blockquote>
      ) : null}
      <div className={`${styles.actions} inline-comment-actions`}>
        <button
          disabled={comment.status === "open"}
          type="button"
          onClick={() => onStatusChange?.(comment.id, "open")}
        >
          Open
        </button>
        <button
          disabled={comment.status === "resolved"}
          type="button"
          onClick={() => onStatusChange?.(comment.id, "resolved")}
        >
          Resolve
        </button>
        <button
          disabled={comment.status === "archived"}
          type="button"
          onClick={() => onStatusChange?.(comment.id, "archived")}
        >
          Archive
        </button>
      </div>
    </article>
  );
}

const arrowClassNames: Record<InlineCommentCardPosition["arrow"], string> = {
  left: styles.pointsLeft,
  right: styles.pointsRight,
  top: styles.pointsTop,
  bottom: styles.pointsBottom,
};

function isTopbarTarget(target: Node | null): boolean {
  return target instanceof Element && Boolean(target.closest(".topbar"));
}

export interface DOMRectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface InlineCommentCardPosition {
  left: number;
  top: number;
  arrow: "left" | "right" | "top" | "bottom";
  arrowX: number;
  arrowY: number;
  maxHeight?: number;
}

export function positionInlineCommentCard(
  rect: DOMRectLike,
  viewport: { width: number; height: number },
  card: { width: number; height: number },
): InlineCommentCardPosition {
  const margin = 12;
  const gap = 12;
  const rightLeft = rect.left + rect.width + gap;
  const sideTop = clamp(
    rect.top - 10,
    margin,
    Math.max(margin, viewport.height - card.height - margin),
  );
  const arrowY = clamp(
    rect.top + Math.min(rect.height / 2, 28) - sideTop,
    18,
    Math.max(18, card.height - 18),
  );
  if (rightLeft + card.width + margin <= viewport.width) {
    return {
      left: rightLeft,
      top: sideTop,
      arrow: "left",
      arrowX: 24,
      arrowY,
    };
  }

  const leftLeft = rect.left - card.width - gap;
  if (leftLeft >= margin) {
    return {
      left: leftLeft,
      top: sideTop,
      arrow: "right",
      arrowX: card.width - 24,
      arrowY,
    };
  }

  const left = clamp(
    rect.left,
    margin,
    Math.max(margin, viewport.width - card.width - margin),
  );
  const arrowX = clamp(
    rect.left + Math.min(rect.width / 2, 28) - left,
    18,
    Math.max(18, card.width - 18),
  );
  const belowTop = rect.top + rect.height + gap;
  const belowHeight = viewport.height - belowTop - margin;
  if (belowHeight >= Math.min(card.height, 120)) {
    return {
      left,
      top: belowTop,
      arrow: "top",
      arrowX,
      arrowY: 24,
      maxHeight: Math.min(card.height, belowHeight),
    };
  }

  return {
    left,
    top: clamp(
      rect.top - card.height - gap,
      margin,
      Math.max(margin, viewport.height - card.height - margin),
    ),
    arrow: "bottom",
    arrowX,
    arrowY: card.height - 24,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
