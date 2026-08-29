import { expect, it } from "vitest";
import type { CommentThreadActivityEvent } from "../ui/src/domain/comments.js";
import {
  addCommentActivities,
  agentReadReviewObservation,
  activityLabel,
  commentActivityRefreshTarget,
  commentActivityThreadPath,
  emptyCommentActivityState,
  summarizeThreadActivity,
  unseenFeedbackPathSet,
} from "../ui/src/state/comment-activity.js";

const baseEvent = {
  threadId: "thread-1",
  actor: { id: "codex:run-1", kind: "codex", displayName: "Codex" },
  createdAt: "2026-06-20T00:00:00.000Z",
} satisfies Partial<CommentThreadActivityEvent>;

it("deduplicates activity events per thread", () => {
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
});

it("projects only the latest agent read into the browser activity summary", () => {
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

  expect(summary.inline).toEqual(["Claude Code read 12s ago"]);
  expect(summary.timeline.map((item) => item.id)).toEqual(["activity-3"]);
});

it("retains the latest agent read through legacy reply and status chatter", () => {
  const read = event({
    id: "activity-read",
    type: "thread_read",
    actor: { id: "codex:run-1", kind: "codex", displayName: "Codex" },
    createdAt: "2026-06-20T00:00:00.000Z",
  });
  const legacyChatter = Array.from({ length: 30 }, (_, index) =>
    event({
      id: `activity-chatter-${index}`,
      type: "thread_status_changed",
      actor: { id: "human:tasuku", kind: "human", displayName: "Tasuku" },
      status: index % 2 === 0 ? "resolved" : "open",
      previousStatus: index % 2 === 0 ? "open" : "resolved",
      createdAt: new Date(
        Date.parse("2026-06-20T00:01:00.000Z") + index * 1_000,
      ).toISOString(),
    }),
  );

  const state = addCommentActivities(emptyCommentActivityState, [
    read,
    ...legacyChatter,
  ]);

  expect(state.byThreadId["thread-1"]).toHaveLength(24);
  expect(
    summarizeThreadActivity(state.byThreadId["thread-1"]).timeline.map(
      (item) => item.id,
    ),
  ).toEqual(["activity-read"]);
});

it("uses an unknown actor id instead of hiding it behind a generic label", () => {
  expect(
    activityLabel(
      event({
        id: "activity-unknown-actor",
        type: "thread_status_changed",
        status: "resolved",
        previousStatus: "open",
        actor: { id: "coding-agent", kind: "unknown" },
        createdAt: "2026-06-20T00:00:30.000Z",
      }),
      new Date("2026-06-20T00:01:00.000Z").getTime(),
    ),
  ).toBe("coding-agent marked resolved 30s ago");
});

it("uses a custom human actor id when no display name is available", () => {
  expect(
    activityLabel(
      event({
        id: "activity-gui-reviewer",
        type: "comment_added",
        actor: { id: "gui-reviewer", kind: "human" },
        createdAt: "2026-06-20T00:00:30.000Z",
      }),
      new Date("2026-06-20T00:01:00.000Z").getTime(),
    ),
  ).toBe("gui-reviewer replied 30s ago");
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

it("pins published feedback until an agent read newer than the latest human note", () => {
  const root = {
    ...comment({
      id: "root-1",
      threadId: "thread-1",
      path: "docs/a.md",
      status: "open",
    }),
    createdBy: { id: "human:tasuku", kind: "human" as const },
  };
  const read = event({
    id: "read-1",
    type: "thread_read",
    actor: { id: "codex:1", kind: "codex", displayName: "Codex" },
    createdAt: "2026-06-20T00:01:00.000Z",
  });

  expect(unseenFeedbackPathSet([root], {})).toEqual(new Set(["docs/a.md"]));
  expect(unseenFeedbackPathSet([root], { "thread-1": [read] })).toEqual(
    new Set(),
  );
  expect(agentReadReviewObservation(read, [root])).toEqual({
    path: "docs/a.md",
    observedAt: Date.parse("2026-06-20T00:01:00.000Z"),
  });

  const laterHumanNote = {
    ...root,
    id: "follow-up-1",
    createdAt: "2026-06-20T00:02:00.000Z",
    updatedAt: "2026-06-20T00:02:00.000Z",
  };
  expect(
    unseenFeedbackPathSet([root, laterHumanNote], { "thread-1": [read] }),
  ).toEqual(new Set(["docs/a.md"]));
});

it("ignores legacy status and agent-only threads when pinning human feedback", () => {
  const terminal = {
    ...comment({
      id: "root-1",
      threadId: "thread-1",
      path: "docs/a.md",
      status: "resolved",
    }),
    createdBy: { id: "human:tasuku", kind: "human" as const },
  };
  const reply = event({
    id: "reply-1",
    type: "comment_added",
    actor: { id: "codex:1", kind: "codex", displayName: "Codex" },
    createdAt: "2026-06-20T00:01:00.000Z",
  });

  expect(unseenFeedbackPathSet([terminal], { "thread-1": [reply] })).toEqual(
    new Set(["docs/a.md"]),
  );
  const agentOnly = {
    ...terminal,
    id: "agent-only",
    threadId: "thread-agent-only",
    path: "docs/agent-only.md",
    status: "open" as const,
    source: "codex",
    createdBy: { id: "codex:1", kind: "codex" as const },
  };
  expect(unseenFeedbackPathSet([agentOnly], {})).toEqual(new Set());
  expect(agentReadReviewObservation(reply, [terminal])).toBeNull();
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
