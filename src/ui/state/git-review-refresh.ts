import type { GitChangeReviewState } from "./git-review.js";

export const gitReviewPollMs = 3_000;
export const gitTimeoutReason =
  "Git command timed out while reading this workspace.";
export const gitPartialTimeoutReason =
  "Git untracked scan timed out; showing tracked changes only.";

export interface GitReviewPollTimer {
  setInterval(handler: () => void, timeout: number): number;
  clearInterval(id: number): void;
}

export interface GitReviewPollVisibility {
  visibilityState?: DocumentVisibilityState;
}

export function shouldPollGitReview(
  gitReview: GitChangeReviewState | null,
): boolean {
  return (
    gitReview?.available !== false &&
    gitReview?.reason !== gitTimeoutReason &&
    gitReview?.reason !== gitPartialTimeoutReason
  );
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
