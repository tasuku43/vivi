import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import type { FilePayload } from "../../../domain/fs-node.js";
import { fileLocationSegments } from "../../../state/file-location.js";
import {
  reviewFileStateLabel,
  reviewFileStateTone,
  type ReviewFileState,
} from "../../../state/review-state.js";
import styles from "./ViewerControlButton.module.css";
import surfaceStyles from "../viewers/ViewerSurface.module.css";

export interface ViewerHeaderReviewStop {
  label: string;
  preview: string;
}

export interface ViewerHeaderReviewState {
  state: ReviewFileState;
  label: string;
  title: string;
  tone: string;
}

interface ViewerHeaderContextValue {
  activeReviewStop?: ViewerHeaderReviewStop | null;
  file: FilePayload;
  reviewState?: ViewerHeaderReviewState | null;
  onFocusActiveComment?: () => void;
  onMarkReviewed?: () => void;
  onRevealInTree?: (path?: string) => void;
}

const ViewerHeaderContext = createContext<ViewerHeaderContextValue | null>(
  null,
);

function cx(...classNames: Array<string | false | null | undefined>): string {
  return classNames.filter(Boolean).join(" ");
}

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
      className={cx(
        styles.toolbar,
        "viewer-toolbar",
        actionsOnly && "viewer-toolbar-actions-only",
      )}
      aria-label={ariaLabel}
      data-viewer-header="unified"
    >
      {header ? (
        <ViewerToolbarLocation
          file={header.file}
          activeReviewStop={header.activeReviewStop}
          reviewState={header.reviewState}
          onFocusActiveComment={header.onFocusActiveComment}
          onRevealInTree={header.onRevealInTree}
        />
      ) : null}
      {status ? (
        <span className={cx(styles.sandboxStatus, "sandbox-status")}>
          {status}
        </span>
      ) : null}
      <div
        className={cx(styles.actions, "viewer-toolbar-actions", actionsClassName)}
      >
        {header?.reviewState?.state === "queued" && header.onMarkReviewed ? (
          <button
            className={cx(styles.markReviewedButton, "mark-reviewed-button")}
            type="button"
            aria-keyshortcuts="Meta+Shift+M Control+Shift+M"
            title="Mark as reviewed (Cmd/Ctrl Shift M)"
            onClick={header.onMarkReviewed}
          >
            Mark as reviewed
          </button>
        ) : null}
        {children}
      </div>
    </div>
  );
}

export function ViewerToolbarLocation({
  file,
  activeReviewStop = null,
  reviewState = null,
  onFocusActiveComment,
  onRevealInTree,
}: {
  file: FilePayload;
  activeReviewStop?: ViewerHeaderReviewStop | null;
  reviewState?: ViewerHeaderReviewState | null;
  onFocusActiveComment?: () => void;
  onRevealInTree?: (path?: string) => void;
}) {
  const segments = fileLocationSegments(file.path);
  if (!segments.length) return null;
  return (
    <div
      className={cx(styles.location, "viewer-toolbar-location")}
      aria-label={fileLocationBarLabel(file.path)}
    >
      <nav
        className={cx(styles.crumbs, "file-location-crumbs")}
        aria-label={`Location: ${file.path}`}
      >
        {segments.map((segment, index) => {
          const segmentLabel = fileLocationSegmentLabel(
            segment,
            index,
            segments.length,
          );
          return (
            <span
              className={cx(styles.segment, "file-location-segment")}
              key={segment.path}
            >
              {index > 0 ? (
                <span className={cx(styles.separator, "file-location-separator")}>
                  /
                </span>
              ) : null}
              <button
                aria-current={segment.kind === "file" ? "page" : undefined}
                aria-label={segmentLabel}
                type="button"
                className={cx(
                  styles.segmentButton,
                  segment.kind === "file" && styles.fileSegment,
                  segment.kind,
                )}
                title={segmentLabel}
                onClick={() => onRevealInTree?.(segment.path)}
              >
                {segment.label}
              </button>
              {segment.kind === "file" && reviewState ? (
                <span
                  aria-label={reviewState.title}
                  className={cx(
                    styles.reviewStateLabel,
                    styles[reviewState.tone],
                    "review-state-label",
                    reviewState.tone,
                  )}
                  title={reviewState.title}
                >
                  {reviewState.label}
                </span>
              ) : null}
            </span>
          );
        })}
      </nav>
      {activeReviewStop ? (
        <button
          aria-keyshortcuts="Meta+I Control+I"
          aria-label={`Focus current review stop, ${activeReviewStop.label}, ${activeReviewStop.preview}`}
          className={cx(styles.reviewStop, "file-location-review-stop")}
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
    </div>
  );
}

export function viewerHeaderReviewState(
  state: ReviewFileState | null | undefined,
): ViewerHeaderReviewState | null {
  if (!state) return null;
  return {
    state,
    label: reviewFileStateLabel(state),
    title: `Review state: ${reviewFileStateLabel(state)}`,
    tone: reviewFileStateTone(state),
  };
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
      className={cx(
        surfaceStyles.diffToggle,
        "diff-toggle",
        enabled && surfaceStyles.diffToggleActive,
        enabled && "active",
      )}
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
