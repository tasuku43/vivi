import { useEffect, useId, useRef, useState } from "react";
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
import {
  mermaidRenderId,
  renderMermaidSvg,
  slugForMarker,
} from "../rendering/mermaid-rendering.js";
import {
  DiffToggleButton,
  ViewerToolbar,
  ViewerModeButton,
} from "../components/ViewerControlButton.js";
import { DiffViewer } from "./DiffViewer.js";

export { hasCustomMermaidStyle } from "../../../domain/mermaid-preview.js";
export {
  renderMermaidBlocks,
  renderMermaidSvg,
} from "../rendering/mermaid-rendering.js";

type MermaidRenderStatus = "loading" | "rendered" | "fallback" | "error";

export function MermaidViewer({
  file,
  theme = "dark",
  diff,
  diffLoading,
  diffEnabled,
  onDiffToggle,
  onCreateComment,
  comments = [],
  activeCommentId,
  onOpenComment,
}: {
  file: FilePayload;
  theme?: ResolvedTheme;
  diff?: TextDiff | null;
  diffLoading?: boolean;
  diffEnabled?: boolean;
  onDiffToggle?: () => void;
  onCreateComment?: CommentCreateHandler;
  comments?: ViviComment[];
  activeCommentId?: string | null;
  onOpenComment?: (id: string, rect: DOMRectLike) => void;
}) {
  const [mode, setMode] = useState<"preview" | "source">("preview");
  const [selectionComment, setSelectionComment] = useState<{
    draft: CommentDraft;
    rect: DOMRectLike;
  } | null>(null);
  const sourceRef = useRef<HTMLDivElement | null>(null);
  const { containerRef, error, status } = useMermaidRender(
    file.content,
    `${useId()}-${slugForMarker(file.path)}`,
    theme,
  );
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
    <section className="mermaid-viewer">
      <ViewerToolbar status="Mermaid preview · strict security">
        <div className="segmented-control" aria-label="Mermaid view mode">
          <ViewerModeButton
            active={mode === "preview"}
            mode="preview"
            path={file.path}
            onClick={() => setMode("preview")}
          >
            Preview
          </ViewerModeButton>
          <ViewerModeButton
            active={mode === "source"}
            mode="source"
            path={file.path}
            onClick={() => setMode("source")}
          >
            Source
          </ViewerModeButton>
        </div>
        <DiffToggleButton
          enabled={diffEnabled}
          path={file.path}
          onToggle={onDiffToggle}
        />
      </ViewerToolbar>
      {diffEnabled ? (
        <DiffViewer
          path={file.path}
          diff={diff ?? null}
          loading={diffLoading}
          renderKind="source"
          theme={theme}
          file={file}
          onCreateComment={onCreateComment}
          comments={comments}
          activeCommentId={activeCommentId}
          onOpenComment={onOpenComment}
        />
      ) : mode === "preview" ? (
        <div className="mermaid-render-surface">
          <div
            className={`mermaid-render-target ${status}`}
            ref={containerRef}
          />
          {status === "loading" ? (
            <p className="muted">Rendering Mermaid diagram...</p>
          ) : null}
          {status === "error" ? (
            <div className="unsupported">
              <h2>{file.path}</h2>
              <p>{error ?? "Mermaid could not render this diagram."}</p>
            </div>
          ) : null}
          {status === "fallback" ? (
            <div className="unsupported">
              <h2>{file.path}</h2>
              <p>
                Mermaid could not render this diagram. The source view is still
                available.
              </p>
            </div>
          ) : null}
        </div>
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

export function useMermaidRender(
  source: string,
  id: string,
  theme: ResolvedTheme,
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<MermaidRenderStatus>("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;
    if (!container) return;

    setStatus("loading");
    setError(null);
    container.replaceChildren();

    renderMermaidSvg(source, mermaidRenderId(id, source), theme)
      .then((svg) => {
        if (cancelled) return;
        container.innerHTML = svg;
        setStatus("rendered");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(errorMessage(err));
        setStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [id, source, theme]);

  return { containerRef, error, status };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return "Mermaid could not render this diagram.";
}
