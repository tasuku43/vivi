export const gitReviewPollMs = 3_000;

export interface GitReviewPollTimer {
  setInterval(handler: () => void, timeout: number): number;
  clearInterval(id: number): void;
}

export interface GitReviewPollVisibility {
  visibilityState?: DocumentVisibilityState;
}

export function startGitReviewPolling(options: {
  timer: GitReviewPollTimer;
  scheduleRefresh: () => void;
  visibility?: GitReviewPollVisibility;
  intervalMs?: number;
}): () => void {
  const interval = options.intervalMs ?? gitReviewPollMs;
  const id = options.timer.setInterval(() => {
    if (options.visibility?.visibilityState === "hidden") return;
    options.scheduleRefresh();
  }, interval);

  return () => options.timer.clearInterval(id);
}
