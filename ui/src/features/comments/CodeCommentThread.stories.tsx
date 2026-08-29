import { useState, type ComponentProps } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import type {
  CommentThreadActivityEvent,
  ViviComment,
} from "../../domain/comments.js";
import { summarizeThreadActivity } from "../../state/comment-activity.js";
import { CodeCommentThread } from "./components/CodeCommentThread.js";
import { useCommentInputSessions } from "./CommentInputSessionProvider.js";
import { sampleFiles } from "../../storybook/fixtures/review-lab.js";

const threadId = "thread-review-attention";
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

const humanComment: ViviComment = {
  id: "comment-human-review",
  threadId,
  path: sampleFiles.code.path,
  viewerKind: "text",
  anchor,
  body: "Keep the activity window independent from the feedback payload.",
  createdBy: {
    id: "human:tasuku",
    kind: "human",
    displayName: "Tasuku",
  },
  source: "human",
  status: "open",
  createdAt: "2026-08-29T09:00:00.000Z",
  updatedAt: "2026-08-29T09:00:00.000Z",
};

const legacyAgentMessage: ViviComment = {
  ...humanComment,
  id: "comment-agent-message",
  body: "I implemented this and left an agent message.",
  createdBy: {
    id: "codex:run-24",
    kind: "codex",
    displayName: "Codex",
  },
  source: "codex",
  createdAt: "2026-08-29T09:04:00.000Z",
  updatedAt: "2026-08-29T09:04:00.000Z",
};

const agentRead: CommentThreadActivityEvent = {
  id: "activity-agent-read",
  threadId,
  type: "thread_read",
  actor: {
    id: "codex:run-24",
    kind: "codex",
    displayName: "Codex",
  },
  createdAt: "2026-08-29T09:05:00.000Z",
};

const baseArgs: ComponentProps<typeof CodeCommentThread> = {
  thread: {
    key: threadId,
    path: sampleFiles.code.path,
    lineStart: 9,
    lineEnd: 12,
    comments: [humanComment],
  },
  draft: {
    threadId,
    path: sampleFiles.code.path,
    viewerKind: "text",
    anchor,
  },
  onClose: fn(),
  onCreateComment: fn(),
  onDeleteDraft: fn(),
};

const meta = {
  title: "Review/Inline Comment States",
  component: CodeCommentThread,
  parameters: { layout: "centered", a11y: { test: "error" } },
  args: baseArgs,
} satisfies Meta<typeof CodeCommentThread>;

export default meta;
type Story = StoryObj<typeof meta>;

export const UnseenPublishedFeedback: Story = {
  tags: ["interaction"],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getAllByText("Published")[0]).toBeVisible();
    await expect(canvas.getByText("Unseen")).toBeVisible();
    await expect(canvas.queryByRole("button", { name: "Resolve" })).toBeNull();
    await expect(canvas.queryByRole("button", { name: "Archive" })).toBeNull();
    await expect(canvas.queryByRole("textbox")).toBeNull();
  },
};

export const SeenByAgent: Story = {
  args: {
    activity: summarizeThreadActivity(
      [agentRead],
      Date.parse(agentRead.createdAt),
    ),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Seen")).toBeVisible();
    await expect(canvas.getByText(/Codex read/)).toBeVisible();
  },
};

export const AgentMessageIsNotAnInbox: Story = {
  tags: ["interaction"],
  args: {
    thread: {
      ...baseArgs.thread,
      comments: [humanComment, legacyAgentMessage],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(humanComment.body)).toBeVisible();
    await expect(canvas.queryByText(legacyAgentMessage.body)).toBeNull();
  },
};

export const NewLineComment: Story = {
  tags: ["interaction"],
  args: {
    thread: { ...baseArgs.thread, key: "new-comment", comments: [] },
    draft: { ...baseArgs.draft, threadId: undefined },
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByLabelText("New line comment");
    await userEvent.type(input, "Use one shared attention clock.");
    await userEvent.click(
      canvas.getByRole("button", { name: "Save pending draft comment" }),
    );
    await expect(args.onCreateComment).toHaveBeenCalled();
    const submitted = (
      args.onCreateComment as unknown as { mock: { calls: unknown[][] } }
    ).mock.calls[0]?.[0];
    await expect(submitted).not.toHaveProperty("threadId");
  },
};

export const ResumableInput: Story = {
  tags: ["interaction"],
  args: {
    thread: { ...baseArgs.thread, key: "resumable-comment", comments: [] },
    draft: { ...baseArgs.draft, threadId: undefined },
  },
  render: (args) => <ResumableInputHarness {...args} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByLabelText("New line comment");
    await userEvent.type(input, "Keep this across navigation");
    await userEvent.click(canvas.getByRole("button", { name: "Other file" }));
    await userEvent.click(
      canvas.getByRole("button", { name: "Return to comment" }),
    );
    await expect(canvas.getByLabelText("New line comment")).toHaveValue(
      "Keep this across navigation",
    );
  },
};

export const StaleInputRequiresDecision: Story = {
  tags: ["interaction"],
  args: {
    thread: { ...baseArgs.thread, key: "stale-comment", comments: [] },
    draft: { ...baseArgs.draft, threadId: undefined },
  },
  render: (args) => <StaleInputHarness {...args} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(
      canvas.getByLabelText("New line comment"),
      "Check this after refresh",
    );
    await userEvent.click(
      canvas.getByRole("button", { name: "Simulate file update" }),
    );
    await expect(
      canvas.getByText("File changed since this comment was started."),
    ).toBeVisible();
    await userEvent.click(
      canvas.getByRole("button", { name: "Re-anchor here" }),
    );
    await expect(canvas.getByLabelText("New line comment")).toBeEnabled();
  },
};

function ResumableInputHarness(
  storyArgs: ComponentProps<typeof CodeCommentThread>,
) {
  const [visible, setVisible] = useState(true);
  const inputs = useCommentInputSessions();
  return (
    <div>
      <button type="button" onClick={() => setVisible(false)}>
        Other file
      </button>
      {!visible ? (
        <button
          type="button"
          onClick={() => {
            inputs.start(storyArgs.draft);
            setVisible(true);
          }}
        >
          Return to comment
        </button>
      ) : null}
      {visible ? (
        <CodeCommentThread {...storyArgs} onClose={() => setVisible(false)} />
      ) : null}
    </div>
  );
}

function StaleInputHarness(
  storyArgs: ComponentProps<typeof CodeCommentThread>,
) {
  const inputs = useCommentInputSessions();
  const [currentDraft, setCurrentDraft] = useState(storyArgs.draft);
  return (
    <div>
      <button
        type="button"
        onClick={() => {
          const nextDraft = {
            ...currentDraft,
            anchor: {
              ...currentDraft.anchor,
              canonical: {
                ...currentDraft.anchor.canonical,
                fileHash: "sha256:updated",
              },
            },
          };
          setCurrentDraft(nextDraft);
          inputs.markPathVersion(nextDraft.path, "sha256:updated");
        }}
      >
        Simulate file update
      </button>
      <CodeCommentThread {...storyArgs} draft={currentDraft} />
    </div>
  );
}
