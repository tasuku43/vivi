import type { TreeSnapshot } from "../domain/fs-node.js";
import type { WorkspaceConnectionStatus } from "../application/ports/ViviClient.js";

export interface WorkspaceStatusMetrics {
  fsEventsReceived: number;
  gitRefreshes: number;
  diffRefreshes: number;
  lastGitRefreshMs: number | null;
  lastDiffRefreshMs: number | null;
  pendingGitRefresh: boolean;
  pendingDiffPaths: number;
}

export interface ActiveFileStatusInput {
  path: string;
  changed?: boolean;
  diffEnabled?: boolean;
  isPreview?: boolean;
  removed?: boolean;
  sourceMissing?: boolean;
  viewerMode?: string;
}

export interface WorkspaceStatusInput {
  tree: TreeSnapshot | null;
  openTabCount: number;
  reviewFileCount: number;
  reviewLoading?: boolean;
  openThreadCount: number;
  draftCount: number;
  connectionStatus: WorkspaceConnectionStatus;
  activeFile?: ActiveFileStatusInput | null;
  metrics: WorkspaceStatusMetrics;
}

export interface WorkspaceStatusSummary {
  workspace: string;
  activeFile: string;
  review: string;
  server: string;
  serverTone: "live" | "pending" | "offline";
  detail: string;
}

export function summarizeWorkspaceStatus({
  tree,
  openTabCount,
  reviewFileCount,
  reviewLoading = false,
  openThreadCount,
  draftCount,
  connectionStatus,
  activeFile,
  metrics,
}: WorkspaceStatusInput): WorkspaceStatusSummary {
  const watchedFiles = tree?.stats?.scannedFiles;
  const rootEntries = tree?.nodes.length ?? 0;
  const workspace = [
    watchedFiles === undefined
      ? `${rootEntries} root ${rootEntries === 1 ? "entry" : "entries"}`
      : `Watching ${watchedFiles} ${watchedFiles === 1 ? "file" : "files"}`,
    `${openTabCount} ${openTabCount === 1 ? "tab" : "tabs"} open`,
  ].join(" · ");
  const reviewFileLabel =
    (reviewLoading || metrics.pendingGitRefresh) && reviewFileCount === 0
      ? "Loading review files"
      : `${reviewFileCount} ${reviewFileCount === 1 ? "file" : "files"} to review`;
  const review = [
    reviewFileLabel,
    `${openThreadCount} ${openThreadCount === 1 ? "thread" : "threads"} open`,
    draftCount ? `${draftCount} draft${draftCount === 1 ? "" : "s"}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const activeFileLabel = activeFileStatusLabel(activeFile ?? null);
  const pending = [
    metrics.pendingGitRefresh ? "review" : null,
    metrics.pendingDiffPaths
      ? `${metrics.pendingDiffPaths} diff${metrics.pendingDiffPaths === 1 ? "" : "s"}`
      : null,
  ]
    .filter(Boolean)
    .join(" + ");
  const serverTone =
    connectionStatus === "disconnected"
      ? "offline"
      : connectionStatus === "connecting" || pending
        ? "pending"
        : "live";
  const server =
    connectionStatus === "disconnected"
      ? "Disconnected · live updates paused"
      : connectionStatus === "connecting"
        ? "Connecting · waiting for events"
        : pending
          ? `Updating ${pending}`
          : metrics.fsEventsReceived
            ? `Live · ${metrics.fsEventsReceived} file ${metrics.fsEventsReceived === 1 ? "event" : "events"} received`
            : "Live · waiting for file changes";
  const detail = [
    `${metrics.gitRefreshes} review refresh${metrics.gitRefreshes === 1 ? "" : "es"}`,
    metrics.lastGitRefreshMs !== null ? `last review ${metrics.lastGitRefreshMs}ms` : null,
    metrics.diffRefreshes
      ? `${metrics.diffRefreshes} diff refresh${metrics.diffRefreshes === 1 ? "" : "es"}`
      : null,
    metrics.lastDiffRefreshMs !== null ? `last diff ${metrics.lastDiffRefreshMs}ms` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return {
    workspace,
    activeFile: activeFileLabel,
    review,
    server,
    serverTone,
    detail,
  };
}

function activeFileStatusLabel(activeFile: ActiveFileStatusInput | null): string {
  if (!activeFile) return "No active file";
  if (activeFile.sourceMissing) {
    return [basenameForPath(activeFile.path), "source missing"]
      .filter(Boolean)
      .join(" · ");
  }
  return [
    basenameForPath(activeFile.path),
    activeFile.isPreview ? "preview" : "kept",
    activeFile.viewerMode,
    activeFile.diffEnabled ? "HEAD diff" : null,
    activeFile.changed ? "changed" : null,
    activeFile.removed ? "removed" : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function basenameForPath(path: string): string {
  return path.split("/").filter(Boolean).at(-1) ?? path;
}
