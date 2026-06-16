import { useRef, useState } from "react";
import type { TextDiff } from "../../domain/change-review.js";
import type { FilePayload } from "../../domain/fs-node.js";
import {
  lineRangeForQuote,
  scheduleSelectionCommentUpdate,
  selectionCommentTargetInElement,
  sourceCommentDraft,
  type CommentDraft,
} from "../state/comments.js";
import type { ResolvedTheme } from "../state/theme.js";
import { SelectionCommentPopover } from "../components/SelectionCommentPopover.js";
import { DiffViewer } from "./DiffViewer.js";

export function TextViewer({
  file,
  theme = "dark",
  diff,
  diffLoading,
  diffEnabled,
  diffFocusChanges,
  onDiffToggle,
  onDiffFocusChange,
  onCreateComment,
}: {
  file: FilePayload;
  theme?: ResolvedTheme;
  diff?: TextDiff | null;
  diffLoading?: boolean;
  diffEnabled?: boolean;
  diffFocusChanges?: boolean;
  onDiffToggle?: () => void;
  onDiffFocusChange?: (focusChanges: boolean) => void;
  onCreateComment?: (draft: CommentDraft) => void;
}) {
  const [wrap, setWrap] = useState(true);
  const [selectionComment, setSelectionComment] = useState<{
    draft: CommentDraft;
    left: number;
    top: number;
  } | null>(null);
  const sourceRef = useRef<HTMLPreElement | null>(null);
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
      left: selection.rect.left + selection.rect.width / 2,
      top: selection.rect.top,
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
        />
      ) : (
        <pre
          className={wrap ? "plain-text wrap" : "plain-text no-wrap"}
          ref={sourceRef}
          onMouseUp={() =>
            scheduleSelectionCommentUpdate(updateSelectionComment)
          }
          onKeyUp={updateSelectionComment}
        >
          {file.content}
        </pre>
      )}
      <SelectionCommentPopover
        draft={selectionComment?.draft ?? null}
        left={selectionComment?.left ?? 0}
        top={selectionComment?.top ?? 0}
        onCreateComment={onCreateComment}
        onDismiss={() => setSelectionComment(null)}
      />
    </section>
  );
}
