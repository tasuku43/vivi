import { useState } from "react";
import type { TextDiff } from "../../../domain/change-review.js";
import type { ViviComment } from "../../../domain/comments.js";
import type { FilePayload } from "../../../domain/fs-node.js";
import type { CommentCreateHandler } from "../../../state/comments.js";
import type { ResolvedTheme } from "../../../state/theme.js";
import {
  DiffToggleButton,
  ViewerToolbar,
  ViewerModeButton,
} from "../components/ViewerControlButton.js";
import { DiffViewer } from "./DiffViewer.js";

export function ImageViewer({
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
      <ViewerToolbar
        status={
          <>
            {formatBytes(file.size)}
            {file.mimeType === "image/svg+xml"
              ? " · SVG as image, scripts inactive"
              : ""}
          </>
        }
      >
        <div className="segmented-control" aria-label="Image size mode">
          <ViewerModeButton
            active={fit === "fit"}
            mode="fit"
            path={file.path}
            onClick={() => setFit("fit")}
          >
            Fit
          </ViewerModeButton>
          <ViewerModeButton
            active={fit === "actual"}
            mode="actual"
            path={file.path}
            onClick={() => setFit("actual")}
          >
            Actual
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
