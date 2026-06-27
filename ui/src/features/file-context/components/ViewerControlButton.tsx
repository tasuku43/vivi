import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import type { FilePayload } from "../../../domain/fs-node.js";
import { fileLocationSegments } from "../../../state/file-location.js";

export interface ViewerHeaderReviewStop {
  label: string;
  preview: string;
}

export interface ViewerHeaderReviewSummary {
  label: string;
  title: string;
  tone: "clear" | "active" | "history";
}

interface ViewerHeaderContextValue {
  activeReviewStop?: ViewerHeaderReviewStop | null;
  file: FilePayload;
  reviewSummary?: ViewerHeaderReviewSummary | null;
  onFocusActiveComment?: () => void;
  onRevealInTree?: (path?: string) => void;
}

const ViewerHeaderContext = createContext<ViewerHeaderContextValue | null>(
  null,
);

export function ViewerHeaderProvider({
  children,
  value,
}: {
  children: ReactNode;
  value: ViewerHeaderContextValue;
}) {
  return (
    <ViewerHeaderContext.Provider value={value}>
      {children}
    </ViewerHeaderContext.Provider>
  );
}

export function ViewerToolbar({
  actionsClassName,
  actionsOnly = false,
  ariaLabel,
  children,
  status,
}: {
  actionsClassName?: string;
  actionsOnly?: boolean;
  ariaLabel?: string;
  children: ReactNode;
  status?: ReactNode;
}) {
  const header = useContext(ViewerHeaderContext);
  return (
    <div
      className={`viewer-toolbar${actionsOnly ? " viewer-toolbar-actions-only" : ""}`}
      aria-label={ariaLabel}
      data-viewer-header="unified"
    >
      {header ? (
        <ViewerToolbarLocation
          file={header.file}
          activeReviewStop={header.activeReviewStop}
          reviewSummary={header.reviewSummary}
          onFocusActiveComment={header.onFocusActiveComment}
          onRevealInTree={header.onRevealInTree}
        />
      ) : null}
      {status ? <span className="sandbox-status">{status}</span> : null}
      <div
        className={`viewer-toolbar-actions${actionsClassName ? ` ${actionsClassName}` : ""}`}
      >
        {children}
      </div>
    </div>
  );
}

export function ViewerToolbarLocation({
  file,
  activeReviewStop = null,
  reviewSummary = null,
  onFocusActiveComment,
  onRevealInTree,
}: {
  file: FilePayload;
  activeReviewStop?: ViewerHeaderReviewStop | null;
  reviewSummary?: ViewerHeaderReviewSummary | null;
  onFocusActiveComment?: () => void;
  onRevealInTree?: (path?: string) => void;
}) {
  const segments = fileLocationSegments(file.path);
  if (!segments.length) return null;
  return (
    <div
      className="viewer-toolbar-location"
      aria-label={fileLocationBarLabel(file.path)}
    >
      <nav
        className="file-location-crumbs"
        aria-label={`Location: ${file.path}`}
      >
        {segments.map((segment, index) => {
          const segmentLabel = fileLocationSegmentLabel(
            segment,
            index,
            segments.length,
          );
          return (
            <span className="file-location-segment" key={segment.path}>
              {index > 0 ? (
                <span className="file-location-separator">/</span>
              ) : null}
              <button
                aria-current={segment.kind === "file" ? "page" : undefined}
                aria-label={segmentLabel}
                type="button"
                className={segment.kind}
                title={segmentLabel}
                onClick={() => onRevealInTree?.(segment.path)}
              >
                {segment.label}
              </button>
            </span>
          );
        })}
      </nav>
      {activeReviewStop ? (
        <button
          aria-keyshortcuts="Meta+I Control+I"
          aria-label={`Focus current review stop, ${activeReviewStop.label}, ${activeReviewStop.preview}`}
          className="file-location-review-stop"
          disabled={!onFocusActiveComment}
          type="button"
          onClick={onFocusActiveComment}
          title={`Focus current review stop (${activeReviewStop.label})`}
        >
          <strong>Current stop</strong>
          <span>{activeReviewStop.label}</span>
          <span>{activeReviewStop.preview}</span>
        </button>
      ) : null}
      {reviewSummary ? (
        <span
          aria-label={reviewSummary.title}
          className={`file-location-review-summary ${reviewSummary.tone}`}
          title={reviewSummary.title}
        >
          {reviewSummary.label}
        </span>
      ) : null}
    </div>
  );
}

function fileLocationBarLabel(path: string): string {
  return `Current file location, ${path}`;
}

function fileLocationSegmentLabel(
  segment: ReturnType<typeof fileLocationSegments>[number],
  index: number,
  count: number,
): string {
  if (segment.kind === "file") {
    return `Current file ${segment.label}, segment ${index + 1} of ${count}, reveal ${segment.path} in the sidebar tree`;
  }
  return `Reveal folder ${segment.path}, segment ${index + 1} of ${count}, in the sidebar tree`;
}

export function DiffToggleButton({
  enabled,
  path,
  onToggle,
}: {
  enabled?: boolean;
  path: string;
  onToggle?: () => void;
}) {
  return (
    <button
      aria-pressed={Boolean(enabled)}
      className={`diff-toggle${enabled ? " active" : ""}`}
      data-diff-enabled={String(Boolean(enabled))}
      data-testid="viewer-diff-toggle"
      data-viewer-path={path}
      type="button"
      onClick={onToggle}
    >
      Diff from HEAD
    </button>
  );
}

export function ViewerModeButton({
  active,
  children,
  mode,
  path,
  onClick,
}: {
  active: boolean;
  children: ReactNode;
  mode: string;
  path: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-pressed={active}
      className={active ? "active" : ""}
      data-active={String(active)}
      data-testid="viewer-mode-option"
      data-viewer-mode={mode}
      data-viewer-path={path}
      type="button"
      onClick={onClick}
    >
      {children}
    </button>
  );
}
