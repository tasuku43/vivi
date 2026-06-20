import { lazy, Suspense } from "react";
import type { ReactNode } from "react";
import type { TextDiff } from "../../../domain/change-review.js";
import type { ViviComment } from "../../../domain/comments.js";
import type { FilePayload } from "../../../domain/fs-node.js";
import { CsvViewer, isDelimitedPath } from "../viewers/CsvViewer.js";
import { DiffViewer } from "../viewers/DiffViewer.js";
import { LargeTextPreview } from "../viewers/LargeTextPreview.js";
import type { LineRange } from "../../../state/code-viewer.js";
import type {
  CommentCreateHandler,
  CommentStatusChangeHandler,
} from "../../../state/comments.js";
import type { ResolvedTheme } from "../../../state/theme.js";
import type { ViewerMode } from "../../../state/viewer-mode.js";

const MarkdownViewer = lazy(() =>
  import("../viewers/MarkdownViewer.js").then((module) => ({
    default: module.MarkdownViewer,
  })),
);
const HtmlViewer = lazy(() =>
  import("../viewers/HtmlViewer.js").then((module) => ({
    default: module.HtmlViewer,
  })),
);
const CodeViewer = lazy(() =>
  import("../viewers/CodeViewer.js").then((module) => ({
    default: module.CodeViewer,
  })),
);
const ImageViewer = lazy(() =>
  import("../viewers/ImageViewer.js").then((module) => ({
    default: module.ImageViewer,
  })),
);
const JsonViewer = lazy(() =>
  import("../viewers/JsonViewer.js").then((module) => ({
    default: module.JsonViewer,
  })),
);
const MermaidViewer = lazy(() =>
  import("../viewers/MermaidViewer.js").then((module) => ({
    default: module.MermaidViewer,
  })),
);
const TextViewer = lazy(() =>
  import("../viewers/TextViewer.js").then((module) => ({
    default: module.TextViewer,
  })),
);

export function FileViewer({
  file,
  removed = false,
  allowHtmlScripts,
  theme,
  selectedCodeRange,
  viewerMode,
  diff,
  diffLoading,
  diffEnabled,
  diffFocusChanges,
  refreshedAt,
  onCodeSelectionChange,
  onViewerModeChange,
  onDiffToggle,
  onDiffFocusChange,
  onCreateComment,
  comments = [],
  activeCommentId,
  onOpenComment,
  onCloseComment,
  onCommentStatusChange,
  onCloseRemoved,
}: {
  file: FilePayload | null;
  removed?: boolean;
  allowHtmlScripts: boolean;
  theme: ResolvedTheme;
  selectedCodeRange: LineRange | null;
  viewerMode?: ViewerMode;
  diff?: TextDiff | null;
  diffLoading?: boolean;
  diffEnabled?: boolean;
  diffFocusChanges?: boolean;
  refreshedAt?: number;
  onCodeSelectionChange: (range: LineRange | null) => void;
  onViewerModeChange?: (mode: ViewerMode) => void;
  onDiffToggle?: () => void;
  onDiffFocusChange?: (focusChanges: boolean) => void;
  onCreateComment?: CommentCreateHandler;
  comments?: ViviComment[];
  activeCommentId?: string | null;
  onOpenComment?: (id: string, rect: DOMRectLike) => void;
  onCloseComment?: () => void;
  onCommentStatusChange?: CommentStatusChangeHandler;
  onCloseRemoved?: () => void;
}) {
  if (!file)
    return <div className="empty-viewer">Select a file from the tree.</div>;

  if (removed) {
    return (
      <div className="removed-viewer" aria-live="polite">
        <p className="removed-eyebrow">Removed from disk</p>
        <h2>{file.path}</h2>
        <p>
          This tab is showing the last loaded content for a file that no longer
          exists in the watched directory.
        </p>
        <div className="removed-actions">
          <button type="button" onClick={onCloseRemoved}>
            Close tab
          </button>
        </div>
      </div>
    );
  }

  if (file.truncated) {
    if (file.encoding === "utf8" && file.content)
      return <LargeTextPreview file={file} />;
    return (
      <div className="unsupported">
        <h2>{file.path}</h2>
        <p>
          This file is {formatBytes(file.size)}, which is larger than the{" "}
          {formatBytes(file.maxSizeBytes ?? 0)} preview limit.
        </p>
      </div>
    );
  }

  if (file.viewerKind === "markdown")
    return (
      <LazyViewerFallback path={file.path}>
        <MarkdownViewer
          file={file}
          mode={viewerMode}
          diff={diff}
          diffLoading={diffLoading}
          diffEnabled={diffEnabled}
          diffFocusChanges={diffFocusChanges}
          theme={theme}
          onModeChange={onViewerModeChange}
          onDiffToggle={onDiffToggle}
          onDiffFocusChange={onDiffFocusChange}
          onCreateComment={onCreateComment}
          comments={comments}
          activeCommentId={activeCommentId}
          onOpenComment={onOpenComment}
          onCloseComment={onCloseComment}
          onCommentStatusChange={onCommentStatusChange}
        />
      </LazyViewerFallback>
    );
  if (file.viewerKind === "html")
    return (
      <LazyViewerFallback path={file.path}>
        <HtmlViewer
          file={file}
          allowHtmlScripts={allowHtmlScripts}
          mode={viewerMode}
          diff={diff}
          diffLoading={diffLoading}
          diffEnabled={diffEnabled}
          diffFocusChanges={diffFocusChanges}
          theme={theme}
          onModeChange={onViewerModeChange}
          onDiffToggle={onDiffToggle}
          onDiffFocusChange={onDiffFocusChange}
          onCreateComment={onCreateComment}
          comments={comments}
          activeCommentId={activeCommentId}
          onOpenComment={onOpenComment}
          onCloseComment={onCloseComment}
        />
      </LazyViewerFallback>
    );
  if (file.viewerKind === "json")
    return (
      <LazyViewerFallback path={file.path}>
        <JsonViewer
          file={file}
          theme={theme}
          diff={diff}
          diffLoading={diffLoading}
          diffEnabled={diffEnabled}
          diffFocusChanges={diffFocusChanges}
          onDiffToggle={onDiffToggle}
          onDiffFocusChange={onDiffFocusChange}
          onCreateComment={onCreateComment}
          comments={comments}
          activeCommentId={activeCommentId}
          onOpenComment={onOpenComment}
        />
      </LazyViewerFallback>
    );
  if (file.viewerKind === "mermaid")
    return (
      <LazyViewerFallback path={file.path}>
        <MermaidViewer
          file={file}
          theme={theme}
          diff={diff}
          diffLoading={diffLoading}
          diffEnabled={diffEnabled}
          diffFocusChanges={diffFocusChanges}
          onDiffToggle={onDiffToggle}
          onDiffFocusChange={onDiffFocusChange}
          onCreateComment={onCreateComment}
          comments={comments}
          activeCommentId={activeCommentId}
          onOpenComment={onOpenComment}
        />
      </LazyViewerFallback>
    );
  if (file.viewerKind === "code")
    return (
      <LazyViewerFallback path={file.path}>
        <CodeViewer
          file={file}
          theme={theme}
          selectedRange={selectedCodeRange}
          refreshedAt={refreshedAt}
          diff={diff}
          diffLoading={diffLoading}
          diffEnabled={diffEnabled}
          diffFocusChanges={diffFocusChanges}
          onSelectionChange={onCodeSelectionChange}
          onDiffToggle={onDiffToggle}
          onDiffFocusChange={onDiffFocusChange}
          onCreateComment={onCreateComment}
          comments={comments}
          activeCommentId={activeCommentId}
          onOpenComment={onOpenComment}
          onCloseComment={onCloseComment}
          onCommentStatusChange={onCommentStatusChange}
        />
      </LazyViewerFallback>
    );
  if (file.viewerKind === "text" && isDelimitedPath(file.path))
    return (
      <CsvViewer
        file={file}
        theme={theme}
        diff={diff}
        diffLoading={diffLoading}
        diffEnabled={diffEnabled}
        diffFocusChanges={diffFocusChanges}
        onDiffToggle={onDiffToggle}
        onDiffFocusChange={onDiffFocusChange}
        onCreateComment={onCreateComment}
        comments={comments}
        activeCommentId={activeCommentId}
        onOpenComment={onOpenComment}
      />
    );
  if (file.viewerKind === "image")
    return (
      <LazyViewerFallback path={file.path}>
        <ImageViewer
          file={file}
          theme={theme}
          diff={diff}
          diffLoading={diffLoading}
          diffEnabled={diffEnabled}
          diffFocusChanges={diffFocusChanges}
          onDiffToggle={onDiffToggle}
          onDiffFocusChange={onDiffFocusChange}
          onCreateComment={onCreateComment}
          comments={comments}
          activeCommentId={activeCommentId}
          onOpenComment={onOpenComment}
        />
      </LazyViewerFallback>
    );
  if (file.viewerKind === "text")
    return (
      <LazyViewerFallback path={file.path}>
        <TextViewer
          file={file}
          theme={theme}
          diff={diff}
          diffLoading={diffLoading}
          diffEnabled={diffEnabled}
          diffFocusChanges={diffFocusChanges}
          onDiffToggle={onDiffToggle}
          onDiffFocusChange={onDiffFocusChange}
          onCreateComment={onCreateComment}
          comments={comments}
          activeCommentId={activeCommentId}
          onOpenComment={onOpenComment}
        />
      </LazyViewerFallback>
    );

  return (
    <div className="unsupported">
      <h2>{file.path}</h2>
      <button
        aria-pressed={Boolean(diffEnabled)}
        className={`diff-toggle${diffEnabled ? " active" : ""}`}
        type="button"
        onClick={onDiffToggle}
      >
        Diff from HEAD
      </button>
      {diffEnabled ? (
        <DiffViewer
          path={file.path}
          diff={diff ?? null}
          loading={diffLoading}
          focusChanges={diffFocusChanges}
          renderKind="source"
          theme={theme}
          onFocusChangesChange={onDiffFocusChange}
          onCreateComment={onCreateComment}
          file={file}
          comments={comments}
          activeCommentId={activeCommentId}
          onOpenComment={onOpenComment}
        />
      ) : (
        <p>This file type is not supported yet.</p>
      )}
    </div>
  );
}

export interface DOMRectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

function LazyViewerFallback({
  children,
  path,
}: {
  children: ReactNode;
  path: string;
}) {
  return (
    <Suspense
      fallback={
        <div className="empty-viewer" aria-live="polite">
          Loading preview for {path}...
        </div>
      }
    >
      {children}
    </Suspense>
  );
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}
