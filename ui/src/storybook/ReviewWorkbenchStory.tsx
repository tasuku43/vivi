import type { CSSProperties, ReactNode } from "react";
import type { TextDiff } from "../domain/change-review.js";
import type { DraftReviewComment, ViviComment } from "../domain/comments.js";
import type { FilePayload, FsNode } from "../domain/fs-node.js";
import { CommandPalette } from "../features/command-palette/CommandPalette.js";
import { CommentsPanel } from "../features/comments/components/CommentsPanel.js";
import { DraftReviewTray } from "../features/comments/components/DraftReviewTray.js";
import { InlineCommentCard } from "../features/comments/components/InlineCommentCard.js";
import { FileViewer } from "../features/file-context/components/FileViewer.js";
import { Inspector } from "../features/review-queue/Inspector.js";
import { ShortcutHelp } from "../shared/components/ShortcutHelp.js";
import { OpenTabs } from "../shared/components/OpenTabs.js";
import { Topbar } from "../shared/components/Topbar.js";
import { TreeSidebar } from "../shared/components/TreeSidebar.js";
import { extractMarkdownOutline } from "../state/outline.js";
import { draftReviewCommentAsViviComment } from "../state/comments.js";
import { defaultViewerMode, type ViewerMode } from "../state/viewer-mode.js";
import type { CommentActivitySummary } from "../state/comment-activity.js";
import type { DiffStat, ReviewChangeItem } from "../state/git-review.js";
import type { ReviewQueueItem } from "../state/review-queue.js";
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
  | "ready"
  | "empty"
  | "loading"
  | "error"
  | "disconnected";

export interface ReviewWorkbenchStoryProps {
  state?: WorkbenchStoryState;
  file?: FilePayload | null;
  nodes?: FsNode[];
  tabs?: OpenTab[];
  comments?: ViviComment[];
  draftComments?: DraftReviewComment[];
  reviewChanges?: ReviewChangeItem[];
  reviewItems?: ReviewQueueItem[];
  diffStats?: Record<string, DiffStat | null>;
  unreadReviewPaths?: Set<string>;
  threadActivities?: Record<string, CommentActivitySummary>;
  diff?: TextDiff | null;
  diffEnabled?: boolean;
  viewerMode?: ViewerMode;
  commentsPanelOpen?: boolean;
  commentsPanelQuery?: string;
  commentsPanelStatus?: "all" | "open" | "resolved" | "archived";
  commandPaletteOpen?: boolean;
  shortcutHelpOpen?: boolean;
  draftPublishing?: boolean;
  draftPublishError?: string | null;
  publishedBatchId?: string | null;
  activeCommentId?: string | null;
  inlineComment?: ViviComment | null;
  inspectorTitle?: ReactNode;
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
  diffStats = sampleReviewDiffStats,
  unreadReviewPaths = sampleUnreadReviewPaths,
  threadActivities = sampleThreadActivities,
  diff = null,
  diffEnabled = false,
  viewerMode,
  commentsPanelOpen = false,
  commentsPanelQuery = "",
  commentsPanelStatus = "all",
  commandPaletteOpen = false,
  shortcutHelpOpen = false,
  draftPublishing = false,
  draftPublishError = null,
  publishedBatchId = null,
  activeCommentId = null,
  inlineComment = null,
  inspectorTitle,
}: ReviewWorkbenchStoryProps) {
  const selectedPath = file?.path ?? null;
  const activeTabs =
    tabs ??
    (file
      ? sampleTabs.some((tab) => tab.path === file.path)
        ? sampleTabs
        : [
            ...sampleTabs,
            { path: file.path, viewerKind: file.viewerKind, paneId: "main" },
          ]
      : []);
  const activeComments = selectedPath
    ? commentsForPath(selectedPath, comments)
    : [];
  const activeDrafts = selectedPath
    ? draftsForPath(selectedPath, draftComments)
    : [];
  const viewerComments = combinePublishedAndDraftComments(
    activeComments,
    activeDrafts,
    comments,
  );
  const outline =
    file?.viewerKind === "markdown" ? extractMarkdownOutline(file.content) : [];
  const resolvedViewerMode =
    viewerMode ?? (file ? defaultViewerMode(file) : undefined);
  const statusLabel =
    state === "disconnected"
      ? "comments watch disconnected"
      : state === "loading"
        ? "loading workspace"
        : state === "error"
          ? "review adapter error"
          : "watching";

  return (
    <div className={`app-shell story-workbench story-workbench-${state}`}>
      <Topbar
        root={state === "empty" ? null : storyRoot}
        themePreference="system"
        openCommentCount={
          comments.filter((comment) => comment.status === "open").length
        }
        onThemeCycle={noop}
        onQuickOpen={noop}
        onSearchText={noop}
        onOpenComments={noop}
        onOpenShortcuts={noop}
      />
      <div
        className="workbench"
        style={
          {
            "--sidebar-width": "290px",
            "--inspector-width": "350px",
          } as CSSProperties
        }
      >
        <aside className="sidebar">
          <div className="panel-title">
            <span>Explorer</span>
            <span className={state === "disconnected" ? "pill active" : "pill"}>
              {state === "disconnected" ? "offline" : "live"}
            </span>
          </div>
          {state === "loading" ? (
            <p className="muted">Loading tree...</p>
          ) : state === "empty" ? (
            <p className="muted compact-empty">No workspace selected.</p>
          ) : (
            <TreeSidebar
              nodes={nodes}
              selectedPath={selectedPath}
              revealPath={selectedPath}
              changedPaths={new Set(reviewChanges.map((change) => change.path))}
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
        <main className="main">
          <section className="editor-pane active" data-pane-id="main">
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
            <div className="pane-focus-badge">Inspector target</div>
            <div className="viewer-pane">
              {state === "error" ? (
                <div className="error">
                  Failed to load comments: simulated adapter failure for
                  Storybook.
                </div>
              ) : state === "loading" ? (
                <div className="empty-viewer" aria-live="polite">
                  Loading preview...
                </div>
              ) : (
                <FileViewer
                  file={state === "empty" ? null : file}
                  allowHtmlScripts={false}
                  theme="light"
                  selectedCodeRange={
                    file?.viewerKind === "code" ? { start: 9, end: 12 } : null
                  }
                  viewerMode={resolvedViewerMode}
                  diff={diff}
                  diffLoading={false}
                  diffEnabled={diffEnabled}
                  diffFocusChanges
                  comments={viewerComments}
                  activeCommentId={activeCommentId}
                  threadActivities={threadActivities}
                  onCodeSelectionChange={noop}
                  onViewerModeChange={noop}
                  onDiffToggle={noop}
                  onDiffFocusChange={noop}
                  onOpenComment={noop}
                  onCloseComment={noop}
                  onCommentStatusChange={noop}
                  onCreateComment={noop}
                />
              )}
            </div>
          </section>
        </main>
        <Inspector
          file={state === "empty" ? null : file}
          outline={outline}
          reviewChanges={reviewChanges}
          reviewItems={reviewItems}
          reviewUnavailableReason={
            state === "disconnected"
              ? "Comment activity subscription disconnected; showing last known review state."
              : null
          }
          reviewDiffStats={diffStats}
          loadingReviewDiffs={
            state === "loading" && selectedPath ? { [selectedPath]: true } : {}
          }
          unreadReviewPaths={unreadReviewPaths}
          comments={activeComments}
          draftComments={activeDrafts}
          commentsLoading={state === "loading"}
          threadActivities={threadActivities}
          selectedCodeRange={
            file?.viewerKind === "code" ? { start: 9, end: 12 } : null
          }
          refreshedAt={
            state === "disconnected" ? Date.now() - 90_000 : undefined
          }
          activePaneId="main"
          onOutlineSelect={noop}
          onOpenEventPath={noop}
          onConfirmEventPath={noop}
          onOpenNextChanged={noop}
          onOpenPreviousChanged={noop}
          onOpenAllChanged={noop}
          onTargetHoverChange={noop}
          onRevealTarget={noop}
          onRevealInTree={noop}
          onOpenComments={noop}
        />
      </div>
      <footer className="statusbar">
        <span>
          {activeTabs.length} tabs · {reviewItems.length} to review ·{" "}
          {nodes.length} root entries
        </span>
        <span>
          {comments.length} comments · {draftComments.length} drafts ·{" "}
          {statusLabel}
        </span>
      </footer>
      {inspectorTitle ? (
        <div className="story-state-note">{inspectorTitle}</div>
      ) : null}
      <CommandPalette
        open={commandPaletteOpen}
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
        actions={[
          {
            id: "next-open-thread",
            label: "Next open thread",
            detail: "Move to the next unresolved review thread",
            shortcut: "Cmd ]",
          },
          {
            id: "publish-drafts",
            label: "Publish draft review comments",
            detail: "Create one PublishedReviewBatch from all drafts",
            shortcut: "Cmd Enter",
            disabled: !draftComments.length,
          },
        ]}
        onQueryChange={noop}
        onModeChange={noop}
        onClose={noop}
        onOpenPath={noop}
        onRunAction={noop}
      />
      <ShortcutHelp open={shortcutHelpOpen} onClose={noop} />
      <CommentsPanel
        open={commentsPanelOpen}
        comments={comments}
        query={commentsPanelQuery}
        statusFilter={commentsPanelStatus}
        threadActivities={threadActivities}
        onQueryChange={noop}
        onStatusFilterChange={noop}
        onClose={noop}
        onOpenComment={noop}
      />
      <DraftReviewTray
        drafts={draftComments}
        publishing={draftPublishing}
        publishError={draftPublishError}
        publishedBatchId={publishedBatchId}
        onOpenPath={noop}
        onUpdateDraft={noop}
        onDeleteDraft={noop}
        onPublishAll={noop}
      />
      <InlineCommentCard
        comment={inlineComment}
        rect={
          inlineComment ? { left: 720, top: 168, width: 220, height: 26 } : null
        }
        onClose={noop}
        onStatusChange={noop}
      />
    </div>
  );
}

function combinePublishedAndDraftComments(
  comments: ViviComment[],
  drafts: DraftReviewComment[],
  allComments: ViviComment[],
): ViviComment[] {
  return [
    ...comments,
    ...drafts.map((draft) =>
      draftReviewCommentAsViviComment(draft, allComments),
    ),
  ].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
