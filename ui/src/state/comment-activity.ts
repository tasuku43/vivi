import type {
  CommentActor,
  CommentThreadActivityEvent,
  CommentThreadActivityType,
  ViviComment,
} from "../domain/comments.js";
import { buildCommentThreads } from "../domain/comments.js";

export interface CommentActivityState {
  byThreadId: Record<string, CommentThreadActivityEvent[]>;
  latestObservedByActor: Record<string, string>;
  seenEventIds: string[];
}

export interface CommentActivitySummary {
  inline: string[];
  timeline: CommentThreadActivityEvent[];
}

export interface CommentActivityRefreshTarget {
  shouldRefresh: boolean;
  path: string | null;
  shouldMarkUnread: boolean;
}

export const emptyCommentActivityState: CommentActivityState = {
  byThreadId: {},
  latestObservedByActor: {},
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
  const threadEvents = [...(state.byThreadId[event.threadId] ?? []), event]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, maxEventsPerThread);
  const latestObservedByActor = { ...state.latestObservedByActor };
  latestObservedByActor[actorKey(event.actor)] = maxIso(
    latestObservedByActor[actorKey(event.actor)],
    event.createdAt,
  );
  return {
    byThreadId: { ...state.byThreadId, [event.threadId]: threadEvents },
    latestObservedByActor,
    seenEventIds: [event.id, ...state.seenEventIds].slice(0, maxSeenEventIds),
  };
}

export function summarizeThreadActivity(
  events: CommentThreadActivityEvent[] | undefined,
  now = Date.now(),
): CommentActivitySummary {
  const timeline = [...(events ?? [])].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
  return {
    inline: timeline.slice(0, 2).map((event) => activityLabel(event, now)),
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
    shouldMarkUnread: commentActivityShouldMarkUnread(event),
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

export function commentActivityShouldMarkUnread(
  event: CommentThreadActivityEvent,
): boolean {
  if (event.actor.kind === "human") return false;
  return event.type !== "thread_read";
}

export function actorLabel(actor: CommentActor): string {
  if (actor.displayName?.trim()) return actor.displayName.trim();
  if (actor.kind === "claude-code") return "Claude Code";
  if (actor.kind === "codex") return "Codex";
  if (actor.kind === "human") return "Human";
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

function actorKey(actor: CommentActor): string {
  return actor.id.trim() || `${actor.kind}:unknown`;
}

function maxIso(a: string | undefined, b: string): string {
  if (!a) return b;
  return a.localeCompare(b) >= 0 ? a : b;
}
