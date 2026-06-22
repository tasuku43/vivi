import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { TextDiff } from "../../domain/change-review.js";
import type {
  CommentStatus,
  DraftReviewComment,
  ViviComment,
} from "../../domain/comments.js";
import type {
  FilePayload,
  FsEvent,
  TreeSnapshot,
  ViewerConfig,
} from "../../domain/fs-node.js";
import { TreeSidebar } from "../../shared/components/TreeSidebar.js";
import { FileViewer } from "../file-context/components/FileViewer.js";
import { Topbar } from "../../shared/components/Topbar.js";
import {
  OpenTabs,
  readDraggedTab,
  type DraggedTabPayload,
  type OpenTab,
} from "../../shared/components/OpenTabs.js";
import { Inspector } from "../review-queue/Inspector.js";
import {
  CommentsPanel,
  type CommentStatusFilter,
} from "../comments/components/CommentsPanel.js";
import { InlineCommentCard } from "../comments/components/InlineCommentCard.js";
import { DraftReviewTray } from "../comments/components/DraftReviewTray.js";
import { CommandPalette } from "../command-palette/CommandPalette.js";
import { ShortcutHelp } from "../../shared/components/ShortcutHelp.js";
import { WorkspaceRestoreNotice } from "../../shared/components/WorkspaceRestoreNotice.js";
import {
  extractHtmlOutline,
  extractMarkdownOutline,
} from "../../state/outline.js";
import type { LineRange } from "../../state/code-viewer.js";
import type {
  FileSearchResult,
  TextSearchResult,
} from "../../domain/search.js";
import {
  recordReviewEvent,
  summarizeReviewEvents,
  type ReviewEvent,
} from "../../state/review-events.js";
import {
  closeOtherOpenTabs,
  closeOpenTab,
  closePreviewTabs,
  closeTabsToRight,
  closeUnchangedTabs,
  markTabChanged,
  markTabLoaded,
  markTabRemoved,
  moveOpenTab,
  promoteOpenTab,
  upsertOpenTab,
  type OpenTabMode,
} from "../../state/tabs.js";
import {
  closePaneIfEmpty,
  flattenPanes,
  initialEditorLayout,
  setPaneActivePath,
  splitEditorPane,
  type EditorLayoutNode,
  type EditorPane,
  type SplitDirection,
  type SplitEdge,
} from "../../state/editor-layout.js";
import {
  filterTreeToPaths,
  replaceDirectoryChildren,
} from "../../state/files.js";
import {
  activePanePaths,
  decideLiveRefresh,
  shouldApplyLiveRefresh,
} from "../../state/live-refresh.js";
import {
  buildDiffStat,
  isReviewChangeOpenable,
  mergeReviewChanges,
  type GitChangeReviewState,
} from "../../state/git-review.js";
import {
  activityNeedsHumanAttention,
  buildReviewQueueItems,
  latestUnreadReviewItemPath,
  nextReviewQueueItemPath,
} from "../../state/review-queue.js";
import {
  shouldLoadInitialGitReview,
  shouldPollGitReview,
  shouldStartGitReviewPolling,
  startGitReviewPolling,
} from "../../state/git-review-refresh.js";
import {
  activeCommentsForPath,
  draftReviewCommentAsViviComment,
  type CommentDraft,
} from "../../state/comments.js";
import {
  addCommentActivities,
  addCommentActivity,
  emptyCommentActivityState,
  summarizeThreadActivity,
  type CommentActivitySummary,
} from "../../state/comment-activity.js";
import {
  isThemePreference,
  nextThemePreference,
  resolveThemePreference,
  themeStorageKey,
  type ResolvedTheme,
  type ThemePreference,
} from "../../state/theme.js";
import {
  clampInspectorWidth,
  clampSidebarWidth,
  compactSidebarWidth,
  defaultInspectorWidth,
  defaultSidebarWidth,
  shouldCollapseInspector,
} from "../../state/workbench-layout.js";
import {
  buildWorkspaceSession,
  parseWorkspaceSession,
  recordRecentFile,
  restoreOnlyActiveWorkspaceTab,
  restoreWorkspaceSession,
  shouldPromptForWorkspaceSessionRestore,
  workspaceSessionStorageKey,
  workspaceSessionStorageKeyForRoot,
  workspaceSessionTtlMs,
  type RecentFile,
  type StoredWorkspaceSessionV1,
  type WorkspaceSessionState,
} from "../../state/workspace-session.js";
import {
  defaultViewerMode,
  diffSupportForFile,
  nextViewerMode,
  supportsDiffMode,
  supportsSourceToggle,
  type ViewerMode,
} from "../../state/viewer-mode.js";
import type {
  CommandActionItem,
  SearchPaletteMode,
} from "../../state/search-palette.js";
import { keyboardShortcutAction } from "../../state/shortcuts.js";
import {
  agentReplyNavigationTargets,
  draftCommentNavigationTargets,
  firstRelevantThreadForReviewItem,
  latestUnreadActivityTarget,
  moveReviewNavigationTarget,
  openThreadNavigationTargets,
  unresolvedThreadNavigationTargets,
  type ReviewNavigationTarget,
} from "../../state/review-navigation.js";
import type { ViviClient } from "../../application/ports/ViviClient.js";

interface LiveRefreshMetrics {
  fsEventsReceived: number;
  gitRefreshes: number;
  diffRefreshes: number;
  lastGitRefreshMs: number | null;
  lastDiffRefreshMs: number | null;
  pendingGitRefresh: boolean;
  pendingDiffPaths: number;
}

export function WorkbenchContainer({ client }: { client: ViviClient }) {
  const [tree, setTree] = useState<TreeSnapshot | null>(null);
  const [config, setConfig] = useState<ViewerConfig | null>(null);
  const [layout, setLayout] = useState(initialEditorLayout);
  const [files, setFiles] = useState<Record<string, FilePayload>>({});
  const [openTabs, setOpenTabs] = useState<OpenTab[]>([]);
  const [recentFiles, setRecentFiles] = useState<RecentFile[]>([]);
  const [recentEvents, setRecentEvents] = useState<ReviewEvent[]>([]);
  const [unreadReviewPaths, setUnreadReviewPaths] = useState<string[]>([]);
  const [liveMetrics, setLiveMetrics] = useState<LiveRefreshMetrics>({
    fsEventsReceived: 0,
    gitRefreshes: 0,
    diffRefreshes: 0,
    lastGitRefreshMs: null,
    lastDiffRefreshMs: null,
    pendingGitRefresh: false,
    pendingDiffPaths: 0,
  });
  const [gitReview, setGitReview] = useState<GitChangeReviewState | null>(null);
  const gitReviewRef = useRef<GitChangeReviewState | null>(null);
  const initialGitReviewRequested = useRef(false);
  const [diffs, setDiffs] = useState<Record<string, TextDiff>>({});
  const [loadingDiffs, setLoadingDiffs] = useState<Record<string, boolean>>({});
  const [diffEnabled, setDiffEnabled] = useState(false);
  const [diffFocusByPath, setDiffFocusByPath] = useState<
    Record<string, boolean>
  >({});
  const [comments, setComments] = useState<ViviComment[]>([]);
  const [draftComments, setDraftComments] = useState<DraftReviewComment[]>([]);
  const [draftPublishing, setDraftPublishing] = useState(false);
  const [draftPublishError, setDraftPublishError] = useState<string | null>(
    null,
  );
  const [lastPublishedReviewBatchId, setLastPublishedReviewBatchId] = useState<
    string | null
  >(null);
  const [commentActivity, setCommentActivity] = useState(
    emptyCommentActivityState,
  );
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentsPanelOpen, setCommentsPanelOpen] = useState(false);
  const [commentsPanelQuery, setCommentsPanelQuery] = useState("");
  const [commentsPanelStatus, setCommentsPanelStatus] =
    useState<CommentStatusFilter>("open");
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null);
  const [activeCommentRect, setActiveCommentRect] =
    useState<DOMRectLike | null>(null);
  const [viewerModes, setViewerModes] = useState<Record<string, ViewerMode>>(
    {},
  );
  const [codeSelections, setCodeSelections] = useState<
    Record<string, LineRange | null>
  >({});
  const [refreshedFiles, setRefreshedFiles] = useState<Record<string, number>>(
    {},
  );
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false);
  const [paletteMode, setPaletteMode] = useState<SearchPaletteMode>("file");
  const [paletteQuery, setPaletteQuery] = useState("");
  const [fileSearchResults, setFileSearchResults] = useState<
    FileSearchResult[]
  >([]);
  const [fileSearchLoading, setFileSearchLoading] = useState(false);
  const [textSearchResults, setTextSearchResults] = useState<
    TextSearchResult[]
  >([]);
  const [textSearchLoading, setTextSearchLoading] = useState(false);
  const [loadingDirectoryPaths, setLoadingDirectoryPaths] = useState<
    Set<string>
  >(new Set());
  const [draggingTab, setDraggingTab] = useState(false);
  const [manualDraggedTab, setManualDraggedTab] =
    useState<DraggedTabPayload | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    paneId: string;
    edge: SplitEdge;
  } | null>(null);
  const [themePreference, setThemePreference] = useState<ThemePreference>(
    readStoredThemePreference,
  );
  const [systemTheme, setSystemTheme] =
    useState<ResolvedTheme>(readSystemTheme);
  const [viewportWidth, setViewportWidth] = useState(readViewportWidth);
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [inspectorVisible, setInspectorVisible] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(defaultSidebarWidth);
  const [inspectorWidth, setInspectorWidth] = useState(defaultInspectorWidth);
  const [resizingWorkbenchPane, setResizingWorkbenchPane] = useState<
    "sidebar" | "inspector" | null
  >(null);
  const [treeChangedOnly, setTreeChangedOnly] = useState(false);
  const [treeReveal, setTreeReveal] = useState<{
    path: string;
    revision: number;
  } | null>(null);
  const [workspaceSessionReady, setWorkspaceSessionReady] = useState(false);
  const [pendingRestoreSession, setPendingRestoreSession] =
    useState<WorkspaceSessionState | null>(null);
  const [restoreNoticeTabCount, setRestoreNoticeTabCount] = useState<
    number | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const gitRefreshTimer = useRef<number | null>(null);
  const knownReviewPaths = useRef(new Set<string>());
  const gitRefreshInFlight = useRef(false);
  const gitRefreshQueued = useRef(false);
  const gitReviewLastAttemptMs = useRef<number | null>(null);
  const diffRefreshTimer = useRef<number | null>(null);
  const pendingDiffRefreshPaths = useRef(new Set<string>());
  const diffRequestVersions = useRef<Record<string, number>>({});
  const activeFilePaths = useRef<Set<string>>(new Set());
  const diffEnabledRef = useRef(diffEnabled);
  const liveFileRefreshTimers = useRef<Record<string, number>>({});
  const liveFileRefreshVersions = useRef<Record<string, number>>({});
  const loadedActivityThreadIds = useRef(new Set<string>());

  async function loadTree() {
    setTree(await client.getTree({ depth: 1 }));
  }

  async function loadDirectory(path: string) {
    setLoadingDirectoryPaths((items) => new Set(items).add(path));
    try {
      const snapshot = await client.getTree({ path, depth: 1 });
      setTree((current) => {
        if (!current) return snapshot;
        return {
          ...current,
          version: snapshot.version,
          nodes: replaceDirectoryChildren(current.nodes, path, snapshot.nodes),
        };
      });
    } finally {
      setLoadingDirectoryPaths((items) => {
        const next = new Set(items);
        next.delete(path);
        return next;
      });
    }
  }

  async function loadConfig() {
    setConfig(await client.getConfig());
  }

  async function loadGitReview() {
    const startedAt = performance.now();
    gitReviewLastAttemptMs.current = Date.now();
    const nextGitReview = await client.getReviewQueue();
    gitReviewRef.current = nextGitReview;
    setGitReview(nextGitReview);
    setLiveMetrics((metrics) => ({
      ...metrics,
      gitRefreshes: metrics.gitRefreshes + 1,
      lastGitRefreshMs: Math.round(performance.now() - startedAt),
      pendingGitRefresh: false,
    }));
  }

  async function loadHeadDiff(path: string) {
    const requestVersion = (diffRequestVersions.current[path] ?? 0) + 1;
    diffRequestVersions.current[path] = requestVersion;
    const startedAt = performance.now();
    setLoadingDiffs((items) => ({ ...items, [path]: true }));
    try {
      const diff = await client.getDiff({ path, base: "HEAD" });
      if (diffRequestVersions.current[path] !== requestVersion) return;
      setDiffs((items) => ({
        ...items,
        [path]: diff,
      }));
      setLiveMetrics((metrics) => ({
        ...metrics,
        diffRefreshes: metrics.diffRefreshes + 1,
        lastDiffRefreshMs: Math.round(performance.now() - startedAt),
      }));
    } finally {
      if (diffRequestVersions.current[path] === requestVersion) {
        setLoadingDiffs((items) => ({ ...items, [path]: false }));
      }
    }
  }

  async function loadComments(path: string | null = selectedPath) {
    setCommentsLoading(true);
    try {
      const loaded = await client.getComments(path ? { path } : undefined);
      setComments((items) => mergeComments(items, loaded, path));
    } finally {
      setCommentsLoading(false);
    }
  }

  async function loadDraftReviewComments(path?: string) {
    const loaded = await client.getDraftReviewComments(
      path ? { path } : undefined,
    );
    setDraftComments((items) =>
      mergeDraftComments(items, loaded, path ?? null),
    );
  }

  async function loadThreadActivities(threadIds: string[]) {
    if (!client.getCommentThreadActivities) return;
    const targets = threadIds
      .filter((threadId) => !loadedActivityThreadIds.current.has(threadId))
      .slice(0, 24);
    if (!targets.length) return;
    targets.forEach((threadId) =>
      loadedActivityThreadIds.current.add(threadId),
    );
    try {
      const results = await Promise.all(
        targets.map((threadId) =>
          client.getCommentThreadActivities!({ threadId, first: 12 }),
        ),
      );
      setCommentActivity((state) =>
        addCommentActivities(state, results.flat()),
      );
    } catch (err) {
      targets.forEach((threadId) =>
        loadedActivityThreadIds.current.delete(threadId),
      );
      throw err;
    }
  }

  async function createComment(
    draft: CommentDraft,
    body: string,
    rect?: DOMRectLike,
  ) {
    const trimmedBody = body.trim();
    if (!trimmedBody) return;
    const draftComment = await client.createDraftReviewComment({
      ...draft,
      body: trimmedBody,
      source: "human",
    });
    setDraftPublishError(null);
    setLastPublishedReviewBatchId(null);
    setDraftComments((items) =>
      mergeDraftComments(items, [draftComment], null),
    );
    setActiveCommentId(null);
    setActiveCommentRect(rect ?? null);
  }

  async function updateDraftReviewComment(id: string, body: string) {
    const draft = await client.updateDraftReviewComment({ id, body });
    setDraftPublishError(null);
    setLastPublishedReviewBatchId(null);
    setDraftComments((items) => mergeDraftComments(items, [draft], null));
  }

  async function deleteDraftReviewComment(id: string) {
    await client.deleteDraftReviewComment(id);
    setDraftPublishError(null);
    setLastPublishedReviewBatchId(null);
    setDraftComments((items) => items.filter((draft) => draft.id !== id));
  }

  async function publishDraftReviewComments() {
    if (!draftComments.length) return;
    setDraftPublishing(true);
    setDraftPublishError(null);
    setLastPublishedReviewBatchId(null);
    try {
      const batch = await client.publishDraftReviewComments();
      setComments((items) =>
        mergeComments(
          items,
          batch.threads.flatMap((thread) => thread.comments),
          null,
        ),
      );
      setDraftComments([]);
      setLastPublishedReviewBatchId(batch.reviewBatchId);
      await loadComments(null);
    } catch (err) {
      setDraftPublishError(errorMessage(err));
      throw err;
    } finally {
      setDraftPublishing(false);
    }
  }

  async function updateCommentStatus(id: string, status: CommentStatus) {
    const comment = comments.find((item) => item.id === id);
    const thread = await client.updateCommentThreadStatus({
      id: comment?.threadId ?? id,
      status,
    });
    setComments((items) => mergeComments(items, thread.comments, null));
  }

  function openInlineComment(id: string, rect: DOMRectLike) {
    setActiveCommentId(id);
    setActiveCommentRect(rect);
  }

  function closeInlineComment() {
    setActiveCommentId(null);
    setActiveCommentRect(null);
  }

  async function openCommentFromPanel(comment: ViviComment) {
    setCommentsPanelOpen(false);
    setDiffEnabled(false);
    setViewerModes((items) => ({ ...items, [comment.path]: "source" }));
    await loadFile(comment.path, layout.activePaneId, "normal");
    setActiveCommentId(comment.id);
    setActiveCommentRect(null);
  }

  const panes = useMemo(() => flattenPanes(layout), [layout]);
  const activePane =
    panes.find((pane) => pane.id === layout.activePaneId) ?? panes[0];
  const selectedPath = activePane?.activePath ?? null;
  const file = selectedPath ? (files[selectedPath] ?? null) : null;
  const activeTab = selectedPath
    ? openTabs.find(
        (tab) =>
          tab.path === selectedPath && tab.paneId === layout.activePaneId,
      )
    : null;
  const activeFileComments = useMemo(
    () => (selectedPath ? activeCommentsForPath(comments, selectedPath) : []),
    [comments, selectedPath],
  );
  const activeFileDraftComments = useMemo(
    () =>
      selectedPath
        ? draftComments.filter((draft) => draft.path === selectedPath)
        : [],
    [draftComments, selectedPath],
  );
  const allCommentMessages = useMemo(
    () => combinePublishedAndDraftComments(comments, draftComments),
    [comments, draftComments],
  );
  const commentActivitySummaries = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(commentActivity.byThreadId).map(([threadId, events]) => [
          threadId,
          summarizeThreadActivity(events),
        ]),
      ) as Record<string, CommentActivitySummary>,
    [commentActivity.byThreadId],
  );
  const activeComment = activeCommentId
    ? (allCommentMessages.find((comment) => comment.id === activeCommentId) ??
      null)
    : null;
  const visibleActiveComment =
    activeComment?.path === selectedPath ? activeComment : null;
  const activeViewerMode = file
    ? (viewerModes[file.path] ?? defaultViewerMode(file))
    : undefined;
  const usesInlineCommentThread = Boolean(
    !diffEnabled &&
    visibleActiveComment &&
    ((file?.viewerKind === "markdown" && activeViewerMode === "rendered") ||
      ((file?.viewerKind === "code" ||
        (file?.viewerKind === "markdown" && activeViewerMode === "source")) &&
        visibleActiveComment.anchor.canonical.lineStart)),
  );
  const openCommentCount = comments.filter(
    (comment) => comment.status === "open",
  ).length;
  const activeFileRemoved = Boolean(activeTab?.removed);
  const effectiveSidebarWidth = compactSidebarWidth(
    sidebarWidth,
    viewportWidth,
  );
  const effectiveSidebarVisible = sidebarVisible;
  const effectiveInspectorVisible =
    inspectorVisible && !shouldCollapseInspector(viewportWidth);
  const workbenchClassName = [
    "workbench",
    effectiveSidebarVisible ? "" : "sidebar-hidden",
    effectiveInspectorVisible ? "" : "inspector-hidden",
  ]
    .filter(Boolean)
    .join(" ");
  const resolvedTheme = resolveThemePreference(themePreference, systemTheme);
  const recentActivityEvents = useMemo(
    () =>
      recentEvents.filter(
        (item) => Date.now() - item.receivedAt <= recentEventWindowMs,
      ),
    [recentEvents],
  );
  const reviewState = useMemo(
    () => summarizeReviewEvents(recentActivityEvents),
    [recentActivityEvents],
  );
  const reviewChanges = useMemo(
    () => mergeReviewChanges(reviewState, gitReview),
    [gitReview, reviewState],
  );
  const reviewDiffStats = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(diffs).map(([path, diff]) => [
          path,
          buildDiffStat(diff),
        ]),
      ),
    [diffs],
  );
  const unreadReviewPathSet = useMemo(
    () => new Set(unreadReviewPaths),
    [unreadReviewPaths],
  );
  const reviewItems = useMemo(
    () =>
      buildReviewQueueItems(
        reviewChanges,
        comments,
        commentActivitySummaries,
        unreadReviewPathSet,
      ),
    [commentActivitySummaries, comments, reviewChanges, unreadReviewPathSet],
  );
  const openThreadTargets = useMemo(
    () => openThreadNavigationTargets(comments),
    [comments],
  );
  const currentFileOpenThreadTargets = useMemo(
    () => openThreadNavigationTargets(comments, { path: selectedPath }),
    [comments, selectedPath],
  );
  const currentReviewBatchId = activeComment?.reviewBatchId ?? null;
  const currentBatchThreadTargets = useMemo(
    () =>
      currentReviewBatchId
        ? openThreadNavigationTargets(comments, {
            reviewBatchId: currentReviewBatchId,
          })
        : [],
    [comments, currentReviewBatchId],
  );
  const draftTargets = useMemo(
    () => draftCommentNavigationTargets(draftComments),
    [draftComments],
  );
  const agentReplyTargets = useMemo(
    () => agentReplyNavigationTargets(comments),
    [comments],
  );
  const latestUnreadTarget = useMemo(
    () => latestUnreadActivityTarget(reviewItems),
    [reviewItems],
  );
  const changedPathSet = useMemo(
    () => new Set(reviewChanges.map((change) => change.path)),
    [reviewChanges],
  );
  const activityThreadTargets = useMemo(
    () =>
      commentActivityThreadTargets({
        comments,
        selectedPath,
        commentsPanelOpen,
        commentsPanelQuery,
        commentsPanelStatus,
        reviewPaths: reviewItems.slice(0, 24).map((item) => item.path),
      }),
    [
      comments,
      commentsPanelOpen,
      commentsPanelQuery,
      commentsPanelStatus,
      reviewItems,
      selectedPath,
    ],
  );
  const sidebarNodes = useMemo(
    () =>
      treeChangedOnly && tree
        ? filterTreeToPaths(tree.nodes, changedPathSet)
        : (tree?.nodes ?? []),
    [changedPathSet, tree, treeChangedOnly],
  );

  useEffect(() => {
    activeFilePaths.current = activePanePaths(panes);
  }, [panes]);

  useEffect(() => {
    diffEnabledRef.current = diffEnabled;
  }, [diffEnabled]);

  async function fetchFilePayload(path: string): Promise<FilePayload> {
    return (await client.getFileContext({ path })).file;
  }

  async function loadFile(
    path: string,
    paneId = layout.activePaneId,
    mode: OpenTabMode = "preview",
  ): Promise<FilePayload> {
    setActiveCommentId(null);
    setActiveCommentRect(null);
    setLayout((current) => setPaneActivePath(current, paneId, path));
    setError(null);
    const payload = await fetchFilePayload(path);
    setFiles((items) => ({ ...items, [payload.path]: payload }));
    setOpenTabs((tabs) => upsertOpenTab(tabs, payload, paneId, mode));
    setRecentFiles((items) => recordRecentFile(items, payload));
    markReviewPathRead(payload.path);
    void loadComments(payload.path).catch((err) => setError(String(err)));
    if (diffEnabled && supportsDiffMode(payload)) {
      void loadHeadDiff(payload.path).catch((err) => setError(String(err)));
    }
    return payload;
  }

  function scheduleLiveFileRefresh(path: string, delayMs = 75) {
    const requestVersion = (liveFileRefreshVersions.current[path] ?? 0) + 1;
    liveFileRefreshVersions.current[path] = requestVersion;
    const existing = liveFileRefreshTimers.current[path];
    if (existing) window.clearTimeout(existing);
    liveFileRefreshTimers.current[path] = window.setTimeout(() => {
      delete liveFileRefreshTimers.current[path];
      void refreshLiveFile(path, requestVersion);
    }, delayMs);
  }

  async function refreshLiveFile(
    path: string,
    requestVersion: number,
  ): Promise<void> {
    try {
      const payload = await fetchFilePayload(path);
      if (
        !shouldApplyLiveRefresh(
          liveFileRefreshVersions.current,
          path,
          requestVersion,
        )
      ) {
        return;
      }
      setError(null);
      setFiles((items) => ({ ...items, [payload.path]: payload }));
      setOpenTabs((tabs) => markTabLoaded(tabs, payload));
      setRefreshedFiles((items) => ({
        ...items,
        [payload.path]: Date.now(),
      }));
      markReviewPathRead(payload.path);
    } catch (err) {
      if (
        shouldApplyLiveRefresh(
          liveFileRefreshVersions.current,
          path,
          requestVersion,
        )
      ) {
        setError(String(err));
      }
    }
  }

  async function openHeadDiff(path: string, paneId = layout.activePaneId) {
    const payload = await loadFile(path, paneId, "preview");
    if (!supportsDiffMode(payload)) return;
    setDiffEnabled(true);
    await loadHeadDiff(path);
  }

  function scheduleGitReviewRefresh(delayMs = 250) {
    gitRefreshQueued.current = true;
    setLiveMetrics((metrics) => ({
      ...metrics,
      pendingGitRefresh: true,
    }));
    if (gitRefreshTimer.current) {
      window.clearTimeout(gitRefreshTimer.current);
    }
    gitRefreshTimer.current = window.setTimeout(() => {
      gitRefreshTimer.current = null;
      void runQueuedGitReviewRefresh();
    }, delayMs);
  }

  async function runQueuedGitReviewRefresh(): Promise<void> {
    if (gitRefreshInFlight.current) return;
    if (!gitRefreshQueued.current) return;

    gitRefreshQueued.current = false;
    gitRefreshInFlight.current = true;
    try {
      await loadGitReview();
    } catch (err) {
      setLiveMetrics((metrics) => ({
        ...metrics,
        pendingGitRefresh: false,
      }));
      setError(String(err));
    } finally {
      gitRefreshInFlight.current = false;
      if (gitRefreshQueued.current) scheduleGitReviewRefresh(50);
    }
  }

  function scheduleDiffRefresh(path: string, delayMs = 250) {
    pendingDiffRefreshPaths.current.add(path);
    setLiveMetrics((metrics) => ({
      ...metrics,
      pendingDiffPaths: pendingDiffRefreshPaths.current.size,
    }));
    if (diffRefreshTimer.current) {
      window.clearTimeout(diffRefreshTimer.current);
    }
    diffRefreshTimer.current = window.setTimeout(() => {
      diffRefreshTimer.current = null;
      const paths = [...pendingDiffRefreshPaths.current];
      pendingDiffRefreshPaths.current.clear();
      setLiveMetrics((metrics) => ({
        ...metrics,
        pendingDiffPaths: 0,
      }));
      for (const path of paths) {
        void loadHeadDiff(path).catch((err) => setError(String(err)));
      }
    }, delayMs);
  }

  function toggleHeadDiff(path = selectedPath) {
    const nextEnabled = !diffEnabled;
    if (nextEnabled && path) {
      const target = files[path];
      if (target) {
        const support = diffSupportForFile(target);
        if (!support.supported) {
          setError(`Diff is not available for ${path}: ${support.reason}`);
          return;
        }
      }
    }
    setDiffEnabled(nextEnabled);
    if (nextEnabled && path) {
      void loadHeadDiff(path).catch((err) => setError(String(err)));
    }
  }

  async function hydrateRestoredFiles(
    restoredLayout: EditorLayoutNode,
    restoredDiffEnabled = false,
  ) {
    const activePaths = [
      ...new Set(
        flattenPanes({
          root: restoredLayout,
          activePaneId: "main",
          nextPaneNumber: 1,
        }).flatMap((pane) => (pane.activePath ? [pane.activePath] : [])),
      ),
    ];
    const payloads = await Promise.all(activePaths.map(fetchFilePayload));
    setFiles((items) => {
      const next = { ...items };
      for (const payload of payloads) next[payload.path] = payload;
      return next;
    });
    if (restoredDiffEnabled) {
      for (const payload of payloads) {
        if (supportsDiffMode(payload)) {
          void loadHeadDiff(payload.path).catch((err) => setError(String(err)));
        }
      }
    }
  }

  function closeTab(path: string, paneId = layout.activePaneId) {
    setOpenTabs((tabs) => {
      const pane = panes.find((item) => item.id === paneId);
      const result = closeOpenTab(tabs, path, pane?.activePath ?? null, paneId);
      setLayout((current) => {
        const next = setPaneActivePath(current, paneId, result.nextActivePath);
        return closePaneIfEmpty(
          next,
          paneId,
          result.tabs.some((tab) => tab.paneId === paneId),
        );
      });
      if (result.nextActivePath && !files[result.nextActivePath]) {
        void loadFile(result.nextActivePath, paneId, "preserve").catch((err) =>
          setError(String(err)),
        );
      }
      return result.tabs;
    });
  }

  function openFromPalette(path: string, preview: boolean) {
    setPaletteOpen(false);
    setPaletteQuery("");
    void loadFile(
      path,
      layout.activePaneId,
      preview ? "preview" : "normal",
    ).catch((err) => setError(String(err)));
  }

  function openPalette(mode: SearchPaletteMode) {
    setPaletteMode(mode);
    setPaletteQuery("");
    setShortcutHelpOpen(false);
    setPaletteOpen(true);
  }

  const commandActions = useMemo<CommandActionItem[]>(
    () => [
      {
        id: "toggle-sidebar",
        label: sidebarVisible ? "Collapse sidebar" : "Expand sidebar",
        detail: "Show or hide the file tree sidebar",
      },
      {
        id: "toggle-inspector",
        label: inspectorVisible ? "Collapse inspector" : "Expand inspector",
        detail: "Show or hide the review inspector",
      },
      {
        id: "next-open-thread",
        label: "Next open thread",
        detail:
          "Move to the next unresolved review thread across the workspace",
        shortcut: "Cmd ]",
        disabled: !openThreadTargets.length,
      },
      {
        id: "previous-open-thread",
        label: "Previous open thread",
        detail: "Move to the previous unresolved review thread",
        shortcut: "Cmd [",
        disabled: !openThreadTargets.length,
      },
      {
        id: "next-current-file-thread",
        label: "Next thread in current file",
        detail: "Stay in the active file while moving through open threads",
        disabled: !currentFileOpenThreadTargets.length,
      },
      {
        id: "previous-current-file-thread",
        label: "Previous thread in current file",
        detail: "Move backward through open threads in the active file",
        disabled: !currentFileOpenThreadTargets.length,
      },
      {
        id: "next-batch-thread",
        label: "Next thread in current review batch",
        detail: "Use reviewBatchId metadata when the active thread has it",
        disabled: !currentBatchThreadTargets.length,
      },
      {
        id: "next-draft-comment",
        label: "Next draft comment",
        detail: "Review unpublished draft comments before publishing",
        disabled: !draftTargets.length,
      },
      {
        id: "previous-draft-comment",
        label: "Previous draft comment",
        detail: "Move backward through unpublished draft comments",
        disabled: !draftTargets.length,
      },
      {
        id: "next-agent-reply",
        label: "Next agent reply",
        detail: "Jump to the most recent Codex or Claude Code reply",
        disabled: !agentReplyTargets.length,
      },
      {
        id: "latest-unread-activity",
        label: "Latest unread activity",
        detail: "Open the next review item marked as unseen",
        shortcut: "Cmd Shift U",
        disabled: !latestUnreadTarget,
      },
      {
        id: "next-unresolved-thread",
        label: "Next unresolved thread",
        detail:
          "Alias for the next open thread; resolved and archived stay in history",
        disabled: !openThreadTargets.length,
      },
      {
        id: "toggle-source",
        label: "Toggle source/rendered",
        detail: "Switch Markdown or HTML between source and rendered preview",
        shortcut: "Cmd E",
        disabled: !supportsSourceToggle(file),
      },
      {
        id: "toggle-diff",
        label: "Toggle diff",
        detail: "Show or hide the read-only diff from HEAD",
        shortcut: "Cmd D",
        disabled: !supportsDiffMode(file),
      },
      {
        id: "show-source",
        label: "Show source",
        detail: "Switch the active viewer to source mode",
        disabled: !file,
      },
      {
        id: "show-rendered",
        label: "Show rendered",
        detail: "Switch Markdown or HTML to rendered/preview mode",
        disabled: !supportsSourceToggle(file),
      },
      {
        id: "show-diff",
        label: "Show diff",
        detail: "Switch the active viewer to diff from HEAD",
        disabled: !supportsDiffMode(file),
      },
      {
        id: "focus-review-queue",
        label: "Focus Review Queue",
        detail: "Move keyboard focus to the active review work list",
        shortcut: "Cmd Shift R",
        disabled: !reviewItems.length,
      },
      {
        id: "focus-comments-panel",
        label: "Focus Comments panel",
        detail: "Open and focus the workspace comments panel",
        shortcut: "Cmd Shift C",
      },
      {
        id: "focus-inline-thread",
        label: "Focus current inline thread",
        detail: "Move focus to the active inline comment thread",
        shortcut: "Cmd I",
        disabled: !activeCommentId && !currentFileOpenThreadTargets.length,
      },
    ],
    [
      activeCommentId,
      agentReplyTargets.length,
      currentBatchThreadTargets.length,
      currentFileOpenThreadTargets.length,
      draftTargets.length,
      file,
      inspectorVisible,
      latestUnreadTarget,
      openThreadTargets.length,
      reviewItems.length,
      sidebarVisible,
    ],
  );

  function openAllChangedFiles() {
    for (const change of reviewChanges) {
      if (!isReviewChangeOpenable(change)) continue;
      const { path } = change;
      void loadFile(path, layout.activePaneId, "normal").catch((err) =>
        setError(String(err)),
      );
    }
  }

  function openReviewQueueFile(direction: "next" | "previous") {
    const path = nextReviewQueueItemPath(reviewItems, selectedPath, direction);
    if (path) openReviewQueueItem(path, "preview");
  }

  function openLatestUnreadReviewFile() {
    const path = latestUnreadReviewItemPath(reviewItems);
    if (path) openReviewQueueItem(path, "preview");
  }

  function openReviewQueueItem(path: string, mode: OpenTabMode) {
    const item = reviewItems.find((candidate) => candidate.path === path);
    const target = item
      ? firstRelevantThreadForReviewItem(item, comments)
      : null;
    if (target) {
      void openReviewTarget(target, mode).catch((err) => setError(String(err)));
      return;
    }
    void loadFile(path, layout.activePaneId, mode).catch((err) =>
      setError(String(err)),
    );
  }

  async function openReviewTarget(
    target: ReviewNavigationTarget,
    mode: OpenTabMode = "preview",
  ) {
    setPaletteOpen(false);
    setShortcutHelpOpen(false);
    setCommentsPanelOpen(false);
    const payload = await loadFile(target.path, layout.activePaneId, mode);
    const targetComment = target.commentId
      ? allCommentMessages.find((comment) => comment.id === target.commentId)
      : null;
    if (target.surface === "diff") {
      if (supportsDiffMode(payload)) {
        setDiffEnabled(true);
        await loadHeadDiff(target.path);
      }
    } else {
      setDiffEnabled(false);
      if (target.surface === "source") {
        setViewerModes((items) => ({ ...items, [target.path]: "source" }));
      }
      if (target.surface === "rendered") {
        setViewerModes((items) => ({
          ...items,
          [target.path]:
            targetComment?.viewerKind === "html" ? "preview" : "rendered",
        }));
      }
    }
    if (target.commentId) {
      setActiveCommentId(target.commentId);
      setActiveCommentRect(null);
      window.setTimeout(() => focusCurrentInlineThread(), 120);
    }
  }

  function openMovedTarget(
    targets: ReviewNavigationTarget[],
    direction: "next" | "previous",
  ) {
    const activeDraftId =
      activeComment &&
      "draftId" in activeComment &&
      typeof activeComment.draftId === "string"
        ? activeComment.draftId
        : null;
    const target = moveReviewNavigationTarget(
      targets,
      {
        path: selectedPath,
        commentId: activeCommentId,
        draftId: activeDraftId,
      },
      direction,
    );
    if (target)
      void openReviewTarget(target).catch((err) => setError(String(err)));
  }

  function toggleSourceRendered(path = selectedPath) {
    if (!path) return;
    const target = files[path] ?? file;
    const next = nextViewerMode(
      target,
      viewerModes[path] ?? (target ? defaultViewerMode(target) : undefined),
    );
    if (!next) return;
    setDiffEnabled(false);
    setViewerModes((items) => ({ ...items, [path]: next }));
  }

  function setActiveViewerSurface(surface: "source" | "rendered" | "diff") {
    if (!selectedPath) return;
    if (surface === "diff") {
      if (!file || !supportsDiffMode(file)) return;
      setDiffEnabled(true);
      void loadHeadDiff(selectedPath).catch((err) => setError(String(err)));
      return;
    }
    setDiffEnabled(false);
    if (surface === "source") {
      setViewerModes((items) => ({ ...items, [selectedPath]: "source" }));
      return;
    }
    if (file?.viewerKind === "html") {
      setViewerModes((items) => ({ ...items, [selectedPath]: "preview" }));
    } else if (file?.viewerKind === "markdown") {
      setViewerModes((items) => ({ ...items, [selectedPath]: "rendered" }));
    }
  }

  function focusReviewQueue() {
    setInspectorVisible(true);
    window.setTimeout(() => {
      document
        .querySelector<HTMLButtonElement>(
          ".review-queue .change-open:not(:disabled)",
        )
        ?.focus();
    }, 0);
  }

  function focusCommentsPanel() {
    setPaletteOpen(false);
    setShortcutHelpOpen(false);
    setCommentsPanelOpen(true);
    window.setTimeout(() => {
      document
        .querySelector<HTMLInputElement>(".global-comments-panel input")
        ?.focus();
    }, 0);
  }

  function focusCurrentInlineThread() {
    if (!activeCommentId) {
      openMovedTarget(currentFileOpenThreadTargets, "next");
      return;
    }
    const target =
      Array.from(
        document.querySelectorAll<HTMLElement>("[data-comment-id]"),
      ).find((element) => element.dataset.commentId === activeCommentId) ??
      document.querySelector<HTMLElement>(".inline-comment-card");
    target?.focus();
  }

  function runCommandAction(id: string) {
    if (id === "next-open-thread" || id === "next-unresolved-thread")
      openMovedTarget(openThreadTargets, "next");
    if (id === "previous-open-thread")
      openMovedTarget(openThreadTargets, "previous");
    if (id === "next-current-file-thread")
      openMovedTarget(currentFileOpenThreadTargets, "next");
    if (id === "previous-current-file-thread")
      openMovedTarget(currentFileOpenThreadTargets, "previous");
    if (id === "next-batch-thread")
      openMovedTarget(currentBatchThreadTargets, "next");
    if (id === "next-draft-comment") openMovedTarget(draftTargets, "next");
    if (id === "previous-draft-comment")
      openMovedTarget(draftTargets, "previous");
    if (id === "next-agent-reply") openMovedTarget(agentReplyTargets, "next");
    if (id === "toggle-sidebar") setSidebarVisible((visible) => !visible);
    if (id === "toggle-inspector") setInspectorVisible((visible) => !visible);
    if (id === "latest-unread-activity" && latestUnreadTarget)
      void openReviewTarget(latestUnreadTarget).catch((err) =>
        setError(String(err)),
      );
    if (id === "toggle-source") toggleSourceRendered();
    if (id === "toggle-diff") toggleHeadDiff();
    if (id === "show-source") setActiveViewerSurface("source");
    if (id === "show-rendered") setActiveViewerSurface("rendered");
    if (id === "show-diff") setActiveViewerSurface("diff");
    if (id === "focus-review-queue") focusReviewQueue();
    if (id === "focus-comments-panel") focusCommentsPanel();
    if (id === "focus-inline-thread") focusCurrentInlineThread();
  }

  function markReviewPathUnread(path: string) {
    setUnreadReviewPaths((paths) => [
      path,
      ...paths.filter((item) => item !== path),
    ]);
  }

  function markReviewPathRead(path: string) {
    setUnreadReviewPaths((paths) => paths.filter((item) => item !== path));
  }

  function promoteTab(path: string, paneId = layout.activePaneId) {
    setOpenTabs((tabs) => promoteOpenTab(tabs, path, paneId));
  }

  function applyTabCleanup(
    cleanup: (
      tabs: OpenTab[],
      activePath: string | null,
      paneId: string,
    ) => { tabs: OpenTab[]; nextActivePath: string | null },
    paneId = layout.activePaneId,
  ) {
    const pane = panes.find((item) => item.id === paneId);
    setOpenTabs((tabs) => {
      const result = cleanup(tabs, pane?.activePath ?? null, paneId);
      setLayout((current) => {
        const next = setPaneActivePath(current, paneId, result.nextActivePath);
        return closePaneIfEmpty(
          next,
          paneId,
          result.tabs.some((tab) => tab.paneId === paneId),
        );
      });
      if (result.nextActivePath && !files[result.nextActivePath]) {
        void loadFile(result.nextActivePath, paneId, "preserve").catch((err) =>
          setError(String(err)),
        );
      }
      return result.tabs;
    });
  }

  function moveTab(
    path: string,
    fromPaneId: string,
    toPaneId: string,
    beforePath: string | null,
  ) {
    setOpenTabs((tabs) =>
      moveOpenTab(tabs, path, fromPaneId, toPaneId, beforePath),
    );
    setLayout((current) => setPaneActivePath(current, toPaneId, path));
    if (!files[path])
      void loadFile(path, toPaneId, "preserve").catch((err) =>
        setError(String(err)),
      );
  }

  function splitTab(
    path: string,
    _fromPaneId: string,
    paneId: string,
    edge: SplitEdge,
  ) {
    const direction: SplitDirection =
      edge === "left" || edge === "right" ? "vertical" : "horizontal";
    const targetPaneId = `pane-${layout.nextPaneNumber}`;
    const cached = files[path];

    setLayout((current) => {
      const split = splitEditorPane(current, paneId, direction, edge);
      return setPaneActivePath(split, targetPaneId, path);
    });

    if (cached) {
      setOpenTabs((tabs) =>
        upsertOpenTab(tabs, cached, targetPaneId, "normal"),
      );
    } else {
      void loadFile(path, targetPaneId, "normal").catch((err) =>
        setError(String(err)),
      );
    }
  }

  const outline = useMemo(() => {
    if (!file) return [];
    if (file.viewerKind === "html") return extractHtmlOutline(file.content);
    if (file.viewerKind !== "markdown") return [];
    return extractMarkdownOutline(file.content);
  }, [file]);

  function jumpToOutline(id: string) {
    const pane = document.querySelector<HTMLElement>(
      `[data-pane-id="${layout.activePaneId}"]`,
    );
    const viewer = pane?.querySelector<HTMLElement>(".viewer-pane");
    if (!viewer) return;

    const markdownTarget = Array.from(
      viewer.querySelectorAll<HTMLElement>("[id]"),
    ).find((element) => element.id === id);
    if (markdownTarget) {
      markdownTarget.scrollIntoView({ block: "start", behavior: "smooth" });
      return;
    }

    const iframe = viewer.querySelector<HTMLIFrameElement>("iframe.html-frame");
    const iframeTarget = iframe?.contentDocument?.getElementById(id);
    if (iframeTarget) {
      iframeTarget.scrollIntoView({ block: "start", behavior: "smooth" });
      return;
    }

    if (iframe) {
      const next = new URL(iframe.src, window.location.href);
      next.hash = id;
      iframe.src = next.toString();
    }
  }

  function revealActiveFileInTree(path = selectedPath) {
    if (!path) return;
    setTreeChangedOnly(false);
    setTreeReveal((current) => ({
      path,
      revision: (current?.revision ?? 0) + 1,
    }));
  }

  useEffect(() => {
    loadConfig().catch((err) => setError(String(err)));
    loadTree().catch((err) => setError(String(err)));
    loadComments(null).catch((err) => setError(String(err)));
    loadDraftReviewComments().catch((err) => setError(String(err)));
  }, []);

  useEffect(() => {
    if (!activityThreadTargets.length) return;
    void loadThreadActivities(activityThreadTargets).catch((err) =>
      setError(String(err)),
    );
  }, [activityThreadTargets]);

  useEffect(() => {
    if (!client.subscribeCommentThreadActivities) return undefined;
    return client.subscribeCommentThreadActivities(undefined, (event) => {
      setCommentActivity((state) => addCommentActivity(state, event));
      const path = comments.find(
        (comment) => (comment.threadId ?? comment.id) === event.threadId,
      )?.path;
      if (path && activityNeedsHumanAttention(event))
        markReviewPathUnread(path);
      if (activityNeedsHumanAttention(event)) {
        void loadComments(null).catch((err) => setError(String(err)));
      }
    });
  }, [comments]);

  useEffect(() => {
    if (
      !shouldLoadInitialGitReview(
        Boolean(tree),
        initialGitReviewRequested.current,
      )
    ) {
      return;
    }
    initialGitReviewRequested.current = true;
    loadGitReview().catch((err) => setError(String(err)));
  }, [tree]);

  useEffect(() => {
    if (!shouldStartGitReviewPolling(gitReview)) return undefined;
    return startGitReviewPolling({
      timer: window,
      visibility: document,
      shouldRefresh: () =>
        shouldPollGitReview(gitReviewRef.current, {
          lastAttemptMs: gitReviewLastAttemptMs.current ?? undefined,
        }),
      scheduleRefresh: () => scheduleGitReviewRefresh(0),
    });
  }, [gitReview]);

  useEffect(() => {
    if (!config || !tree || workspaceSessionReady) return;
    pruneStoredWorkspaceSessions();

    const restored = restoreWorkspaceSession(
      readStoredWorkspaceSession(config.root),
      config.root,
      null,
    );

    if (restored) {
      if (shouldPromptForWorkspaceSessionRestore(restored)) {
        setPendingRestoreSession(restored);
      } else {
        applyWorkspaceSession(restored);
        setRestoreNoticeTabCount(restored.openTabs.length);
      }
    }

    setWorkspaceSessionReady(true);
  }, [config, tree, workspaceSessionReady]);

  useEffect(() => {
    if (!config || !workspaceSessionReady || pendingRestoreSession) return;
    writeStoredWorkspaceSession(
      buildWorkspaceSession(config.root, {
        openTabs,
        layout,
        recentFiles,
        sidebarVisible,
        inspectorVisible,
        sidebarWidth,
        inspectorWidth,
        diffEnabled,
        diffFocusByPath,
      }),
    );
  }, [
    config,
    workspaceSessionReady,
    openTabs,
    layout,
    recentFiles,
    sidebarVisible,
    inspectorVisible,
    sidebarWidth,
    inspectorWidth,
    diffEnabled,
    diffFocusByPath,
    pendingRestoreSession,
  ]);

  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: light)");
    const updateSystemTheme = () =>
      setSystemTheme(query.matches ? "light" : "dark");
    updateSystemTheme();
    query.addEventListener("change", updateSystemTheme);
    return () => query.removeEventListener("change", updateSystemTheme);
  }, []);

  useEffect(() => {
    const updateViewportWidth = () => setViewportWidth(readViewportWidth());
    updateViewportWidth();
    window.addEventListener("resize", updateViewportWidth);
    return () => window.removeEventListener("resize", updateViewportWidth);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
    document.documentElement.style.colorScheme = resolvedTheme;
    window.localStorage.setItem(themeStorageKey, themePreference);
  }, [resolvedTheme, themePreference]);

  useEffect(() => {
    if (!resizingWorkbenchPane) return;

    const resize = (event: PointerEvent) => {
      if (resizingWorkbenchPane === "sidebar") {
        setSidebarWidth(clampSidebarWidth(event.clientX));
      } else {
        setInspectorWidth(
          clampInspectorWidth(window.innerWidth - event.clientX),
        );
      }
    };
    const stopResize = () => setResizingWorkbenchPane(null);

    window.addEventListener("pointermove", resize);
    window.addEventListener("pointerup", stopResize);
    window.addEventListener("pointercancel", stopResize);
    document.body.classList.add("resizing-workbench-pane");

    return () => {
      window.removeEventListener("pointermove", resize);
      window.removeEventListener("pointerup", stopResize);
      window.removeEventListener("pointercancel", stopResize);
      document.body.classList.remove("resizing-workbench-pane");
    };
  }, [resizingWorkbenchPane]);

  useEffect(() => {
    if (!paletteOpen || paletteMode !== "file") {
      setFileSearchResults([]);
      setFileSearchLoading(false);
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      setFileSearchLoading(true);
      client
        .searchFiles({
          query: paletteQuery.trim(),
          limit: 40,
          signal: controller.signal,
        })
        .then(setFileSearchResults)
        .catch((err) => {
          if (err instanceof DOMException && err.name === "AbortError") return;
          setError(String(err));
        })
        .finally(() => {
          if (!controller.signal.aborted) setFileSearchLoading(false);
        });
    }, 120);

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [paletteMode, paletteOpen, paletteQuery]);

  useEffect(() => {
    const currentPaths = new Set(reviewItems.map((item) => item.path));
    const newPaths = reviewItems
      .map((item) => item.path)
      .filter((path) => !knownReviewPaths.current.has(path));

    for (const path of [...knownReviewPaths.current]) {
      if (!currentPaths.has(path)) knownReviewPaths.current.delete(path);
    }
    for (const path of newPaths) knownReviewPaths.current.add(path);

    setUnreadReviewPaths((paths) => [
      ...newPaths.reverse(),
      ...paths.filter(
        (path) => currentPaths.has(path) && !newPaths.includes(path),
      ),
    ]);
  }, [reviewItems]);

  useEffect(() => {
    for (const change of reviewChanges.slice(0, 12)) {
      if (diffs[change.path] || loadingDiffs[change.path]) continue;
      void loadHeadDiff(change.path).catch((err) => setError(String(err)));
    }
  }, [reviewChanges]);

  useEffect(() => {
    const query = paletteQuery.trim();
    if (!paletteOpen || paletteMode !== "text" || !query) {
      setTextSearchResults([]);
      setTextSearchLoading(false);
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      setTextSearchLoading(true);
      client
        .searchText({ query, limit: 40, signal: controller.signal })
        .then(setTextSearchResults)
        .catch((err) => {
          if (err instanceof DOMException && err.name === "AbortError") return;
          setError(String(err));
        })
        .finally(() => {
          if (!controller.signal.aborted) setTextSearchLoading(false);
        });
    }, 180);

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [paletteMode, paletteOpen, paletteQuery]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const action = keyboardShortcutAction(event);
      if (!action) return;

      if (action === "dismiss-overlays") {
        setPaletteOpen(false);
        setShortcutHelpOpen(false);
        setCommentsPanelOpen(false);
        setActiveCommentId(null);
        setActiveCommentRect(null);
        return;
      }

      if (action === "quick-open") {
        event.preventDefault();
        if (paletteOpen && paletteMode === "file") setPaletteOpen(false);
        else openPalette("file");
        return;
      }

      if (action === "search-text") {
        event.preventDefault();
        if (paletteOpen && paletteMode === "text") setPaletteOpen(false);
        else openPalette("text");
        return;
      }

      if (action === "toggle-comments") {
        event.preventDefault();
        setPaletteOpen(false);
        setShortcutHelpOpen(false);
        setActiveCommentId(null);
        setActiveCommentRect(null);
        setCommentsPanelOpen((open) => !open);
        return;
      }

      if (action === "toggle-shortcuts") {
        event.preventDefault();
        setPaletteOpen(false);
        setShortcutHelpOpen((open) => !open);
        return;
      }

      if (action === "close-active-tab") {
        if (shortcutHelpOpen) {
          event.preventDefault();
          setShortcutHelpOpen(false);
          return;
        }
        if (paletteOpen) {
          event.preventDefault();
          setPaletteOpen(false);
          return;
        }
        if (selectedPath) {
          event.preventDefault();
          closeTab(selectedPath, layout.activePaneId);
        }
        return;
      }

      event.preventDefault();
      if (action === "toggle-diff") toggleHeadDiff();
      if (action === "toggle-source") toggleSourceRendered();
      if (action === "open-latest-unread") openLatestUnreadReviewFile();
      if (action === "open-next-review") openReviewQueueFile("next");
      if (action === "open-previous-review") openReviewQueueFile("previous");
      if (action === "open-next-thread")
        openMovedTarget(openThreadTargets, "next");
      if (action === "open-previous-thread")
        openMovedTarget(openThreadTargets, "previous");
      if (action === "focus-review-queue") focusReviewQueue();
      if (action === "focus-current-inline-thread") focusCurrentInlineThread();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    layout.activePaneId,
    paletteMode,
    paletteOpen,
    shortcutHelpOpen,
    selectedPath,
    diffEnabled,
    reviewChanges,
    unreadReviewPaths,
    commentsPanelOpen,
    activeCommentId,
    openThreadTargets,
    currentFileOpenThreadTargets,
    reviewItems,
    files,
    file,
    viewerModes,
  ]);

  useEffect(() => {
    const unsubscribe = client.subscribeWorkspaceEvents((event) => {
      const decision = decideLiveRefresh(event, activeFilePaths.current);
      setLiveMetrics((metrics) => ({
        ...metrics,
        fsEventsReceived: metrics.fsEventsReceived + 1,
      }));
      setRecentEvents((items) => recordReviewEvent(items, event));
      markReviewPathUnread(event.path);

      if (decision.reloadPath) {
        scheduleLiveFileRefresh(decision.reloadPath);
      }

      if (decision.stalePath) {
        setOpenTabs((tabs) => markTabChanged(tabs, decision.stalePath!));
      }

      if (decision.removedPath) {
        setOpenTabs((tabs) => markTabRemoved(tabs, decision.removedPath!));
      }

      if (decision.treeRefreshParentPath !== null) {
        const refresh = decision.treeRefreshParentPath
          ? loadDirectory(decision.treeRefreshParentPath)
          : loadTree();
        refresh.catch((err) => setError(String(err)));
      }
      scheduleGitReviewRefresh();
      if (diffEnabledRef.current) {
        scheduleDiffRefresh(event.path);
      }
    });
    return () => {
      unsubscribe();
      if (gitRefreshTimer.current) window.clearTimeout(gitRefreshTimer.current);
      if (diffRefreshTimer.current)
        window.clearTimeout(diffRefreshTimer.current);
      for (const timer of Object.values(liveFileRefreshTimers.current)) {
        window.clearTimeout(timer);
      }
      liveFileRefreshTimers.current = {};
    };
  }, []);

  useEffect(() => {
    if (!manualDraggedTab) return;
    const clearManualDrag = () => {
      setManualDraggedTab(null);
      setDraggingTab(false);
      setDropTarget(null);
    };
    window.addEventListener("mouseup", clearManualDrag);
    return () => window.removeEventListener("mouseup", clearManualDrag);
  }, [manualDraggedTab]);

  return (
    <div className="app-shell">
      <Topbar
        root={config?.root ?? null}
        themePreference={themePreference}
        onThemeCycle={() =>
          setThemePreference((current) => nextThemePreference(current))
        }
        onQuickOpen={() => openPalette("file")}
        onSearchText={() => openPalette("text")}
        openCommentCount={openCommentCount}
        onOpenComments={() => {
          setPaletteOpen(false);
          setShortcutHelpOpen(false);
          setActiveCommentId(null);
          setActiveCommentRect(null);
          setCommentsPanelOpen(true);
        }}
        onOpenShortcuts={() => {
          setPaletteOpen(false);
          setShortcutHelpOpen(true);
        }}
      />

      <div
        className={workbenchClassName}
        style={
          {
            "--sidebar-width": `${effectiveSidebarWidth}px`,
            "--inspector-width": `${inspectorWidth}px`,
          } as CSSProperties
        }
      >
        {effectiveSidebarVisible ? (
          <>
            <button
              className="workbench-resizer sidebar-resizer"
              type="button"
              aria-label="Resize sidebar"
              title="Resize sidebar"
              onPointerDown={(event) => {
                event.preventDefault();
                setResizingWorkbenchPane("sidebar");
              }}
              onDoubleClick={() => setSidebarWidth(defaultSidebarWidth)}
            />
            <aside className="sidebar">
              <div className="panel-title">
                <span>Explorer</span>
                <button
                  className={treeChangedOnly ? "pill active" : "pill"}
                  type="button"
                  onClick={() => setTreeChangedOnly((value) => !value)}
                >
                  {treeChangedOnly ? "changed" : "live"}
                </button>
              </div>
              {tree ? (
                <TreeSidebar
                  nodes={sidebarNodes}
                  selectedPath={selectedPath}
                  revealPath={treeReveal?.path ?? null}
                  revealRevision={treeReveal?.revision ?? 0}
                  changedPaths={changedPathSet}
                  removedPaths={reviewState.removedPaths}
                  loadingDirectoryPaths={loadingDirectoryPaths}
                  onLoadDirectory={(path) => loadDirectory(path)}
                  onSelect={(path) =>
                    void loadFile(path, layout.activePaneId, "preview").catch(
                      (err) => setError(String(err)),
                    )
                  }
                  onOpen={(path) =>
                    void loadFile(path, layout.activePaneId, "normal").catch(
                      (err) => setError(String(err)),
                    )
                  }
                />
              ) : (
                <p className="muted">Loading tree...</p>
              )}
            </aside>
          </>
        ) : null}
        <button
          className="rail-toggle sidebar-rail-toggle"
          type="button"
          aria-label={
            effectiveSidebarVisible ? "Collapse sidebar" : "Expand sidebar"
          }
          title={
            effectiveSidebarVisible ? "Collapse sidebar" : "Expand sidebar"
          }
          onClick={() => setSidebarVisible((visible) => !visible)}
        >
          <span
            className={
              effectiveSidebarVisible
                ? "collapse-icon collapse-left"
                : "collapse-icon collapse-right"
            }
          />
        </button>

        <main className="main">
          <div className={`editor-grid ${draggingTab ? "dragging-tab" : ""}`}>
            {renderLayoutNode(layout.root)}
          </div>
        </main>

        <button
          className="rail-toggle inspector-rail-toggle"
          type="button"
          aria-label={
            effectiveInspectorVisible
              ? "Collapse inspector"
              : "Expand inspector"
          }
          title={
            effectiveInspectorVisible
              ? "Collapse inspector"
              : "Expand inspector"
          }
          onClick={() => setInspectorVisible((visible) => !visible)}
        >
          <span
            className={
              effectiveInspectorVisible
                ? "collapse-icon collapse-right"
                : "collapse-icon collapse-left"
            }
          />
        </button>

        {effectiveInspectorVisible ? (
          <>
            <button
              className="workbench-resizer inspector-resizer"
              type="button"
              aria-label="Resize inspector"
              title="Resize inspector"
              onPointerDown={(event) => {
                event.preventDefault();
                setResizingWorkbenchPane("inspector");
              }}
              onDoubleClick={() => setInspectorWidth(defaultInspectorWidth)}
            />
            <Inspector
              file={file}
              fileRemoved={activeFileRemoved}
              outline={outline}
              reviewChanges={reviewChanges}
              reviewItems={reviewItems}
              reviewUnavailableReason={gitReview?.reason ?? null}
              reviewDiffStats={reviewDiffStats}
              loadingReviewDiffs={loadingDiffs}
              unreadReviewPaths={unreadReviewPathSet}
              comments={activeFileComments}
              draftComments={activeFileDraftComments}
              commentsLoading={commentsLoading}
              threadActivities={commentActivitySummaries}
              onOpenComments={() => {
                setCommentsPanelStatus("all");
                setCommentsPanelQuery(file?.path ?? "");
                setActiveCommentId(null);
                setActiveCommentRect(null);
                setCommentsPanelOpen(true);
              }}
              selectedCodeRange={
                file?.path ? (codeSelections[file.path] ?? null) : null
              }
              refreshedAt={file?.path ? refreshedFiles[file.path] : undefined}
              onOutlineSelect={jumpToOutline}
              onOpenEventPath={(path) => openReviewQueueItem(path, "preview")}
              onConfirmEventPath={(path) => openReviewQueueItem(path, "normal")}
              onOpenNextChanged={() => openReviewQueueFile("next")}
              onOpenPreviousChanged={() => openReviewQueueFile("previous")}
              onOpenAllChanged={openAllChangedFiles}
              onRevealInTree={revealActiveFileInTree}
            />
          </>
        ) : null}
      </div>

      <footer className="statusbar">
        <span>
          {openTabs.length} tabs · {reviewChanges.length} to review ·{" "}
          {tree?.nodes.length ?? 0} root entries
        </span>
        <span>
          {liveMetrics.fsEventsReceived} fs events · {liveMetrics.gitRefreshes}{" "}
          git refreshes
          {liveMetrics.lastGitRefreshMs !== null
            ? ` · git ${liveMetrics.lastGitRefreshMs}ms`
            : ""}
          {liveMetrics.diffRefreshes
            ? ` · ${liveMetrics.diffRefreshes} diff refreshes`
            : ""}
          {liveMetrics.lastDiffRefreshMs !== null
            ? ` · diff ${liveMetrics.lastDiffRefreshMs}ms`
            : ""}
          {liveMetrics.pendingGitRefresh || liveMetrics.pendingDiffPaths
            ? ` · pending ${liveMetrics.pendingGitRefresh ? "git" : ""}${liveMetrics.pendingDiffPaths ? ` diff:${liveMetrics.pendingDiffPaths}` : ""}`
            : ""}
        </span>
      </footer>

      <CommandPalette
        open={paletteOpen}
        mode={paletteMode}
        query={paletteQuery}
        fileResults={fileSearchResults}
        fileLoading={fileSearchLoading}
        textResults={textSearchResults}
        textLoading={textSearchLoading}
        actions={commandActions}
        onQueryChange={setPaletteQuery}
        onModeChange={(mode) => {
          setPaletteMode(mode);
          setPaletteQuery("");
        }}
        onClose={() => setPaletteOpen(false)}
        onOpenPath={openFromPalette}
        onRunAction={runCommandAction}
      />
      <ShortcutHelp
        open={shortcutHelpOpen}
        onClose={() => setShortcutHelpOpen(false)}
      />
      {restoreNoticeTabCount ? (
        <WorkspaceRestoreNotice
          tabCount={restoreNoticeTabCount}
          onDismiss={() => setRestoreNoticeTabCount(null)}
          onStartFresh={startFreshWorkspace}
        />
      ) : null}
      {pendingRestoreSession ? (
        <RestoreSessionPrompt
          tabCount={pendingRestoreSession.openTabs.length}
          onRestoreAll={() => {
            applyWorkspaceSession(pendingRestoreSession);
            setRestoreNoticeTabCount(pendingRestoreSession.openTabs.length);
            setPendingRestoreSession(null);
          }}
          onRestoreActive={() => {
            const activeOnly = restoreOnlyActiveWorkspaceTab(
              pendingRestoreSession,
            );
            applyWorkspaceSession(activeOnly);
            setRestoreNoticeTabCount(activeOnly.openTabs.length);
            setPendingRestoreSession(null);
          }}
          onSkip={() => setPendingRestoreSession(null)}
        />
      ) : null}
      <CommentsPanel
        open={commentsPanelOpen}
        comments={comments}
        query={commentsPanelQuery}
        statusFilter={commentsPanelStatus}
        threadActivities={commentActivitySummaries}
        onQueryChange={setCommentsPanelQuery}
        onStatusFilterChange={setCommentsPanelStatus}
        onClose={() => setCommentsPanelOpen(false)}
        onOpenComment={(comment) =>
          void openCommentFromPanel(comment).catch((err) =>
            setError(String(err)),
          )
        }
      />
      <DraftReviewTray
        drafts={draftComments}
        publishing={draftPublishing}
        publishError={draftPublishError}
        publishedBatchId={lastPublishedReviewBatchId}
        onOpenPath={(path) =>
          void loadFile(path, layout.activePaneId, "preview").catch((err) =>
            setError(String(err)),
          )
        }
        onUpdateDraft={(id, body) =>
          void updateDraftReviewComment(id, body).catch((err) =>
            setError(String(err)),
          )
        }
        onDeleteDraft={(id) =>
          void deleteDraftReviewComment(id).catch((err) =>
            setError(String(err)),
          )
        }
        onPublishAll={() =>
          void publishDraftReviewComments().catch((err) =>
            setError(String(err)),
          )
        }
      />
      <InlineCommentCard
        comment={
          commentsPanelOpen || usesInlineCommentThread
            ? null
            : visibleActiveComment
        }
        rect={activeCommentRect}
        onClose={closeInlineComment}
        onStatusChange={(id, status) =>
          void updateCommentStatus(id, status).catch((err) =>
            setError(String(err)),
          )
        }
      />
    </div>
  );

  function applyWorkspaceSession(restored: WorkspaceSessionState) {
    setOpenTabs(restored.openTabs);
    setLayout(restored.layout);
    setRecentFiles(restored.recentFiles);
    setSidebarVisible(restored.sidebarVisible ?? true);
    setInspectorVisible(restored.inspectorVisible);
    setSidebarWidth(clampSidebarWidth(restored.sidebarWidth ?? sidebarWidth));
    setInspectorWidth(
      clampInspectorWidth(restored.inspectorWidth ?? inspectorWidth),
    );
    setDiffEnabled(restored.diffEnabled ?? false);
    setDiffFocusByPath(restored.diffFocusByPath ?? {});
    void hydrateRestoredFiles(
      restored.layout.root,
      restored.diffEnabled ?? false,
    ).catch((err) => setError(String(err)));
  }

  function startFreshWorkspace() {
    setOpenTabs([]);
    setFiles({});
    setLayout(initialEditorLayout);
    setRecentFiles([]);
    setDiffEnabled(false);
    setDiffFocusByPath({});
    setRestoreNoticeTabCount(null);
  }

  function renderLayoutNode(node: EditorLayoutNode): ReactNode {
    if (node.kind === "split") {
      return (
        <div className={`editor-split ${node.direction}`} key={node.id}>
          {renderLayoutNode(node.first)}
          {renderLayoutNode(node.second)}
        </div>
      );
    }

    return renderEditorPane(node.pane);
  }

  function renderEditorPane(pane: EditorPane): ReactNode {
    const paneTabs = openTabs.filter((tab) => tab.paneId === pane.id);
    const paneFile = pane.activePath ? (files[pane.activePath] ?? null) : null;
    const paneActiveTab = pane.activePath
      ? paneTabs.find((tab) => tab.path === pane.activePath)
      : null;

    return (
      <section
        className={
          pane.id === layout.activePaneId ? "editor-pane active" : "editor-pane"
        }
        data-pane-id={pane.id}
        key={pane.id}
        onFocus={() =>
          setLayout((current) =>
            current.activePaneId === pane.id
              ? current
              : { ...current, activePaneId: pane.id },
          )
        }
        onMouseDown={() =>
          setLayout((current) =>
            current.activePaneId === pane.id
              ? current
              : { ...current, activePaneId: pane.id },
          )
        }
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null))
            setDropTarget(null);
        }}
      >
        <OpenTabs
          tabs={paneTabs}
          activePath={pane.activePath}
          paneId={pane.id}
          onActivate={(path) => {
            const target = paneTabs.find((tab) => tab.path === path);
            if (target?.removed) {
              setLayout((current) => setPaneActivePath(current, pane.id, path));
              return;
            }
            void loadFile(path, pane.id, "preserve").catch((err) =>
              setError(String(err)),
            );
          }}
          onClose={(path) => closeTab(path, pane.id)}
          onPromote={(path) => promoteTab(path, pane.id)}
          onCloseOtherTabs={() => applyTabCleanup(closeOtherOpenTabs, pane.id)}
          onCloseTabsToRight={() => applyTabCleanup(closeTabsToRight, pane.id)}
          onCloseUnchangedTabs={() =>
            applyTabCleanup(closeUnchangedTabs, pane.id)
          }
          onClosePreviewTabs={() => applyTabCleanup(closePreviewTabs, pane.id)}
          onDropTab={moveTab}
          onDragStateChange={setDraggingTab}
          onManualDragStart={(payload) => {
            setManualDraggedTab(payload);
            setDraggingTab(true);
          }}
        />
        <div className="viewer-pane">
          {error && pane.id === layout.activePaneId ? (
            <div className="error">{error}</div>
          ) : (
            <FileViewer
              key={paneFile?.path ?? "empty"}
              file={paneFile}
              removed={Boolean(paneActiveTab?.removed)}
              allowHtmlScripts={config?.allowHtmlScripts ?? false}
              theme={resolvedTheme}
              selectedCodeRange={
                paneFile?.path ? (codeSelections[paneFile.path] ?? null) : null
              }
              viewerMode={
                paneFile
                  ? (viewerModes[paneFile.path] ?? defaultViewerMode(paneFile))
                  : undefined
              }
              diff={paneFile?.path ? (diffs[paneFile.path] ?? null) : null}
              diffLoading={
                paneFile?.path ? Boolean(loadingDiffs[paneFile.path]) : false
              }
              diffEnabled={
                paneFile ? diffEnabled && supportsDiffMode(paneFile) : false
              }
              diffFocusChanges={
                paneFile?.path ? Boolean(diffFocusByPath[paneFile.path]) : false
              }
              refreshedAt={
                paneFile?.path ? refreshedFiles[paneFile.path] : undefined
              }
              onCreateComment={(draft, body, rect) =>
                createComment(draft, body, rect).catch((err) =>
                  setError(String(err)),
                )
              }
              comments={
                paneFile?.path
                  ? combinePublishedAndDraftComments(
                      comments,
                      draftComments,
                      paneFile.path,
                    )
                  : []
              }
              activeCommentId={activeCommentId}
              onOpenComment={openInlineComment}
              onCloseComment={closeInlineComment}
              onCommentStatusChange={updateCommentStatus}
              threadActivities={commentActivitySummaries}
              onCodeSelectionChange={(range) => {
                if (!paneFile?.path) return;
                setCodeSelections((items) => ({
                  ...items,
                  [paneFile.path]: range,
                }));
              }}
              onViewerModeChange={(mode) => {
                if (!paneFile?.path) return;
                setViewerModes((items) => ({
                  ...items,
                  [paneFile.path]: mode,
                }));
              }}
              onDiffToggle={() => {
                if (!paneFile?.path) return;
                toggleHeadDiff(paneFile.path);
              }}
              onDiffFocusChange={(focusChanges) => {
                if (!paneFile?.path) return;
                setDiffFocusByPath((items) => ({
                  ...items,
                  [paneFile.path]: focusChanges,
                }));
              }}
              onCloseRemoved={() => {
                if (pane.activePath) closeTab(pane.activePath, pane.id);
              }}
            />
          )}
        </div>
        <div
          aria-label="Split pane"
          className={`split-drop-zone ${dropTarget?.paneId === pane.id ? `active ${dropTarget.edge}` : ""}`}
          onDragOver={(event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
            setDropTarget({
              paneId: pane.id,
              edge: edgeForPoint(
                event.currentTarget,
                event.clientX,
                event.clientY,
              ),
            });
          }}
          onDrop={(event) => {
            event.preventDefault();
            event.stopPropagation();
            const dragged = readDraggedTab(event.dataTransfer);
            const edge = edgeForPoint(
              event.currentTarget,
              event.clientX,
              event.clientY,
            );
            setDraggingTab(false);
            setManualDraggedTab(null);
            setDropTarget(null);
            if (dragged) splitTab(dragged.path, dragged.paneId, pane.id, edge);
          }}
          onMouseUp={(event) => {
            if (!manualDraggedTab) return;
            event.preventDefault();
            event.stopPropagation();
            const edge = edgeForPoint(
              event.currentTarget,
              event.clientX,
              event.clientY,
            );
            const dragged = manualDraggedTab;
            setManualDraggedTab(null);
            setDraggingTab(false);
            setDropTarget(null);
            splitTab(dragged.path, dragged.paneId, pane.id, edge);
          }}
        />
      </section>
    );
  }
}

function RestoreSessionPrompt({
  tabCount,
  onRestoreAll,
  onRestoreActive,
  onSkip,
}: {
  tabCount: number;
  onRestoreAll: () => void;
  onRestoreActive: () => void;
  onSkip: () => void;
}) {
  return (
    <div className="restore-overlay" role="presentation">
      <section
        aria-label="Restore previous tabs"
        className="restore-prompt"
        role="dialog"
      >
        <strong>Restore previous tabs?</strong>
        <p>
          The last session had {tabCount} tabs. Choose how much of that
          workspace to bring back.
        </p>
        <div className="restore-actions">
          <button onClick={onRestoreAll} type="button">
            Restore all tabs
          </button>
          <button onClick={onRestoreActive} type="button">
            Restore active tab
          </button>
          <button onClick={onSkip} type="button">
            Start without tabs
          </button>
        </div>
      </section>
    </div>
  );
}

function edgeForPoint(
  target: HTMLElement,
  clientX: number,
  clientY: number,
): SplitEdge {
  const rect = target.getBoundingClientRect();
  const x = (clientX - rect.left) / rect.width;
  const y = (clientY - rect.top) / rect.height;
  if (x < 0.25) return "left";
  if (x > 0.75) return "right";
  return y < 0.5 ? "top" : "bottom";
}

function readStoredThemePreference(): ThemePreference {
  if (typeof window === "undefined") return "system";
  const stored = window.localStorage.getItem(themeStorageKey);
  return isThemePreference(stored) ? stored : "system";
}

function readStoredWorkspaceSession(
  root: string,
): StoredWorkspaceSessionV1 | null {
  if (typeof window === "undefined") return null;
  try {
    return parseWorkspaceSession(
      window.localStorage.getItem(workspaceSessionStorageKeyForRoot(root)),
    );
  } catch {
    return null;
  }
}

function writeStoredWorkspaceSession(session: StoredWorkspaceSessionV1) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      workspaceSessionStorageKeyForRoot(session.root),
      JSON.stringify(session),
    );
  } catch {
    // Storage can be unavailable in private or quota-limited browser contexts.
  }
}

function pruneStoredWorkspaceSessions(now = Date.now()) {
  if (typeof window === "undefined") return;
  const prefix = `${workspaceSessionStorageKey}:`;
  try {
    for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
      const key = window.localStorage.key(index);
      if (!key?.startsWith(prefix)) continue;
      const session = parseWorkspaceSession(window.localStorage.getItem(key));
      if (!session || now - session.updatedAt > workspaceSessionTtlMs) {
        window.localStorage.removeItem(key);
      }
    }
  } catch {
    // Best-effort cleanup only; persistence should never block the viewer.
  }
}

function readSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: light)").matches
    ? "light"
    : "dark";
}

function readViewportWidth(): number {
  if (typeof window === "undefined") return 1280;
  return window.innerWidth;
}

function mergeComments(
  current: ViviComment[],
  incoming: ViviComment[],
  replacedPath: string | null,
): ViviComment[] {
  const byId = new Map<string, ViviComment>();
  for (const comment of current) {
    if (replacedPath && comment.path === replacedPath) continue;
    byId.set(comment.id, comment);
  }
  for (const comment of incoming) byId.set(comment.id, comment);
  return [...byId.values()].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
}

function mergeDraftComments(
  current: DraftReviewComment[],
  incoming: DraftReviewComment[],
  replacedPath: string | null,
): DraftReviewComment[] {
  const byId = new Map<string, DraftReviewComment>();
  for (const draft of current) {
    if (replacedPath && draft.path === replacedPath) continue;
    byId.set(draft.id, draft);
  }
  for (const draft of incoming) byId.set(draft.id, draft);
  return [...byId.values()].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );
}

function combinePublishedAndDraftComments(
  comments: ViviComment[],
  drafts: DraftReviewComment[],
  path?: string,
): ViviComment[] {
  const published = path
    ? comments.filter((comment) => comment.path === path)
    : comments;
  const draftMessages = (
    path ? drafts.filter((draft) => draft.path === path) : drafts
  ).map((draft) => draftReviewCommentAsViviComment(draft, comments));
  return [...published, ...draftMessages].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );
}

function commentActivityThreadTargets({
  comments,
  selectedPath,
  commentsPanelOpen,
  commentsPanelQuery,
  commentsPanelStatus,
  reviewPaths,
}: {
  comments: ViviComment[];
  selectedPath: string | null;
  commentsPanelOpen: boolean;
  commentsPanelQuery: string;
  commentsPanelStatus: CommentStatusFilter;
  reviewPaths: string[];
}): string[] {
  const reviewPathSet = new Set(reviewPaths);
  const query = commentsPanelQuery.trim().toLowerCase();
  const targets: string[] = [];
  for (const comment of comments) {
    if (comment.status !== "open") continue;
    const threadId = comment.threadId ?? comment.id;
    if (targets.includes(threadId)) continue;
    const selectedTarget =
      selectedPath !== null && comment.path === selectedPath;
    const reviewTarget = reviewPathSet.has(comment.path);
    const panelTarget =
      commentsPanelOpen &&
      (commentsPanelStatus === "all" ||
        comment.status === commentsPanelStatus) &&
      (!query ||
        [comment.path, comment.body, comment.anchor.canonical.quote ?? ""]
          .join(" ")
          .toLowerCase()
          .includes(query));
    if (selectedTarget || reviewTarget || panelTarget) targets.push(threadId);
    if (targets.length >= 40) break;
  }
  return targets;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return "Unknown publish error";
}

interface DOMRectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

const recentEventWindowMs = 5 * 60 * 1000;
