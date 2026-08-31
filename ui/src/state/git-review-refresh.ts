import {
  gitPartialTimeoutReason,
  type GitChangeReviewState,
} from "./git-review.js";

export { gitPartialTimeoutReason };

export const gitReviewPollMs = 3_000;
export const gitReviewTimeoutRetryMs = 30_000;
export const gitTimeoutReason =
  "Git command timed out while reading this workspace.";
export const gitReviewTimeoutGuidance =
  "Vivi will retry; for large workspaces, restart with --git-review-timeout 10s.";

export interface GitReviewPollTimer {
  setInterval(handler: () => void, timeout: number): number;
  clearInterval(id: number): void;
}

export interface GitReviewPollVisibility {
  visibilityState?: DocumentVisibilityState;
}

export function shouldPollGitReview(
  gitReview: GitChangeReviewState | null,
  options: {
    lastAttemptMs?: number;
    nowMs?: number;
    retryAfterMs?: number;
  } = {},
): boolean {
  if (gitReview?.reason === gitPartialTimeoutReason) return false;
  if (gitReview?.reason === gitTimeoutReason) {
    if (typeof options.lastAttemptMs !== "number") return false;
    const nowMs = options.nowMs ?? Date.now();
    const retryAfterMs = options.retryAfterMs ?? gitReviewTimeoutRetryMs;
    return nowMs - options.lastAttemptMs >= retryAfterMs;
  }
  return gitReview?.available !== false;
}

export function gitReviewUnavailableGuidance(
  reason: string | null | undefined,
): string | null {
  if (reason === gitTimeoutReason) return gitReviewTimeoutGuidance;
  return null;
}

export function shouldStartGitReviewPolling(
  gitReview: GitChangeReviewState | null,
): boolean {
  return gitReview !== null;
}

export function shouldLoadInitialGitReview(
  treeLoaded: boolean,
  alreadyRequested: boolean,
): boolean {
  return treeLoaded && !alreadyRequested;
}

export function startGitReviewPolling(options: {
  timer: GitReviewPollTimer;
  scheduleRefresh: () => void;
  shouldRefresh?: () => boolean;
  visibility?: GitReviewPollVisibility;
  intervalMs?: number;
}): () => void {
  const interval = options.intervalMs ?? gitReviewPollMs;
  const id = options.timer.setInterval(() => {
    if (options.visibility?.visibilityState === "hidden") return;
    if (options.shouldRefresh && !options.shouldRefresh()) return;
    options.scheduleRefresh();
  }, interval);

  return () => options.timer.clearInterval(id);
}
