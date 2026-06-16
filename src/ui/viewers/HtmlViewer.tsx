import { useEffect, useRef, useState } from "react";
import type { TextDiff } from "../../domain/change-review.js";
import type { PathlensComment } from "../../domain/comments.js";
import type { FilePayload } from "../../domain/fs-node.js";
import {
  lineRangeForQuote,
  renderedCommentDraft,
  scheduleSelectionCommentUpdate,
  selectionCommentTargetInElement,
  sourceCommentDraft,
  type CommentCreateHandler,
  type CommentDraft,
} from "../state/comments.js";
import type { ResolvedTheme } from "../state/theme.js";
import type { ViewerMode } from "../state/viewer-mode.js";
import { CommentedSourceLines } from "../components/CommentedSourceLines.js";
import { SelectionCommentComposer } from "../components/SelectionCommentComposer.js";
import { DiffViewer } from "./DiffViewer.js";

export function HtmlViewer({
  file,
  allowHtmlScripts,
  mode: controlledMode,
  diff,
  diffLoading,
  diffEnabled,
  diffFocusChanges,
  theme = "dark",
  onModeChange,
  onDiffToggle,
  onDiffFocusChange,
  onCreateComment,
  comments = [],
  activeCommentId,
  onOpenComment,
}: {
  file: FilePayload;
  allowHtmlScripts: boolean;
  mode?: ViewerMode;
  diff?: TextDiff | null;
  diffLoading?: boolean;
  diffEnabled?: boolean;
  diffFocusChanges?: boolean;
  theme?: ResolvedTheme;
  onModeChange?: (mode: ViewerMode) => void;
  onDiffToggle?: () => void;
  onDiffFocusChange?: (focusChanges: boolean) => void;
  onCreateComment?: CommentCreateHandler;
  comments?: PathlensComment[];
  activeCommentId?: string | null;
  onOpenComment?: (id: string, rect: DOMRectLike) => void;
}) {
  const [localMode, setLocalMode] = useState<ViewerMode>("preview");
  const [selectionComment, setSelectionComment] = useState<{
    draft: CommentDraft;
    rect: DOMRectLike;
  } | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const sourceRef = useRef<HTMLDivElement | null>(null);
  const mode =
    controlledMode === "source" || controlledMode === "preview"
      ? controlledMode
      : localMode;
  const setMode = (nextMode: ViewerMode) => {
    setSelectionComment(null);
    setLocalMode(nextMode);
    onModeChange?.(nextMode);
  };
  useEffect(() => {
    setSelectionComment(null);
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data as {
        type?: string;
        path?: string;
        text?: string;
        selector?: string;
        rect?: { left: number; top: number; width: number; height: number };
      } | null;
      if (
        data?.type !== "pathlens-html-selection" ||
        data.path !== file.path ||
        typeof data.text !== "string"
      ) {
        return;
      }
      const text = data.text.trim();
      const iframeRect = iframeRef.current?.getBoundingClientRect();
      if (!text || !data.rect || !iframeRect) {
        setSelectionComment(null);
        return;
      }
      const range = lineRangeForQuote(file.content, text);
      setSelectionComment({
        draft: renderedCommentDraft(file, "html", {
          text,
          selector: data.selector,
          sourceLineStart: range?.start,
          sourceLineEnd: range?.end,
        }),
        rect: {
          left: iframeRect.left + data.rect.left,
          top: iframeRect.top + data.rect.top,
          width: data.rect.width,
          height: data.rect.height,
        },
      });
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [file.content, file.path]);

  const updateSourceSelectionComment = () => {
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
    <section className="html-viewer">
      <div className="viewer-toolbar">
        <strong>{file.path}</strong>
        <span className="sandbox-status">
          sandboxed · scripts {allowHtmlScripts ? "on" : "off"}
        </span>
        <div className="viewer-toolbar-actions">
          <div className="segmented-control" aria-label="HTML view mode">
            <button
              className={mode === "preview" ? "active" : ""}
              type="button"
              onClick={() => setMode("preview")}
            >
              Preview
            </button>
            <button
              className={mode === "source" ? "active" : ""}
              type="button"
              onClick={() => setMode("source")}
            >
              Source
            </button>
          </div>
          <button
            aria-pressed={Boolean(diffEnabled)}
            className={`diff-toggle${diffEnabled ? " active" : ""}`}
            type="button"
            onClick={onDiffToggle}
          >
            Diff from HEAD
          </button>
        </div>
      </div>
      {diffEnabled ? (
        <DiffViewer
          path={file.path}
          diff={diff ?? null}
          loading={diffLoading}
          focusChanges={diffFocusChanges}
          renderKind={mode === "source" ? "source" : "html"}
          theme={theme}
          onFocusChangesChange={onDiffFocusChange}
          onCreateComment={onCreateComment}
          file={file}
          comments={comments}
          activeCommentId={activeCommentId}
          onOpenComment={onOpenComment}
        />
      ) : mode === "preview" ? (
        <iframe
          ref={iframeRef}
          className="html-frame"
          key={file.etag}
          title={file.path}
          sandbox={
            allowHtmlScripts
              ? "allow-scripts allow-same-origin"
              : "allow-scripts"
          }
          src={`/preview/html?path=${encodeURIComponent(file.path)}&theme=${theme}&v=${encodeURIComponent(file.etag)}`}
        />
      ) : (
        <CommentedSourceLines
          content={file.content}
          className="markdown-source"
          containerRef={sourceRef}
          comments={comments}
          activeCommentId={activeCommentId}
          onOpenComment={onOpenComment}
          onMouseUp={() =>
            scheduleSelectionCommentUpdate(updateSourceSelectionComment)
          }
          onKeyUp={updateSourceSelectionComment}
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
