import type {
  CommentActor,
  CommentThread,
  CommentThreadActivityEvent,
  CommentThreadActivityType,
  ViviComment,
} from "../domain/comments.js";
import { buildCommentThreads } from "../domain/comments.js";

export interface CommentActivityState {
  byThreadId: Record<string, CommentThreadActivityEvent[]>;
  seenEventIds: string[];
}

export interface CommentActivitySummary {
  inline: string[];
  timeline: CommentThreadActivityEvent[];
}

export interface CommentActivityRefreshTarget {
  shouldRefresh: boolean;
  path: string | null;
}

export type CommentThreadReviewReceiptState = "not-read" | "agent-read";

export interface CommentThreadReviewReceipt {
  state: CommentThreadReviewReceiptState;
  label: string;
  meta: string;
  ariaLabel: string;
}

export const emptyCommentActivityState: CommentActivityState = {
  byThreadId: {},
  seenEventIds: [],
};

const maxEventsPerThread = 24;
const maxSeenEventIds = 600;

export function addCommentActivities(
  state: CommentActivityState,
  events: CommentThreadActivityEvent[],
): CommentActivityState {
  let next = state;
  for (const event of events) next = addCommentActivity(next, event);
  return next;
}

export function addCommentActivity(
  state: CommentActivityState,
  event: CommentThreadActivityEvent,
): CommentActivityState {
  if (state.seenEventIds.includes(event.id)) return state;
  const threadEvents = retainThreadActivities([
    ...(state.byThreadId[event.threadId] ?? []),
    event,
  ]);
  return {
    byThreadId: { ...state.byThreadId, [event.threadId]: threadEvents },
    seenEventIds: [event.id, ...state.seenEventIds].slice(0, maxSeenEventIds),
  };
}

export function summarizeThreadActivity(
  events: CommentThreadActivityEvent[] | undefined,
  now = Date.now(),
): CommentActivitySummary {
  const timeline = [...(events ?? [])]
    .filter(isAgentThreadRead)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return {
    inline: timeline.slice(0, 1).map((event) => activityLabel(event, now)),
    timeline,
  };
}

export function activityLabel(
  event: CommentThreadActivityEvent,
  now = Date.now(),
): string {
  return `${actorLabel(event.actor)} ${activityVerb(event)} ${relativeTime(event.createdAt, now)}`;
}

export function commentActivityRefreshTarget(
  event: CommentThreadActivityEvent,
  comments: ViviComment[],
): CommentActivityRefreshTarget {
  const path = commentActivityThreadPath(event, comments);
  return {
    shouldRefresh: commentActivityNeedsAuthoritativeRefresh(event),
    path,
  };
}

export function commentActivityThreadPath(
  event: CommentThreadActivityEvent,
  comments: ViviComment[],
): string | null {
  const thread = buildCommentThreads(comments).find(
    (candidate) => candidate.id === event.threadId,
  );
  return thread?.path ?? null;
}

export function commentActivityNeedsAuthoritativeRefresh(
  event: CommentThreadActivityEvent,
): boolean {
  return event.type !== "thread_read";
}

export function commentThreadReviewReceipt(
  thread: CommentThread,
  events: CommentThreadActivityEvent[] | undefined,
): CommentThreadReviewReceipt {
  const timeline = [...(events ?? [])].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
  const latestAgentRead = latestEvent(timeline, (event) =>
    isAgentThreadRead(event),
  );
  if (
    latestAgentRead &&
    latestAgentRead.createdAt >= latestHumanFeedbackAt(thread)
  ) {
    return {
      state: "agent-read",
      label: "Seen",
      meta: `Seen by ${actorLabel(latestAgentRead.actor)}`,
      ariaLabel: "read by agent",
    };
  }

  return {
    state: "not-read",
    label: "Unseen",
    meta: "Not yet seen by an agent",
    ariaLabel: "not read by agent",
  };
}

export function unseenFeedbackPathSet(
  comments: readonly ViviComment[],
  activitiesByThreadId: Readonly<
    Record<string, readonly CommentThreadActivityEvent[]>
  >,
): Set<string> {
  return new Set(
    buildCommentThreads([...comments])
      .filter((thread) => thread.comments.some(isHumanFeedback))
      .filter(
        (thread) =>
          commentThreadReviewReceipt(
            thread,
            activitiesByThreadId[thread.id]
              ? [...activitiesByThreadId[thread.id]!]
              : undefined,
          ).state === "not-read",
      )
      .map((thread) => thread.path),
  );
}

export function agentReadReviewObservation(
  event: CommentThreadActivityEvent,
  comments: readonly ViviComment[],
): { path: string; observedAt: number } | null {
  if (!isAgentThreadRead(event)) return null;
  const path = commentActivityThreadPath(event, [...comments]);
  const observedAt = Date.parse(event.createdAt);
  if (!path || !Number.isFinite(observedAt)) return null;
  return { path, observedAt };
}

export function actorLabel(actor: CommentActor): string {
  if (actor.displayName?.trim()) return actor.displayName.trim();
  if (actor.kind === "claude-code") return "Claude Code";
  if (actor.kind === "codex") return "Codex";
  if (
    actor.kind === "human" &&
    actor.id.trim() &&
    actor.id.trim() !== "human"
  ) {
    return actor.id.trim();
  }
  if (actor.kind === "human") return "Human";
  if (actor.id.trim() && actor.id.trim() !== "unknown") return actor.id.trim();
  return "Unknown agent";
}

function activityVerb(event: {
  type: CommentThreadActivityType;
  previousStatus?: string;
  status?: string;
}): string {
  if (event.type === "thread_read") return "read";
  if (event.type === "thread_claimed") return "claimed";
  if (event.type === "thread_claim_released") return "released";
  if (event.type === "comment_added") return "replied";
  if (event.type === "thread_status_changed") {
    return event.status ? `marked ${event.status}` : "changed status";
  }
  if (event.type === "thread_created") return "started";
  return "updated";
}

export function relativeTime(value: string, now = Date.now()): string {
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return value;
  const seconds = Math.max(0, Math.floor((now - then) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function latestEvent(
  timeline: CommentThreadActivityEvent[],
  predicate: (event: CommentThreadActivityEvent) => boolean,
): CommentThreadActivityEvent | undefined {
  return timeline.find(predicate);
}

function retainThreadActivities(
  events: CommentThreadActivityEvent[],
): CommentThreadActivityEvent[] {
  const sorted = [...events].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
  const recent = sorted.slice(0, maxEventsPerThread);
  const latestAgentRead = sorted.find(isAgentThreadRead);
  if (
    !latestAgentRead ||
    recent.some((event) => event.id === latestAgentRead.id)
  ) {
    return recent;
  }
  return [...recent.slice(0, maxEventsPerThread - 1), latestAgentRead].sort(
    (a, b) => b.createdAt.localeCompare(a.createdAt),
  );
}

function isAgentThreadRead(event: CommentThreadActivityEvent): boolean {
  return event.type === "thread_read" && event.actor.kind !== "human";
}

function latestHumanFeedbackAt(thread: CommentThread): string {
  return thread.comments
    .filter(isHumanFeedback)
    .reduce(
      (latest, comment) =>
        comment.updatedAt > latest ? comment.updatedAt : latest,
      thread.createdAt,
    );
}

export function isHumanFeedback(comment: ViviComment): boolean {
  if (comment.createdBy) return comment.createdBy.kind === "human";
  if (comment.source) return comment.source === "human";
  return true;
}
