import { useRef, useState } from "react";
import type { TextDiff } from "../../../domain/change-review.js";
import type { ViviComment } from "../../../domain/comments.js";
import type { FilePayload } from "../../../domain/fs-node.js";
import {
  lineRangeForQuote,
  scheduleSelectionCommentUpdate,
  selectionCommentTargetInElement,
  sourceCommentDraft,
  type CommentCreateHandler,
  type CommentDraft,
} from "../../../state/comments.js";
import type { ResolvedTheme } from "../../../state/theme.js";
import { CommentedSourceLines } from "../../comments/components/CommentedSourceLines.js";
import { SelectionCommentComposer } from "../../comments/components/SelectionCommentComposer.js";
import { DiffViewer } from "./DiffViewer.js";

export function TextViewer({
  file,
  theme = "dark",
  focusLineNumber,
  focusRevision,
  diff,
  diffLoading,
  diffEnabled,
  diffFocusChanges,
  onDiffToggle,
  onDiffFocusChange,
  onCreateComment,
  comments = [],
  activeCommentId,
  onOpenComment,
}: {
  file: FilePayload;
  theme?: ResolvedTheme;
  focusLineNumber?: number | null;
  focusRevision?: number;
  diff?: TextDiff | null;
  diffLoading?: boolean;
  diffEnabled?: boolean;
  diffFocusChanges?: boolean;
  onDiffToggle?: () => void;
  onDiffFocusChange?: (focusChanges: boolean) => void;
  onCreateComment?: CommentCreateHandler;
  comments?: ViviComment[];
  activeCommentId?: string | null;
  onOpenComment?: (id: string, rect: DOMRectLike) => void;
}) {
  const [wrap, setWrap] = useState(true);
  const [selectionComment, setSelectionComment] = useState<{
    draft: CommentDraft;
    rect: DOMRectLike;
  } | null>(null);
  const sourceRef = useRef<HTMLDivElement | null>(null);
  const updateSelectionComment = () => {
    const selection = selectionCommentTargetInElement(sourceRef.current);
    if (!selection) {
      setSelectionComment(null);
      return;
    }
    setSelectionComment({
      draft: sourceCommentDraft(
        file,
        lineRangeForQuote(file.content, selection.text),
        selection.text,
      ),
      rect: selection.rect,
    });
  };
  return (
    <section className="text-viewer">
      <div className="text-toolbar">
        <strong>{file.path}</strong>
        <button
          aria-pressed={Boolean(diffEnabled)}
          className={`diff-toggle${diffEnabled ? " active" : ""}`}
          type="button"
          onClick={onDiffToggle}
        >
          Diff from HEAD
        </button>
        <button type="button" onClick={() => setWrap((value) => !value)}>
          {wrap ? "No wrap" : "Wrap"}
        </button>
      </div>
      {diffEnabled ? (
        <DiffViewer
          path={file.path}
          diff={diff ?? null}
          loading={diffLoading}
          focusChanges={diffFocusChanges}
          renderKind="source"
          theme={theme}
          onFocusChangesChange={onDiffFocusChange}
          file={file}
          onCreateComment={onCreateComment}
          comments={comments}
          activeCommentId={activeCommentId}
          onOpenComment={onOpenComment}
        />
      ) : (
        <CommentedSourceLines
          content={file.content}
          className={wrap ? "plain-text wrap" : "plain-text no-wrap"}
          containerRef={sourceRef}
          focusLineNumber={focusLineNumber}
          focusRevision={focusRevision}
          comments={comments}
          activeCommentId={activeCommentId}
          onOpenComment={onOpenComment}
          onMouseUp={() =>
            scheduleSelectionCommentUpdate(updateSelectionComment)
          }
          onKeyUp={updateSelectionComment}
        />
      )}
      <SelectionCommentComposer
        draft={selectionComment?.draft ?? null}
        rect={selectionComment?.rect ?? null}
        onSave={onCreateComment}
        onDismiss={() => setSelectionComment(null)}
      />
    </section>
  );
}

interface DOMRectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}
