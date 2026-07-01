import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  expect,
  fireEvent,
  fn,
  userEvent,
  waitFor,
  within,
} from "storybook/test";
import type { TextDiff } from "../../../domain/change-review.js";
import type { ViviComment } from "../../../domain/comments.js";
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
    onCreateComment: fn(),
  },
} satisfies Meta<typeof DiffViewer>;

export default meta;
type Story = StoryObj<typeof meta>;

const fencedCodeMarkdownDiff: TextDiff = {
  path: sampleFiles.markdown.path,
  status: "available",
  baseLabel: "HEAD",
  baseRef: "HEAD",
  compareLabel: "working tree",
  diffHash: "diff-markdown-code-fence-42",
  content: [
    "diff --git a/docs/product-review.md b/docs/product-review.md",
    "index 3030303..4040404 100644",
    "--- a/docs/product-review.md",
    "+++ b/docs/product-review.md",
    "@@ -1,4 +1,4 @@",
    " ```ts",
    " const unchanged = true;",
    "-console.log('old');",
    "+console.log('new');",
    " ```",
  ].join("\n"),
};

const removedMarkdownDiff: TextDiff = {
  path: sampleFiles.markdown.path,
  status: "available",
  baseLabel: "HEAD",
  baseRef: "HEAD",
  compareLabel: "working tree",
  diffHash: "diff-markdown-removed-42",
  content: [
    "diff --git a/docs/product-review.md b/docs/product-review.md",
    "index 5050505..6060606 100644",
    "--- a/docs/product-review.md",
    "+++ b/docs/product-review.md",
    "@@ -8,2 +7,0 @@",
    "-## Draft review comments",
    "-Draft comments stay private until the reviewer publishes a batch.",
  ].join("\n"),
};

const renderedMarkdownDiffComment = {
  ...sampleComments.find((comment) => comment.id === "comment-md-rendered")!,
  anchor: {
    surface: "diff",
    canonical: {
      path: sampleFiles.markdown.path,
      lineStart: 7,
      lineEnd: 7,
      quote: "Comment threads are the shared contract",
      fileHash: sampleFiles.markdown.etag,
    },
    diff: {
      path: sampleFiles.markdown.path,
      base: "HEAD",
      ref: "working tree",
      hunkId: "@@ -1,8 +1,12 @@",
      side: "new",
      newLineStart: 7,
      newLineEnd: 7,
      diffHash: markdownDiff.diffHash,
      fileHash: sampleFiles.markdown.etag,
      changeKind: "added",
    },
  },
} satisfies ViviComment;

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
    comments: [renderedMarkdownDiffComment],
    activeCommentId: "comment-md-rendered",
  },
  play: async ({ args, canvasElement }) => {
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
    const activeCard = cardsCanvas.getByRole("article", {
      name: "Added rendered block 7",
    });
    const activeCardCanvas = within(activeCard);
    await expect(
      activeCardCanvas.getByRole("article", {
        name: "Comment thread for line 7",
      }),
    ).toBeVisible();
    await expect(activeCard).toHaveTextContent(
      "This sentence captures the feedback layer well; keep it visible in the inspector outline story.",
    );
    await userEvent.type(
      activeCardCanvas.getByLabelText("Continue thread"),
      "Keep this follow-up on the rendered diff card.",
    );
    await userEvent.click(
      activeCardCanvas.getByRole("button", { name: "Add follow-up" }),
    );
    await expect(args.onCreateComment).toHaveBeenCalled();
    const draft = (
      args.onCreateComment as unknown as { mock: { calls: unknown[][] } }
    ).mock.calls.at(-1)?.[0];
    await expect(draft).toMatchObject({
      threadId: "thread-md-rendered",
      path: sampleFiles.markdown.path,
      viewerKind: "markdown",
      anchor: {
        surface: "diff",
        canonical: {
          path: sampleFiles.markdown.path,
          lineStart: 7,
          lineEnd: 7,
        },
        diff: {
          path: sampleFiles.markdown.path,
          hunkId: "@@ -1,8 +1,12 @@",
          side: "new",
          newLineStart: 7,
          newLineEnd: 7,
          diffHash: "diff-markdown-42",
          changeKind: "added",
        },
      },
    });
    const toggle = cardsCanvas.getAllByRole("button", {
      name: /Show source hunk for/,
    })[0];
    expect(toggle).toBeDefined();
    const previewId = toggle!.getAttribute("aria-controls");
    expect(previewId).toBeTruthy();
    const sourcePreview = canvasElement.ownerDocument.getElementById(
      previewId!,
    );
    expect(sourcePreview).not.toBeNull();
    expect(sourcePreview).toHaveAttribute("hidden");
    await userEvent.click(toggle!);
    expect(sourcePreview!.id).toBe(previewId);
    await waitFor(() => {
      expect(sourcePreview).not.toHaveAttribute("hidden");
    });
    expect(
      cardsCanvas.getByRole("region", { name: "Source hunk preview" }).id,
    ).toBe(previewId);
    await userEvent.click(
      cardsCanvas.getByRole("button", { name: /Hide source hunk for/ }),
    );
    await waitFor(() => {
      expect(sourcePreview).toHaveAttribute("hidden");
    });
    for (const openSourceHunk of cardsCanvas.queryAllByRole("button", {
      name: /Hide source hunk for/,
    })) {
      await userEvent.click(openSourceHunk);
    }
    await waitFor(() => {
      expect(
        cardsRegion.querySelector(
          '[aria-label="Source hunk preview"]:not([hidden])',
        ),
      ).toBeNull();
    });
  },
};

export const RenderedMarkdownCodeFenceReplacement: Story = {
  tags: ["interaction"],
  args: {
    path: sampleFiles.markdown.path,
    renderKind: "markdown",
    file: sampleFiles.markdown,
    diff: fencedCodeMarkdownDiff,
    comments: [],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const cardsRegion = canvas.getByRole("region", {
      name: `Rendered Markdown change cards for ${sampleFiles.markdown.path}`,
    });
    await expect(cardsRegion).toBeVisible();

    const card = within(cardsRegion).getByRole("article", {
      name: "Changed rendered block 1-4",
    });
    await expect(card).toBeVisible();
    await expect(card).toHaveTextContent("Before · HEAD");
    await expect(card).toHaveTextContent("After · working tree");

    const panes = card.querySelectorAll<HTMLElement>(".rendered-change-pane");
    expect(panes).toHaveLength(2);
    await expect(panes[0]!).toHaveTextContent("console.log('old');");
    await expect(panes[0]!).not.toHaveTextContent("console.log('new');");
    await expect(panes[1]!).toHaveTextContent("console.log('new');");
    await expect(panes[1]!).not.toHaveTextContent("console.log('old');");

    await userEvent.click(
      within(card).getByRole("button", {
        name: "Show source hunk for Changed rendered block line 1-4",
      }),
    );
    const sourceToggle = within(card).getByRole("button", {
      name: "Hide source hunk for Changed rendered block line 1-4",
    });
    const sourceHunkId = sourceToggle.getAttribute("aria-controls");
    expect(sourceHunkId).toBeTruthy();
    const sourceHunk = canvasElement.ownerDocument.getElementById(
      sourceHunkId!,
    );
    expect(sourceHunk).not.toBeNull();
    expect(sourceHunk!.id).toBe(sourceHunkId);
    expect(
      within(card).getByRole("region", { name: "Source hunk preview" }).id,
    ).toBe(sourceHunkId);
    await expect(sourceHunk).toHaveTextContent("console.log('old');");
    await expect(sourceHunk).toHaveTextContent("console.log('new');");
  },
};

export const RenderedMarkdownRemovedComment: Story = {
  tags: ["interaction"],
  args: {
    path: sampleFiles.markdown.path,
    renderKind: "markdown",
    file: sampleFiles.markdown,
    diff: removedMarkdownDiff,
    comments: [],
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const cardsRegion = canvas.getByRole("region", {
      name: `Rendered Markdown change cards for ${sampleFiles.markdown.path}`,
    });
    await expect(cardsRegion).toBeVisible();

    const removedCard = within(cardsRegion).getByRole("article", {
      name: "Removed rendered block 8-9",
    });
    await expect(removedCard).toBeVisible();
    await expect(removedCard).toHaveTextContent("Removed · HEAD");
    await expect(removedCard).toHaveTextContent("Draft review comments");
    await expect(removedCard).toHaveTextContent(
      "Draft comments stay private until the reviewer publishes a batch.",
    );

    await userEvent.click(
      within(removedCard).getByRole("button", {
        name: "Add comment to Removed rendered block line 8-9",
      }),
    );
    fireEvent.change(canvas.getByPlaceholderText("Draft a review comment"), {
      target: {
        value: "This removed review section should keep an old-side anchor.",
      },
    });
    await userEvent.click(canvas.getByRole("button", { name: "Save draft" }));
    await expect(args.onCreateComment).toHaveBeenCalled();
    const draft = (
      args.onCreateComment as unknown as { mock: { calls: unknown[][] } }
    ).mock.calls.at(-1)?.[0];
    await expect(draft).toMatchObject({
      path: sampleFiles.markdown.path,
      viewerKind: "markdown",
      anchor: {
        surface: "diff",
        canonical: {
          path: sampleFiles.markdown.path,
          lineStart: 8,
          lineEnd: 9,
          quote:
            "## Draft review comments\nDraft comments stay private until the reviewer publishes a batch.",
        },
        diff: {
          path: sampleFiles.markdown.path,
          hunkId: "@@ -8,2 +7,0 @@",
          side: "old",
          oldLineStart: 8,
          oldLineEnd: 9,
          diffHash: "diff-markdown-removed-42",
        },
      },
    });
  },
};

export const RenderedHtmlComment: Story = {
  tags: ["interaction"],
  args: {
    path: sampleFiles.html.path,
    renderKind: "html",
    file: sampleFiles.html,
    diff: htmlDiff,
    comments: commentsForPath(sampleFiles.html.path),
    activeCommentId: "comment-html-rendered",
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const cardsRegion = canvas.getByRole("region", {
      name: `Rendered HTML change cards for ${sampleFiles.html.path}`,
    });
    await expect(cardsRegion).toBeVisible();
    const changedCard = within(cardsRegion).getByRole("article", {
      name: "Changed rendered block 6-7",
    });
    await expect(changedCard).toBeVisible();
    await expect(
      within(changedCard).getByRole("article", {
        name: "Comment thread for line 7",
      }),
    ).toBeVisible();
    await expect(changedCard).toHaveTextContent(
      "HTML rendered comments should be visible as source-mapped review metadata.",
    );

    await userEvent.click(
      within(changedCard).getByRole("button", {
        name: "Add comment to Changed rendered block line 6-7",
      }),
    );
    await userEvent.type(
      canvas.getByPlaceholderText("Draft a review comment"),
      "Keep the preview CTA mapped to this rendered card.",
    );
    await userEvent.click(canvas.getByRole("button", { name: "Save draft" }));
    await expect(args.onCreateComment).toHaveBeenCalled();
    const draft = (
      args.onCreateComment as unknown as { mock: { calls: unknown[][] } }
    ).mock.calls.at(-1)?.[0];
    await expect(draft).toMatchObject({
      path: sampleFiles.html.path,
      viewerKind: "html",
      anchor: {
        surface: "diff",
        canonical: {
          path: sampleFiles.html.path,
          lineStart: 6,
          lineEnd: 7,
        },
        diff: {
          path: sampleFiles.html.path,
          hunkId: "@@ -4,6 +4,7 @@",
          side: "new",
          newLineStart: 6,
          newLineEnd: 7,
          diffHash: "diff-html-42",
        },
      },
    });
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
