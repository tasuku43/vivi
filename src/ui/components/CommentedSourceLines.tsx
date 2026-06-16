import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import type { PathlensComment } from "../../domain/comments.js";
import { commentsForLine, rectLikeFromElement } from "../state/comments.js";

export function CommentedSourceLines({
  content,
  className,
  comments,
  activeCommentId,
  onOpenComment,
  onMouseUp,
  onKeyUp,
  containerRef: externalContainerRef,
}: {
  content: string;
  className?: string;
  comments: PathlensComment[];
  activeCommentId?: string | null;
  onOpenComment?: (id: string, rect: DOMRectLike) => void;
  onMouseUp?: () => void;
  onKeyUp?: () => void;
  containerRef?: RefObject<HTMLDivElement | null>;
}) {
  const internalContainerRef = useRef<HTMLDivElement | null>(null);
  const containerRef = externalContainerRef ?? internalContainerRef;
  const lines = content.split(/\r?\n/);

  useEffect(() => {
    if (!activeCommentId) return;
    const marker = containerRef.current?.querySelector<HTMLElement>(
      `[data-comment-id="${CSS.escape(activeCommentId)}"]`,
    );
    if (!marker) return;
    marker.scrollIntoView({ block: "center", behavior: "smooth" });
    window.requestAnimationFrame(() => {
      onOpenComment?.(activeCommentId, rectLikeFromElement(marker));
    });
  }, [activeCommentId, comments, onOpenComment]);

  return (
    <div
      ref={containerRef}
      className={`commented-source-lines ${className ?? ""}`}
      onMouseUp={onMouseUp}
      onKeyUp={onKeyUp}
      role="list"
    >
      {lines.map((line, index) => {
        const lineNumber = index + 1;
        const lineComments = commentsForLine(comments, lineNumber);
        const firstComment = lineComments[0];
        return (
          <div
            className={`commented-source-line${lineComments.length ? " has-comment" : ""}`}
            data-line={lineNumber}
            key={lineNumber}
            role="listitem"
            onClick={(event) => {
              if (!firstComment) return;
              onOpenComment?.(
                firstComment.id,
                rectLikeFromElement(event.currentTarget),
              );
            }}
          >
            <span className="commented-source-gutter">
              {firstComment ? (
                <button
                  className="comment-gutter-marker"
                  type="button"
                  aria-label={`Open comment on line ${lineNumber}`}
                  data-comment-id={firstComment.id}
                  onClick={(event) => {
                    event.stopPropagation();
                    onOpenComment?.(
                      firstComment.id,
                      rectLikeFromElement(event.currentTarget),
                    );
                  }}
                />
              ) : null}
              <span>{lineNumber}</span>
            </span>
            <code>{line || " "}</code>
          </div>
        );
      })}
    </div>
  );
}

export interface DOMRectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}
