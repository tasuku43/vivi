import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { TextDiff } from "../../domain/change-review.js";
import type { WorkspaceConnectionStatus } from "../../application/ports/ViviClient.js";
import type {
  CommentActor,
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
import { InlineCommentCard } from "../comments/components/InlineCommentCard.js";
import { CommandPalette } from "../command-palette/CommandPalette.js";
import { ShortcutHelp } from "../../shared/components/ShortcutHelp.js";
import { WorkspaceRestoreNotice } from "../../shared/components/WorkspaceRestoreNotice.js";
import { WorkspaceStatusbar } from "../../shared/components/WorkspaceStatusbar.js";
import sharedUiStyles from "../../shared/styles/SharedUi.module.css";
import styles from "./WorkbenchContainer.module.css";
import {
  extractHtmlOutline,
  extractMarkdownOutline,
} from "../../state/outline.js";
import { activeOutlineHeadingId } from "../../state/outline-position.js";
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
  isPathKnownMissing,
  replaceDirectoryChildren,
} from "../../state/files.js";
import {
  explorerFilterLabel,
  explorerFilterText,
} from "../../state/tree-filter.js";
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
  buildReviewQueueItems,
  latestUnreadReviewItemPath,
  nextReviewQueueItemPath,
  summarizeReviewQueue,
  syncUnreadReviewPaths,
} from "../../state/review-queue.js";
import {
  compactReviewDecisions,
  compactReviewReceipts,
  createReviewReceipt,
  reviewChangeFingerprint,
  reviewDecisionPathSet,
  reviewQueueItemState,
  visibleReviewReceipts,
  type ReviewDecisionEntry,
  type ReviewFileState,
  type ReviewReceiptEntry,
  type ReviewReceiptReason,
} from "../../state/review-state.js";
import {
  shouldLoadInitialGitReview,
  shouldPollGitReview,
  shouldStartGitReviewPolling,
  startGitReviewPolling,
} from "../../state/git-review-refresh.js";
import {
  activeCommentRendersInViewerThread,
  draftReviewCommentAsViviComment,
  visibleThreadComments,
  type CommentDraft,
} from "../../state/comments.js";
import {
  activeTextSearchResult,
  codeSelectionForTextSearchTarget,
  moveTextSearchSession,
  textSearchPositionLabel,
  textSearchSessionForSelection,
  viewerModeForTextSearchTarget,
  type TextSearchNavigationSession,
} from "../../state/search-navigation.js";
import {
  parseWorkbenchDeepLink,
  type WorkbenchDeepLink,
} from "../../state/workbench-deep-link.js";
import {
  addCommentActivities,
  addCommentActivity,
  commentActivityRefreshTarget,
  commentActivityThreadPath,
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
  isInspectorEffectivelyVisible,
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
import { summarizeWorkspaceStatus } from "../../state/workspace-status.js";
import {
  defaultViewerMode,
  diffSupportForFile,
  nextViewerMode,
  supportsDiffMode,
  type ViewerMode,
} from "../../state/viewer-mode.js";
import {
  textSearchPreviewSegments,
  type CommandActionItem,
  type RecentFileSearchResult,
  type SearchPaletteMode,
} from "../../state/search-palette.js";
import {
  currentThreadLifecycleShortcutStatus,
  reviewCommandActions,
} from "../../state/review-command-actions.js";
import { keyboardShortcutAction } from "../../state/shortcuts.js";
import {
  agentReplyNavigationTargets,
  commentNavigationTarget,
  commentActivityThreadTargets,
  countAttentionCommentThreads,
  draftCommentNavigationTargets,
  firstRelevantThreadForReviewItem,
  inlineThreadFocusCommentId,
  moveReviewNavigationTarget,
  openThreadNavigationTargets,
  reviewQueueOpenTransition,
  unresolvedThreadNavigationTargets,
  type ReviewNavigationTarget,
} from "../../state/review-navigation.js";
import type { ViviClient } from "../../application/ports/ViviClient.js";
import { WorkbenchErrorMessage } from "./WorkbenchErrorMessage.js";
import { WorkbenchPendingFileMessage } from "./WorkbenchPendingFileMessage.js";

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
  const [loadingFilePaths, setLoadingFilePaths] = useState<
    Record<string, number>
  >({});
  const [openTabs, setOpenTabs] = useState<OpenTab[]>([]);
  const [recentFiles, setRecentFiles] = useState<RecentFile[]>([]);
  const [recentEvents, setRecentEvents] = useState<ReviewEvent[]>([]);
  const [unreadReviewPaths, setUnreadReviewPaths] = useState<string[]>([]);
  const [reviewDecisions, setReviewDecisions] = useState<ReviewDecisionEntry[]>(
    [],
  );
  const [reviewReceipts, setReviewReceipts] = useState<ReviewReceiptEntry[]>(
    [],
  );
  const [reviewReceiptNow, setReviewReceiptNow] = useState(() => Date.now());
  const [reviewLedgerLoadedRoot, setReviewLedgerLoadedRoot] = useState<
    string | null
  >(null);
  const [reviewLedgerDirty, setReviewLedgerDirty] = useState(false);
  const [liveMetrics, setLiveMetrics] = useState<LiveRefreshMetrics>({
    fsEventsReceived: 0,
    gitRefreshes: 0,
    diffRefreshes: 0,
    lastGitRefreshMs: null,
    lastDiffRefreshMs: null,
    pendingGitRefresh: false,
    pendingDiffPaths: 0,
  });
  const [workspaceConnectionStatus, setWorkspaceConnectionStatus] =
    useState<WorkspaceConnectionStatus>("connecting");
  const [gitReview, setGitReview] = useState<GitChangeReviewState | null>(null);
  const [gitReviewLoading, setGitReviewLoading] = useState(false);
  const gitReviewRef = useRef<GitChangeReviewState | null>(null);
  const initialGitReviewRequested = useRef(false);
  const requestedReviewLedgerRoot = useRef<string | null>(null);
  const [diffs, setDiffs] = useState<Record<string, TextDiff>>({});
  const [loadingDiffs, setLoadingDiffs] = useState<Record<string, boolean>>({});
  const [diffEnabled, setDiffEnabled] = useState(false);
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
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null);
  const [activeCommentRect, setActiveCommentRect] =
    useState<DOMRectLike | null>(null);
  const [viewerModes, setViewerModes] = useState<Record<string, ViewerMode>>(
    {},
  );
  const [codeSelections, setCodeSelections] = useState<
    Record<string, LineRange | null>
  >({});
  const [sourceFocusTarget, setSourceFocusTarget] = useState<{
    paneId: string;
    path: string;
    lineNumber: number;
    revision: number;
  } | null>(null);
  const [textSearchNavigation, setTextSearchNavigation] =
    useState<TextSearchNavigationSession | null>(null);
  const [activeOutlineByPane, setActiveOutlineByPane] = useState<
    Record<string, string | null>
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
  const [compactInspectorOpen, setCompactInspectorOpen] = useState(false);
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
  const initialDeepLink = useRef<WorkbenchDeepLink | null>(
    typeof window === "undefined"
      ? null
      : parseWorkbenchDeepLink(window.location.search),
  );
  const diffEnabledRef = useRef(diffEnabled);
  const commentsRef = useRef<ViviComment[]>([]);
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
    setGitReviewLoading(true);
    setLiveMetrics((metrics) => ({
      ...metrics,
      pendingGitRefresh: true,
    }));
    try {
      const nextGitReview = await client.getReviewQueue();
      gitReviewRef.current = nextGitReview;
      setGitReview(nextGitReview);
      setLiveMetrics((metrics) => ({
        ...metrics,
        gitRefreshes: metrics.gitRefreshes + 1,
        lastGitRefreshMs: Math.round(performance.now() - startedAt),
        pendingGitRefresh: false,
      }));
    } finally {
      setGitReviewLoading(false);
    }
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

  async function loadComments(
    path: string | null = selectedPath,
  ): Promise<ViviComment[]> {
    setCommentsLoading(true);
    try {
      const loaded = await client.getComments(path ? { path } : undefined);
      setComments((items) => mergeComments(items, loaded, path));
      return loaded;
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
      actor: reviewActorForConfig(config),
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

  async function publishDraftReviewComments(draftIds?: string[]) {
    if (!draftComments.length || draftPublishing) return;
    const activeDraftId = activeCommentId?.startsWith("draft:")
      ? activeCommentId.slice("draft:".length)
      : null;
    const publishingDrafts = draftIds?.length
      ? draftComments.filter((draft) => draftIds.includes(draft.id))
      : draftComments;
    const activePublishingDraft = activeDraftId
      ? publishingDrafts.find((draft) => draft.id === activeDraftId)
      : undefined;
    setDraftPublishing(true);
    setDraftPublishError(null);
    setLastPublishedReviewBatchId(null);
    try {
      const batch = await client.publishDraftReviewComments({ draftIds });
      const nextActiveCommentId = activePublishingDraft
        ? matchingPublishedCommentForDraft(
            batch.threads.flatMap((thread) => thread.comments),
            activePublishingDraft,
          )?.id
        : undefined;
      setComments((items) =>
        mergeComments(
          items,
          batch.threads.flatMap((thread) => thread.comments),
          null,
        ),
      );
      setDraftComments((items) =>
        draftIds?.length
          ? items.filter((draft) => !draftIds.includes(draft.id))
          : [],
      );
      if (nextActiveCommentId) setActiveCommentId(nextActiveCommentId);
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
    if (status === "resolved") {
      recordResolvedThreadReview(thread.path, thread.id);
    }
  }

  function recordResolvedThreadReview(path: string, threadId: string) {
    const now = Date.now();
    const createdAt = new Date(now).toISOString();
    const fingerprint = currentReviewFingerprintByPath.get(path);
    if (fingerprint) {
      const entry: ReviewDecisionEntry = {
        path,
        fingerprint,
        reason: "threads_resolved",
        createdAt,
      };
      setReviewDecisions((entries) => [
        entry,
        ...entries.filter((candidate) => candidate.path !== path),
      ]);
    }
    addReviewReceipt({
      path,
      reason: "threads_resolved",
      now,
      fingerprint,
      threadIds: [threadId],
    });
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
    await openReviewTarget(commentNavigationTarget(comment), "normal");
  }

  async function openDraftReviewComment(draft: DraftReviewComment) {
    const target = draftCommentNavigationTargets([draft])[0];
    if (!target) return;
    await openReviewTarget(target, "normal");
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
    () =>
      selectedPath
        ? comments.filter((comment) => comment.path === selectedPath)
        : [],
    [comments, selectedPath],
  );
  const quickOpenRecentFiles = useMemo<RecentFileSearchResult[]>(() => {
    const seen = new Set<string>();
    const candidates: RecentFileSearchResult[] = [];
    const activeTab = openTabs.find((tab) => tab.path === selectedPath);
    if (activeTab) {
      seen.add(activeTab.path);
      candidates.push({
        path: activeTab.path,
        viewerKind: activeTab.viewerKind,
        source: "active",
      });
    }
    for (const tab of openTabs) {
      if (seen.has(tab.path)) continue;
      seen.add(tab.path);
      candidates.push({
        path: tab.path,
        viewerKind: tab.viewerKind,
        source: "open",
      });
    }
    for (const file of recentFiles) {
      if (seen.has(file.path)) continue;
      seen.add(file.path);
      candidates.push({
        path: file.path,
        viewerKind: file.viewerKind,
        source: "recent",
      });
    }
    return candidates;
  }, [openTabs, recentFiles, selectedPath]);
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
  const activeFileOutline = useMemo(() => outlineForFile(file), [file]);
  const usesInlineCommentThread = activeCommentRendersInViewerThread({
    comment: visibleActiveComment,
    diffEnabled,
    viewerKind: file?.viewerKind,
    viewerMode: activeViewerMode,
  });
  const activeFileRemoved = Boolean(activeTab?.removed);
  const effectiveSidebarWidth = compactSidebarWidth(
    sidebarWidth,
    viewportWidth,
  );
  const effectiveSidebarVisible = sidebarVisible;
  const inspectorCollapsedByViewport = shouldCollapseInspector(viewportWidth);
  const effectiveInspectorVisible = isInspectorEffectivelyVisible(
    inspectorVisible,
    compactInspectorOpen,
    viewportWidth,
  );
  const workbenchClassName = [
    styles.workbench,
    effectiveSidebarVisible ? "" : styles.sidebarHidden,
    effectiveInspectorVisible ? "" : styles.inspectorHidden,
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
  const currentReviewFingerprintByPath = useMemo(
    () =>
      new Map(
        reviewChanges.map((change) => [
          change.path,
          reviewChangeFingerprint(
            change,
            reviewDiffStats[change.path],
            files[change.path] ?? null,
          ),
        ]),
      ),
    [files, reviewChanges, reviewDiffStats],
  );
  const acceptedReviewPathSet = useMemo(
    () =>
      reviewDecisionPathSet(reviewDecisions, currentReviewFingerprintByPath),
    [currentReviewFingerprintByPath, reviewDecisions],
  );
  const acceptedReviewChanges = useMemo(
    () =>
      reviewChanges.filter((change) => acceptedReviewPathSet.has(change.path)),
    [acceptedReviewPathSet, reviewChanges],
  );
  const attentionCommentThreadCount = useMemo(
    () => countAttentionCommentThreads(comments, unreadReviewPathSet),
    [comments, unreadReviewPathSet],
  );
  const knownMissingCommentPathSet = useMemo(() => {
    if (!tree) return new Set<string>();
    const paths = new Set<string>();
    for (const comment of comments) {
      if (
        comment.status === "open" &&
        isPathKnownMissing(tree.nodes, comment.path)
      ) {
        paths.add(comment.path);
      }
    }
    return paths;
  }, [comments, tree]);
  const selectedPathSourceMissing = selectedPath
    ? knownMissingCommentPathSet.has(selectedPath)
    : false;
  const reviewItems = useMemo(
    () =>
      buildReviewQueueItems(
        reviewChanges,
        comments,
        commentActivitySummaries,
        unreadReviewPathSet,
        {
          acceptedPaths: acceptedReviewPathSet,
          knownMissingPaths: knownMissingCommentPathSet,
          draftComments,
        },
      ),
    [
      acceptedReviewPathSet,
      commentActivitySummaries,
      comments,
      knownMissingCommentPathSet,
      draftComments,
      reviewChanges,
      unreadReviewPathSet,
    ],
  );
  const reviewQueueProgress = useMemo(
    () => summarizeReviewQueue(reviewItems),
    [reviewItems],
  );
  const hiddenAcceptedReviewChanges = useMemo(() => {
    const activeQueuePaths = new Set(reviewItems.map((item) => item.path));
    return acceptedReviewChanges.filter(
      (change) => !activeQueuePaths.has(change.path),
    );
  }, [acceptedReviewChanges, reviewItems]);
  const visibleReviewedReceipts = useMemo(
    () =>
      visibleReviewReceipts(
        reviewReceipts,
        reviewReceiptNow,
        new Set(reviewItems.map((item) => item.path)),
      ),
    [reviewItems, reviewReceiptNow, reviewReceipts],
  );
  const reviewStateByPath = useMemo(() => {
    const states: Record<string, ReviewFileState> = {};
    for (const receipt of visibleReviewedReceipts) {
      states[receipt.path] = "reviewed";
      states[receipt.path.toLowerCase()] = "reviewed";
    }
    for (const item of reviewItems) {
      states[item.path] = reviewQueueItemState(item);
      states[item.path.toLowerCase()] = reviewQueueItemState(item);
    }
    return states;
  }, [reviewItems, visibleReviewedReceipts]);
  const reviewStateForPath = (path: string): ReviewFileState | null =>
    reviewStateByPath[path.toLowerCase()] ?? reviewStateByPath[path] ?? null;
  const openThreadTargets = useMemo(
    () => openThreadNavigationTargets(comments),
    [comments],
  );
  const inReviewReplyTargets = useMemo(
    () => agentReplyNavigationTargets(comments),
    [comments],
  );
  const currentFileOpenThreadTargets = useMemo(
    () => openThreadNavigationTargets(comments, { path: selectedPath }),
    [comments, selectedPath],
  );
  const changedPathSet = useMemo(
    () => new Set(reviewChanges.map((change) => change.path)),
    [reviewChanges],
  );
  const reviewPathSet = useMemo(
    () => new Set(reviewItems.map((item) => item.path)),
    [reviewItems],
  );
  const reviewTreePathSet = useMemo(
    () => new Set([...changedPathSet, ...reviewPathSet]),
    [changedPathSet, reviewPathSet],
  );
  const openTabPathSet = useMemo(
    () => new Set(openTabs.map((tab) => tab.path)),
    [openTabs],
  );
  const treeCommentCountsByPath = useMemo(
    () =>
      Object.fromEntries(
        reviewItems.map((item) => [item.path, item.commentCount]),
      ),
    [reviewItems],
  );
  const treeOpenThreadCountsByPath = useMemo(
    () =>
      Object.fromEntries(
        reviewItems.map((item) => [item.path, item.threadCounts.open]),
      ),
    [reviewItems],
  );
  const workspaceStatus = useMemo(
    () =>
      summarizeWorkspaceStatus({
        tree,
        openTabCount: openTabs.length,
        reviewFileCount: reviewItems.length,
        reviewLoading: gitReviewLoading || gitReview === null,
        openThreadCount: openThreadTargets.length,
        draftCount: draftComments.length,
        connectionStatus: workspaceConnectionStatus,
        activeFile: selectedPath
          ? {
              path: selectedPath,
              changed: changedPathSet.has(selectedPath),
              diffEnabled: Boolean(
                file && diffEnabled && supportsDiffMode(file),
              ),
              isPreview: Boolean(activeTab?.isPreview),
              removed: Boolean(activeTab?.removed),
              sourceMissing: selectedPathSourceMissing,
              viewerMode: activeViewerMode,
            }
          : null,
        metrics: liveMetrics,
      }),
    [
      activeTab?.isPreview,
      activeTab?.removed,
      activeViewerMode,
      changedPathSet,
      draftComments.length,
      diffEnabled,
      file,
      gitReview,
      gitReviewLoading,
      liveMetrics,
      openThreadTargets.length,
      openTabs.length,
      reviewItems.length,
      selectedPath,
      selectedPathSourceMissing,
      tree,
      workspaceConnectionStatus,
    ],
  );
  const activityThreadTargets = useMemo(
    () =>
      commentActivityThreadTargets({
        comments,
        selectedPath,
        reviewPaths: reviewItems.slice(0, 24).map((item) => item.path),
      }),
    [comments, reviewItems, selectedPath],
  );
  const commandActions = useMemo<CommandActionItem[]>(
    () =>
      reviewCommandActions({
        activeComment:
          activeComment?.path === selectedPath ? activeComment : null,
        canToggleDiff: Boolean(file && supportsDiffMode(file)),
        diffEnabled,
        inReviewReplyTargetCount: inReviewReplyTargets.length,
        openThreadTargetCount: openThreadTargets.length,
        reviewItemCount: reviewItems.length,
        unreadReviewCount: unreadReviewPathSet.size,
      }),
    [
      activeComment,
      attentionCommentThreadCount,
      diffEnabled,
      file,
      inReviewReplyTargets.length,
      openThreadTargets.length,
      reviewItems.length,
      selectedPath,
      unreadReviewPathSet.size,
    ],
  );
  const sidebarNodes = useMemo(
    () =>
      treeChangedOnly && tree
        ? filterTreeToPaths(tree.nodes, reviewTreePathSet)
        : (tree?.nodes ?? []),
    [reviewTreePathSet, tree, treeChangedOnly],
  );
  const explorerFilterSummary = {
    active: treeChangedOnly,
    reviewLoading: gitReviewLoading && gitReview === null,
    reviewPathCount: reviewTreePathSet.size,
  };

  useEffect(() => {
    activeFilePaths.current = activePanePaths(panes);
  }, [panes]);

  useEffect(() => {
    commentsRef.current = comments;
  }, [comments]);

  useEffect(() => {
    diffEnabledRef.current = diffEnabled;
  }, [diffEnabled]);

  useEffect(() => {
    const paneId = layout.activePaneId;
    const validIds = new Set(activeFileOutline.map((heading) => heading.id));
    const nextId = activeFileOutline[0]?.id ?? null;
    setActiveOutlineByPane((items) => {
      const current = items[paneId] ?? null;
      const normalized = current && validIds.has(current) ? current : nextId;
      return current === normalized
        ? items
        : { ...items, [paneId]: normalized };
    });
  }, [activeFileOutline, layout.activePaneId]);

  async function fetchFilePayload(path: string): Promise<FilePayload> {
    return (await client.getFileContext({ path })).file;
  }

  async function loadFile(
    path: string,
    paneId = layout.activePaneId,
    mode: OpenTabMode = "preview",
  ): Promise<FilePayload> {
    setLoadingFilePaths((items) => ({
      ...items,
      [path]: (items[path] ?? 0) + 1,
    }));
    setActiveCommentId(null);
    setActiveCommentRect(null);
    setLayout((current) => setPaneActivePath(current, paneId, path));
    setError(null);
    try {
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
    } finally {
      setLoadingFilePaths((items) => {
        const nextCount = (items[path] ?? 1) - 1;
        if (nextCount > 0) return { ...items, [path]: nextCount };
        const next = { ...items };
        delete next[path];
        return next;
      });
    }
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

  function focusTextSearchResult(
    payload: FilePayload,
    paneId: string,
    lineNumber: number,
  ) {
    setDiffEnabled(false);
    setSourceFocusTarget((current) => ({
      paneId,
      path: payload.path,
      lineNumber,
      revision: (current?.revision ?? 0) + 1,
    }));
    const searchViewerMode = viewerModeForTextSearchTarget(payload);
    if (searchViewerMode) {
      setViewerModes((items) => ({
        ...items,
        [payload.path]: searchViewerMode,
      }));
    }
    const searchSelection = codeSelectionForTextSearchTarget(
      payload,
      lineNumber,
    );
    if (searchSelection) {
      setCodeSelections((items) => ({
        ...items,
        [payload.path]: searchSelection,
      }));
    }
    focusSourceLine(paneId, lineNumber);
  }

  function openTextSearchResult(
    session: TextSearchNavigationSession,
    paneId = layout.activePaneId,
    preview: OpenTabMode = "preview",
  ) {
    const result = activeTextSearchResult(session);
    if (!result) return;
    setTextSearchNavigation(session);
    void loadFile(result.path, paneId, preview)
      .then((payload) =>
        focusTextSearchResult(payload, paneId, result.lineNumber),
      )
      .catch((err) => setError(String(err)));
  }

  function moveTextSearchResult(direction: "next" | "previous") {
    const nextSession = moveTextSearchSession(textSearchNavigation, direction);
    if (!nextSession) return;
    openTextSearchResult(
      nextSession,
      sourceFocusTarget?.paneId ?? layout.activePaneId,
      "preview",
    );
  }

  function openFromPalette(
    path: string,
    preview: boolean,
    lineNumber?: number,
  ) {
    const query = paletteQuery.trim();
    const session = lineNumber
      ? textSearchSessionForSelection({
          query,
          results: textSearchResults,
          path,
          lineNumber,
        })
      : null;
    setPaletteOpen(false);
    setPaletteQuery("");
    const paneId = layout.activePaneId;
    void loadFile(path, paneId, preview ? "preview" : "normal")
      .then((payload) => {
        if (!lineNumber) return;
        if (session) setTextSearchNavigation(session);
        focusTextSearchResult(payload, paneId, lineNumber);
      })
      .catch((err) => setError(String(err)));
  }

  function openPalette(mode: SearchPaletteMode) {
    setPaletteMode(mode);
    setPaletteQuery("");
    setShortcutHelpOpen(false);
    setPaletteOpen(true);
  }

  function openShortcutHelp() {
    setPaletteOpen(false);
    setShortcutHelpOpen(true);
  }

  function runPaletteAction(id: string) {
    setPaletteOpen(false);
    setPaletteQuery("");
    if (id === "return-current-stop") focusCurrentInlineThread();
    if (
      id === "toggle-current-thread-status" ||
      id === "archive-current-thread"
    )
      updateActiveCommentLifecycle(id);
    if (id === "open-latest-unread") openLatestUnreadReviewFile();
    if (id === "open-in-review-reply")
      openMovedTarget(inReviewReplyTargets, "next");
    if (id === "open-next-review") openReviewQueueFile("next");
    if (id === "focus-review-queue") focusReviewQueue();
    if (id === "open-next-thread") openMovedTarget(openThreadTargets, "next");
    if (id === "open-previous-thread")
      openMovedTarget(openThreadTargets, "previous");
    if (id === "toggle-diff") toggleHeadDiff();
  }

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

  function addReviewReceipt({
    path,
    reason,
    now = Date.now(),
    fingerprint,
    threadIds,
  }: {
    path: string;
    reason: ReviewReceiptReason;
    now?: number;
    fingerprint?: string;
    threadIds?: string[];
  }) {
    setReviewReceiptNow(now);
    setReviewReceipts((entries) =>
      compactReviewReceipts(
        [
          createReviewReceipt({
            path,
            reason,
            now,
            fingerprint,
            threadIds,
          }),
          ...entries,
        ],
        now,
      ),
    );
    setReviewLedgerDirty(true);
  }

  function acceptReviewPath(path: string) {
    const change = reviewChanges.find((candidate) => candidate.path === path);
    if (!change) return;
    const now = Date.now();
    const createdAt = new Date(now).toISOString();
    const fingerprint = reviewChangeFingerprint(
      change,
      reviewDiffStats[path],
      files[path] ?? null,
    );
    const entry: ReviewDecisionEntry = {
      path,
      fingerprint,
      reason: "accepted_change",
      createdAt,
    };
    setReviewDecisions((entries) => [
      entry,
      ...entries.filter((candidate) => candidate.path !== path),
    ]);
    setReviewLedgerDirty(true);
    addReviewReceipt({
      path,
      reason: "accepted_change",
      now,
      fingerprint,
    });
    setUnreadReviewPaths((paths) =>
      paths.filter((candidate) => candidate !== path),
    );
  }

  function restoreAcceptedReviewPath(path: string) {
    setReviewDecisions((entries) =>
      entries.filter((candidate) => candidate.path !== path),
    );
    setReviewReceipts((entries) =>
      entries.filter((candidate) => candidate.path !== path),
    );
    setReviewLedgerDirty(true);
  }

  function openReviewQueueItem(path: string, mode: OpenTabMode) {
    const paneId = layout.activePaneId;
    const activateReviewPath = () =>
      setLayout((current) => setPaneActivePath(current, paneId, path));
    const transition = reviewQueueOpenTransition({ layout, paneId, path });
    setActiveCommentId(transition.activeCommentId);
    setActiveCommentRect(transition.activeCommentRect);
    setPaletteOpen(transition.paletteOpen);
    setShortcutHelpOpen(transition.shortcutHelpOpen);
    setError(transition.error);
    setLayout((current) => {
      return reviewQueueOpenTransition({ layout: current, paneId, path })
        .layout;
    });
    const item = reviewItems.find((candidate) => candidate.path === path);
    const target = item
      ? firstRelevantThreadForReviewItem(item, comments)
      : null;
    if (target) {
      void openReviewTarget(target, mode, paneId)
        .then(activateReviewPath)
        .catch((err) => setError(String(err)));
      return;
    }
    void loadFile(path, paneId, mode)
      .then(activateReviewPath)
      .catch((err) => setError(String(err)));
  }

  async function openReviewTarget(
    target: ReviewNavigationTarget,
    mode: OpenTabMode = "preview",
    paneId = layout.activePaneId,
  ) {
    setPaletteOpen(false);
    setShortcutHelpOpen(false);
    const payload = await loadFile(target.path, paneId, mode);
    const targetComment = target.commentId
      ? (allCommentMessages.find(
          (comment) => comment.id === target.commentId,
        ) ?? null)
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
        focusReviewTargetSourceLine(payload, targetComment, paneId);
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
      window.setTimeout(() => focusCurrentInlineThread(target.commentId), 120);
    }
  }

  function focusReviewTargetSourceLine(
    payload: FilePayload,
    comment: ViviComment | null,
    paneId: string,
  ) {
    const lineStart = comment?.anchor.canonical.lineStart;
    if (!lineStart) return;
    const lineEnd = comment.anchor.canonical.lineEnd ?? lineStart;
    setSourceFocusTarget((current) => ({
      paneId,
      path: payload.path,
      lineNumber: lineStart,
      revision: (current?.revision ?? 0) + 1,
    }));
    if (payload.viewerKind === "code") {
      setCodeSelections((items) => ({
        ...items,
        [payload.path]: { start: lineStart, end: lineEnd },
      }));
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

  function focusReviewQueue() {
    if (inspectorCollapsedByViewport) {
      setCompactInspectorOpen(true);
    } else {
      setInspectorVisible(true);
    }
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

  function focusCurrentInlineThread(commentId: string | null = null) {
    const focusCommentId = inlineThreadFocusCommentId(
      activeCommentId,
      commentId,
    );
    if (!focusCommentId) {
      openMovedTarget(currentFileOpenThreadTargets, "next");
      return;
    }
    const target =
      Array.from(
        document.querySelectorAll<HTMLElement>("[data-comment-id]"),
      ).find((element) => element.dataset.commentId === focusCommentId) ??
      document.querySelector<HTMLElement>(".inline-comment-card");
    target?.focus();
  }

  function updateActiveCommentLifecycle(
    action: "toggle-current-thread-status" | "archive-current-thread",
  ) {
    const status = currentThreadLifecycleShortcutStatus(activeComment, action);
    if (!status || !activeComment) return;
    void updateCommentStatus(activeComment.id, status).catch((err) =>
      setError(String(err)),
    );
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

  function outlineForFile(target: FilePayload | null) {
    if (!target) return [];
    if (target.viewerKind === "html") return extractHtmlOutline(target.content);
    if (target.viewerKind !== "markdown") return [];
    return extractMarkdownOutline(target.content);
  }

  function updateActiveOutlineForPane(
    paneId: string,
    target: FilePayload | null,
  ) {
    const outline = outlineForFile(target);
    if (!outline.length) {
      setActiveOutlineByPane((items) =>
        items[paneId] === null || items[paneId] === undefined
          ? items
          : { ...items, [paneId]: null },
      );
      return;
    }
    const pane = document.querySelector<HTMLElement>(
      `[data-pane-id="${paneId}"]`,
    );
    const viewer = pane?.querySelector<HTMLElement>("[data-viewer-pane]");
    if (!viewer) return;
    const viewerTop = viewer.getBoundingClientRect().top;
    const positions = outline
      .map((heading) => {
        const element = Array.from(
          viewer.querySelectorAll<HTMLElement>("[id]"),
        ).find((candidate) => candidate.id === heading.id);
        if (!element) return null;
        return {
          id: heading.id,
          top: element.getBoundingClientRect().top - viewerTop,
        };
      })
      .filter(
        (position): position is { id: string; top: number } =>
          position !== null,
      );
    const activeId = activeOutlineHeadingId(positions);
    setActiveOutlineByPane((items) =>
      items[paneId] === activeId ? items : { ...items, [paneId]: activeId },
    );
  }

  function jumpToOutline(id: string, paneId = layout.activePaneId) {
    const pane = document.querySelector<HTMLElement>(
      `[data-pane-id="${paneId}"]`,
    );
    const viewer = pane?.querySelector<HTMLElement>("[data-viewer-pane]");
    if (!viewer) return;

    const markdownTarget = Array.from(
      viewer.querySelectorAll<HTMLElement>("[id]"),
    ).find((element) => element.id === id);
    if (markdownTarget) {
      markdownTarget.scrollIntoView({ block: "start", behavior: "smooth" });
      setActiveOutlineByPane((items) =>
        items[paneId] === id ? items : { ...items, [paneId]: id },
      );
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

  function focusSourceLine(paneId: string, lineNumber: number, attempt = 0) {
    const pane = document.querySelector<HTMLElement>(
      `[data-pane-id="${paneId}"]`,
    );
    const target = pane?.querySelector<HTMLElement>(
      `.code-line[data-line="${lineNumber}"], .commented-source-line[data-line="${lineNumber}"]`,
    );
    if (target) {
      target.scrollIntoView({ block: "center", behavior: "smooth" });
      if (!target.hasAttribute("tabindex")) target.tabIndex = -1;
      target.focus({ preventScroll: true });
      return;
    }
    if (attempt >= 6) return;
    window.setTimeout(
      () => focusSourceLine(paneId, lineNumber, attempt + 1),
      50,
    );
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
  }, [client]);

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
      const target = commentActivityRefreshTarget(event, commentsRef.current);
      if (!target.shouldRefresh) return;
      if (target.path && target.shouldMarkUnread) {
        markReviewPathUnread(target.path);
      }
      void loadComments(target.path)
        .then((loaded) => {
          if (target.path || !target.shouldMarkUnread) return;
          const refreshedPath = commentActivityThreadPath(event, loaded);
          if (refreshedPath) markReviewPathUnread(refreshedPath);
        })
        .catch((err) => setError(String(err)));
    });
  }, [client]);

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

    if (restored && !initialDeepLink.current) {
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
    if (!workspaceSessionReady || pendingRestoreSession) return;
    const deepLink = initialDeepLink.current;
    if (!deepLink) return;
    initialDeepLink.current = null;
    const paneId = layout.activePaneId;
    const open = deepLink.diff
      ? openHeadDiff(deepLink.path, paneId)
      : loadFile(deepLink.path, paneId, "preview");
    void open.catch((err) => setError(String(err)));
  }, [workspaceSessionReady, pendingRestoreSession, client]);

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
    if (!inspectorCollapsedByViewport) setCompactInspectorOpen(false);
  }, [inspectorCollapsedByViewport]);

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
    document.body.classList.add(styles.resizingWorkbenchPane);

    return () => {
      window.removeEventListener("pointermove", resize);
      window.removeEventListener("pointerup", stopResize);
      window.removeEventListener("pointercancel", stopResize);
      document.body.classList.remove(styles.resizingWorkbenchPane);
    };
  }, [resizingWorkbenchPane]);

  useEffect(() => {
    const query = paletteQuery.trim();
    if (!paletteOpen || paletteMode !== "file" || !query) {
      setFileSearchResults([]);
      setFileSearchLoading(false);
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      setFileSearchLoading(true);
      client
        .searchFiles({
          query,
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
    setReviewDecisions((entries) => {
      const compacted = compactReviewDecisions(
        entries,
        currentReviewFingerprintByPath,
      );
      if (compacted.length !== entries.length) setReviewLedgerDirty(true);
      return compacted;
    });
  }, [currentReviewFingerprintByPath]);

  useEffect(() => {
    if (!config?.root || requestedReviewLedgerRoot.current === config.root) {
      return;
    }
    requestedReviewLedgerRoot.current = config.root;
    setReviewLedgerLoadedRoot(null);
    const now = Date.now();
    client
      .getReviewLedger()
      .then((snapshot) => {
        setReviewDecisions(snapshot.decisions);
        setReviewReceipts(compactReviewReceipts(snapshot.receipts, now));
        setReviewReceiptNow(now);
        setReviewLedgerDirty(false);
        setReviewLedgerLoadedRoot(config.root);
      })
      .catch((err) => setError(String(err)));
  }, [client, config?.root]);

  useEffect(() => {
    if (
      !config?.root ||
      reviewLedgerLoadedRoot !== config.root ||
      !reviewLedgerDirty
    ) {
      return;
    }
    void client
      .saveReviewLedger({
        decisions: reviewDecisions,
        receipts: reviewReceipts,
      })
      .then(() => setReviewLedgerDirty(false))
      .catch((err) => setError(String(err)));
  }, [
    client,
    config?.root,
    reviewDecisions,
    reviewLedgerDirty,
    reviewLedgerLoadedRoot,
    reviewReceipts,
  ]);

  useEffect(() => {
    const interval = window.setInterval(
      () => setReviewReceiptNow(Date.now()),
      30_000,
    );
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    setReviewReceipts((entries) => {
      const compacted = compactReviewReceipts(entries, reviewReceiptNow);
      if (compacted.length !== entries.length) setReviewLedgerDirty(true);
      return compacted;
    });
  }, [reviewReceiptNow]);

  useEffect(() => {
    setUnreadReviewPaths((paths) =>
      syncUnreadReviewPaths(paths, reviewItems, knownReviewPaths.current),
    );
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

      if (action === "toggle-sidebar") {
        event.preventDefault();
        setSidebarVisible((visible) => !visible);
        return;
      }

      if (action === "toggle-inspector") {
        event.preventDefault();
        if (inspectorCollapsedByViewport) {
          setCompactInspectorOpen((visible) => !visible);
        } else {
          setInspectorVisible((visible) => !visible);
        }
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
      if (action === "open-in-review-reply")
        openMovedTarget(inReviewReplyTargets, "next");
      if (action === "open-next-review") openReviewQueueFile("next");
      if (action === "open-previous-review") openReviewQueueFile("previous");
      if (action === "open-next-thread")
        openMovedTarget(openThreadTargets, "next");
      if (action === "open-previous-thread")
        openMovedTarget(openThreadTargets, "previous");
      if (action === "open-next-search-result") moveTextSearchResult("next");
      if (action === "open-previous-search-result")
        moveTextSearchResult("previous");
      if (action === "focus-current-inline-thread") focusCurrentInlineThread();
      if (
        action === "toggle-current-thread-status" ||
        action === "archive-current-thread"
      )
        updateActiveCommentLifecycle(action);
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
    activeComment,
    activeCommentId,
    draftComments,
    draftPublishing,
    inReviewReplyTargets,
    openThreadTargets,
    currentFileOpenThreadTargets,
    reviewItems,
    textSearchNavigation,
    sourceFocusTarget,
    files,
    file,
    viewerModes,
  ]);

  useEffect(() => {
    const unsubscribe = client.subscribeWorkspaceEvents(
      (event) => {
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
      },
      { onStatus: setWorkspaceConnectionStatus },
    );
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
    <div
      className={`${sharedUiStyles.sharedUiStyles} ${sharedUiStyles.appShell} app-shell`}
    >
      <Topbar
        root={config?.root ?? null}
        themePreference={themePreference}
        onThemeCycle={() =>
          setThemePreference((current) => nextThemePreference(current))
        }
        onQuickOpen={() => openPalette("file")}
        onSearchText={() => openPalette("text")}
        onOpenShortcuts={openShortcutHelp}
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
              className={`${styles.resizer} ${styles.sidebarResizer}`}
              type="button"
              aria-label="Resize sidebar"
              title="Resize sidebar"
              onPointerDown={(event) => {
                event.preventDefault();
                setResizingWorkbenchPane("sidebar");
              }}
              onDoubleClick={() => setSidebarWidth(defaultSidebarWidth)}
            />
            <aside
              className={`${sharedUiStyles.sidebar} sidebar`}
              aria-label="File explorer"
            >
              <div className={`${sharedUiStyles.panelTitle} panel-title`}>
                <span>Explorer</span>
                <button
                  aria-label={explorerFilterLabel(explorerFilterSummary)}
                  className={
                    treeChangedOnly
                      ? `${sharedUiStyles.pill} ${sharedUiStyles.filterPill} ${sharedUiStyles.pillActive} pill filter-pill active`
                      : `${sharedUiStyles.pill} ${sharedUiStyles.filterPill} pill filter-pill`
                  }
                  title={explorerFilterLabel(explorerFilterSummary)}
                  type="button"
                  onClick={() => setTreeChangedOnly((value) => !value)}
                >
                  {explorerFilterText(explorerFilterSummary)}
                </button>
              </div>
              {tree ? (
                <TreeSidebar
                  nodes={sidebarNodes}
                  selectedPath={selectedPath}
                  revealPath={treeReveal?.path ?? null}
                  revealRevision={treeReveal?.revision ?? 0}
                  changedPaths={changedPathSet}
                  reviewPaths={reviewPathSet}
                  reviewStateByPath={reviewStateByPath}
                  unreadReviewPaths={unreadReviewPathSet}
                  activePaths={openTabPathSet}
                  currentStopPath={activeComment?.path ?? null}
                  commentCountsByPath={treeCommentCountsByPath}
                  openThreadCountsByPath={treeOpenThreadCountsByPath}
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
                <p className={`${sharedUiStyles.muted} muted`}>
                  Loading tree...
                </p>
              )}
            </aside>
          </>
        ) : null}
        <button
          className={`${styles.railToggle} ${styles.sidebarRailToggle}`}
          type="button"
          aria-label={
            effectiveSidebarVisible ? "Collapse sidebar" : "Expand sidebar"
          }
          aria-keyshortcuts="Meta+B Control+B"
          title={
            effectiveSidebarVisible ? "Collapse sidebar" : "Expand sidebar"
          }
          onClick={() => setSidebarVisible((visible) => !visible)}
        >
          <span
            className={
              effectiveSidebarVisible
                ? `${styles.collapseIcon} ${styles.collapseLeft}`
                : `${styles.collapseIcon} ${styles.collapseRight}`
            }
          />
        </button>

        <main className={styles.main}>
          <div
            className={`${styles.editorGrid}${draggingTab ? ` ${styles.draggingTab}` : ""}`}
          >
            {renderLayoutNode(layout.root)}
          </div>
        </main>

        <button
          className={`${styles.railToggle} ${styles.inspectorRailToggle}`}
          type="button"
          aria-label={
            effectiveInspectorVisible
              ? "Collapse inspector"
              : "Expand inspector"
          }
          aria-keyshortcuts="Meta+Shift+\\ Control+Shift+\\"
          title={
            effectiveInspectorVisible
              ? "Collapse inspector"
              : "Expand inspector"
          }
          onClick={() => {
            if (inspectorCollapsedByViewport) {
              setCompactInspectorOpen((visible) => !visible);
            } else {
              setInspectorVisible((visible) => !visible);
            }
          }}
        >
          <span
            className={
              effectiveInspectorVisible
                ? `${styles.collapseIcon} ${styles.collapseRight}`
                : `${styles.collapseIcon} ${styles.collapseLeft}`
            }
          />
        </button>

        {effectiveInspectorVisible ? (
          <>
            <button
              className={`${styles.resizer} ${styles.inspectorResizer}`}
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
              reviewChanges={reviewChanges}
              acceptedReviewChanges={hiddenAcceptedReviewChanges}
              reviewReceipts={visibleReviewedReceipts}
              reviewItems={reviewItems}
              reviewLoading={gitReviewLoading && gitReview === null}
              reviewUnavailableReason={gitReview?.reason ?? null}
              reviewDiffStats={reviewDiffStats}
              loadingReviewDiffs={loadingDiffs}
              unreadReviewPaths={unreadReviewPathSet}
              comments={activeFileComments}
              reviewComments={comments}
              draftComments={draftComments}
              commentsLoading={commentsLoading}
              knownMissingCommentPaths={knownMissingCommentPathSet}
              threadActivities={commentActivitySummaries}
              activeCommentId={activeCommentId}
              onOpenComment={openCommentFromPanel}
              onOpenDraft={(draft) =>
                void openDraftReviewComment(draft).catch((err) =>
                  setError(String(err)),
                )
              }
              onPublishDrafts={(draftIds) =>
                void publishDraftReviewComments(draftIds).catch((err) =>
                  setError(String(err)),
                )
              }
              onCommentStatusChange={(id, status) =>
                void updateCommentStatus(id, status).catch((err) =>
                  setError(String(err)),
                )
              }
              selectedCodeRange={
                file?.path ? (codeSelections[file.path] ?? null) : null
              }
              outline={activeFileOutline}
              activeOutlineId={activeOutlineByPane[layout.activePaneId] ?? null}
              activePath={selectedPath}
              refreshedAt={file?.path ? refreshedFiles[file.path] : undefined}
              activePaneId={layout.activePaneId}
              onOpenEventPath={(path) => openReviewQueueItem(path, "preview")}
              onConfirmEventPath={(path) => openReviewQueueItem(path, "normal")}
              onOpenNextUnread={openLatestUnreadReviewFile}
              onOpenNextChanged={() => openReviewQueueFile("next")}
              onOpenPreviousChanged={() => openReviewQueueFile("previous")}
              onOpenAllChanged={openAllChangedFiles}
              onAcceptReviewPath={acceptReviewPath}
              onRestoreAcceptedReviewPath={restoreAcceptedReviewPath}
              onRevealInTree={revealActiveFileInTree}
              onOutlineSelect={(id) => jumpToOutline(id)}
            />
          </>
        ) : null}
      </div>

      <WorkspaceStatusbar status={workspaceStatus} />

      <CommandPalette
        open={paletteOpen}
        mode={paletteMode}
        query={paletteQuery}
        fileResults={fileSearchResults}
        recentFiles={quickOpenRecentFiles}
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
        onRunAction={runPaletteAction}
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
      <InlineCommentCard
        comment={usesInlineCommentThread ? null : visibleActiveComment}
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
    setRestoreNoticeTabCount(null);
  }

  function renderLayoutNode(node: EditorLayoutNode): ReactNode {
    if (node.kind === "split") {
      return (
        <div
          className={`${styles.editorSplit} ${styles[node.direction]}`}
          key={node.id}
        >
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
    const panePendingPath =
      pane.activePath && !paneFile && loadingFilePaths[pane.activePath]
        ? pane.activePath
        : null;
    const paneActiveTab = pane.activePath
      ? paneTabs.find((tab) => tab.path === pane.activePath)
      : null;
    const paneTextSearchResult =
      paneFile && sourceFocusTarget?.paneId === pane.id
        ? activeTextSearchResult(textSearchNavigation)
        : null;
    const paneTextSearchPosition =
      textSearchPositionLabel(textSearchNavigation);
    const showPaneTextSearch =
      paneTextSearchResult &&
      paneFile &&
      paneTextSearchResult.path === paneFile.path &&
      sourceFocusTarget?.path === paneFile.path;

    return (
      <section
        className={
          pane.id === layout.activePaneId
            ? `${styles.editorPane} ${styles.activePane}`
            : styles.editorPane
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
        <div
          className={styles.viewerPane}
          data-viewer-pane
          onScroll={() => updateActiveOutlineForPane(pane.id, paneFile)}
        >
          {error && pane.id === layout.activePaneId ? (
            <WorkbenchErrorMessage
              error={error}
              path={pane.activePath}
              sourceMissing={selectedPathSourceMissing}
            />
          ) : (
            <>
              {showPaneTextSearch ? (
                <TextSearchNavigationBar
                  query={textSearchNavigation?.query ?? ""}
                  position={paneTextSearchPosition ?? ""}
                  result={paneTextSearchResult}
                  onPrevious={() => moveTextSearchResult("previous")}
                  onNext={() => moveTextSearchResult("next")}
                  onClose={() => {
                    setTextSearchNavigation(null);
                    setSourceFocusTarget(null);
                  }}
                />
              ) : null}
              {panePendingPath ? (
                <WorkbenchPendingFileMessage path={panePendingPath} />
              ) : (
                <FileViewer
                  key={paneFile?.path ?? "empty"}
                  file={paneFile}
                  removed={Boolean(paneActiveTab?.removed)}
                  allowHtmlScripts={config?.allowHtmlScripts ?? false}
                  theme={resolvedTheme}
                  selectedCodeRange={
                    paneFile?.path
                      ? (codeSelections[paneFile.path] ?? null)
                      : null
                  }
                  focusLineNumber={
                    paneFile &&
                    sourceFocusTarget?.paneId === pane.id &&
                    sourceFocusTarget.path === paneFile.path
                      ? sourceFocusTarget.lineNumber
                      : null
                  }
                  focusRevision={
                    paneFile &&
                    sourceFocusTarget?.paneId === pane.id &&
                    sourceFocusTarget.path === paneFile.path
                      ? sourceFocusTarget.revision
                      : 0
                  }
                  viewerMode={
                    paneFile
                      ? (viewerModes[paneFile.path] ??
                        defaultViewerMode(paneFile))
                      : undefined
                  }
                  diff={paneFile?.path ? (diffs[paneFile.path] ?? null) : null}
                  diffLoading={
                    paneFile?.path
                      ? Boolean(loadingDiffs[paneFile.path])
                      : false
                  }
                  diffEnabled={
                    paneFile ? diffEnabled && supportsDiffMode(paneFile) : false
                  }
                  currentActorId={reviewActorForConfig(config)?.id}
                  outline={outlineForFile(paneFile)}
                  refreshedAt={
                    paneFile?.path ? refreshedFiles[paneFile.path] : undefined
                  }
                  onOutlineSelect={(id) => jumpToOutline(id, pane.id)}
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
                  reviewState={
                    paneFile?.path ? reviewStateForPath(paneFile.path) : null
                  }
                  onMarkReviewed={
                    paneFile?.path &&
                    reviewStateForPath(paneFile.path) === "queued"
                      ? () => acceptReviewPath(paneFile.path)
                      : undefined
                  }
                  activeCommentId={activeCommentId}
                  expandActiveCommentThread
                  onOpenComment={openInlineComment}
                  onCloseComment={closeInlineComment}
                  onCommentStatusChange={updateCommentStatus}
                  threadActivities={commentActivitySummaries}
                  onFocusActiveComment={focusCurrentInlineThread}
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
                  onRevealInTree={(path) => revealActiveFileInTree(path)}
                  onOpenPath={(path) => {
                    const mode = paneActiveTab?.isPreview
                      ? "preview"
                      : "normal";
                    void loadFile(path, pane.id, mode).catch((err) =>
                      setError(String(err)),
                    );
                  }}
                  onCloseRemoved={() => {
                    if (pane.activePath) closeTab(pane.activePath, pane.id);
                  }}
                />
              )}
            </>
          )}
        </div>
        <div
          aria-label="Split pane"
          className={[
            styles.splitDropZone,
            dropTarget?.paneId === pane.id ? styles.splitDropZoneActive : "",
            dropTarget?.paneId === pane.id
              ? dropEdgeClass(dropTarget.edge)
              : "",
          ]
            .filter(Boolean)
            .join(" ")}
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

export function TextSearchNavigationBar({
  query,
  position,
  result,
  onPrevious,
  onNext,
  onClose,
}: {
  query: string;
  position: string;
  result: TextSearchResult;
  onPrevious: () => void;
  onNext: () => void;
  onClose: () => void;
}) {
  return (
    <div
      className={`${styles.textSearchNav} text-search-nav`}
      aria-label="Text search navigation"
    >
      <div className={`${styles.textSearchNavMain} text-search-nav-main`}>
        <span className={`${styles.textSearchNavQuery} text-search-nav-query`}>
          "{query}"
        </span>
        <span>{position}</span>
        <span>Line {result.lineNumber}</span>
        <code
          className={`${styles.textSearchNavPreview} text-search-nav-preview`}
        >
          {textSearchPreviewSegments(
            result.lineText,
            result.matchStart,
            result.matchLength,
          ).map((segment, index) =>
            segment.match ? (
              <mark
                className={`${styles.textSearchNavMatch} text-search-nav-match`}
                key={index}
              >
                {segment.text}
              </mark>
            ) : (
              <span key={index}>{segment.text}</span>
            ),
          )}
        </code>
      </div>
      <div className={`${styles.textSearchNavActions} text-search-nav-actions`}>
        <button type="button" onClick={onPrevious} title="Previous match">
          Previous
        </button>
        <button type="button" onClick={onNext} title="Next match">
          Next
        </button>
        <button type="button" onClick={onClose} title="Clear search focus">
          Clear
        </button>
      </div>
    </div>
  );
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
    <div className={styles.restoreOverlay} role="presentation">
      <section
        aria-label="Restore previous tabs"
        className={styles.restorePrompt}
        role="dialog"
      >
        <strong>Restore previous tabs?</strong>
        <p>
          The last session had {tabCount} tabs. Choose how much of that
          workspace to bring back.
        </p>
        <div className={styles.restoreActions}>
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
  return visibleThreadComments([...byId.values()]).sort((a, b) =>
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
  ).map((draft) => draftReviewCommentAsViviComment(draft));
  return visibleThreadComments([...published, ...draftMessages]).sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );
}

function matchingPublishedCommentForDraft(
  comments: ViviComment[],
  draft: DraftReviewComment,
): ViviComment | undefined {
  const draftAnchorKey = commentAnchorIdentity(draft.anchor);
  return comments.find(
    (comment) =>
      comment.path === draft.path &&
      comment.body === draft.body &&
      comment.source === draft.source &&
      commentAnchorIdentity(comment.anchor) === draftAnchorKey,
  );
}

function commentAnchorIdentity(anchor: DraftReviewComment["anchor"]): string {
  const canonical = anchor.canonical;
  const rendered = anchor.rendered;
  const diff = anchor.diff;
  return JSON.stringify([
    anchor.surface,
    canonical.path ?? null,
    canonical.lineStart ?? null,
    canonical.lineEnd ?? canonical.lineStart ?? null,
    canonical.quote ?? null,
    rendered?.blockId ?? null,
    rendered?.selector ?? null,
    diff?.base ?? null,
    diff?.ref ?? null,
    diff?.hunkId ?? null,
    diff?.side ?? null,
    diff?.oldLineStart ?? null,
    diff?.oldLineEnd ?? null,
    diff?.newLineStart ?? null,
    diff?.newLineEnd ?? null,
  ]);
}

function dropEdgeClass(edge: SplitEdge): string {
  if (edge === "left") return styles.dropLeft;
  if (edge === "right") return styles.dropRight;
  if (edge === "top") return styles.dropTop;
  return styles.dropBottom;
}

export function reviewActorForConfig(
  config: ViewerConfig | null,
): CommentActor | undefined {
  const actor = config?.reviewActor;
  if (!actor?.id.trim()) return undefined;
  return actor;
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
