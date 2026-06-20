import { expect, it } from "vitest";
import type { CommentThreadActivityEvent } from "../ui/src/domain/comments.js";
import {
  addCommentActivities,
  emptyCommentActivityState,
  summarizeThreadActivity,
} from "../ui/src/state/comment-activity.js";

const baseEvent = {
  threadId: "thread-1",
  actor: { id: "codex:run-1", kind: "codex", displayName: "Codex" },
  createdAt: "2026-06-20T00:00:00.000Z",
} satisfies Partial<CommentThreadActivityEvent>;

it("deduplicates activity events and tracks latest observed time by actor", () => {
  const read = event({
    id: "activity-1",
    type: "thread_read",
    actor: {
      id: "claude-code:run-1",
      kind: "claude-code",
      displayName: "Claude Code",
    },
    createdAt: "2026-06-20T00:00:01.000Z",
  });
  const reply = event({
    id: "activity-2",
    type: "comment_added",
    actor: { id: "codex:run-1", kind: "codex", displayName: "Codex" },
    createdAt: "2026-06-20T00:01:01.000Z",
  });

  const state = addCommentActivities(emptyCommentActivityState, [
    read,
    reply,
    read,
  ]);

  expect(state.byThreadId["thread-1"]).toHaveLength(2);
  expect(state.byThreadId["thread-1"]?.map((item) => item.id)).toEqual([
    "activity-2",
    "activity-1",
  ]);
  expect(state.latestObservedByActor["claude-code:run-1"]).toBe(
    "2026-06-20T00:00:01.000Z",
  );
  expect(state.latestObservedByActor["codex:run-1"]).toBe(
    "2026-06-20T00:01:01.000Z",
  );
});

it("summarizes the newest two activity events inline and keeps the rest in the timeline", () => {
  const summary = summarizeThreadActivity(
    [
      event({
        id: "activity-1",
        type: "thread_read",
        actor: {
          id: "claude-code:run-1",
          kind: "claude-code",
          displayName: "Claude Code",
        },
        createdAt: "2026-06-20T00:00:48.000Z",
      }),
      event({
        id: "activity-2",
        type: "comment_added",
        actor: { id: "codex:run-1", kind: "codex", displayName: "Codex" },
        createdAt: "2026-06-20T00:00:00.000Z",
      }),
      event({
        id: "activity-3",
        type: "thread_status_changed",
        actor: { id: "human:tasuku", kind: "human", displayName: "Tasuku" },
        status: "resolved",
        previousStatus: "open",
        createdAt: "2026-06-19T23:59:00.000Z",
      }),
    ],
    new Date("2026-06-20T00:01:00.000Z").getTime(),
  );

  expect(summary.inline).toEqual([
    "Claude Code read 12s ago",
    "Codex replied 1m ago",
  ]);
  expect(summary.timeline.map((item) => item.id)).toEqual([
    "activity-1",
    "activity-2",
    "activity-3",
  ]);
});

function event(
  input: Partial<CommentThreadActivityEvent> & {
    id: string;
    type: CommentThreadActivityEvent["type"];
  },
): CommentThreadActivityEvent {
  return {
    ...baseEvent,
    ...input,
    actor: input.actor ?? baseEvent.actor!,
    createdAt: input.createdAt ?? baseEvent.createdAt!,
  } as CommentThreadActivityEvent;
}
