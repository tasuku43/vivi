import {
  Component,
  lazy,
  Suspense,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import type { ErrorInfo, ReactNode } from "react";
import type { TextDiff } from "../../../domain/change-review.js";
import type { ViviComment } from "../../../domain/comments.js";
import type { FilePayload } from "../../../domain/fs-node.js";
import type { CommentActivitySummary } from "../../../state/comment-activity.js";
import { BinaryMetadataViewer } from "../viewers/BinaryMetadataViewer.js";
import surfaceStyles from "../viewers/ViewerSurface.module.css";
import {
  DiffToggleButton,
  ViewerHeaderProvider,
  type ViewerHeaderReviewStop,
} from "./ViewerControlButton.js";
import { LargeTextPreview } from "../viewers/LargeTextPreview.js";
import {
  buildCodeMetadata,
  type CodeSymbol,
  type LineRange,
} from "../../../state/code-viewer.js";
import type { CommentCreateHandler } from "../../../state/comments.js";
import {
  commentLineLabel,
  truncateCommentPreview,
} from "../../../state/comments.js";
import type { OutlineHeading } from "../../../state/outline.js";
import type { ResolvedTheme } from "../../../state/theme.js";
import type { ViewerMode } from "../../../state/viewer-mode.js";
import styles from "./FileViewer.module.css";
import viewerMessageStyles from "../../../shared/components/ViewerMessage.module.css";

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
const CsvViewer = lazy(() =>
  import("../viewers/CsvViewer.js").then((module) => ({
    default: module.CsvViewer,
  })),
);
const DiffViewer = lazy(() =>
  import("../viewers/DiffViewer.js").then((module) => ({
    default: module.DiffViewer,
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
  focusLineNumber,
  focusRevision,
  viewerMode,
  diff,
  diffLoading,
  diffEnabled,
  currentActorId,
  defaultOutlineOpen,
  outline = [],
  refreshedAt,
  onCodeSelectionChange,
  onViewerModeChange,
  onDiffToggle,
  onOutlineSelect,
  onCreateComment,
  comments = [],
  activeCommentId,
  expandActiveCommentThread = true,
  onOpenComment,
  onCloseComment,
  threadActivities = {},
  onRevealInTree,
  onFocusActiveComment,
  onOpenPath,
  onCloseRemoved,
}: {
  file: FilePayload | null;
  removed?: boolean;
  allowHtmlScripts: boolean;
  theme: ResolvedTheme;
  selectedCodeRange: LineRange | null;
  focusLineNumber?: number | null;
  focusRevision?: number;
  viewerMode?: ViewerMode;
  diff?: TextDiff | null;
  diffLoading?: boolean;
  diffEnabled?: boolean;
  currentActorId?: string;
  defaultOutlineOpen?: boolean;
  outline?: OutlineHeading[];
  refreshedAt?: number;
  onCodeSelectionChange: (range: LineRange | null) => void;
  onViewerModeChange?: (mode: ViewerMode) => void;
  onDiffToggle?: () => void;
  onOutlineSelect?: (id: string) => void;
  onCreateComment?: CommentCreateHandler;
  comments?: ViviComment[];
  activeCommentId?: string | null;
  expandActiveCommentThread?: boolean;
  onOpenComment?: (id: string, rect: DOMRectLike) => void;
  onCloseComment?: () => void;
  threadActivities?: Record<string, CommentActivitySummary>;
  onRevealInTree?: (path?: string) => void;
  onFocusActiveComment?: () => void;
  onOpenPath?: (path: string) => void;
  onCloseRemoved?: () => void;
}) {
  if (!file)
    return (
      <div className={`${viewerMessageStyles.empty} empty-viewer`}>
        Select a file from the tree.
      </div>
    );

  const activeReviewStop = activeFileReviewStop(
    file,
    comments,
    activeCommentId ?? null,
  );
  const frameProps = {
    file,
    activeReviewStop,
    onFocusActiveComment,
    onRevealInTree,
  };
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
      <FileViewerFrame {...frameProps}>
        <div className={`${styles.removed} removed-viewer`} aria-live="polite">
          <p className={`${styles.removedEyebrow} removed-eyebrow`}>
            Removed from disk
          </p>
          <h2>{file.path}</h2>
          <p>
            Vivi stopped displaying this file because it no longer exists in the
            watched directory.
          </p>
          <div className={`${styles.removedActions} removed-actions`}>
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
        <FileViewerFrame {...frameProps}>
          <LargeTextPreview file={file} />
        </FileViewerFrame>
      );
    return (
      <FileViewerFrame {...frameProps}>
        <BinaryMetadataViewer
          file={file}
          theme={theme}
          diff={diff}
          diffLoading={diffLoading}
          diffEnabled={diffEnabled}
          onDiffToggle={onDiffToggle}
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
      <FileViewerFrame {...frameProps}>
        <LazyViewerFallback path={file.path}>
          <MarkdownViewer
            file={file}
            mode={viewerMode}
            focusLineNumber={focusLineNumber}
            focusRevision={focusRevision}
            toolbarAction={localOutline}
            diff={diff}
            diffLoading={diffLoading}
            diffEnabled={diffEnabled}
            theme={theme}
            onModeChange={onViewerModeChange}
            onDiffToggle={onDiffToggle}
            onCreateComment={onCreateComment}
            comments={comments}
            activeCommentId={activeCommentId}
            expandActiveCommentThread={expandActiveCommentThread}
            currentActorId={currentActorId}
            onOpenComment={onOpenComment}
            onCloseComment={onCloseComment}
            threadActivities={threadActivities}
            onOpenPath={onOpenPath}
          />
        </LazyViewerFallback>
      </FileViewerFrame>
    );
  if (file.viewerKind === "html")
    return (
      <FileViewerFrame {...frameProps}>
        <LazyViewerFallback path={file.path}>
          <HtmlViewer
            file={file}
            allowHtmlScripts={allowHtmlScripts}
            mode={viewerMode}
            focusLineNumber={focusLineNumber}
            focusRevision={focusRevision}
            toolbarAction={localOutline}
            diff={diff}
            diffLoading={diffLoading}
            diffEnabled={diffEnabled}
            theme={theme}
            onModeChange={onViewerModeChange}
            onDiffToggle={onDiffToggle}
            onCreateComment={onCreateComment}
            comments={comments}
            activeCommentId={activeCommentId}
            currentActorId={currentActorId}
            onOpenComment={onOpenComment}
            onCloseComment={onCloseComment}
            threadActivities={threadActivities}
            onOpenPath={onOpenPath}
          />
        </LazyViewerFallback>
      </FileViewerFrame>
    );
  if (file.viewerKind === "json")
    return (
      <FileViewerFrame {...frameProps}>
        <LazyViewerFallback path={file.path}>
          <JsonViewer
            file={file}
            initialMode={viewerMode === "source" ? "source" : undefined}
            theme={theme}
            diff={diff}
            diffLoading={diffLoading}
            diffEnabled={diffEnabled}
            onDiffToggle={onDiffToggle}
            onCreateComment={onCreateComment}
            comments={comments}
            activeCommentId={activeCommentId}
            expandActiveCommentThread={expandActiveCommentThread}
            currentActorId={currentActorId}
            onOpenComment={onOpenComment}
            onCloseComment={onCloseComment}
            threadActivities={threadActivities}
          />
        </LazyViewerFallback>
      </FileViewerFrame>
    );
  if (file.viewerKind === "mermaid")
    return (
      <FileViewerFrame {...frameProps}>
        <LazyViewerFallback path={file.path}>
          <MermaidViewer
            file={file}
            theme={theme}
            diff={diff}
            diffLoading={diffLoading}
            diffEnabled={diffEnabled}
            onDiffToggle={onDiffToggle}
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
      <FileViewerFrame {...frameProps}>
        <LazyViewerFallback path={file.path}>
          <CodeViewer
            file={file}
            theme={theme}
            selectedRange={selectedCodeRange}
            focusLineNumber={focusLineNumber}
            focusRevision={focusRevision}
            toolbarAction={localOutline}
            refreshedAt={refreshedAt}
            diff={diff}
            diffLoading={diffLoading}
            diffEnabled={diffEnabled}
            onSelectionChange={onCodeSelectionChange}
            onDiffToggle={onDiffToggle}
            onCreateComment={onCreateComment}
            comments={comments}
            activeCommentId={activeCommentId}
            expandActiveCommentThread={expandActiveCommentThread}
            currentActorId={currentActorId}
            onOpenComment={onOpenComment}
            onCloseComment={onCloseComment}
            threadActivities={threadActivities}
          />
        </LazyViewerFallback>
      </FileViewerFrame>
    );
  if (file.viewerKind === "text" && isDelimitedPath(file.path))
    return (
      <FileViewerFrame {...frameProps}>
        <LazyViewerFallback path={file.path}>
          <CsvViewer
            file={file}
            theme={theme}
            diff={diff}
            diffLoading={diffLoading}
            diffEnabled={diffEnabled}
            onDiffToggle={onDiffToggle}
            onCreateComment={onCreateComment}
            comments={comments}
            activeCommentId={activeCommentId}
            onOpenComment={onOpenComment}
          />
        </LazyViewerFallback>
      </FileViewerFrame>
    );
  if (file.viewerKind === "image")
    return (
      <FileViewerFrame {...frameProps}>
        <LazyViewerFallback path={file.path}>
          <ImageViewer
            file={file}
            theme={theme}
            diff={diff}
            diffLoading={diffLoading}
            diffEnabled={diffEnabled}
            onDiffToggle={onDiffToggle}
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
      <FileViewerFrame {...frameProps}>
        <BinaryMetadataViewer
          file={file}
          theme={theme}
          diff={diff}
          diffLoading={diffLoading}
          diffEnabled={diffEnabled}
          onDiffToggle={onDiffToggle}
          onCreateComment={onCreateComment}
          comments={comments}
          activeCommentId={activeCommentId}
          onOpenComment={onOpenComment}
        />
      </FileViewerFrame>
    );
  if (file.viewerKind === "text")
    return (
      <FileViewerFrame {...frameProps}>
        <LazyViewerFallback path={file.path}>
          <TextViewer
            file={file}
            theme={theme}
            focusLineNumber={focusLineNumber}
            focusRevision={focusRevision}
            diff={diff}
            diffLoading={diffLoading}
            diffEnabled={diffEnabled}
            onDiffToggle={onDiffToggle}
            onCreateComment={onCreateComment}
            comments={comments}
            activeCommentId={activeCommentId}
            onOpenComment={onOpenComment}
          />
        </LazyViewerFallback>
      </FileViewerFrame>
    );

  return (
    <FileViewerFrame {...frameProps}>
      <div className={`${surfaceStyles.unsupported} unsupported`}>
        <h2>{file.path}</h2>
        <DiffToggleButton
          enabled={diffEnabled}
          path={file.path}
          onToggle={onDiffToggle}
        />
        {diffEnabled ? (
          <LazyViewerFallback path={file.path}>
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
              currentActorId={currentActorId}
              onOpenComment={onOpenComment}
            />
          </LazyViewerFallback>
        ) : (
          <p>This file type is not supported yet.</p>
        )}
      </div>
    </FileViewerFrame>
  );
}

function isDelimitedPath(path: string): boolean {
  return /\.(csv|tsv)$/i.test(path);
}

function FileViewerFrame({
  children,
  file,
  activeReviewStop,
  onFocusActiveComment,
  onRevealInTree,
}: {
  children: ReactNode;
  file: FilePayload;
  activeReviewStop?: ActiveFileReviewStop | null;
  onFocusActiveComment?: () => void;
  onRevealInTree?: (path?: string) => void;
}) {
  return (
    <div className={`${styles.frame} file-viewer-frame`}>
      <ViewerHeaderProvider
        value={{
          file,
          activeReviewStop,
          onFocusActiveComment,
          onRevealInTree,
        }}
      >
        <ViewerErrorBoundary
          path={file.path}
          resetKey={`${file.path}:${file.etag}`}
        >
          {children}
        </ViewerErrorBoundary>
      </ViewerHeaderProvider>
    </div>
  );
}

interface ViewerErrorBoundaryProps {
  children: ReactNode;
  path: string;
  resetKey: string;
  onRetry?: () => void;
}

interface ViewerErrorBoundaryState {
  error: Error | null;
}

export class ViewerErrorBoundary extends Component<
  ViewerErrorBoundaryProps,
  ViewerErrorBoundaryState
> {
  state: ViewerErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ViewerErrorBoundaryState {
    return { error };
  }

  componentDidUpdate(previous: ViewerErrorBoundaryProps): void {
    if (this.state.error && previous.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  componentDidCatch(_error: Error, _info: ErrorInfo): void {
    // React reports the component stack; this boundary keeps sibling UI alive.
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <section
        aria-label={`Preview error for ${this.props.path}`}
        className={`${styles.viewerError} viewer-error-boundary`}
        role="alert"
      >
        <p className={`${styles.viewerErrorEyebrow} viewer-error-eyebrow`}>
          Preview unavailable
        </p>
        <h2>This file could not be displayed.</h2>
        <p>
          Vivi kept the rest of the workspace open. You can retry this preview
          or continue with another file.
        </p>
        <details>
          <summary>Technical details</summary>
          <code>{error.message || error.name}</code>
        </details>
        <button
          type="button"
          onClick={() => {
            this.props.onRetry?.();
            this.setState({ error: null });
          }}
        >
          Try preview again
        </button>
      </section>
    );
  }
}

type ActiveFileReviewStop = ViewerHeaderReviewStop;

export function activeFileReviewStop(
  file: FilePayload,
  comments: ViviComment[],
  activeCommentId: string | null,
): ActiveFileReviewStop | null {
  if (!activeCommentId) return null;
  const comment = comments.find(
    (candidate) =>
      candidate.id === activeCommentId && candidate.path === file.path,
  );
  if (!comment) return null;
  return {
    label: [surfaceLabel(comment), commentLineLabel(comment)]
      .filter(Boolean)
      .join(" · "),
    preview: truncateCommentPreview(comment.body, 72),
  };
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
  const outlineLabel = fileOutlineControlLabel({
    path: file.path,
    symbolCount: codeSymbols.length,
    headingCount: outline.length,
    selectedReference: codeMetadata?.selectedReference ?? null,
  });

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
    <div
      className={`${styles.localOutlineControl} local-outline-control`}
      ref={controlRef}
    >
      <button
        aria-controls={open ? panelId : undefined}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={outlineLabel}
        className={`${styles.localOutlineButton} local-outline-button`}
        type="button"
        title={outlineLabel}
        onClick={() => setOpen((value) => !value)}
      >
        <span>In this file</span>
        <small>{codeSymbols.length || outline.length}</small>
      </button>
      {open ? (
        <div
          aria-label="In this file"
          className={`${styles.localOutlinePopover} local-outline-popover`}
          id={panelId}
          role="dialog"
        >
          <div className={`${styles.localOutlineHeader} local-outline-header`}>
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
                  ?.closest("[data-viewer-pane]")
                  ?.querySelector<HTMLElement>(
                    `.code-line[data-line="${line}"]`,
                  )
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

function surfaceLabel(comment: ViviComment): string {
  if (comment.anchor.surface === "diff") return "diff";
  if (comment.anchor.surface === "rendered") {
    return `${comment.anchor.rendered?.kind ?? comment.viewerKind} rendered`;
  }
  return "source";
}

function fileOutlineControlLabel({
  path,
  symbolCount,
  headingCount,
  selectedReference,
}: {
  path: string;
  symbolCount: number;
  headingCount: number;
  selectedReference: string | null;
}): string {
  const parts = [`Open in-file navigation for ${path}`];
  if (symbolCount) {
    parts.push(`${symbolCount} ${symbolCount === 1 ? "symbol" : "symbols"}`);
  } else {
    parts.push(
      `${headingCount} ${headingCount === 1 ? "heading" : "headings"}`,
    );
  }
  if (selectedReference) parts.push(`selection ${selectedReference}`);
  return parts.join(", ");
}

function CodeSymbolList({
  symbols,
  onSelect,
}: {
  symbols: CodeSymbol[];
  onSelect: (line: number) => void;
}) {
  return (
    <nav
      className={`${styles.localSymbolList} local-symbol-list`}
      aria-label="Code symbols"
    >
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
    <nav
      className={`${styles.localOutlineList} local-outline-list`}
      aria-label="Document outline"
    >
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
          <span className={`${styles.outlineLevel} outline-level`}>
            H{heading.level}
          </span>
          <span className={`${styles.outlineText} outline-text`}>
            {heading.text}
          </span>
          {heading.lineStart ? (
            <span className={`${styles.outlineLine} outline-line`}>
              L{heading.lineStart}
            </span>
          ) : null}
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
        <div
          className={`${viewerMessageStyles.empty} empty-viewer`}
          aria-live="polite"
        >
          Loading preview for {path}...
        </div>
      }
    >
      {children}
    </Suspense>
  );
}
