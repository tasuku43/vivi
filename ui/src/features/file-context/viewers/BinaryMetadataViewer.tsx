import type { TextDiff } from "../../../domain/change-review.js";
import type { ViviComment } from "../../../domain/comments.js";
import type { FilePayload } from "../../../domain/fs-node.js";
import type { CommentCreateHandler } from "../../../state/comments.js";
import type { ResolvedTheme } from "../../../state/theme.js";
import { DiffViewer } from "./DiffViewer.js";

export function BinaryMetadataViewer({
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
  return (
    <section className="binary-metadata-viewer">
      <div className="viewer-toolbar">
        <div>
          <strong>{file.path}</strong>
          <small>{metadataSummary(file)}</small>
        </div>
        <div className="viewer-toolbar-actions">
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
          renderKind="source"
          theme={theme}
          onCreateComment={onCreateComment}
          file={file}
          comments={comments}
          activeCommentId={activeCommentId}
          onOpenComment={onOpenComment}
        />
      ) : (
        <div className="binary-metadata-panel">
          <p>
            Vivi did not load file contents for this payload. Metadata is shown
            so review can continue without decoding binary or unsafe bytes.
          </p>
          <dl>
            <div>
              <dt>Type</dt>
              <dd>{file.viewerKind}</dd>
            </div>
            <div>
              <dt>MIME</dt>
              <dd>{file.mimeType ?? "unknown"}</dd>
            </div>
            <div>
              <dt>Size</dt>
              <dd>{formatBytes(file.size)}</dd>
            </div>
            <div>
              <dt>Encoding</dt>
              <dd>{file.encoding}</dd>
            </div>
            <div>
              <dt>ETag</dt>
              <dd>{file.etag}</dd>
            </div>
            <div>
              <dt>Modified</dt>
              <dd>{formatDate(file.mtimeMs)}</dd>
            </div>
            {file.truncated ? (
              <div>
                <dt>Preview limit</dt>
                <dd>{formatBytes(file.maxSizeBytes ?? 0)}</dd>
              </div>
            ) : null}
          </dl>
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

function metadataSummary(file: FilePayload): string {
  if (file.truncated) {
    return `metadata only · ${formatBytes(file.size)} exceeds ${formatBytes(
      file.maxSizeBytes ?? 0,
    )}`;
  }
  return `metadata only · ${formatBytes(file.size)}`;
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(mtimeMs: number): string {
  if (!Number.isFinite(mtimeMs) || mtimeMs <= 0) return "unknown";
  return new Date(mtimeMs).toLocaleString();
}
