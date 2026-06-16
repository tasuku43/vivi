import { useState } from "react";
import type { TextDiff } from "../../domain/change-review.js";
import type { PathlensComment } from "../../domain/comments.js";
import type { FilePayload } from "../../domain/fs-node.js";
import type { CommentCreateHandler } from "../state/comments.js";
import type { ResolvedTheme } from "../state/theme.js";
import { DiffViewer } from "./DiffViewer.js";

export function ImageViewer({
  file,
  theme = "dark",
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
  diff?: TextDiff | null;
  diffLoading?: boolean;
  diffEnabled?: boolean;
  diffFocusChanges?: boolean;
  onDiffToggle?: () => void;
  onDiffFocusChange?: (focusChanges: boolean) => void;
  onCreateComment?: CommentCreateHandler;
  comments?: PathlensComment[];
  activeCommentId?: string | null;
  onOpenComment?: (id: string, rect: DOMRectLike) => void;
}) {
  const [fit, setFit] = useState<"fit" | "actual">("fit");
  const src =
    file.encoding === "base64" && file.mimeType
      ? `data:${file.mimeType};base64,${file.content}`
      : "";
  if (!src) {
    return (
      <div className="unsupported">
        <h2>{file.path}</h2>
        <p>This image could not be previewed.</p>
      </div>
    );
  }
  return (
    <section className="image-viewer">
      <div className="viewer-toolbar">
        <strong>{file.path}</strong>
        <span>
          {formatBytes(file.size)}
          {file.mimeType === "image/svg+xml"
            ? " · SVG as image, scripts inactive"
            : ""}
        </span>
        <button
          aria-pressed={Boolean(diffEnabled)}
          className={`diff-toggle${diffEnabled ? " active" : ""}`}
          type="button"
          onClick={onDiffToggle}
        >
          Diff from HEAD
        </button>
        <div className="segmented-control" aria-label="Image size mode">
          <button
            className={fit === "fit" ? "active" : ""}
            type="button"
            onClick={() => setFit("fit")}
          >
            Fit
          </button>
          <button
            className={fit === "actual" ? "active" : ""}
            type="button"
            onClick={() => setFit("actual")}
          >
            Actual
          </button>
        </div>
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
        <div
          className={fit === "fit" ? "image-stage fit" : "image-stage actual"}
        >
          <img className="image-preview" src={src} alt={file.path} />
        </div>
      )}
    </section>
  );
}

interface DOMRectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}
