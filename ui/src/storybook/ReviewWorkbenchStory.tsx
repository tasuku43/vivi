import { useEffect, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { TextDiff } from "../domain/change-review.js";
import {
  type DraftReviewComment,
  type ViviComment,
} from "../domain/comments.js";
import type { FilePayload, FsNode } from "../domain/fs-node.js";
import { CommandPalette } from "../features/command-palette/CommandPalette.js";
import { FileViewer } from "../features/file-context/components/FileViewer.js";
import { Inspector } from "../features/review-queue/Inspector.js";
import { ShortcutHelp } from "../shared/components/ShortcutHelp.js";
import { OpenTabs } from "../shared/components/OpenTabs.js";
import { Topbar } from "../shared/components/Topbar.js";
import { TreeSidebar } from "../shared/components/TreeSidebar.js";
import { WorkspaceStatusbar } from "../shared/components/WorkspaceStatusbar.js";
import { WorkbenchErrorMessage } from "../features/workbench/WorkbenchErrorMessage.js";
import { WorkbenchPendingFileMessage } from "../features/workbench/WorkbenchPendingFileMessage.js";
import workbenchStyles from "../features/workbench/WorkbenchContainer.module.css";
import viewerMessageStyles from "../shared/components/ViewerMessage.module.css";
import treeSidebarStyles from "../shared/components/TreeSidebar.module.css";
import sharedUiStyles from "../shared/styles/SharedUi.module.css";
import { extractMarkdownOutline } from "../state/outline.js";
import {
  draftReviewCommentAsViviComment,
  visibleThreadComments,
} from "../state/comments.js";
import {
  explorerFilterLabel,
  explorerFilterText,
} from "../state/tree-filter.js";
import { defaultViewerMode, type ViewerMode } from "../state/viewer-mode.js";
import type { CommentActivitySummary } from "../state/comment-activity.js";
import type { DiffStat, ReviewChangeItem } from "../state/git-review.js";
import type { ReviewQueueItem } from "../state/review-queue.js";
import {
  reviewQueueItemState,
  type ReviewFileState,
} from "../state/review-state.js";
import type { ResolvedTheme } from "../state/theme.js";
import type { OpenTab } from "../state/tabs.js";
import {
  commentsForPath,
  draftsForPath,
  sampleComments,
  sampleDraftComments,
  sampleFiles,
  sampleReviewChanges,
  sampleReviewDiffStats,
  sampleReviewQueueItems,
  sampleTabs,
  sampleThreadActivities,
  sampleUnreadReviewPaths,
  sampleWorkspaceTree,
  storyRoot,
} from "./fixtures/review-lab.js";

const noop = () => undefined;

export type WorkbenchStoryState =
  "ready" | "empty" | "loading" | "error" | "disconnected";

export interface ReviewWorkbenchStoryProps {
  state?: WorkbenchStoryState;
  file?: FilePayload | null;
  nodes?: FsNode[];
  tabs?: OpenTab[];
  comments?: ViviComment[];
  draftComments?: DraftReviewComment[];
  reviewChanges?: ReviewChangeItem[];
  reviewItems?: ReviewQueueItem[];
  reviewStateByPath?: Record<string, ReviewFileState>;
  diffStats?: Record<string, DiffStat | null>;
  unreadReviewPaths?: Set<string>;
  threadActivities?: Record<string, CommentActivitySummary>;
  diff?: TextDiff | null;
  diffEnabled?: boolean;
  viewerMode?: ViewerMode;
  commandPaletteOpen?: boolean;
  shortcutHelpOpen?: boolean;
  viewerError?: string;
  viewerSourceMissing?: boolean;
  pendingFilePath?: string;
  reviewQueueOpenFile?: FilePayload;
  activeCommentId?: string | null;
  inspectorTitle?: ReactNode;
  compactInspector?: boolean;
  reviewLoading?: boolean;
  treeChangedOnly?: boolean;
  theme?: ResolvedTheme;
}

export function ReviewWorkbenchStory({
  state = "ready",
  file = sampleFiles.code,
  nodes = sampleWorkspaceTree.nodes,
  tabs,
  comments = sampleComments,
  draftComments = sampleDraftComments,
  reviewChanges = sampleReviewChanges,
  reviewItems = sampleReviewQueueItems,
  reviewStateByPath,
  diffStats = sampleReviewDiffStats,
  unreadReviewPaths = sampleUnreadReviewPaths,
  threadActivities = sampleThreadActivities,
  diff = null,
  diffEnabled = false,
  viewerMode,
  commandPaletteOpen = false,
  shortcutHelpOpen = false,
  viewerError = "Failed to load comments: simulated adapter failure for Storybook.",
  viewerSourceMissing = false,
  pendingFilePath,
  reviewQueueOpenFile,
  activeCommentId = null,
  inspectorTitle,
  compactInspector = false,
  reviewLoading = false,
  treeChangedOnly = false,
  theme = "dark",
}: ReviewWorkbenchStoryProps) {
  const [storyState, setStoryState] = useState(state);
  const [storyFile, setStoryFile] = useState(file);
  const [storyViewerError, setStoryViewerError] = useState(viewerError);
  const [storyViewerSourceMissing, setStoryViewerSourceMissing] =
    useState(viewerSourceMissing);
  const [storyActiveCommentId, setStoryActiveCommentId] =
    useState(activeCommentId);
  const [storyCommandPaletteOpen, setStoryCommandPaletteOpen] =
    useState(commandPaletteOpen);
  const [storyShortcutHelpOpen, setStoryShortcutHelpOpen] =
    useState(shortcutHelpOpen);
  const [compactInspectorOpen, setCompactInspectorOpen] = useState(false);

  function focusCompactReviewQueue() {
    setCompactInspectorOpen(true);
    window.setTimeout(() => {
      const activeRow = '.review-queue .change-open[aria-current="true"]';
      const firstRow = ".review-queue .change-open:not(:disabled)";
      document
        .querySelector<HTMLButtonElement>(
          `${activeRow}:not(:disabled), ${firstRow}`,
        )
        ?.focus();
    }, 0);
  }

  useEffect(() => {
    setStoryState(state);
  }, [state]);

  useEffect(() => {
    setStoryFile(file);
  }, [file]);

  useEffect(() => {
    setStoryViewerError(viewerError);
  }, [viewerError]);

  useEffect(() => {
    setStoryViewerSourceMissing(viewerSourceMissing);
  }, [viewerSourceMissing]);

  useEffect(() => {
    setStoryActiveCommentId(activeCommentId);
  }, [activeCommentId]);

  useEffect(() => {
    setStoryCommandPaletteOpen(commandPaletteOpen);
  }, [commandPaletteOpen]);

  useEffect(() => {
    setStoryShortcutHelpOpen(shortcutHelpOpen);
  }, [shortcutHelpOpen]);

  useEffect(() => {
    setCompactInspectorOpen(false);
  }, [compactInspector]);

  function openReviewQueuePath(path: string) {
    if (!reviewQueueOpenFile || reviewQueueOpenFile.path !== path) return;
    setStoryFile(reviewQueueOpenFile);
    setStoryState("ready");
    setStoryViewerSourceMissing(false);
    setStoryActiveCommentId(null);
  }

  const selectedPath = storyFile?.path ?? pendingFilePath ?? null;
  const visibleComments = visibleThreadComments(comments);
  const activeTabs =
    tabs ??
    (storyFile
      ? sampleTabs.some((tab) => tab.path === storyFile.path)
        ? sampleTabs
        : [
            ...sampleTabs,
            {
              path: storyFile.path,
              viewerKind: storyFile.viewerKind,
              paneId: "main",
            },
          ]
      : []);
  const activeComments = selectedPath
    ? commentsForPath(selectedPath, visibleComments)
    : [];
  const activeDrafts = selectedPath
    ? draftsForPath(selectedPath, draftComments)
    : [];
  const viewerComments = combinePublishedAndDraftComments(
    activeComments,
    activeDrafts,
  );
  const outline =
    storyFile?.viewerKind === "markdown"
      ? extractMarkdownOutline(storyFile.content)
      : [];
  const resolvedViewerMode =
    viewerMode ?? (storyFile ? defaultViewerMode(storyFile) : undefined);
  const statusLabel =
    storyState === "disconnected"
      ? "comments watch disconnected"
      : storyState === "loading"
        ? "loading workspace"
        : storyState === "error"
          ? "review adapter error"
          : "watching";
  const reviewStatusLabel =
    reviewLoading && reviewItems.length === 0
      ? "Loading review files"
      : `${reviewItems.length} review ${reviewItems.length === 1 ? "file" : "files"}`;
  const explorerFilterSummary = {
    active: treeChangedOnly,
    reviewLoading,
    reviewPathCount: reviewItems.length,
  };
  const derivedReviewStateByPath =
    reviewStateByPath ??
    Object.fromEntries(
      reviewItems.map((item) => [item.path, reviewQueueItemState(item)]),
    );

  return (
    <div
      className={[
        "app-shell",
        sharedUiStyles.appShell,
        sharedUiStyles.sharedUiStyles,
        "story-workbench",
        `story-workbench-${storyState}`,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <Topbar
        root={storyState === "empty" ? null : storyRoot}
        themePreference="system"
        onThemeCycle={noop}
        onQuickOpen={() => setStoryCommandPaletteOpen(true)}
        onSearchText={() => setStoryCommandPaletteOpen(true)}
        onOpenShortcuts={() => setStoryShortcutHelpOpen(true)}
      />
      <div
        className={[
          workbenchStyles.workbench,
          compactInspector
            ? workbenchStyles.storyWorkbenchCompactInspector
            : "",
          compactInspector && !compactInspectorOpen
            ? workbenchStyles.inspectorHidden
            : "",
        ]
          .filter(Boolean)
          .join(" ")}
        style={
          {
            "--sidebar-width": "290px",
            "--inspector-width": "396px",
          } as CSSProperties
        }
      >
        <aside
          className={`${sharedUiStyles.sidebar} sidebar`}
          aria-label="File explorer"
        >
          <div className={`${sharedUiStyles.panelTitle} panel-title`}>
            <span>Explorer</span>
            <span
              aria-label={
                storyState === "disconnected"
                  ? "Workspace events disconnected"
                  : explorerFilterLabel(explorerFilterSummary)
              }
              className={
                storyState === "disconnected" || treeChangedOnly
                  ? `${sharedUiStyles.pill} ${sharedUiStyles.pillActive} pill active`
                  : `${sharedUiStyles.pill} pill`
              }
              title={
                storyState === "disconnected"
                  ? "Workspace events disconnected"
                  : explorerFilterLabel(explorerFilterSummary)
              }
            >
              {storyState === "disconnected"
                ? "offline"
                : explorerFilterText(explorerFilterSummary)}
            </span>
          </div>
          {storyState === "loading" ? (
            <p className={`${sharedUiStyles.muted} muted`}>Loading tree...</p>
          ) : storyState === "empty" ? (
            <p
              className={`${treeSidebarStyles.compactEmpty} ${sharedUiStyles.muted} muted compact-empty`}
            >
              No workspace selected.
            </p>
          ) : (
            <TreeSidebar
              nodes={nodes}
              selectedPath={selectedPath}
              revealPath={selectedPath}
              changedPaths={new Set(reviewChanges.map((change) => change.path))}
              reviewPaths={new Set(reviewItems.map((item) => item.path))}
              reviewStateByPath={derivedReviewStateByPath}
              removedPaths={
                new Set(
                  reviewChanges
                    .filter((change) => change.status === "deleted")
                    .map((change) => change.path),
                )
              }
              onSelect={noop}
              onOpen={noop}
            />
          )}
        </aside>
        <main className={workbenchStyles.main}>
          <section
            className={`${workbenchStyles.editorPane} ${workbenchStyles.activePane}`}
            data-pane-id="main"
          >
            <OpenTabs
              tabs={activeTabs}
              activePath={selectedPath}
              paneId="main"
              onActivate={noop}
              onClose={noop}
              onPromote={noop}
              onCloseOtherTabs={noop}
              onCloseTabsToRight={noop}
              onCloseUnchangedTabs={noop}
              onClosePreviewTabs={noop}
              onDropTab={noop}
              onDragStateChange={noop}
              onManualDragStart={noop}
            />
            <div className={workbenchStyles.viewerPane} data-viewer-pane>
              {storyState === "error" ? (
                <WorkbenchErrorMessage
                  error={storyViewerError}
                  path={selectedPath}
                  sourceMissing={storyViewerSourceMissing}
                />
              ) : pendingFilePath && !storyFile ? (
                <WorkbenchPendingFileMessage path={pendingFilePath} />
              ) : storyState === "loading" ? (
                <div
                  className={`${viewerMessageStyles.empty} empty-viewer`}
                  aria-live="polite"
                >
                  Loading preview...
                </div>
              ) : (
                <FileViewer
                  file={storyState === "empty" ? null : storyFile}
                  allowHtmlScripts={false}
                  theme={theme}
                  selectedCodeRange={
                    storyFile?.viewerKind === "code"
                      ? { start: 9, end: 12 }
                      : null
                  }
                  viewerMode={resolvedViewerMode}
                  diff={diff}
                  diffLoading={false}
                  diffEnabled={diffEnabled}
                  outline={outline}
                  comments={viewerComments}
                  reviewState={
                    selectedPath
                      ? (derivedReviewStateByPath[selectedPath] ?? null)
                      : null
                  }
                  activeCommentId={storyActiveCommentId}
                  threadActivities={threadActivities}
                  onCodeSelectionChange={noop}
                  onViewerModeChange={noop}
                  onDiffToggle={noop}
                  onOpenComment={noop}
                  onCloseComment={noop}
                  onCommentStatusChange={noop}
                  onCreateComment={noop}
                />
              )}
            </div>
          </section>
        </main>
        {compactInspector ? (
          <>
            <button
              className={workbenchStyles.storyFocusReviewQueue}
              type="button"
              onClick={focusCompactReviewQueue}
            >
              Focus Review Queue
            </button>
            <button
              className={`${workbenchStyles.railToggle} ${workbenchStyles.inspectorRailToggle}`}
              type="button"
              aria-label={
                compactInspectorOpen ? "Collapse inspector" : "Expand inspector"
              }
              title={
                compactInspectorOpen ? "Collapse inspector" : "Expand inspector"
              }
              onClick={() => setCompactInspectorOpen((open) => !open)}
            >
              <span
                className={
                  compactInspectorOpen
                    ? `${workbenchStyles.collapseIcon} ${workbenchStyles.collapseRight}`
                    : `${workbenchStyles.collapseIcon} ${workbenchStyles.collapseLeft}`
                }
              />
            </button>
          </>
        ) : null}
        <Inspector
          file={storyState === "empty" ? null : storyFile}
          reviewChanges={reviewChanges}
          reviewItems={reviewItems}
          reviewUnavailableReason={
            storyState === "disconnected"
              ? "Comment activity subscription disconnected; showing last known review state."
              : null
          }
          reviewDiffStats={diffStats}
          loadingReviewDiffs={
            storyState === "loading" && selectedPath
              ? { [selectedPath]: true }
              : {}
          }
          unreadReviewPaths={unreadReviewPaths}
          comments={activeComments}
          draftComments={draftComments}
          commentsLoading={storyState === "loading"}
          threadActivities={threadActivities}
          selectedCodeRange={
            storyFile?.viewerKind === "code" ? { start: 9, end: 12 } : null
          }
          refreshedAt={
            storyState === "disconnected" ? Date.now() - 90_000 : undefined
          }
          activePaneId="main"
          onOpenEventPath={openReviewQueuePath}
          onConfirmEventPath={openReviewQueuePath}
          onOpenNextChanged={noop}
          onOpenPreviousChanged={noop}
          onOpenAllChanged={noop}
          onPublishDrafts={noop}
          onRevealInTree={noop}
          onOpenDraft={noop}
        />
      </div>
      <WorkspaceStatusbar
        status={{
          workspace: `${nodes.length} root entries · ${activeTabs.length} open tabs`,
          activeFile: storyFile?.path ?? "No active file",
          review: `${reviewStatusLabel} · ${visibleComments.length} comments · ${draftComments.length} drafts`,
          server: statusLabel,
          serverTone: storyState === "loading" ? "pending" : "live",
          detail: "",
        }}
      />
      {inspectorTitle ? (
        <aside className="story-state-note" aria-label="Story context">
          {inspectorTitle}
        </aside>
      ) : null}
      <CommandPalette
        open={storyCommandPaletteOpen}
        mode="file"
        query="review"
        fileResults={[
          {
            path: sampleFiles.markdown.path,
            name: "product-review.md",
            viewerKind: "markdown",
            score: 1,
          },
          {
            path: sampleFiles.code.path,
            name: "WorkbenchContainer.tsx",
            viewerKind: "code",
            score: 0.92,
          },
          {
            path: sampleFiles.html.path,
            name: "review-preview.html",
            viewerKind: "html",
            score: 0.78,
          },
        ]}
        fileLoading={false}
        textResults={[
          {
            path: sampleFiles.markdown.path,
            viewerKind: "markdown",
            lineNumber: 7,
            lineText:
              "Comment threads are the shared contract between the browser UI and coding agents.",
            matchStart: 0,
            matchLength: 15,
          },
        ]}
        textLoading={false}
        onQueryChange={noop}
        onModeChange={noop}
        onClose={() => setStoryCommandPaletteOpen(false)}
        onOpenPath={noop}
      />
      <ShortcutHelp
        open={storyShortcutHelpOpen}
        onClose={() => setStoryShortcutHelpOpen(false)}
      />
    </div>
  );
}

function combinePublishedAndDraftComments(
  comments: ViviComment[],
  drafts: DraftReviewComment[],
): ViviComment[] {
  return [
    ...comments,
    ...drafts.map((draft) => draftReviewCommentAsViviComment(draft)),
  ].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
