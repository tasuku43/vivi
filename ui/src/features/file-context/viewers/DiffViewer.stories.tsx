import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import {
  commentsForPath,
  htmlDiff,
  markdownDiff,
  sampleComments,
  sampleDiff,
  sampleFiles,
  sampleThreadActivities,
} from "../../../storybook/fixtures/review-lab.js";
import { DiffViewer } from "./DiffViewer.js";
import {
  RenderedChangeCardsFacade,
  type RenderedChangeCard,
} from "./RenderedChangeCardsFacade.js";

const meta = {
  title: "Review/Diff States",
  component: DiffViewer,
  parameters: {
    layout: "fullscreen",
    a11y: { test: "error" },
  },
  args: {
    path: sampleFiles.code.path,
    renderKind: "source",
    file: sampleFiles.code,
    diff: sampleDiff,
    comments: commentsForPath(sampleFiles.code.path),
    threadActivities: sampleThreadActivities,
    onOpenComment: fn(),
  },
} satisfies Meta<typeof DiffViewer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const DiffCommentOnAddedLine: Story = {
  name: "Added diff line opens an inline review thread",
  tags: ["interaction"],
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("region", {
        name: `Diff from HEAD for ${sampleFiles.code.path}`,
      }),
    ).toBeInTheDocument();
    const lineAction = canvasElement.querySelector<HTMLButtonElement>(
      `[data-testid="line-comment-action"][data-comment-surface="diff"][data-path="${sampleFiles.code.path}"]`,
    );
    expect(lineAction).toBeInTheDocument();
    expect(lineAction!.getBoundingClientRect().width).toBeGreaterThanOrEqual(
      28,
    );
    expect(lineAction!.getBoundingClientRect().height).toBeGreaterThanOrEqual(
      24,
    );
    const marker = canvas.getByRole("button", {
      name: "Open comment thread on line 10 with 1 message",
    });
    await expect(marker).toBeInTheDocument();
    await userEvent.click(marker);
    await expect(
      canvas.getByRole("article", { name: "Comment thread for line 10" }),
    ).toBeVisible();
    await expect(args.onOpenComment).not.toHaveBeenCalled();
    await userEvent.click(marker);
    await expect(
      canvas.queryByRole("article", { name: "Comment thread for line 10" }),
    ).not.toBeInTheDocument();
    await expect(args.onOpenComment).not.toHaveBeenCalled();
  },
};

export const ActiveDiffCommentStaysInline: Story = {
  name: "Active diff thread stays inline",
  args: {
    activeCommentId: "comment-diff-added",
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("article", { name: "Comment thread for line 10" }),
    ).toBeVisible();
    await expect(
      canvas.getByText("Diff comments should anchor to changed lines."),
    ).toBeVisible();
    await expect(args.onOpenComment).not.toHaveBeenCalled();
    const marker = canvas.getByRole("button", {
      name: "Open comment thread on line 10 with 1 message",
    });
    await userEvent.click(marker);
    await expect(
      canvas.queryByRole("article", { name: "Comment thread for line 10" }),
    ).not.toBeInTheDocument();
    await expect(args.onOpenComment).not.toHaveBeenCalled();
  },
};

export const DiffThreadReplyStaysFocusedOnExistingLine: Story = {
  name: "Diff line keeps replies focused on the existing thread",
  tags: ["interaction"],
  args: {
    comments: [
      {
        ...sampleComments[2]!,
        id: "comment-diff-existing-composer-10",
        threadId: "thread-diff-existing-composer-10",
        body: "Existing diff thread should stay separate from the next note.",
      },
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole("button", {
        name: "Open comment thread on line 10 with 1 message",
      }),
    );

    await expect(
      canvas.getAllByRole("article", {
        name: "Comment thread for line 10",
      }),
    ).toHaveLength(1);
    await expect(
      canvas.getByText(
        "Existing diff thread should stay separate from the next note.",
      ),
    ).toBeVisible();
    await expect(
      canvas.queryByRole("button", { name: "Start separate thread" }),
    ).not.toBeInTheDocument();
    await expect(canvas.queryByLabelText("New line comment")).toBeNull();
    await expect(canvas.getByLabelText("Continue thread")).toBeVisible();
  },
};

export const MultipleDraftFormsStayOpen: Story = {
  tags: ["interaction"],
  args: {
    comments: [],
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

export const DiffCommentOnRemovedLine: Story = {
  args: {
    activeCommentId: "comment-diff-removed",
  },
};

export const ResolvedDiffThreadMarker: Story = {
  name: "Resolved diff thread can be reopened",
  tags: ["interaction"],
  args: {
    comments: [
      {
        ...sampleComments[2]!,
        id: "comment-diff-resolved-root",
        threadId: "thread-diff-resolved",
        status: "resolved",
        body: "Resolved diff history should not look like an open reply target.",
      },
      {
        ...sampleComments[2]!,
        id: "comment-diff-resolved-reply",
        threadId: "thread-diff-resolved",
        status: "resolved",
        body: "The follow-up verification already closed this discussion.",
        createdAt: "2026-06-20T09:14:00.000Z",
        updatedAt: "2026-06-20T09:14:00.000Z",
      },
    ],
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const marker = canvas.getByRole("button", {
      name: "Open resolved comment thread on line 10 with 2 messages",
    });
    await expect(marker).toBeInTheDocument();
    await userEvent.click(marker);
    await expect(args.onOpenComment).not.toHaveBeenCalled();
    const thread = canvas.getByRole("article", {
      name: "Comment thread for line 10",
    });
    await expect(thread).toBeVisible();
    expect(within(thread).getAllByText("Resolved").length).toBeGreaterThan(0);
  },
};

export const RenderedMarkdownComment: Story = {
  tags: ["interaction"],
  args: {
    path: sampleFiles.markdown.path,
    renderKind: "markdown",
    file: sampleFiles.markdown,
    diff: markdownDiff,
    comments: commentsForPath(sampleFiles.markdown.path),
    activeCommentId: "comment-md-rendered",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const cardsRegion = canvas.getByRole("region", {
      name: `Rendered Markdown change cards for ${sampleFiles.markdown.path}`,
    });
    await expect(cardsRegion).toBeVisible();
    const cardsCanvas = within(cardsRegion);
    expect(cardsCanvas.getAllByRole("article").length).toBeGreaterThan(0);
    await expect(cardsRegion).toHaveTextContent(
      "source diff remains canonical",
    );
    const sourcePreviews = cardsCanvas.getAllByLabelText("Source hunk preview");
    expect(sourcePreviews.length).toBeGreaterThan(0);
    const toggle = cardsCanvas.getAllByRole("button", {
      name: "Hide source hunk",
    })[0];
    expect(toggle).toBeDefined();
    await userEvent.click(toggle!);
    expect(cardsCanvas.getAllByLabelText("Source hunk preview").length).toBe(
      sourcePreviews.length - 1,
    );
    await userEvent.click(toggle!);
    expect(cardsCanvas.getAllByLabelText("Source hunk preview").length).toBe(
      sourcePreviews.length,
    );
  },
};

export const RenderedHtmlComment: Story = {
  args: {
    path: sampleFiles.html.path,
    renderKind: "html",
    file: sampleFiles.html,
    diff: htmlDiff,
    comments: commentsForPath(sampleFiles.html.path),
    activeCommentId: "comment-html-rendered",
  },
};

const renderedChangeCards: RenderedChangeCard[] = [
  {
    id: "markdown-intro-change",
    kind: "changed",
    surface: "markdown",
    title: "Changed paragraph",
    path: sampleFiles.markdown.path,
    meta: "Markdown paragraph · old line 3 -> new line 3",
    beforeLabel: "Before · HEAD",
    afterLabel: "After · working tree",
    before: {
      kind: "markdown",
      body: "Vivi keeps review comments near files.",
    },
    after: {
      kind: "markdown",
      body: "Vivi keeps the human review surface close to the files that changed.",
    },
    sourceRows: [
      {
        line: "-3",
        kind: "remove",
        text: "Vivi keeps review comments near files.",
      },
      {
        line: "+3",
        kind: "add",
        text: "Vivi keeps the human review surface close to the files that changed.",
      },
    ],
  },
  {
    id: "markdown-contract-added",
    kind: "added",
    surface: "markdown",
    title: "Added review contract",
    path: sampleFiles.markdown.path,
    meta: "Markdown paragraph · new lines 7-8",
    afterLabel: "Added · working tree",
    after: {
      kind: "markdown",
      body: "Comment threads are the shared contract between the browser UI and coding agents.",
    },
    sourceRows: [
      {
        line: "+7",
        kind: "add",
        text: "Comment threads are the shared contract between the browser UI and coding agents.",
      },
      { line: "+8", kind: "add", text: "" },
    ],
    comment: commentsForPath(sampleFiles.markdown.path).find(
      (comment) => comment.id === "comment-md-rendered",
    ),
  },
  {
    id: "html-preview-copy",
    kind: "changed",
    surface: "html",
    title: "HTML preview copy",
    path: sampleFiles.html.path,
    meta: "review-preview.html · old line 7 -> new lines 7-8",
    beforeLabel: "Before · HEAD",
    afterLabel: "After · working tree",
    before: {
      kind: "html",
      heading: "Review Preview",
      body: "Comments map back to source blocks.",
    },
    after: {
      kind: "html",
      heading: "Review Preview",
      body: "Rendered HTML comments map back to source blocks.",
      action: "Approve local preview",
    },
    sourceRows: [
      {
        line: "-7",
        kind: "remove",
        text: "<p>Comments map back to source blocks.</p>",
      },
      {
        line: "+7",
        kind: "add",
        text: "<p>Rendered HTML comments map back to source blocks.</p>",
      },
      {
        line: "+8",
        kind: "add",
        text: "<button>Approve local preview</button>",
      },
    ],
    comment: commentsForPath(sampleFiles.html.path).find(
      (comment) => comment.id === "comment-html-rendered",
    ),
  },
  {
    id: "removed-rendered-note",
    kind: "removed",
    surface: "markdown",
    title: "Removed note",
    path: sampleFiles.markdown.path,
    meta: "Ghost rendered block · old line 12",
    beforeLabel: "Removed · HEAD",
    before: {
      kind: "markdown",
      body: "Previous note: rendered comments are experimental in preview mode.",
    },
    sourceRows: [
      {
        line: "-12",
        kind: "remove",
        text: "Previous note: rendered comments are experimental in preview mode.",
      },
    ],
  },
];

export const RenderedChangeCards: Story = {
  name: "Rendered change cards facade",
  render: () => (
    <RenderedChangeCardsFacade
      markdownFile={sampleFiles.markdown}
      markdownDiff={markdownDiff}
      cards={renderedChangeCards}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("region", { name: "Rendered change cards facade" }),
    ).toBeInTheDocument();
    await expect(
      canvas.getByTestId("rendered-change-cards-subtitle"),
    ).toHaveTextContent("source diff remains canonical");

    const addedStatus = canvas.getByRole("button", {
      name: "Select Added review contract",
    });
    await userEvent.click(addedStatus);
    await expect(addedStatus).toHaveAttribute("aria-pressed", "true");

    const addedCard = canvas.getByRole("article", {
      name: "Added review contract rendered change card",
    });
    const addedCardCanvas = within(addedCard);
    await expect(
      addedCardCanvas.getByLabelText("Source hunk preview"),
    ).toBeVisible();
    await userEvent.click(
      addedCardCanvas.getByRole("button", { name: "Hide source hunk" }),
    );
    await expect(
      addedCardCanvas.queryByLabelText("Source hunk preview"),
    ).not.toBeInTheDocument();
    await userEvent.click(
      addedCardCanvas.getByRole("button", { name: "Show source hunk" }),
    );
    await expect(
      addedCardCanvas.getByLabelText("Source hunk preview"),
    ).toBeVisible();
  },
};

export const Loading: Story = {
  args: {
    diff: null,
    loading: true,
    comments: [],
  },
};

export const Unavailable: Story = {
  args: {
    diff: {
      path: sampleFiles.code.path,
      status: "unavailable",
      baseLabel: "HEAD",
      compareLabel: "working tree",
      content: "",
      reason: "No base ref is available in this fixture.",
    },
    comments: [],
  },
};

export const BinaryDiff: Story = {
  args: {
    diff: {
      path: "screenshots/workbench.png",
      status: "binary",
      baseLabel: "HEAD",
      compareLabel: "working tree",
      content: "",
      reason: "Binary file diffs are reviewed as metadata only.",
    },
    comments: [],
  },
};
