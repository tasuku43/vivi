import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import type { CommentStatus, ViviComment } from "../../domain/comments.js";
import { draftReviewCommentAsViviComment } from "../../state/comments.js";
import { summarizeThreadActivity } from "../../state/comment-activity.js";
import { CodeCommentThread } from "./components/CodeCommentThread.js";
import {
  sampleComments,
  sampleDraftComments,
  sampleFiles,
  sampleThreadActivities,
} from "../../storybook/fixtures/review-lab.js";

const anchor = {
  surface: "source" as const,
  canonical: {
    path: sampleFiles.code.path,
    lineStart: 9,
    lineEnd: 12,
    quote: "function publishDraftReviewComments()",
    fileHash: sampleFiles.code.etag,
  },
};

function comments(status: CommentStatus): ViviComment[] {
  return [
    {
      ...sampleComments[0]!,
      status,
      resolvedAt:
        status === "resolved" ? "2026-06-20T09:20:00.000Z" : undefined,
      archivedAt:
        status === "archived" ? "2026-06-20T09:25:00.000Z" : undefined,
    },
    {
      ...sampleComments[1]!,
      status,
      resolvedAt:
        status === "resolved" ? "2026-06-20T09:20:00.000Z" : undefined,
      archivedAt:
        status === "archived" ? "2026-06-20T09:25:00.000Z" : undefined,
    },
  ];
}

const meta = {
  title: "Review/Inline Comment States",
  component: CodeCommentThread,
  parameters: { layout: "centered", a11y: { test: "error" } },
  args: {
    onClose: fn(),
    onCreateComment: fn(),
    onStatusChange: fn(),
  },
} satisfies Meta<typeof CodeCommentThread>;

export default meta;
type Story = StoryObj<typeof meta>;

function args(status: CommentStatus) {
  return {
    thread: {
      key: "thread-workbench-open",
      path: sampleFiles.code.path,
      lineStart: 9,
      lineEnd: 12,
      status,
      comments: comments(status),
    },
    draft: {
      threadId: "thread-workbench-open",
      path: sampleFiles.code.path,
      viewerKind: "text" as const,
      anchor,
    },
  };
}

export const Open: Story = {
  tags: ["interaction"],
  args: args("open"),
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("article", { name: "Comment thread for lines 9-12" }),
    ).toBeInTheDocument();
    await expect(canvas.getByText("New thread on Lines 9-12")).toBeVisible();
    await expect(
      canvas.getByLabelText("New line comment"),
    ).toHaveAccessibleDescription(/New thread on Lines 9-12.*to save/);
    await userEvent.type(
      canvas.getByLabelText("New line comment"),
      "Separate concern",
    );
    await userEvent.click(
      canvas.getByRole("button", { name: "Save private draft comment" }),
    );
    await expect(args.onCreateComment).toHaveBeenCalled();
    await expect(
      (args.onCreateComment as unknown as { mock: { calls: unknown[][] } }).mock
        .calls[0]?.[0],
    ).not.toMatchObject({ threadId: "thread-workbench-open" });

    await userEvent.click(canvas.getByRole("button", { name: "Reply" }));
    await expect(canvas.getByText("Reply to thread")).toBeVisible();
    await userEvent.type(canvas.getByLabelText("Reply to thread"), "Replying");
    await userEvent.click(canvas.getByRole("button", { name: "Add reply" }));
    await expect(
      (args.onCreateComment as unknown as { mock: { calls: unknown[][] } }).mock
        .calls[1]?.[0],
    ).toMatchObject({ threadId: "thread-workbench-open" });
    await userEvent.click(
      canvas.getByRole("button", { name: "Resolve thread" }),
    );
    await expect(args.onStatusChange).toHaveBeenCalledWith(
      "thread-workbench-open",
      "resolved",
    );
  },
};
export const Resolved: Story = { args: args("resolved") };

export const MultiActorConversation: Story = {
  name: "Human and coding agents conversation",
  tags: ["interaction"],
  args: {
    thread: {
      key: "thread-multi-actor-conversation",
      path: sampleFiles.code.path,
      lineStart: 9,
      lineEnd: 12,
      status: "open",
      comments: [
        {
          ...sampleComments[0]!,
          id: "multi-actor-human-start",
          threadId: "thread-multi-actor-conversation",
          source: "human",
          author: "Tasuku",
          body: "This review batch has several notes on the same source range.",
          createdAt: "2026-06-20T09:00:00.000Z",
          updatedAt: "2026-06-20T09:00:00.000Z",
          createdBy: {
            id: "human:tasuku",
            kind: "human",
            displayName: "Tasuku",
          },
        },
        {
          ...sampleComments[1]!,
          id: "multi-actor-human-follow-up",
          threadId: "thread-multi-actor-conversation",
          source: "human",
          author: "Tasuku",
          body: "Adding a second consecutive human note should not feel like a conversation reply.",
          createdAt: "2026-06-20T09:01:00.000Z",
          updatedAt: "2026-06-20T09:01:00.000Z",
          createdBy: {
            id: "human:tasuku",
            kind: "human",
            displayName: "Tasuku",
          },
        },
        {
          ...sampleComments[1]!,
          id: "multi-actor-claude-reply",
          threadId: "thread-multi-actor-conversation",
          source: "claude-code",
          author: "Claude Code",
          body: "I can take the parsing branch and report back with the failing fixture.",
          createdAt: "2026-06-20T09:04:00.000Z",
          updatedAt: "2026-06-20T09:04:00.000Z",
          createdBy: {
            id: "claude-code:run-17",
            kind: "claude-code",
            displayName: "Claude Code",
          },
        },
        {
          ...sampleComments[1]!,
          id: "multi-actor-cursor-reply",
          threadId: "thread-multi-actor-conversation",
          source: "unknown",
          author: "Cursor",
          body: "I can check the editor-side handoff and confirm the marker state.",
          createdAt: "2026-06-20T09:05:00.000Z",
          updatedAt: "2026-06-20T09:05:00.000Z",
          createdBy: {
            id: "cursor:composer-3",
            kind: "unknown",
            displayName: "Cursor",
          },
        },
        {
          ...sampleComments[1]!,
          id: "multi-actor-copilot-reply",
          threadId: "thread-multi-actor-conversation",
          source: "unknown",
          author: "GitHub Copilot",
          body: "I will compare this against the pull request conversation view.",
          createdAt: "2026-06-20T09:06:00.000Z",
          updatedAt: "2026-06-20T09:06:00.000Z",
          createdBy: {
            id: "github-copilot:review-11",
            kind: "unknown",
            displayName: "GitHub Copilot",
          },
        },
        {
          ...sampleComments[1]!,
          id: "multi-actor-codex-reply",
          threadId: "thread-multi-actor-conversation",
          source: "codex",
          author: "Codex",
          body: "I will patch the thread projection and add a focused regression story.",
          createdAt: "2026-06-20T09:07:00.000Z",
          updatedAt: "2026-06-20T09:07:00.000Z",
          createdBy: {
            id: "codex:run-24",
            kind: "codex",
            displayName: "Codex",
          },
        },
        {
          ...sampleComments[1]!,
          id: "multi-actor-windsurf-reply",
          threadId: "thread-multi-actor-conversation",
          source: "unknown",
          author: "Windsurf",
          body: "I can verify the workspace-level agent labels stay readable in dense mode.",
          createdAt: "2026-06-20T09:08:00.000Z",
          updatedAt: "2026-06-20T09:08:00.000Z",
          createdBy: {
            id: "windsurf:cascade-5",
            kind: "unknown",
            displayName: "Windsurf",
          },
        },
        {
          ...sampleComments[1]!,
          id: "multi-actor-devin-reply",
          threadId: "thread-multi-actor-conversation",
          source: "unknown",
          author: "Devin",
          body: "I will take the longer-running verification branch and leave a status note here.",
          createdAt: "2026-06-20T09:09:00.000Z",
          updatedAt: "2026-06-20T09:09:00.000Z",
          createdBy: {
            id: "devin:session-2",
            kind: "unknown",
            displayName: "Devin",
          },
        },
        {
          ...sampleComments[1]!,
          id: "multi-actor-human-final",
          threadId: "thread-multi-actor-conversation",
          source: "human",
          author: "Tasuku",
          body: "Thanks. This is the kind of mixed-thread shape I want to inspect.",
          createdAt: "2026-06-20T09:10:00.000Z",
          updatedAt: "2026-06-20T09:10:00.000Z",
          createdBy: {
            id: "human:tasuku",
            kind: "human",
            displayName: "Tasuku",
          },
        },
      ],
    },
    draft: {
      threadId: "thread-multi-actor-conversation",
      path: sampleFiles.code.path,
      viewerKind: "text" as const,
      anchor,
    },
    activeCommentId: "multi-actor-codex-reply",
    currentActorId: "human:tasuku",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("article", { name: "Comment thread for lines 9-12" }),
    ).toBeInTheDocument();
    await expect(canvas.getByText("9 messages")).toBeVisible();
    await expect(canvas.getByText("Started by Tasuku")).toBeVisible();
    await expect(canvas.getByText("Reply by Claude Code")).toBeVisible();
    await expect(canvas.getByText("Reply by Cursor")).toBeVisible();
    await expect(canvas.getByText("Reply by GitHub Copilot")).toBeVisible();
    await expect(canvas.getByText("Reply by Codex")).toBeVisible();
    await expect(canvas.getByText("Reply by Windsurf")).toBeVisible();
    await expect(canvas.getByText("Reply by Devin")).toBeVisible();
    for (const icon of [
      "codex.svg",
      "cursor.svg",
      "github-copilot.svg",
      "windsurf.svg",
    ]) {
      await expect(
        canvasElement.querySelector(`img[src="/vivi/agent-icons/${icon}"]`),
      ).toBeInTheDocument();
    }
    await expect(
      canvasElement.querySelector('[data-comment-id="multi-actor-human-start"]'),
    ).toHaveClass("current-user");
    await expect(
      canvasElement.querySelector(
        '[data-comment-id="multi-actor-claude-reply"]',
      ),
    ).not.toHaveClass("current-user");
    await expect(canvas.getByText("Current stop")).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Reply" }));
    await expect(canvas.getByLabelText("Reply to thread")).toHaveFocus();
  },
};

export const SelfCommentOwnership: Story = {
  name: "Self comment ownership",
  tags: ["interaction"],
  args: {
    thread: {
      key: "thread-self-comment-ownership",
      path: sampleFiles.code.path,
      lineStart: 9,
      lineEnd: 12,
      status: "open",
      comments: [
        {
          ...sampleComments[0]!,
          id: "self-comment-start",
          threadId: "thread-self-comment-ownership",
          source: "human",
          author: "Tasuku",
          body: "Can everyone check the comment-thread experience from their side?",
          createdAt: "2026-06-20T09:00:00.000Z",
          updatedAt: "2026-06-20T09:00:00.000Z",
          createdBy: {
            id: "human:tasuku",
            kind: "human",
            displayName: "Tasuku",
          },
        },
        {
          ...sampleComments[1]!,
          id: "self-comment-codex",
          threadId: "thread-self-comment-ownership",
          source: "codex",
          author: "Codex",
          body: "I see the source projection and will keep the current stop anchored.",
          createdAt: "2026-06-20T09:01:00.000Z",
          updatedAt: "2026-06-20T09:01:00.000Z",
          createdBy: {
            id: "codex:run-31",
            kind: "codex",
            displayName: "Codex",
          },
        },
        {
          ...sampleComments[1]!,
          id: "self-comment-claude",
          threadId: "thread-self-comment-ownership",
          source: "claude-code",
          author: "Claude Code",
          body: "I can verify the failing fixture and report whether this should be a reply or a follow-up.",
          createdAt: "2026-06-20T09:02:00.000Z",
          updatedAt: "2026-06-20T09:02:00.000Z",
          createdBy: {
            id: "claude-code:run-18",
            kind: "claude-code",
            displayName: "Claude Code",
          },
        },
        {
          ...sampleComments[1]!,
          id: "self-comment-follow-up",
          threadId: "thread-self-comment-ownership",
          source: "human",
          author: "Tasuku",
          body: "This separation is helpful. I want my own comments to scan as a stable reference point.",
          createdAt: "2026-06-20T09:07:00.000Z",
          updatedAt: "2026-06-20T09:07:00.000Z",
          createdBy: {
            id: "human:tasuku",
            kind: "human",
            displayName: "Tasuku",
          },
        },
      ],
    },
    draft: {
      threadId: "thread-self-comment-ownership",
      path: sampleFiles.code.path,
      viewerKind: "text" as const,
      anchor,
    },
    currentActorId: "human:tasuku",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("4 messages")).toBeVisible();
    await expect(canvas.getAllByText("You")).toHaveLength(2);
    await expect(
      canvasElement.querySelector('img[src="/vivi/agent-icons/human.svg"]'),
    ).toBeInTheDocument();
    await expect(
      canvasElement.querySelector('[data-comment-id="self-comment-start"]'),
    ).toHaveClass("current-user");
    await expect(
      canvasElement.querySelector('[data-comment-id="self-comment-follow-up"]'),
    ).toHaveClass("current-user");
    await expect(
      canvasElement.querySelector('[data-comment-id="self-comment-codex"]'),
    ).not.toHaveClass("current-user");
  },
};

export const AllAgentsConversation: Story = {
  name: "All agents in one thread",
  tags: ["interaction"],
  args: {
    thread: {
      key: "thread-all-agents-conversation",
      path: sampleFiles.code.path,
      lineStart: 9,
      lineEnd: 12,
      status: "open",
      comments: [
        {
          ...sampleComments[0]!,
          id: "all-agents-human-start",
          threadId: "thread-all-agents-conversation",
          source: "human",
          author: "Tasuku",
          body: "Can everyone check the comment-thread experience from their side?",
          createdAt: "2026-06-20T09:00:00.000Z",
          updatedAt: "2026-06-20T09:00:00.000Z",
          createdBy: {
            id: "human:tasuku",
            kind: "human",
            displayName: "Tasuku",
          },
        },
        {
          ...sampleComments[1]!,
          id: "all-agents-codex",
          threadId: "thread-all-agents-conversation",
          source: "codex",
          author: "Codex",
          body: "I see the source projection and will keep the current stop anchored.",
          createdAt: "2026-06-20T09:01:00.000Z",
          updatedAt: "2026-06-20T09:01:00.000Z",
          createdBy: {
            id: "codex:run-31",
            kind: "codex",
            displayName: "Codex",
          },
        },
        {
          ...sampleComments[1]!,
          id: "all-agents-claude",
          threadId: "thread-all-agents-conversation",
          source: "claude-code",
          author: "Claude Code",
          body: "I can verify the failing fixture and report whether this should be a reply or a follow-up.",
          createdAt: "2026-06-20T09:02:00.000Z",
          updatedAt: "2026-06-20T09:02:00.000Z",
          createdBy: {
            id: "claude-code:run-18",
            kind: "claude-code",
            displayName: "Claude Code",
          },
        },
        {
          ...sampleComments[1]!,
          id: "all-agents-cursor",
          threadId: "thread-all-agents-conversation",
          source: "unknown",
          author: "Cursor",
          body: "I will check the editor handoff and keep the inline marker readable.",
          createdAt: "2026-06-20T09:03:00.000Z",
          updatedAt: "2026-06-20T09:03:00.000Z",
          createdBy: {
            id: "cursor:composer-4",
            kind: "unknown",
            displayName: "Cursor",
          },
        },
        {
          ...sampleComments[1]!,
          id: "all-agents-copilot",
          threadId: "thread-all-agents-conversation",
          source: "unknown",
          author: "GitHub Copilot",
          body: "I will compare the thread wording with the pull request review surface.",
          createdAt: "2026-06-20T09:04:00.000Z",
          updatedAt: "2026-06-20T09:04:00.000Z",
          createdBy: {
            id: "github-copilot:review-12",
            kind: "unknown",
            displayName: "GitHub Copilot",
          },
        },
        {
          ...sampleComments[1]!,
          id: "all-agents-windsurf",
          threadId: "thread-all-agents-conversation",
          source: "unknown",
          author: "Windsurf",
          body: "I will keep an eye on dense-mode spacing with every actor visible.",
          createdAt: "2026-06-20T09:05:00.000Z",
          updatedAt: "2026-06-20T09:05:00.000Z",
          createdBy: {
            id: "windsurf:cascade-6",
            kind: "unknown",
            displayName: "Windsurf",
          },
        },
        {
          ...sampleComments[1]!,
          id: "all-agents-devin",
          threadId: "thread-all-agents-conversation",
          source: "unknown",
          author: "Devin",
          body: "I can take the longer verification branch and post the result back here.",
          createdAt: "2026-06-20T09:06:00.000Z",
          updatedAt: "2026-06-20T09:06:00.000Z",
          createdBy: {
            id: "devin:session-3",
            kind: "unknown",
            displayName: "Devin",
          },
        },
        {
          ...sampleComments[1]!,
          id: "all-agents-human-close",
          threadId: "thread-all-agents-conversation",
          source: "human",
          author: "Tasuku",
          body: "Great. This is the full thread shape I wanted to inspect.",
          createdAt: "2026-06-20T09:07:00.000Z",
          updatedAt: "2026-06-20T09:07:00.000Z",
          createdBy: {
            id: "human:tasuku",
            kind: "human",
            displayName: "Tasuku",
          },
        },
      ],
    },
    draft: {
      threadId: "thread-all-agents-conversation",
      path: sampleFiles.code.path,
      viewerKind: "text" as const,
      anchor,
    },
    activeCommentId: "all-agents-devin",
    currentActorId: "human:tasuku",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("8 messages")).toBeVisible();
    for (const actor of [
      "Tasuku",
      "Codex",
      "Claude Code",
      "Cursor",
      "GitHub Copilot",
      "Windsurf",
      "Devin",
    ]) {
      await expect(
        canvas.getAllByText(new RegExp(`by ${actor}$`)).length,
      ).toBeGreaterThan(0);
    }
    await expect(canvas.getByText("Current stop")).toBeVisible();
  },
};

export const CurrentThreadActions: Story = {
  name: "Resolved thread can be reopened",
  tags: ["interaction"],
  args: {
    ...args("resolved"),
    activeCommentId: "comment-workbench-open-1",
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const reopen = canvas.getByRole("button", {
      name: "Reopen current thread",
    });
    await expect(reopen).toBeInTheDocument();
    await expect(
      canvas.getByRole("button", { name: "Archive current thread" }),
    ).toBeInTheDocument();
    await userEvent.click(reopen);
    await expect(args.onStatusChange).toHaveBeenCalledWith(
      "thread-workbench-open",
      "open",
    );
  },
};

export const NewLineComment: Story = {
  tags: ["interaction"],
  args: {
    thread: {
      key: "new-line-comment",
      path: sampleFiles.code.path,
      lineStart: 14,
      lineEnd: 14,
      status: "open",
      comments: [],
    },
    draft: {
      path: sampleFiles.code.path,
      viewerKind: "text",
      anchor: {
        surface: "source",
        canonical: {
          path: sampleFiles.code.path,
          lineStart: 14,
          lineEnd: 14,
          quote: "setError(String(err));",
          fileHash: sampleFiles.code.etag,
        },
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Composing")).toBeVisible();
    await expect(canvas.getByText("New thread on Line 14")).toBeVisible();
    await expect(canvas.getByLabelText("New line comment")).toHaveFocus();
    await expect(
      canvas.getByLabelText("New line comment"),
    ).toHaveAccessibleDescription(
      /New thread on Line 14.*to save private draft/,
    );
    await expect(
      canvas.getByRole("button", { name: "Save private draft comment" }),
    ).toBeDisabled();
    await expect(canvas.getByText("to save private draft")).toBeVisible();
  },
};

export const DirtyComposerConfirmsBeforeClose: Story = {
  tags: ["interaction"],
  args: {
    thread: {
      key: "dirty-new-line-comment",
      path: sampleFiles.code.path,
      lineStart: 16,
      lineEnd: 16,
      status: "open",
      comments: [],
    },
    draft: {
      path: sampleFiles.code.path,
      viewerKind: "text",
      anchor: {
        surface: "source",
        canonical: {
          path: sampleFiles.code.path,
          lineStart: 16,
          lineEnd: 16,
          quote: "return next;",
          fileHash: sampleFiles.code.etag,
        },
      },
    },
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(
      canvas.getByLabelText("New line comment"),
      "Keep this in progress.",
    );

    const originalConfirm = window.confirm;
    try {
      const rejectDiscard = fn(() => false);
      window.confirm = rejectDiscard;
      await userEvent.click(
        canvas.getByRole("button", { name: "Close comment thread" }),
      );
      await expect(rejectDiscard).toHaveBeenCalledWith(
        "Discard this unsent comment?",
      );
      await expect(args.onClose).not.toHaveBeenCalled();
      await expect(canvas.getByLabelText("New line comment")).toHaveValue(
        "Keep this in progress.",
      );

      const acceptDiscard = fn(() => true);
      window.confirm = acceptDiscard;
      await userEvent.click(
        canvas.getByRole("button", { name: "Close comment thread" }),
      );
      await expect(acceptDiscard).toHaveBeenCalledWith(
        "Discard this unsent comment?",
      );
      await expect(args.onClose).toHaveBeenCalled();
    } finally {
      window.confirm = originalConfirm;
    }
  },
};

export const SubmitFailureKeepsDraftEditable: Story = {
  tags: ["interaction"],
  args: {
    ...args("open"),
    onCreateComment: fn(async () => {
      throw new Error("Comment save failed. Try again.");
    }),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Reply" }));
    const reply = canvas.getByLabelText("Reply to thread");
    await userEvent.type(reply, "This should survive a failed save.");
    await userEvent.click(canvas.getByRole("button", { name: "Add reply" }));

    await expect(args.onCreateComment).toHaveBeenCalled();
    await expect(reply).toHaveValue("This should survive a failed save.");
    await expect(canvas.getByRole("alert")).toHaveTextContent(
      "Comment save failed. Try again.",
    );

    await userEvent.type(reply, " Continuing.");
    await expect(canvas.queryByRole("alert")).toBeNull();
    await expect(reply).toHaveValue(
      "This should survive a failed save. Continuing.",
    );
  },
};

export const UserWritesOneDraftComment: Story = {
  args: {
    thread: {
      key: "draft-review-1",
      path: sampleFiles.code.path,
      lineStart: 6,
      lineEnd: 6,
      status: "open",
      comments: [draftReviewCommentAsViviComment(sampleDraftComments[0]!)],
    },
    draft: {
      path: sampleFiles.code.path,
      viewerKind: "text",
      anchor: sampleDraftComments[0]!.anchor,
    },
  },
};

export const UserWritesMultipleDraftComments: Story = {
  args: {
    thread: {
      key: "draft-review-multiple",
      path: sampleFiles.code.path,
      lineStart: 6,
      lineEnd: 10,
      status: "open",
      comments: sampleDraftComments
        .filter((draft) => draft.path === sampleFiles.code.path)
        .map((draft) => draftReviewCommentAsViviComment(draft)),
    },
    draft: {
      path: sampleFiles.code.path,
      viewerKind: "text",
      anchor: sampleDraftComments[0]!.anchor,
    },
  },
};

export const AgentHasReadThread: Story = {
  args: {
    ...args("open"),
    activity: summarizeThreadActivity(
      sampleThreadActivities["thread-workbench-open"]?.timeline.filter(
        (event) => event.type === "thread_read",
      ),
    ),
  },
};

export const AgentHasReplied: Story = {
  args: {
    ...args("open"),
    activity: sampleThreadActivities["thread-workbench-open"],
  },
};
