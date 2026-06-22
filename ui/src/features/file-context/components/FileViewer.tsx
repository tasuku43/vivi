import { lazy, Suspense, useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { TextDiff } from "../../../domain/change-review.js";
import type { ViviComment } from "../../../domain/comments.js";
import type { FilePayload } from "../../../domain/fs-node.js";
import type { CommentActivitySummary } from "../../../state/comment-activity.js";
import { CsvViewer, isDelimitedPath } from "../viewers/CsvViewer.js";
import { DiffViewer } from "../viewers/DiffViewer.js";
import { BinaryMetadataViewer } from "../viewers/BinaryMetadataViewer.js";
import { LargeTextPreview } from "../viewers/LargeTextPreview.js";
import {
  buildCodeMetadata,
  type CodeSymbol,
  type LineRange,
} from "../../../state/code-viewer.js";
import type {
  CommentCreateHandler,
  CommentStatusChangeHandler,
} from "../../../state/comments.js";
import type { OutlineHeading } from "../../../state/outline.js";
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
  defaultOutlineOpen,
  outline = [],
  refreshedAt,
  onCodeSelectionChange,
  onViewerModeChange,
  onDiffToggle,
  onDiffFocusChange,
  onOutlineSelect,
  onCreateComment,
  comments = [],
  activeCommentId,
  onOpenComment,
  onCloseComment,
  onCommentStatusChange,
  threadActivities = {},
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
  defaultOutlineOpen?: boolean;
  outline?: OutlineHeading[];
  refreshedAt?: number;
  onCodeSelectionChange: (range: LineRange | null) => void;
  onViewerModeChange?: (mode: ViewerMode) => void;
  onDiffToggle?: () => void;
  onDiffFocusChange?: (focusChanges: boolean) => void;
  onOutlineSelect?: (id: string) => void;
  onCreateComment?: CommentCreateHandler;
  comments?: ViviComment[];
  activeCommentId?: string | null;
  onOpenComment?: (id: string, rect: DOMRectLike) => void;
  onCloseComment?: () => void;
  onCommentStatusChange?: CommentStatusChangeHandler;
  threadActivities?: Record<string, CommentActivitySummary>;
  onCloseRemoved?: () => void;
}) {
  if (!file)
    return <div className="empty-viewer">Select a file from the tree.</div>;

  const localOutline = (
    <FileOutlineControl
      file={file}
      outline={outline}
      selectedCodeRange={selectedCodeRange}
      defaultOpen={defaultOutlineOpen}
      onOutlineSelect={onOutlineSelect}
    />
  );

  if (removed) {
    return (
      <FileViewerFrame outlineControl={localOutline}>
        <div className="removed-viewer" aria-live="polite">
          <p className="removed-eyebrow">Removed from disk</p>
          <h2>{file.path}</h2>
          <p>
            This tab is showing the last loaded content for a file that no
            longer exists in the watched directory.
          </p>
          <div className="removed-actions">
            <button type="button" onClick={onCloseRemoved}>
              Close tab
            </button>
          </div>
        </div>
      </FileViewerFrame>
    );
  }

  if (file.truncated) {
    if (file.encoding === "utf8" && file.content)
      return (
        <FileViewerFrame outlineControl={localOutline}>
          <LargeTextPreview file={file} />
        </FileViewerFrame>
      );
    return (
      <FileViewerFrame outlineControl={localOutline}>
        <BinaryMetadataViewer
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
      </FileViewerFrame>
    );
  }

  if (file.viewerKind === "markdown")
    return (
      <FileViewerFrame outlineControl={localOutline}>
        <LazyViewerFallback path={file.path}>
          <MarkdownViewer
            file={file}
            mode={viewerMode}
            toolbarAction={localOutline}
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
            threadActivities={threadActivities}
          />
        </LazyViewerFallback>
      </FileViewerFrame>
    );
  if (file.viewerKind === "html")
    return (
      <FileViewerFrame outlineControl={localOutline}>
        <LazyViewerFallback path={file.path}>
          <HtmlViewer
            file={file}
            allowHtmlScripts={allowHtmlScripts}
            mode={viewerMode}
            toolbarAction={localOutline}
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
      </FileViewerFrame>
    );
  if (file.viewerKind === "json")
    return (
      <FileViewerFrame outlineControl={localOutline}>
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
      </FileViewerFrame>
    );
  if (file.viewerKind === "mermaid")
    return (
      <FileViewerFrame outlineControl={localOutline}>
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
      </FileViewerFrame>
    );
  if (file.viewerKind === "code")
    return (
      <FileViewerFrame outlineControl={localOutline}>
        <LazyViewerFallback path={file.path}>
          <CodeViewer
            file={file}
            theme={theme}
            selectedRange={selectedCodeRange}
            toolbarAction={localOutline}
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
            threadActivities={threadActivities}
          />
        </LazyViewerFallback>
      </FileViewerFrame>
    );
  if (file.viewerKind === "text" && isDelimitedPath(file.path))
    return (
      <FileViewerFrame outlineControl={localOutline}>
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
      </FileViewerFrame>
    );
  if (file.viewerKind === "image")
    return (
      <FileViewerFrame outlineControl={localOutline}>
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
      </FileViewerFrame>
    );
  if (file.viewerKind === "binary")
    return (
      <FileViewerFrame outlineControl={localOutline}>
        <BinaryMetadataViewer
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
      </FileViewerFrame>
    );
  if (file.viewerKind === "text")
    return (
      <FileViewerFrame outlineControl={localOutline}>
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
      </FileViewerFrame>
    );

  return (
    <FileViewerFrame outlineControl={localOutline}>
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
    </FileViewerFrame>
  );
}

function FileViewerFrame({ children }: { children: ReactNode; outlineControl?: ReactNode }) {
  return <div className="file-viewer-frame">{children}</div>;
}

export function FileOutlineControl({
  file,
  defaultOpen = false,
  outline,
  selectedCodeRange,
  onOutlineSelect,
}: {
  file: FilePayload;
  defaultOpen?: boolean;
  outline: OutlineHeading[];
  selectedCodeRange: LineRange | null;
  onOutlineSelect?: (id: string) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const controlRef = useRef<HTMLDivElement | null>(null);
  const panelId = useId();
  const codeMetadata =
    file.viewerKind === "code" || file.viewerKind === "json"
      ? buildCodeMetadata(file, selectedCodeRange)
      : null;
  const codeSymbols = codeMetadata?.symbols.slice(0, 14) ?? [];
  const hasItems = codeSymbols.length > 0 || outline.length > 0;

  useEffect(() => {
    if (!open) return undefined;

    const dismissOnPointerDown = (event: PointerEvent) => {
      if (controlRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
      }
    };

    document.addEventListener("pointerdown", dismissOnPointerDown);
    document.addEventListener("keydown", dismissOnEscape);
    return () => {
      document.removeEventListener("pointerdown", dismissOnPointerDown);
      document.removeEventListener("keydown", dismissOnEscape);
    };
  }, [open]);

  useEffect(() => {
    setOpen(defaultOpen);
  }, [defaultOpen, file.path]);

  if (!hasItems) return null;

  return (
    <div className="local-outline-control" ref={controlRef}>
      <button
        aria-controls={open ? panelId : undefined}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="local-outline-button"
        type="button"
        onClick={() => setOpen((value) => !value)}
      >
        <span>In this file</span>
        <small>{codeSymbols.length || outline.length}</small>
      </button>
      {open ? (
        <div
          aria-label="In this file"
          className="local-outline-popover"
          id={panelId}
          role="dialog"
        >
          <div className="local-outline-header">
            <strong>In this file</strong>
            <button
              aria-label="Close file outline"
              type="button"
              onClick={() => setOpen(false)}
            >
              Close
            </button>
          </div>
          {codeSymbols.length ? (
            <CodeSymbolList
              symbols={codeSymbols}
              onSelect={(line) => {
                controlRef.current
                  ?.closest(".viewer-pane")
                  ?.querySelector<HTMLElement>(`.code-line[data-line="${line}"]`)
                  ?.scrollIntoView({
                    block: "center",
                    behavior: "smooth",
                  });
                setOpen(false);
              }}
            />
          ) : (
            <HeadingOutlineList
              outline={outline}
              onSelect={(id) => {
                onOutlineSelect?.(id);
                setOpen(false);
              }}
            />
          )}
        </div>
      ) : null}
    </div>
  );
}

function CodeSymbolList({
  symbols,
  onSelect,
}: {
  symbols: CodeSymbol[];
  onSelect: (line: number) => void;
}) {
  return (
    <nav className="local-symbol-list" aria-label="Code symbols">
      {symbols.map((symbol) => (
        <a
          href={`#L${symbol.line}`}
          key={`${symbol.kind}-${symbol.name}-${symbol.line}`}
          onClick={(event) => {
            event.preventDefault();
            onSelect(symbol.line);
          }}
        >
          <span>{symbol.kind}</span>
          <strong>{symbol.name}</strong>
          <small>{symbol.line}</small>
        </a>
      ))}
    </nav>
  );
}

function HeadingOutlineList({
  outline,
  onSelect,
}: {
  outline: OutlineHeading[];
  onSelect: (id: string) => void;
}) {
  return (
    <nav className="local-outline-list" aria-label="Document outline">
      {outline.map((heading, index) => (
        <a
          key={heading.id}
          className={`${heading.level === 2 ? "h2 " : ""}${index === 0 ? "active" : ""}`}
          href={`#${heading.id}`}
          onClick={(event) => {
            event.preventDefault();
            onSelect(heading.id);
          }}
        >
          {heading.text}
        </a>
      ))}
    </nav>
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
