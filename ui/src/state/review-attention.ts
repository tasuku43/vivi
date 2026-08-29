export type ReviewAttentionClock = Record<string, number>;

export const reviewActivityWindowMs = 30 * 60 * 1000;
export const emptyReviewAttentionClock: ReviewAttentionClock = {};
const maxTimerDelayMs = 2_147_483_647;

export function touchReviewAttention(
  clock: ReviewAttentionClock,
  path: string,
  observedAt = Date.now(),
  receivedAt = Date.now(),
): ReviewAttentionClock {
  if (!path || !Number.isFinite(observedAt) || !Number.isFinite(receivedAt))
    return clock;
  const safeObservedAt = Math.min(observedAt, receivedAt);
  const current = clock[path];
  if (
    current !== undefined &&
    current <= receivedAt &&
    current >= safeObservedAt
  )
    return clock;
  return { ...clock, [path]: safeObservedAt };
}

export function recentReviewAttentionPaths(
  clock: ReviewAttentionClock,
  now = Date.now(),
  windowMs = reviewActivityWindowMs,
): Set<string> {
  return new Set(
    Object.entries(clock)
      .filter(
        ([, observedAt]) => observedAt <= now && now - observedAt <= windowMs,
      )
      .map(([path]) => path),
  );
}

export function nextReviewAttentionExpiryDelay(
  clock: ReviewAttentionClock,
  now = Date.now(),
  windowMs = reviewActivityWindowMs,
): number | null {
  const nextExpiry = Object.values(clock).reduce<number | null>(
    (earliest, observedAt) => {
      if (!Number.isFinite(observedAt) || observedAt > now) return earliest;
      const expiresAt = observedAt + windowMs + 1;
      if (expiresAt <= now) return earliest;
      return earliest === null ? expiresAt : Math.min(earliest, expiresAt);
    },
    null,
  );
  return nextExpiry === null
    ? null
    : Math.min(maxTimerDelayMs, Math.max(1, nextExpiry - now));
}

export function compactReviewAttention(
  clock: ReviewAttentionClock,
  now = Date.now(),
  windowMs = reviewActivityWindowMs,
): ReviewAttentionClock {
  return Object.fromEntries(
    Object.entries(clock).filter(
      ([path, observedAt]) =>
        path.length > 0 &&
        Number.isFinite(observedAt) &&
        observedAt <= now &&
        now - observedAt <= windowMs,
    ),
  );
}
