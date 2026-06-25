import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState, type ComponentProps } from "react";
import { expect, fn, userEvent, within } from "storybook/test";
import { draftReviewCommentAsViviComment } from "../../../state/comments.js";
import {
  commentsForPath,
  sampleDiff,
  sampleComments,
  sampleDraftComments,
  sampleFiles,
  sampleThreadActivities,
} from "../../../storybook/fixtures/review-lab.js";
import { CodeViewer } from "./CodeViewer.js";

const meta = {
  title: "Viewers/Code/CodeViewer",
  component: CodeViewer,
  parameters: {
    layout: "fullscreen",
    a11y: { test: "error" },
  },
  args: {
    file: sampleFiles.code,
    theme: "dark",
    selectedRange: { start: 9, end: 12 },
    comments: commentsForPath(sampleFiles.code.path),
    threadActivities: sampleThreadActivities,
    onSelectionChange: fn(),
    onCreateComment: fn(),
    onOpenComment: fn(),
    onCloseComment: fn(),
    onCommentStatusChange: fn(),
    onDiffToggle: fn(),
  },
} satisfies Meta<typeof CodeViewer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SourceWithOpenThread: Story = {
  tags: ["interaction"],
  args: {
    activeCommentId: "comment-workbench-open-1",
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("region", {
        name: `Code viewer for ${sampleFiles.code.path}`,
      }),
    ).toBeInTheDocument();
    const diffToggle = canvasElement.querySelector<HTMLButtonElement>(
      `[data-testid="viewer-diff-toggle"][data-viewer-path="${sampleFiles.code.path}"]`,
    );
    await expect(diffToggle).toBeInTheDocument();
    await expect(diffToggle).toHaveAttribute("data-diff-enabled", "false");
    await userEvent.click(diffToggle!);
    await expect(args.onDiffToggle).toHaveBeenCalled();
    await expect(canvas.getByText("Current scope")).toBeInTheDocument();
  },
};

export const SourceWithAgentReply: Story = {
  args: {
    activeCommentId: "comment-workbench-agent-1",
  },
};

export const SourceIgnoresDiffThreadOnSameLine: Story = {
  tags: ["interaction"],
  args: {
    selectedRange: null,
    activeCommentId: "comment-source-line-10",
    comments: [
      {
        ...sampleComments[0]!,
        id: "comment-source-line-10",
        threadId: "thread-source-line-10",
        anchor: {
          surface: "source",
          canonical: {
            path: sampleFiles.code.path,
            lineStart: 10,
            lineEnd: 10,
            quote:
              "return client.publishDraftReviewComments({ actor: humanTasuku });",
            fileHash: sampleFiles.code.etag,
          },
        },
        body: "Source viewer should show this one source-thread message.",
      },
      {
        ...sampleComments[2]!,
        id: "comment-diff-same-line-1",
        threadId: "thread-diff-same-line",
        anchor: {
          ...sampleComments[2]!.anchor,
          surface: "diff",
          canonical: {
            ...sampleComments[2]!.anchor.canonical,
            lineStart: 10,
            lineEnd: 10,
          },
        },
        body: "Diff-only feedback should stay out of source gutter counts.",
      },
      {
        ...sampleComments[2]!,
        id: "comment-diff-same-line-2",
        threadId: "thread-diff-same-line",
        anchor: {
          ...sampleComments[2]!.anchor,
          surface: "diff",
          canonical: {
            ...sampleComments[2]!.anchor.canonical,
            lineStart: 10,
            lineEnd: 10,
          },
        },
        body: "Second diff-only message on the same canonical line.",
        createdAt: "2026-06-20T09:14:00.000Z",
        updatedAt: "2026-06-20T09:14:00.000Z",
      },
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const lineAction = canvasElement.querySelector<HTMLButtonElement>(
      `[data-testid="line-comment-action"][data-comment-surface="source"][data-line="10"][data-path="${sampleFiles.code.path}"]`,
    );
    expect(lineAction).toBeInTheDocument();
    await expect(lineAction).toHaveAttribute(
      "aria-label",
      "Open comment thread on line 10 with 1 message; open to reply",
    );
    await userEvent.click(lineAction!);
    await expect(
      canvas.getByRole("article", { name: "Comment thread for line 10" }),
    ).toBeVisible();
    await expect(canvas.getByText("1 message")).toBeVisible();
    await expect(
      canvas.getByText(
        "Source viewer should show this one source-thread message.",
      ),
    ).toBeVisible();
    await expect(
      canvas.queryByText(
        "Second diff-only message on the same canonical line.",
      ),
    ).not.toBeInTheDocument();
  },
};

export const DiffMode: Story = {
  args: {
    diffEnabled: true,
    diff: sampleDiff,
    activeCommentId: "comment-diff-added",
  },
  play: async ({ canvasElement }) => {
    const diffToggle = canvasElement.querySelector<HTMLButtonElement>(
      `[data-testid="viewer-diff-toggle"][data-viewer-path="${sampleFiles.code.path}"]`,
    );
    await expect(diffToggle).toBeInTheDocument();
    await expect(diffToggle).toHaveAttribute("data-diff-enabled", "true");
  },
};

export const NarrowInlineCommentDraft: Story = {
  tags: ["interaction"],
  args: {
    comments: [],
    selectedRange: null,
  },
  render: (args) => (
    <div
      className="viewer-pane"
      style={{
        width: 520,
        height: 620,
        borderRight: "1px solid var(--line)",
      }}
    >
      <CodeViewer {...args} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const lineAction = canvasElement.querySelector<HTMLButtonElement>(
      `[data-testid="line-comment-action"][data-comment-surface="source"][data-line="6"][data-path="${sampleFiles.code.path}"]`,
    );
    expect(lineAction).toBeInTheDocument();
    expect(lineAction!.getBoundingClientRect().width).toBeGreaterThanOrEqual(
      28,
    );
    expect(lineAction!.getBoundingClientRect().height).toBeGreaterThanOrEqual(
      24,
    );
    await userEvent.click(lineAction!);
    await expect(canvas.getByLabelText("New line comment")).toBeVisible();

    const viewerPane = canvasElement.querySelector<HTMLElement>(".viewer-pane");
    const thread = canvasElement.querySelector<HTMLElement>(
      ".code-comment-thread",
    );
    const saveButton = canvas.getByRole("button", {
      name: "Save private draft comment",
    });
    if (!viewerPane || !thread) throw new Error("missing inline comment story");

    const paneRight = viewerPane.getBoundingClientRect().right;
    expect(thread.getBoundingClientRect().right).toBeLessThanOrEqual(
      paneRight + 1,
    );
    expect(saveButton.getBoundingClientRect().right).toBeLessThanOrEqual(
      paneRight + 1,
    );
  },
};

export const MultipleSourceDraftFormsStayOpen: Story = {
  tags: ["interaction"],
  args: {
    comments: [],
    selectedRange: null,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole("button", { name: "Add comment on line 6" }),
    );
    await expect(
      canvas.getByRole("article", { name: "Comment thread for line 6" }),
    ).toBeVisible();

    await userEvent.click(
      canvas.getByRole("button", { name: "Add comment on line 9" }),
    );

    await expect(
      canvas.getByRole("article", { name: "Comment thread for line 6" }),
    ).toBeVisible();
    await expect(
      canvas.getByRole("article", { name: "Comment thread for line 9" }),
    ).toBeVisible();
    await expect(canvas.getAllByLabelText("New line comment")).toHaveLength(2);
  },
};

export const SourceCommentActionDragSelectsRange: Story = {
  tags: ["interaction"],
  args: {
    comments: [],
    selectedRange: null,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const line6Action = canvasElement.querySelector<HTMLButtonElement>(
      `[data-testid="line-comment-action"][data-comment-surface="source"][data-line="6"][data-path="${sampleFiles.code.path}"]`,
    );
    const line9Row = canvasElement.querySelector<HTMLElement>(
      '.code-line[data-line="9"]',
    );
    expect(line6Action).toBeInTheDocument();
    expect(line9Row).toBeInTheDocument();
    await userEvent.pointer([
      { keys: "[MouseLeft>]", target: line6Action! },
      { target: line9Row! },
      { keys: "[/MouseLeft]", target: line9Row! },
    ]);

    await expect(
      canvas.getByRole("article", { name: "Comment thread for lines 6-9" }),
    ).toBeVisible();
    await expect(canvas.getAllByLabelText("New line comment")).toHaveLength(1);
    await expect(canvas.queryByLabelText("Comment thread for line 6")).toBe(
      null,
    );
  },
};

export const SavedInlineDraftRemainsVisible: Story = {
  tags: ["interaction"],
  args: {
    comments: [],
    selectedRange: null,
  },
  render: (args) => <SavedInlineDraftHarness {...args} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const lineAction = canvasElement.querySelector<HTMLButtonElement>(
      `[data-testid="line-comment-action"][data-comment-surface="source"][data-line="6"][data-path="${sampleFiles.code.path}"]`,
    );
    expect(lineAction).toBeInTheDocument();
    await userEvent.click(lineAction!);
    await userEvent.type(
      canvas.getByLabelText("New line comment"),
      "Persist this draft in place.",
    );
    await userEvent.click(
      canvas.getByRole("button", { name: "Save private draft comment" }),
    );

    await expect(
      canvas.getByText("Persist this draft in place."),
    ).toBeVisible();
    await expect(canvas.getByText("1 message")).toBeVisible();
    expect(canvas.getAllByText("Draft").length).toBeGreaterThan(0);
  },
};

export const LoadingHighlightFallback: Story = {
  args: {
    selectedRange: null,
    comments: [],
  },
};

function SavedInlineDraftHarness(args: ComponentProps<typeof CodeViewer>) {
  const [comments, setComments] = useState(args.comments ?? []);

  return (
    <CodeViewer
      {...args}
      comments={comments}
      onCreateComment={async (_draft, body) => {
        const fixture = sampleDraftComments[0]!;
        setComments([
          draftReviewCommentAsViviComment(
            {
              ...fixture,
              body,
              updatedAt: "2026-06-23T10:10:00.000Z",
            },
            [],
          ),
        ]);
      }}
    />
  );
}
