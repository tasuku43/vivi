import { expect, it } from "vitest";
import type { CommentThreadActivityEvent } from "../ui/src/domain/comments.js";
import {
  addCommentActivities,
  commentActivityRefreshTarget,
  commentActivityThreadPath,
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
        type: "thread_claim_released",
        actor: { id: "codex:run-1", kind: "codex", displayName: "Codex" },
        createdAt: "2026-06-20T00:00:55.000Z",
      }),
      event({
        id: "activity-2",
        type: "thread_claimed",
        actor: { id: "codex:run-1", kind: "codex", displayName: "Codex" },
        leaseExpiresAt: "2026-06-20T00:10:48.000Z",
        createdAt: "2026-06-20T00:00:50.000Z",
      }),
      event({
        id: "activity-3",
        type: "thread_read",
        actor: {
          id: "claude-code:run-1",
          kind: "claude-code",
          displayName: "Claude Code",
        },
        createdAt: "2026-06-20T00:00:48.000Z",
      }),
      event({
        id: "activity-4",
        type: "comment_added",
        actor: { id: "codex:run-1", kind: "codex", displayName: "Codex" },
        createdAt: "2026-06-20T00:00:00.000Z",
      }),
      event({
        id: "activity-5",
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
    "Codex released 5s ago",
    "Codex claimed 10s ago",
  ]);
  expect(summary.timeline.map((item) => item.id)).toEqual([
    "activity-1",
    "activity-2",
    "activity-3",
    "activity-4",
    "activity-5",
  ]);
});

it("targets authoritative comment refreshes without inferring thread status from activity", () => {
  const comments = [
    comment({
      id: "root-1",
      threadId: "thread-1",
      path: "docs/a.md",
      status: "open",
    }),
  ];

  expect(
    commentActivityRefreshTarget(
      event({
        id: "read-1",
        type: "thread_read",
        actor: { id: "codex:1", kind: "codex", displayName: "Codex" },
      }),
      comments,
    ),
  ).toEqual({
    shouldRefresh: false,
    path: "docs/a.md",
    shouldMarkUnread: false,
  });

  expect(
    commentActivityRefreshTarget(
      event({
        id: "reply-1",
        type: "comment_added",
        actor: { id: "codex:1", kind: "codex", displayName: "Codex" },
      }),
      comments,
    ),
  ).toEqual({
    shouldRefresh: true,
    path: "docs/a.md",
    shouldMarkUnread: true,
  });

  expect(
    commentActivityRefreshTarget(
      event({
        id: "human-status-1",
        type: "thread_status_changed",
        status: "resolved",
        previousStatus: "open",
        actor: { id: "human:tasuku", kind: "human", displayName: "Tasuku" },
      }),
      comments,
    ),
  ).toEqual({
    shouldRefresh: true,
    path: "docs/a.md",
    shouldMarkUnread: false,
  });
});

it("falls back to a global refresh for unseen activity threads", () => {
  const reply = event({
    id: "reply-unknown",
    threadId: "thread-new",
    type: "comment_added",
    actor: { id: "claude:1", kind: "claude-code", displayName: "Claude Code" },
  });

  expect(commentActivityRefreshTarget(reply, [])).toEqual({
    shouldRefresh: true,
    path: null,
    shouldMarkUnread: true,
  });
  expect(
    commentActivityThreadPath(reply, [
      comment({
        id: "agent-reply",
        threadId: "thread-new",
        path: "src/new.ts",
        status: "open",
      }),
    ]),
  ).toBe("src/new.ts");
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

function comment(input: {
  id: string;
  threadId: string;
  path: string;
  status: "open" | "resolved" | "archived";
}) {
  return {
    id: input.id,
    threadId: input.threadId,
    path: input.path,
    viewerKind: "text" as const,
    anchor: { surface: "source" as const, canonical: { path: input.path } },
    body: "Review note",
    status: input.status,
    createdAt: "2026-06-20T00:00:00.000Z",
    updatedAt: "2026-06-20T00:00:00.000Z",
  };
}
