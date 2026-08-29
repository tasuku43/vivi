import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import type { FsNode } from "../../domain/fs-node.js";
import { iconForPath } from "../../state/file-icons.js";
import {
  boundedVisibleTreeRows,
  countTreeNodes,
  ensureVisibleAncestors,
  initialExpandedPaths,
} from "../../state/tree-expansion.js";
import { treeKeyboardAction } from "../../state/tree-navigation.js";
import { unloadedAncestorDirectoryPaths } from "../../state/files.js";
import fileIconStyles from "./FileIcon.module.css";
import sharedUiStyles from "../styles/SharedUi.module.css";
import styles from "./TreeSidebar.module.css";

interface Props {
  nodes: FsNode[];
  ariaLabel?: string;
  selectedPath: string | null;
  revealPath?: string | null;
  revealRevision?: number;
  changedPaths?: Set<string>;
  reviewPaths?: Set<string>;
  unreadReviewPaths?: Set<string>;
  activePaths?: Set<string>;
  currentStopPath?: string | null;
  commentCountsByPath?: Record<string, number>;
  removedPaths?: Set<string>;
  loadingDirectoryPaths?: Set<string>;
  onLoadDirectory?: (path: string) => Promise<void>;
  renderFileEnd?: (node: FsNode) => ReactNode;
  showBadges?: boolean;
  onSelect: (path: string) => void;
  onOpen: (path: string) => void;
}

export function TreeSidebar({
  nodes,
  ariaLabel,
  selectedPath,
  revealPath = null,
  revealRevision = 0,
  changedPaths = new Set(),
  reviewPaths = new Set(),
  unreadReviewPaths = new Set(),
  activePaths = new Set(),
  currentStopPath = null,
  commentCountsByPath = {},
  removedPaths = new Set(),
  loadingDirectoryPaths = new Set(),
  onLoadDirectory,
  renderFileEnd,
  showBadges = true,
  onSelect,
  onOpen,
}: Props) {
  const interactionHelpId = useId();
  const treeRef = useRef<HTMLDivElement>(null);
  const forceVisiblePaths = useMemo(
    () => (revealPath ? [revealPath] : []),
    [revealPath],
  );
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() =>
    initialExpandedPaths(nodes, { forceVisiblePaths }),
  );
  const [activeTreePath, setActiveTreePath] = useState<string | null>(
    selectedPath,
  );

  useEffect(() => {
    if (!revealPath) return;
    setExpandedPaths((current) => {
      return ensureVisibleAncestors(current, forceVisiblePaths);
    });
  }, [forceVisiblePaths, revealPath, revealRevision]);

  useEffect(() => {
    if (!revealPath) return;
    window.requestAnimationFrame(() => {
      Array.from(
        treeRef.current?.querySelectorAll<HTMLElement>("[data-tree-path]") ??
          [],
      )
        .find((element) => element.dataset.treePath === revealPath)
        ?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  }, [revealPath, revealRevision, expandedPaths, nodes]);

  useEffect(() => {
    if (!onLoadDirectory || !revealPath) return;
    const pathsToLoad = unloadedAncestorDirectoryPaths(
      nodes,
      forceVisiblePaths,
      loadingDirectoryPaths,
    );
    if (!pathsToLoad.length) return;
    let cancelled = false;
    void (async () => {
      for (const path of pathsToLoad) {
        if (cancelled) return;
        await onLoadDirectory(path);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    forceVisiblePaths,
    loadingDirectoryPaths,
    nodes,
    onLoadDirectory,
    revealPath,
  ]);

  const totalRows = useMemo(() => countTreeNodes(nodes), [nodes]);
  const treeSummary = useMemo(
    () =>
      workspaceTreeSummary(nodes, {
        activePaths,
        commentCountsByPath,
        currentStopPath,
        reviewPaths,
        unreadReviewPaths,
      }),
    [
      activePaths,
      commentCountsByPath,
      currentStopPath,
      nodes,
      reviewPaths,
      unreadReviewPaths,
    ],
  );
  const boundedRows = useMemo(
    () =>
      boundedVisibleTreeRows(nodes, expandedPaths, {
        forceVisiblePaths,
      }),
    [expandedPaths, forceVisiblePaths, nodes],
  );
  const focusedTreePath =
    boundedRows.rows.find((row) => row.node.path === activeTreePath)?.node
      .path ??
    boundedRows.rows.find((row) => row.node.path === selectedPath)?.node.path ??
    boundedRows.rows[0]?.node.path ??
    null;
  const selectedAncestorPaths = useMemo(
    () => ancestorDirectoryPaths(selectedPath),
    [selectedPath],
  );
  const currentStopAncestorPaths = useMemo(
    () => ancestorDirectoryPaths(currentStopPath),
    [currentStopPath],
  );

  useEffect(() => {
    if (focusedTreePath !== activeTreePath) setActiveTreePath(focusedTreePath);
  }, [activeTreePath, focusedTreePath]);

  function toggleDirectory(path: string) {
    const row = boundedRows.rows.find((item) => item.node.path === path);
    const shouldLoad =
      row?.node.kind === "directory" &&
      !expandedPaths.has(path) &&
      row.node.childrenLoaded === false;
    setExpandedPaths((current) => togglePath(current, path));
    if (shouldLoad) void onLoadDirectory?.(path);
  }

  function focusTreePath(path: string) {
    setActiveTreePath(path);
    window.requestAnimationFrame(() => {
      Array.from(
        treeRef.current?.querySelectorAll<HTMLElement>("[data-tree-path]") ??
          [],
      )
        .find((element) => element.dataset.treePath === path)
        ?.focus();
    });
  }

  function handleTreeKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const action = treeKeyboardAction(
      boundedRows.rows,
      expandedPaths,
      focusedTreePath,
      event.key,
    );
    if (!action) return;
    event.preventDefault();
    if (action.kind === "focus") {
      focusTreePath(action.path);
      return;
    }
    if (action.kind === "toggle") {
      toggleDirectory(action.path);
      focusTreePath(action.path);
      return;
    }
    const row = boundedRows.rows.find((item) => item.node.path === action.path);
    if (row?.node.kind === "directory") {
      toggleDirectory(action.path);
      focusTreePath(action.path);
      return;
    }
    onOpen(action.path);
  }

  return (
    <>
      {totalRows > boundedRows.totalVisibleRows ? (
        <div className={styles.perfNote}>
          Showing {boundedRows.totalVisibleRows} of {totalRows} rows. Expand
          folders as needed.
        </div>
      ) : null}
      {boundedRows.omittedRows > 0 ? (
        <div className={styles.perfNote}>
          Rendering {boundedRows.rows.length} of {boundedRows.totalVisibleRows}{" "}
          visible rows. Narrow with changed-only view or collapse a folder to
          see more.
        </div>
      ) : null}
      <div
        ref={treeRef}
        className={styles.tree}
        role="tree"
        aria-label={ariaLabel ?? workspaceTreeAriaLabel(treeSummary)}
        aria-describedby={interactionHelpId}
        onKeyDown={handleTreeKeyDown}
      >
        <p
          className={`${sharedUiStyles.srOnly} sr-only`}
          id={interactionHelpId}
        >
          Click a file to preview it. Double-click or press Enter to keep it
          open as a tab.
        </p>
        {boundedRows.rows.map(({ node, depth }) => (
          <TreeRow
            activePath={focusedTreePath}
            depth={depth}
            expanded={node.kind === "directory" && expandedPaths.has(node.path)}
            key={`${node.path}:${depth}`}
            node={node}
            selectedPath={selectedPath}
            selectedAncestorPaths={selectedAncestorPaths}
            currentStopPath={currentStopPath}
            currentStopAncestorPaths={currentStopAncestorPaths}
            changedPaths={changedPaths}
            reviewPaths={reviewPaths}
            unreadReviewPaths={unreadReviewPaths}
            activePaths={activePaths}
            commentCountsByPath={commentCountsByPath}
            removedPaths={removedPaths}
            loadingDirectoryPaths={loadingDirectoryPaths}
            interactionHelpId={interactionHelpId}
            renderFileEnd={renderFileEnd}
            showBadges={showBadges}
            onFocusPath={setActiveTreePath}
            onToggleDirectory={toggleDirectory}
            onSelect={onSelect}
            onOpen={onOpen}
          />
        ))}
      </div>
    </>
  );
}

function TreeRow({
  node,
  activePath,
  depth,
  expanded,
  selectedPath,
  selectedAncestorPaths,
  currentStopPath,
  currentStopAncestorPaths,
  changedPaths,
  reviewPaths,
  unreadReviewPaths,
  activePaths,
  commentCountsByPath,
  removedPaths,
  loadingDirectoryPaths,
  interactionHelpId,
  renderFileEnd,
  showBadges,
  onFocusPath,
  onToggleDirectory,
  onSelect,
  onOpen,
}: {
  node: FsNode;
  activePath: string | null;
  depth: number;
  expanded: boolean;
  selectedPath: string | null;
  selectedAncestorPaths: Set<string>;
  currentStopPath: string | null;
  currentStopAncestorPaths: Set<string>;
  changedPaths: Set<string>;
  reviewPaths: Set<string>;
  unreadReviewPaths: Set<string>;
  activePaths: Set<string>;
  commentCountsByPath: Record<string, number>;
  removedPaths: Set<string>;
  loadingDirectoryPaths: Set<string>;
  interactionHelpId: string;
  renderFileEnd?: (node: FsNode) => ReactNode;
  showBadges: boolean;
  onFocusPath: (path: string) => void;
  onToggleDirectory: (path: string) => void;
  onSelect: (path: string) => void;
  onOpen: (path: string) => void;
}) {
  const indent = { paddingLeft: `${8 + depth * 14}px` };
  const active = node.path === activePath;
  const selected = node.path === selectedPath;
  const containsSelection = selectedAncestorPaths.has(node.path);
  const currentStop = node.path === currentStopPath;
  const containsCurrentStop = currentStopAncestorPaths.has(node.path);
  if (node.kind === "directory") {
    const summary = directoryReviewSummary(
      node,
      reviewPaths,
      unreadReviewPaths,
      activePaths,
      commentCountsByPath,
      currentStopPath,
    );
    const reviewReason = directoryTreeReviewReason(summary, {
      containsCurrentStop,
      loading: loadingDirectoryPaths.has(node.path),
    });
    return (
      <button
        className={[
          styles.row,
          styles.dir,
          summary.reviewFiles ? styles.hasReviewWork : "",
          summary.unreadFiles ? styles.hasUnreadWork : "",
          summary.openFiles ? styles.openInTab : "",
          containsSelection ? styles.containsSelection : "",
          containsCurrentStop ? styles.containsCurrentStop : "",
        ]
          .filter(Boolean)
          .join(" ")}
        data-tree-path={node.path}
        role="treeitem"
        aria-label={directoryTreeRowAriaLabel({
          name: node.name,
          expanded,
          containsSelection,
          containsCurrentStop,
          summary,
          loading: loadingDirectoryPaths.has(node.path),
        })}
        aria-expanded={expanded}
        aria-level={depth + 1}
        aria-selected={selected}
        tabIndex={active ? 0 : -1}
        onFocus={() => onFocusPath(node.path)}
        onClick={() => {
          onToggleDirectory(node.path);
        }}
        style={indent}
      >
        <span className={styles.twisty}>{expanded ? "▾" : "▸"}</span>
        <span className={`${fileIconStyles.icon} file-icon`}>📁</span>
        <span className={styles.main}>
          <span className={styles.label}>{node.name}</span>
          {reviewReason ? (
            <span className={styles.reason} aria-hidden="true">
              {reviewReason}
            </span>
          ) : null}
        </span>
        {showBadges ? (
          <TreeBadges
            loading={loadingDirectoryPaths.has(node.path)}
            open={summary.openFiles > 0}
            openFiles={summary.openFiles}
            reviewFiles={summary.reviewFiles}
            unreadFiles={summary.unreadFiles}
          />
        ) : null}
      </button>
    );
  }
  const commentCount = commentCountsByPath[node.path] ?? 0;
  const unread = unreadReviewPaths.has(node.path);
  const changed = changedPaths.has(node.path);
  const review = reviewPaths.has(node.path);
  const open = activePaths.has(node.path);
  const removed = removedPaths.has(node.path);
  const fileEnd = renderFileEnd?.(node) ?? null;
  const reviewReason = fileTreeReviewReason({
    changed,
    comments: commentCount,
    currentStop,
    open,
    removed,
    review,
    unread,
  });
  return (
    <button
      data-tree-path={node.path}
      role="treeitem"
      aria-label={fileTreeRowAriaLabel({
        name: node.name,
        selected,
        changed,
        review,
        unread,
        open,
        removed,
        currentStop,
        comments: commentCount,
      })}
      aria-describedby={interactionHelpId}
      title="Click to preview; double-click to keep open as a tab"
      aria-level={depth + 1}
      aria-selected={selected}
      tabIndex={active ? 0 : -1}
      className={[
        styles.row,
        styles.file,
        selected ? styles.selected : "",
        changed ? styles.changed : "",
        review ? styles.hasReviewWork : "",
        unread ? styles.hasUnreadWork : "",
        open ? styles.openInTab : "",
        removed ? styles.removed : "",
        currentStop ? styles.currentReviewStop : "",
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={() => onSelect(node.path)}
      onDoubleClick={() => onOpen(node.path)}
      onFocus={() => onFocusPath(node.path)}
      style={indent}
    >
      <span className={styles.twisty} />
      <span className={`${fileIconStyles.icon} file-icon`}>
        {iconForPath(node.path, node.viewerKind)}
      </span>
      <span className={styles.main}>
        <span className={styles.labelLine}>
          <span className={styles.label}>{node.name}</span>
        </span>
        {reviewReason ? (
          <span className={styles.reason} aria-hidden="true">
            {reviewReason}
          </span>
        ) : null}
      </span>
      {showBadges ? (
        <TreeBadges
          changed={changed}
          currentStop={currentStop}
          open={open}
          reviewFiles={0}
          showChangedBadge={!fileEnd}
          unreadFiles={unread ? 1 : 0}
        />
      ) : null}
      {fileEnd}
    </button>
  );
}

function directoryTreeRowAriaLabel({
  name,
  expanded,
  containsSelection,
  containsCurrentStop,
  summary,
  loading,
}: {
  name: string;
  expanded: boolean;
  containsSelection: boolean;
  containsCurrentStop: boolean;
  summary: ReturnType<typeof directoryReviewSummary>;
  loading: boolean;
}): string {
  return [
    name,
    "folder",
    expanded ? "expanded" : "collapsed",
    containsSelection ? "contains selected file" : "",
    containsCurrentStop
      ? `contains current review stop${summary.reviewStopPath ? ` ${baseName(summary.reviewStopPath)}` : ""}`
      : "",
    !containsCurrentStop && summary.reviewStopPath
      ? `next review stop ${baseName(summary.reviewStopPath)}`
      : "",
    countPhrase(summary.openFiles, "open file"),
    countPhrase(summary.reviewFiles, "review file"),
    countPhrase(summary.unreadFiles, "unseen feedback file"),
    countPhrase(summary.comments, "comment"),
    loading ? "loading" : "",
  ]
    .filter(Boolean)
    .join(", ");
}

function fileTreeRowAriaLabel({
  name,
  selected,
  changed,
  review,
  unread,
  open,
  removed,
  currentStop,
  comments,
}: {
  name: string;
  selected: boolean;
  changed: boolean;
  review: boolean;
  unread: boolean;
  open: boolean;
  removed: boolean;
  currentStop: boolean;
  comments: number;
}): string {
  return [
    name,
    "file",
    selected ? "selected" : "",
    changed ? "changed" : "",
    review ? "review file" : "",
    unread ? "unseen feedback" : "",
    open ? "open in tab" : "",
    removed ? "removed" : "",
    currentStop ? "current review stop" : "",
    countPhrase(comments, "comment"),
  ]
    .filter(Boolean)
    .join(", ");
}

function directoryTreeReviewReason(
  summary: ReturnType<typeof directoryReviewSummary>,
  {
    containsCurrentStop,
    loading,
  }: { containsCurrentStop: boolean; loading: boolean },
): string {
  return [
    directoryReviewStopReason(summary, { containsCurrentStop }),
    ...treeReasonParts({
      comments: summary.comments,
      loading,
      openFiles: summary.openFiles,
      reviewFiles: summary.reviewFiles,
      unreadFiles: summary.unreadFiles,
    }),
  ]
    .filter(Boolean)
    .join(" · ");
}

function directoryReviewStopReason(
  summary: ReturnType<typeof directoryReviewSummary>,
  { containsCurrentStop }: { containsCurrentStop: boolean },
): string {
  if (!summary.reviewStopPath) return "";
  const name = baseName(summary.reviewStopPath);
  if (containsCurrentStop || summary.reviewStopKind === "current") {
    return `current ${name}`;
  }
  return `next ${name}`;
}

function fileTreeReviewReason({
  changed,
  comments,
  currentStop,
  open,
  removed,
  review,
  unread,
}: {
  changed: boolean;
  comments: number;
  currentStop: boolean;
  open: boolean;
  removed: boolean;
  review: boolean;
  unread: boolean;
}): string {
  return [
    unread ? "attention" : "",
    currentStop ? "current stop" : "",
    review ? "review" : "",
    comments ? countReason(comments, "comment") : "",
    changed ? "changed" : "",
    open ? "open tab" : "",
    removed ? "removed" : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

function treeReasonParts({
  changed = false,
  comments = 0,
  loading = false,
  openFiles = 0,
  removed = false,
  reviewFiles = 0,
  unreadFiles = 0,
}: {
  changed?: boolean;
  comments?: number;
  loading?: boolean;
  openFiles?: number;
  removed?: boolean;
  reviewFiles?: number;
  unreadFiles?: number;
}): string[] {
  return [
    unreadFiles ? countReason(unreadFiles, "attention") : "",
    reviewFiles ? countReason(reviewFiles, "review file") : "",
    comments ? countReason(comments, "comment") : "",
    changed ? "changed" : "",
    openFiles ? countReason(openFiles, "open tab") : "",
    removed ? "removed" : "",
    loading ? "loading" : "",
  ].filter(Boolean);
}

function countReason(count: number, label: string): string {
  if (label === "attention") {
    return count === 1 ? "attention" : `${count} attention`;
  }
  return `${count} ${label}${count === 1 ? "" : "s"}`;
}

function countPhrase(count: number, label: string): string {
  if (!count) return "";
  if (label === "root entry") {
    return count === 1 ? "1 root entry" : `${count} root entries`;
  }
  return `${count} ${label}${count === 1 ? "" : "s"}`;
}

function baseName(path: string): string {
  return path.split("/").filter(Boolean).at(-1) ?? path;
}

function workspaceTreeAriaLabel(
  summary: ReturnType<typeof workspaceTreeSummary>,
): string {
  return [
    "Live workspace map",
    countPhrase(summary.rootEntries, "root entry"),
    countPhrase(summary.files, "loaded file"),
    countPhrase(summary.reviewFiles, "review file"),
    countPhrase(summary.unreadFiles, "unseen feedback file"),
    countPhrase(summary.openFiles, "open file"),
    countPhrase(summary.comments, "comment"),
  ]
    .filter(Boolean)
    .join(", ");
}

function TreeBadges({
  changed = false,
  currentStop = false,
  loading = false,
  open = false,
  openFiles = 0,
  reviewFiles = 0,
  showChangedBadge = true,
  unreadFiles = 0,
}: {
  changed?: boolean;
  currentStop?: boolean;
  loading?: boolean;
  open?: boolean;
  openFiles?: number;
  reviewFiles?: number;
  showChangedBadge?: boolean;
  unreadFiles?: number;
}) {
  if (
    !changed &&
    !currentStop &&
    !loading &&
    !open &&
    !reviewFiles &&
    !unreadFiles
  )
    return null;
  return (
    <span className={styles.badges}>
      {unreadFiles ? (
        <>
          <span className={styles.unreadDot} aria-hidden="true" />
          <span
            className={`${styles.badge} ${styles.attention}`}
            title={countPhrase(unreadFiles, "attention item")}
          >
            {unreadFiles > 1 ? unreadFiles : "!"}
          </span>
        </>
      ) : null}
      {currentStop ? (
        <span
          className={`${styles.badge} ${styles.current}`}
          title="Current review stop"
        >
          now
        </span>
      ) : null}
      {open ? (
        <span
          className={`${styles.badge} ${styles.open}`}
          title={countPhrase(openFiles || 1, "open tab")}
        >
          open{openFiles > 1 ? ` ${openFiles}` : ""}
        </span>
      ) : null}
      {reviewFiles ? (
        <span
          className={`${styles.badge} ${styles.review}`}
          title={countPhrase(reviewFiles, "review file")}
        >
          rev{reviewFiles > 1 ? ` ${reviewFiles}` : ""}
        </span>
      ) : null}
      {changed && showChangedBadge ? (
        <span
          className={`${styles.badge} ${styles.changedBadge}`}
          title="Changed"
        >
          mod
        </span>
      ) : null}
      {loading ? (
        <span className={`${styles.badge} ${styles.loading}`} title="Loading">
          ...
        </span>
      ) : null}
    </span>
  );
}

interface TreeReviewSummary {
  comments: number;
  openFiles: number;
  reviewFiles: number;
  reviewStopKind: ReviewStopKind | null;
  reviewStopPath: string | null;
  unreadFiles: number;
}

function directoryReviewSummary(
  node: FsNode,
  reviewPaths: Set<string>,
  unreadReviewPaths: Set<string>,
  activePaths: Set<string>,
  commentCountsByPath: Record<string, number>,
  currentStopPath: string | null,
): TreeReviewSummary {
  if (node.kind !== "directory") {
    return {
      comments: commentCountsByPath[node.path] ?? 0,
      openFiles: activePaths.has(node.path) ? 1 : 0,
      reviewFiles: reviewPaths.has(node.path) ? 1 : 0,
      reviewStopKind: fileReviewStopKind({
        currentStop: node.path === currentStopPath,
        review: reviewPaths.has(node.path),
        unread: unreadReviewPaths.has(node.path),
      }),
      reviewStopPath:
        node.path === currentStopPath ||
        unreadReviewPaths.has(node.path) ||
        reviewPaths.has(node.path)
          ? node.path
          : null,
      unreadFiles: unreadReviewPaths.has(node.path) ? 1 : 0,
    };
  }

  return (node.children ?? []).reduce<TreeReviewSummary>(
    (summary, child) => {
      const childSummary = directoryReviewSummary(
        child,
        reviewPaths,
        unreadReviewPaths,
        activePaths,
        commentCountsByPath,
        currentStopPath,
      );
      return {
        comments: summary.comments + childSummary.comments,
        openFiles: summary.openFiles + childSummary.openFiles,
        reviewFiles: summary.reviewFiles + childSummary.reviewFiles,
        reviewStopKind: preferredReviewStop(summary, childSummary).kind,
        reviewStopPath: preferredReviewStop(summary, childSummary).path,
        unreadFiles: summary.unreadFiles + childSummary.unreadFiles,
      };
    },
    {
      comments: 0,
      openFiles: 0,
      reviewFiles: 0,
      reviewStopKind: null,
      reviewStopPath: null,
      unreadFiles: 0,
    },
  );
}

type ReviewStopKind = "current" | "attention" | "review";

function fileReviewStopKind({
  currentStop,
  review,
  unread,
}: {
  currentStop: boolean;
  review: boolean;
  unread: boolean;
}): ReviewStopKind | null {
  if (currentStop) return "current";
  if (unread) return "attention";
  if (review) return "review";
  return null;
}

function preferredReviewStop(
  left: {
    reviewStopKind: ReviewStopKind | null;
    reviewStopPath: string | null;
  },
  right: {
    reviewStopKind: ReviewStopKind | null;
    reviewStopPath: string | null;
  },
): { kind: ReviewStopKind | null; path: string | null } {
  if (
    reviewStopPriority(right.reviewStopKind) >
    reviewStopPriority(left.reviewStopKind)
  ) {
    return { kind: right.reviewStopKind, path: right.reviewStopPath };
  }
  return { kind: left.reviewStopKind, path: left.reviewStopPath };
}

function reviewStopPriority(kind: ReviewStopKind | null): number {
  if (kind === "current") return 4;
  if (kind === "attention") return 3;
  if (kind === "review") return 1;
  return 0;
}

function workspaceTreeSummary(
  nodes: FsNode[],
  context: {
    activePaths: Set<string>;
    commentCountsByPath: Record<string, number>;
    currentStopPath: string | null;
    reviewPaths: Set<string>;
    unreadReviewPaths: Set<string>;
  },
): TreeReviewSummary & { files: number; rootEntries: number } {
  return nodes.reduce<
    TreeReviewSummary & { files: number; rootEntries: number }
  >(
    (summary, node) => {
      const childSummary = workspaceNodeSummary(node, context);
      return {
        comments: summary.comments + childSummary.comments,
        files: summary.files + childSummary.files,
        openFiles: summary.openFiles + childSummary.openFiles,
        reviewFiles: summary.reviewFiles + childSummary.reviewFiles,
        reviewStopKind: preferredReviewStop(summary, childSummary).kind,
        reviewStopPath: preferredReviewStop(summary, childSummary).path,
        rootEntries: summary.rootEntries,
        unreadFiles: summary.unreadFiles + childSummary.unreadFiles,
      };
    },
    {
      comments: 0,
      files: 0,
      openFiles: 0,
      reviewFiles: 0,
      reviewStopKind: null,
      reviewStopPath: null,
      rootEntries: nodes.length,
      unreadFiles: 0,
    },
  );
}

function workspaceNodeSummary(
  node: FsNode,
  context: {
    activePaths: Set<string>;
    commentCountsByPath: Record<string, number>;
    currentStopPath: string | null;
    reviewPaths: Set<string>;
    unreadReviewPaths: Set<string>;
  },
): ReturnType<typeof directoryReviewSummary> & { files: number } {
  const summary = directoryReviewSummary(
    node,
    context.reviewPaths,
    context.unreadReviewPaths,
    context.activePaths,
    context.commentCountsByPath,
    context.currentStopPath,
  );
  if (node.kind !== "directory") {
    return { ...summary, files: 1 };
  }
  return {
    ...summary,
    files: (node.children ?? []).reduce(
      (count, child) => count + workspaceNodeSummary(child, context).files,
      0,
    ),
  };
}

function ancestorDirectoryPaths(path: string | null): Set<string> {
  if (!path) return new Set();
  const parts = path.split("/").filter(Boolean);
  const ancestors = new Set<string>();
  for (let index = 1; index < parts.length; index += 1) {
    ancestors.add(parts.slice(0, index).join("/"));
  }
  return ancestors;
}

function togglePath(paths: Set<string>, path: string): Set<string> {
  const next = new Set(paths);
  if (next.has(path)) next.delete(path);
  else next.add(path);
  return next;
}
