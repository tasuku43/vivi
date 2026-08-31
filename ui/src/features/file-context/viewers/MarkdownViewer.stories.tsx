import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, fireEvent, fn, userEvent, waitFor, within } from "storybook/test";
import type { ViviComment } from "../../../domain/comments.js";
import {
  draftReviewCommentAsViviComment,
  type CommentDraft,
} from "../../../state/comments.js";
import type { ViewerMode } from "../../../state/viewer-mode.js";
import { useCommentInputSessions } from "../../comments/CommentInputSessionProvider.js";
import {
  commentsForPath,
  humanTasuku,
  markdownDiff,
  sampleFiles,
  sampleThreadActivities,
} from "../../../storybook/fixtures/review-lab.js";
import { MarkdownViewer } from "./MarkdownViewer.js";

const meta = {
  title: "Files/Markdown Review States",
  component: MarkdownViewer,
  parameters: {
    layout: "fullscreen",
    a11y: { test: "error" },
  },
  args: {
    file: sampleFiles.markdown,
    theme: "light",
    comments: commentsForPath(sampleFiles.markdown.path),
    threadActivities: sampleThreadActivities,
    onModeChange: fn(),
    onDiffToggle: fn(),
    onCreateComment: fn(),
    onOpenComment: fn(),
    onCloseComment: fn(),
    onOpenPath: fn(),
  },
} satisfies Meta<typeof MarkdownViewer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const RenderedMarkdownComment: Story = {
  tags: ["interaction"],
  args: {
    mode: "rendered",
    activeCommentId: "comment-md-rendered",
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("heading", { name: "Review Surface" }),
    ).toBeInTheDocument();
    const sourceMode = canvasElement.querySelector<HTMLButtonElement>(
      `[data-testid="viewer-mode-option"][data-viewer-mode="source"][data-viewer-path="${sampleFiles.markdown.path}"]`,
    );
    await expect(sourceMode).toBeInTheDocument();
    await expect(sourceMode).toHaveAttribute("data-active", "false");
    await userEvent.click(sourceMode!);
    await expect(args.onModeChange).toHaveBeenCalledWith("source");
    const diffToggle = canvasElement.querySelector<HTMLButtonElement>(
      `[data-testid="viewer-diff-toggle"][data-viewer-path="${sampleFiles.markdown.path}"]`,
    );
    await expect(diffToggle).toBeInTheDocument();
    await expect(diffToggle).toHaveAttribute("data-diff-enabled", "false");
    await userEvent.click(diffToggle!);
    await expect(args.onDiffToggle).toHaveBeenCalled();
  },
};

export const SourceMarkdownComment: Story = {
  args: {
    mode: "source",
    activeCommentId: "comment-md-rendered",
  },
};

export const RenderedShowsSourceInputReturn: Story = {
  name: "Rendered mode keeps Source input visible",
  tags: ["interaction"],
  render: () => <SourceInputReturnHarness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole("button", { name: "Add comment on line 3" }),
    );
    const composer = canvas.getByRole("textbox", {
      name: "New line comment",
    });
    await userEvent.type(composer, "Keep this visible from Rendered mode");
    await userEvent.click(canvas.getByRole("button", { name: "Rendered" }));

    const returnButton = canvas.getByRole("button", {
      name: "Return to Source, 1 input in progress",
    });
    await expect(returnButton).toBeVisible();
    await userEvent.click(returnButton);
    await expect(
      canvas.getByRole("textbox", { name: "New line comment" }),
    ).toHaveValue("Keep this visible from Rendered mode");
    await userEvent.click(canvas.getByRole("button", { name: "Rendered" }));
    await expect(
      canvas.getByRole("button", {
        name: "Return to Source, 1 input in progress",
      }),
    ).toBeVisible();
  },
};

export const RenderedBlockClickDraft: Story = {
  name: "Rendered Markdown starts a draft only on double-click",
  tags: ["interaction"],
  args: {
    mode: "rendered",
    comments: [],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const heading = canvas.getByRole("heading", { name: "Review Surface" });
    await expect(heading).toHaveClass("vivi-rendered-comment-block");

    await clickRenderedBlock(heading);
    await expect(canvas.queryByLabelText("New line comment")).toBeNull();
    await expect(heading).not.toHaveClass("drafting-rendered-comment");

    await fireEvent.mouseDown(heading, { clientX: 20, clientY: 10 });
    await fireEvent.mouseMove(heading, { clientX: 160, clientY: 10 });
    await fireEvent.mouseUp(heading, { clientX: 160, clientY: 10 });
    await expect(canvas.queryByLabelText("New line comment")).toBeNull();

    await doubleClickRenderedBlock(heading);
    await expect(canvas.getByLabelText("New line comment")).toBeInTheDocument();
    await expect(heading).toHaveClass("drafting-rendered-comment");
  },
};

export const RenderedCommentMarkerOpensFeedback: Story = {
  name: "Rendered Markdown marker opens existing feedback",
  tags: ["interaction"],
  args: {
    mode: "rendered",
    comments: commentsForPath(sampleFiles.markdown.path),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const commentedText = canvas.getByText(
      /Comment threads are the shared contract/,
    );
    const commentedBlock = commentedText.closest(
      ".vivi-rendered-comment-block",
    )!;
    const marker = within(commentedBlock as HTMLElement).getByRole("button", {
      name: /Open comment thread/,
    });
    await userEvent.click(marker);

    await expect(canvas.queryByRole("textbox")).not.toBeInTheDocument();
    await expect(
      canvas.getByText(/This sentence captures the feedback layer/),
    ).toBeVisible();
  },
};

export const RenderedPublishedFeedbackHasNoResponseComposer: Story = {
  name: "Rendered Markdown published feedback has no response composer",
  tags: ["interaction"],
  args: {
    mode: "rendered",
    comments: commentsForPath(sampleFiles.markdown.path),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const commentedText = canvas.getByText(
      /Comment threads are the shared contract/,
    );

    await clickRenderedBlock(commentedText);
    const existingThread = canvas.getByRole("article", {
      name: "Comment thread for line 7",
    });
    await expect(
      within(existingThread).getByText(/feedback layer well/),
    ).toBeVisible();

    await expect(
      canvas.getAllByRole("article", {
        name: "Comment thread for line 7",
      }),
    ).toHaveLength(1);
    await expect(
      within(existingThread).queryByRole("button", {
        name: "Start separate thread",
      }),
    ).not.toBeInTheDocument();
    await expect(canvas.queryByLabelText("New line comment")).toBeNull();
    await expect(canvas.queryByRole("textbox")).not.toBeInTheDocument();
  },
};

export const RenderedSameAnchorStartsNewFeedback: Story = {
  name: "Rendered Markdown same-anchor selection starts new feedback",
  tags: ["interaction"],
  args: {
    mode: "rendered",
    file: {
      ...sampleFiles.markdown,
      path: "AGENTS.md",
      content: ["# Agent instructions", "", "Body text."].join("\n"),
    },
    comments: [
      {
        id: "comment-agents-l1-root",
        threadId: "thread-agents-l1",
        path: "AGENTS.md",
        viewerKind: "markdown",
        body: "First L1 note.",
        status: "open",
        source: "human",
        createdBy: humanTasuku,
        createdAt: "2026-07-02T01:00:00.000Z",
        updatedAt: "2026-07-02T01:00:00.000Z",
        anchor: {
          surface: "rendered",
          canonical: {
            path: "AGENTS.md",
            lineStart: 1,
            lineEnd: 1,
            quote: "# Agent instructions",
            fileHash: sampleFiles.markdown.etag,
          },
          rendered: {
            kind: "markdown",
            blockId: "vivi-block-1",
            selector: "#agent",
            textQuote: "Agent",
            sourceLineStart: 1,
            sourceLineEnd: 1,
          },
        },
      },
      draftReviewCommentAsViviComment({
        id: "source-draft-agents-l1",
        threadId: "draft-thread:source-agents-l1",
        path: "AGENTS.md",
        viewerKind: "markdown",
        body: "A pending Source note on the same line.",
        source: "human",
        createdBy: humanTasuku,
        createdAt: "2026-07-02T01:05:00.000Z",
        updatedAt: "2026-07-02T01:05:00.000Z",
        anchor: {
          surface: "source",
          canonical: {
            path: "AGENTS.md",
            lineStart: 1,
            lineEnd: 1,
            quote: "# Agent instructions",
            fileHash: sampleFiles.markdown.etag,
          },
        },
      }),
    ],
    onCreateComment: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const heading = canvas.getByRole("heading", {
      name: "Agent instructions",
    });
    await doubleClickRenderedBlock(heading);

    const composer = canvas.getByLabelText("New line comment");
    await userEvent.type(composer, "A separate note on the same heading.");
    await userEvent.click(
      canvas.getByRole("button", { name: "Save pending draft comment" }),
    );

    await expect(args.onCreateComment).toHaveBeenCalledTimes(1);
    const calls = (
      args.onCreateComment as unknown as {
        mock: { calls: Array<[CommentDraft, string]> };
      }
    ).mock.calls;
    await expect(calls[0]?.[0].threadId).toBeUndefined();
    await expect(calls[0]?.[1]).toBe("A separate note on the same heading.");
  },
};

const renderedMarkdownComment = commentsForPath(sampleFiles.markdown.path).find(
  (comment) => comment.id === "comment-md-rendered",
)!;

export const RenderedLegacyResolvedFeedback: Story = {
  name: "Rendered Markdown ignores legacy resolved status",
  tags: ["interaction"],
  args: {
    mode: "rendered",
    activeCommentId: "comment-md-rendered",
    comments: [
      {
        ...renderedMarkdownComment,
        status: "resolved",
        resolvedAt: "2026-06-25T09:15:00.000Z",
        updatedAt: "2026-06-25T09:15:00.000Z",
      },
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const commentedText = canvas.getByText(
      /Comment threads are the shared contract/,
    );
    const commentedBlock = commentedText.closest(
      ".vivi-rendered-comment-block",
    ) as HTMLElement;
    await expect(commentedBlock).toHaveClass("has-rendered-comment");

    await clickRenderedBlock(commentedText);

    const thread = canvas.getByRole("article", {
      name: "Comment thread for line 7",
    });
    await expect(thread).toBeVisible();
    await expect(within(thread).getAllByText("Published")[0]).toBeVisible();
    await expect(
      within(thread).queryByText("Resolved"),
    ).not.toBeInTheDocument();
    await expect(canvas.queryByRole("textbox")).not.toBeInTheDocument();
  },
};

export const RenderedLegacyArchivedFeedback: Story = {
  name: "Rendered Markdown ignores legacy archived status",
  tags: ["interaction"],
  args: {
    mode: "rendered",
    comments: [
      {
        ...renderedMarkdownComment,
        status: "archived",
        archivedAt: "2026-06-25T09:15:00.000Z",
        updatedAt: "2026-06-25T09:15:00.000Z",
      },
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const commentedText = canvas.getByText(
      /Comment threads are the shared contract/,
    );
    const commentedBlock = commentedText.closest(
      ".vivi-rendered-comment-block",
    ) as HTMLElement;

    await expect(commentedBlock).toHaveClass("has-rendered-comment");
    await expect(
      within(commentedBlock).getByRole("button", {
        name: /Open comment thread/,
      }),
    ).toBeVisible();

    await clickRenderedBlock(commentedText);
    await expect(
      canvas.getByRole("article", {
        name: "Comment thread for line 7",
      }),
    ).toBeVisible();
    await expect(canvas.queryByText("Archived")).not.toBeInTheDocument();
  },
};

export const RenderedMarkdownWorkspaceLink: Story = {
  tags: ["interaction"],
  args: {
    mode: "rendered",
    file: {
      ...sampleFiles.markdown,
      content: [
        "# Review Surface",
        "",
        "Read the [review queue](review-queue.md) next.",
        "",
      ].join("\n"),
    },
    comments: [],
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("link", { name: "review queue" }));
    await expect(args.onOpenPath).toHaveBeenCalledWith("docs/review-queue.md");
    await expect(canvas.queryByLabelText("New line comment")).toBeNull();
  },
};

const markdownSyntaxGallery = [
  "---",
  "title: Markdown Pattern Gallery",
  "owner: docs-team",
  "tags:",
  "  - markdown",
  "  - visual-regression",
  "release: 2026-06-30",
  "published: true",
  "---",
  "",
  "# Markdown Pattern Gallery",
  "",
  "A broad rendered Markdown sample keeps common document shapes visible in Storybook: **strong text**, _emphasis_, `inline code`, workspace links, and long identifiers like `workspace.preview.pipeline.table.regression.case.identifier`.",
  "",
  "## Lists and Tasks",
  "",
  "- [x] Preserve the sidebar as the stable map.",
  "- [ ] Keep the reader comfortable during dense review sessions.",
  "  - Nested bullets should align under the parent text.",
  "  - A second nested item checks compact row spacing.",
  "1. Ordered items keep their counter alignment.",
  "2. Multiline ordered items wrap without crossing the marker column and keep enough leading for scanning.",
  "",
  "## Dense Table",
  "",
  "| Area | Owner | Status | Latency | Risk | Notes |",
  "| :--- | :--- | :---: | ---: | :--- | :--- |",
  "| Markdown renderer | UI platform | Ready | 2.4s | Low | Tables should scroll horizontally instead of compressing every cell. |",
  "| Storybook regression lab | Review surface | Watching | 184ms | Medium | Long identifiers such as `vivi.markdown.table.column.width.regression` should remain readable. |",
  "| Local preview server | Server | Queued | 8.0s | High | Paths outside the selected root stay refused by default. |",
  "",
  "## Quotes and Callouts",
  "",
  "> Plain blockquotes keep muted body text and enough left rule contrast.",
  "",
  "> [!WARNING]",
  "> GitHub-style alert blocks render as callouts without breaking nearby document rhythm.",
  "",
  "## Code and HTML",
  "",
  "```ts",
  'type ViewerMode = "source" | "rendered";',
  "const tableState = { scrolls: true, aligned: true };",
  "```",
  "",
  "<details open>",
  "<summary>Inline HTML disclosure</summary>",
  "<p>Raw HTML blocks stay inside the Markdown reader flow.</p>",
  "</details>",
  "",
  "## Image",
  "",
  "![Tiny preview swatch](data:image/svg+xml;base64,PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHdpZHRoPSc0MjAnIGhlaWdodD0nMTQwJyB2aWV3Qm94PScwIDAgNDIwIDE0MCc+PHJlY3Qgd2lkdGg9JzQyMCcgaGVpZ2h0PScxNDAnIGZpbGw9JyNmNmY4ZmEnLz48cmVjdCB4PScyNCcgeT0nMjQnIHdpZHRoPSczNzInIGhlaWdodD0nOTInIHJ4PSc4JyBmaWxsPScjZmZmZmZmJyBzdHJva2U9JyM5YWE0YjInLz48Y2lyY2xlIGN4PSc3MicgY3k9JzcwJyByPScyNCcgZmlsbD0nIzI1NjNlYicvPjxwYXRoIGQ9J00xMTggODhoMjEwTTExOCA1OGgyNTQnIHN0cm9rZT0nIzM3NDE1MScgc3Ryb2tlLXdpZHRoPScxMicgc3Ryb2tlLWxpbmVjYXA9J3JvdW5kJy8+PC9zdmc+)",
].join("\n");

export const RenderedMarkdownSyntaxGallery: Story = {
  name: "Rendered Markdown syntax gallery",
  tags: ["interaction"],
  args: {
    mode: "rendered",
    file: {
      ...sampleFiles.markdown,
      path: "docs/markdown-pattern-gallery.md",
      content: markdownSyntaxGallery,
    },
    comments: [],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("heading", { name: "Markdown Pattern Gallery" }),
    ).toBeInTheDocument();
    await expect(
      canvas.getByLabelText("Front matter metadata"),
    ).toBeInTheDocument();
    const frontMatterRow = canvasElement.querySelector<HTMLElement>(
      ".markdown-frontmatter-row",
    );
    await expect(frontMatterRow).toBeInTheDocument();
    await expect(getComputedStyle(frontMatterRow!).display).toBe("grid");
    await expect(
      getComputedStyle(frontMatterRow!).gridTemplateColumns,
    ).not.toBe("none");
    await expect(canvas.getByText("visual-regression")).toBeInTheDocument();
    await expect(canvas.getByText("Inline HTML disclosure")).toBeVisible();
    await expect(
      canvas.getByRole("img", { name: "Tiny preview swatch" }),
    ).toBeVisible();

    const tableWrap = canvasElement.querySelector<HTMLElement>(
      ".markdown-table-wrap",
    );
    await expect(tableWrap).toBeInTheDocument();
    const table = tableWrap!.querySelector("table");
    await expect(table).toBeInTheDocument();
    const markdown = canvasElement.querySelector<HTMLElement>(".markdown");
    await expect(markdown).toBeInTheDocument();
    await expect(markdown!.getBoundingClientRect().width).toBeLessThanOrEqual(
      862,
    );
    await expect(getComputedStyle(markdown!).backgroundColor).not.toBe(
      "rgba(0, 0, 0, 0)",
    );
    await expect(tableWrap!.getBoundingClientRect().right).toBeLessThanOrEqual(
      markdown!.getBoundingClientRect().right + 1,
    );
    const pendingTask = canvas.getByLabelText("Incomplete task");
    await expect(pendingTask).toBeDisabled();
    await expect(pendingTask).toHaveAttribute("aria-readonly", "true");
    await expect(pendingTask).not.toBeChecked();
    await userEvent.click(pendingTask);
    await expect(pendingTask).not.toBeChecked();

    const statusHeader = canvas.getByRole("columnheader", {
      name: "Status",
    });
    const latencyHeader = canvas.getByRole("columnheader", {
      name: "Latency",
    });
    await expect(getComputedStyle(statusHeader).textAlign).toBe("center");
    await expect(getComputedStyle(latencyHeader).textAlign).toBe("right");
    await expect(statusHeader.getBoundingClientRect().width).toBeGreaterThan(
      120,
    );
    await expect(latencyHeader.getBoundingClientRect().width).toBeGreaterThan(
      120,
    );
  },
};

export const RenderedDraftTargetSwitchesWithoutReflow: Story = {
  name: "Rendered Markdown keeps one anchored composer without reflow",
  tags: ["interaction"],
  args: {
    mode: "rendered",
    comments: [],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await doubleClickRenderedBlock(
      canvas.getByRole("heading", { name: "Review Surface" }),
    );
    await expect(canvas.getAllByLabelText("New line comment")).toHaveLength(1);
    const paragraph = canvas.getByText(
      "Vivi keeps the human review surface close to the files that changed.",
    );
    const paragraphTop = paragraph.getBoundingClientRect().top;

    await doubleClickRenderedBlock(paragraph);

    await expect(canvas.getAllByLabelText("New line comment")).toHaveLength(1);
    await expect(paragraph).toHaveClass("drafting-rendered-comment");
    await expect(
      Math.abs(paragraph.getBoundingClientRect().top - paragraphTop),
    ).toBeLessThan(2);
    const host = canvasElement.querySelector<HTMLElement>(
      ".markdown-rendered-comment-thread-host",
    );
    await expect(host).toBeVisible();
    await expect(getComputedStyle(host!).position).toBe("fixed");
    await expect(host).toHaveAttribute("data-placement");
    await expect(
      rectanglesOverlap(
        paragraph.getBoundingClientRect(),
        host!.getBoundingClientRect(),
      ),
    ).toBe(false);
  },
};

export const RenderedResumeChoosesExactInput: Story = {
  name: "Rendered Markdown resumes the exact input",
  tags: ["interaction"],
  render: () => <ExactResumeHarness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await doubleClickRenderedBlock(
      canvas.getByRole("heading", { name: "Review Surface" }),
    );
    await userEvent.type(
      canvas.getByLabelText("New line comment"),
      "Heading thought",
    );
    await doubleClickRenderedBlock(
      canvas.getByText(
        "Vivi keeps the human review surface close to the files that changed.",
      ),
    );
    await userEvent.type(
      canvas.getByLabelText("New line comment"),
      "Paragraph thought",
    );

    await userEvent.click(
      canvas.getByRole("button", { name: "Resume Heading thought" }),
    );
    await expect(canvas.getByLabelText("New line comment")).toHaveValue(
      "Heading thought",
    );
    await expect(canvas.getByLabelText("New line comment")).toHaveFocus();

    await userEvent.click(
      canvas.getByRole("button", { name: "Resume Paragraph thought" }),
    );
    await expect(canvas.getByLabelText("New line comment")).toHaveValue(
      "Paragraph thought",
    );
    await expect(canvas.getByLabelText("New line comment")).toHaveFocus();
    await expect(canvas.getAllByLabelText("New line comment")).toHaveLength(1);
  },
};

export const RenderedListDraftSwitchDoesNotReflow: Story = {
  tags: ["interaction"],
  args: {
    mode: "rendered",
    comments: [],
    file: {
      ...sampleFiles.markdown,
      content: [
        "# Mockup roles",
        "",
        "- [`01-classic-explorer.html`]: baseline layout with sidebar tree, tabs, viewer, and status bar.",
        "- [`02-doc-reader.html`]: long-form Markdown reading model with right-side outline/inspector.",
        "- [`03-preview-lab.html`]: HTML preview and live event diagnostics exploration.",
        "- [`04-split-workbench.html`]: source/rendered split-view exploration.",
        "- [`05-command-focus.html`]: command palette and keyboard-heavy workflow exploration.",
      ].join("\n"),
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const docReader = canvas
      .getByText(/long-form Markdown reading model/)
      .closest("li")!;
    const previewLab = canvas
      .getByText(/HTML preview and live event diagnostics/)
      .closest("li")!;
    const splitWorkbench = canvas
      .getByText(/source\/rendered split-view exploration/)
      .closest("li")!;

    await doubleClickRenderedBlock(
      canvas.getByText(/long-form Markdown reading model/),
    );
    await doubleClickRenderedBlock(
      canvas.getByText(/source\/rendered split-view exploration/),
    );

    await expect(canvas.getAllByLabelText("New line comment")).toHaveLength(1);
    await expect(docReader).not.toHaveClass("drafting-rendered-comment");
    await expect(splitWorkbench).toHaveClass("drafting-rendered-comment");
    await expect(previewLab).not.toHaveClass("drafting-rendered-comment");
    await expect(
      canvasElement.querySelectorAll(".rendered-comment-range-join-after"),
    ).toHaveLength(0);
    await expect(
      docReader.style.getPropertyValue("--rendered-comment-block-bottom"),
    ).toBe("");
  },
};

const markerPlacementMarkdown = [
  "# Marker placement",
  "",
  "- marker list item keeps the badge beside the bullet line.",
  "- adjacent list item keeps a compact highlighted row.",
  "",
  "The command palette is modal and keeps a balanced paragraph highlight.",
  "",
  "```text",
  "left   : live file tree",
  "center : tabs plus active viewer",
  "right  : inspector",
  "```",
].join("\n");

const markerPlacementComments: ViviComment[] = [
  markerPlacementComment({
    id: "comment-md-list-marker",
    threadId: "thread-md-list-marker",
    lineStart: 3,
    lineEnd: 3,
    quote: "marker list item",
    body: "List marker should stay pinned to the text row.",
  }),
  markerPlacementComment({
    id: "comment-md-list-adjacent",
    threadId: "thread-md-list-adjacent",
    lineStart: 4,
    lineEnd: 4,
    quote: "adjacent list item",
    body: "Adjacent list rows should not merge into a heavy band.",
  }),
  markerPlacementComment({
    id: "comment-md-paragraph-marker",
    threadId: "thread-md-paragraph-marker",
    lineStart: 6,
    lineEnd: 6,
    quote: "command palette",
    body: "Paragraph highlights should keep the same visual weight.",
  }),
  markerPlacementComment({
    id: "comment-md-code-marker",
    threadId: "thread-md-code-marker",
    lineStart: 8,
    lineEnd: 12,
    quote: "left   : live file tree",
    body: "Code block marker should sit near the top edge.",
  }),
];

export const RenderedMarkerPlacement: Story = {
  tags: ["interaction", "snapshot-ready"],
  args: {
    mode: "rendered",
    file: {
      ...sampleFiles.markdown,
      content: markerPlacementMarkdown,
    },
    comments: markerPlacementComments,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const listItem = canvas.getByText(/marker list item/).closest("li")!;
    const adjacentListItem = canvas
      .getByText(/adjacent list item/)
      .closest("li")!;
    const paragraph = canvas.getByText(/command palette is modal/);
    const listMarker = within(listItem).getByRole("button", {
      name: /Open comment thread/,
    });
    const listTopBefore = listMarker.getBoundingClientRect().top;
    const listMetricsBefore = renderedBlockMetrics(listItem);
    const adjacentListMetrics = renderedBlockMetrics(adjacentListItem);
    const paragraphMetrics = renderedBlockMetrics(paragraph);

    await expect(listMetricsBefore.height).toBeLessThanOrEqual(40);
    await expect(adjacentListMetrics.height).toBeLessThanOrEqual(40);
    await expect(paragraphMetrics.height).toBeLessThanOrEqual(34);
    await expect(
      Math.abs(listMetricsBefore.topPadding - listMetricsBefore.bottomPadding),
    ).toBeLessThanOrEqual(6);
    await expect(renderedMarkerTextGap(listItem)).toBeGreaterThanOrEqual(10);
    await expect(
      renderedMarkerTextGap(adjacentListItem),
    ).toBeGreaterThanOrEqual(10);
    await expect(renderedMarkerTextGap(paragraph)).toBeGreaterThanOrEqual(10);

    await expect(
      getComputedStyle(listItem)
        .getPropertyValue("--rendered-comment-marker-top")
        .trim(),
    ).toBe("calc(0.85em + 1px)");

    await userEvent.click(listMarker);
    await expect(canvas.queryByRole("textbox")).not.toBeInTheDocument();
    await waitFor(() =>
      expect(
        Math.abs(
          within(listItem)
            .getByRole("button", { name: /Open comment thread/ })
            .getBoundingClientRect().top - listTopBefore,
        ),
      ).toBeLessThan(2),
    );
    const listMetricsOpen = renderedBlockMetrics(listItem);
    await expect(listMetricsOpen.bottomPadding).toBeGreaterThanOrEqual(4);
    await expect(listMetricsOpen.height).toBeLessThanOrEqual(56);
    await expect(renderedMarkerTextGap(listItem)).toBeGreaterThanOrEqual(10);

    const codeBlock = canvasElement.querySelector("pre")!;
    await expect(
      getComputedStyle(codeBlock)
        .getPropertyValue("--rendered-comment-marker-top")
        .trim(),
    ).toBe("18px");
    await expect(
      getComputedStyle(codeBlock)
        .getPropertyValue("--rendered-comment-marker-left")
        .trim(),
    ).toContain("ch");

    const codeMarker = within(codeBlock).getByRole("button", {
      name: /Open comment thread/,
    });
    const codeMarkerRect = codeMarker.getBoundingClientRect();
    const codeBlockRect = codeBlock.getBoundingClientRect();
    await expect(codeMarkerRect.left).toBeGreaterThan(codeBlockRect.left + 180);
    await expect(codeMarkerRect.right).toBeLessThan(codeBlockRect.right);
    await userEvent.click(codeMarker);
    await expect(
      canvas.getByRole("article", { name: "Comment thread for lines 8-12" }),
    ).toBeVisible();
    await expect(canvas.getByText("Lines 8-12")).toBeVisible();
    await waitFor(() =>
      expect(
        Math.abs(
          within(listItem)
            .getByRole("button", { name: /Open comment thread/ })
            .getBoundingClientRect().top - listTopBefore,
        ),
      ).toBeLessThan(2),
    );
    const listMetricsAfterCodeOpen = renderedBlockMetrics(listItem);
    await expect(listMetricsAfterCodeOpen.bottomPadding).toBeGreaterThanOrEqual(
      4,
    );
    await expect(listMetricsAfterCodeOpen.height).toBeLessThanOrEqual(56);
    canvasElement.dataset.viviSnapshotReady = "true";
  },
};

export const RenderedMarkdownMultipleLineThreads: Story = {
  name: "Rendered Markdown shows multiple current line threads",
  tags: ["current-ui-observation", "snapshot-ready"],
  args: {
    mode: "rendered",
    file: {
      ...sampleFiles.markdown,
      content: markerPlacementMarkdown,
    },
    comments: markerPlacementComments,
    activeCommentId: "comment-md-paragraph-marker",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const paragraph = canvas.getByText(/command palette is modal/);
    await expect(paragraph).toHaveClass("active-rendered-comment");
    await expect(
      canvas.getAllByRole("button", { name: /Open comment thread/ }),
    ).toHaveLength(4);
    await waitForRenderedBlockMetricsToSettle(paragraph);
    canvasElement.dataset.viviSnapshotReady = "true";
  },
};

export const RenderedMarkdownOpenThreadSwitchesToNewDraft: Story = {
  name: "Rendered Markdown switches an open thread to a new draft",
  tags: ["interaction", "current-ui-observation", "snapshot-ready"],
  args: {
    mode: "rendered",
    file: {
      ...sampleFiles.markdown,
      content: markerPlacementMarkdown,
    },
    comments: markerPlacementComments,
    activeCommentId: "comment-md-list-marker",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const listItem = canvas.getByText(/marker list item/).closest("li")!;
    await userEvent.click(
      within(listItem).getByRole("button", {
        name: /Open comment thread/,
      }),
    );
    await expect(
      canvas.getByRole("article", { name: "Comment thread for line 3" }),
    ).toBeVisible();

    await doubleClickRenderedBlock(
      canvas.getByRole("heading", { name: "Marker placement" }),
    );
    const draftComposer = canvas.getByLabelText("New line comment");
    await expect(draftComposer).toBeVisible();
    await expect(draftComposer).toHaveFocus();
    await expect(
      canvas.getByRole("article", { name: "Comment thread for line 1" }),
    ).toBeVisible();
    await expect(
      canvas.getAllByRole("article", { name: /Comment thread for line/ }),
    ).toHaveLength(1);
    await expect(
      canvas.queryByRole("article", { name: "Comment thread for line 3" }),
    ).not.toBeInTheDocument();
    await expect(
      listItem.style.getPropertyValue("--rendered-comment-block-bottom"),
    ).toBe("");
    await waitForRenderedBlockMetricsToSettle(listItem);
    await waitForRenderedSnapshotLayoutToSettle(canvasElement);
    canvasElement.dataset.viviSnapshotReady = "true";
  },
};

export const RenderedDiffMode: Story = {
  args: {
    mode: "rendered",
    diffEnabled: true,
    diff: markdownDiff,
    activeCommentId: "comment-md-rendered",
  },
};

function markerPlacementComment(input: {
  id: string;
  threadId: string;
  lineStart: number;
  lineEnd: number;
  quote: string;
  body: string;
}): ViviComment {
  return {
    id: input.id,
    threadId: input.threadId,
    path: sampleFiles.markdown.path,
    viewerKind: "markdown",
    body: input.body,
    status: "open",
    source: "human",
    createdBy: humanTasuku,
    createdAt: "2026-06-25T09:00:00.000Z",
    updatedAt: "2026-06-25T09:00:00.000Z",
    anchor: {
      surface: "source",
      canonical: {
        path: sampleFiles.markdown.path,
        lineStart: input.lineStart,
        lineEnd: input.lineEnd,
        quote: input.quote,
        fileHash: sampleFiles.markdown.etag,
      },
    },
  };
}

function renderedBlockMetrics(block: HTMLElement): {
  bottomPadding: number;
  height: number;
  topPadding: number;
} {
  const textRect = firstReadableTextRect(block);
  const blockRect = block.getBoundingClientRect();
  const beforeStyle = getComputedStyle(block, "::before");
  const beforeTop = Number.parseFloat(beforeStyle.top);
  const beforeHeight = Number.parseFloat(beforeStyle.height);
  const highlightTop = blockRect.top + beforeTop;
  const highlightBottom = blockRect.top + beforeTop + beforeHeight;
  return {
    bottomPadding: highlightBottom - textRect.bottom,
    height: beforeHeight,
    topPadding: textRect.top - highlightTop,
  };
}

function renderedMarkerTextGap(block: HTMLElement): number {
  const marker = block.querySelector<HTMLElement>(".rendered-comment-marker");
  if (!marker) return Number.POSITIVE_INFINITY;
  return (
    marker.getBoundingClientRect().left - firstReadableTextRect(block).right
  );
}

async function waitForRenderedBlockMetricsToSettle(
  block: HTMLElement,
): Promise<void> {
  let previous = renderedBlockMetricsSignature(block);
  let stableFrames = 0;
  await waitFor(
    async () => {
      await new Promise<void>((resolve) =>
        window.requestAnimationFrame(() => resolve()),
      );
      const current = renderedBlockMetricsSignature(block);
      if (current !== previous) {
        previous = current;
        stableFrames = 0;
        throw new Error("Rendered block metrics are still settling.");
      }
      stableFrames += 1;
      previous = current;
      if (stableFrames < 4) {
        throw new Error("Rendered block metrics need another stable frame.");
      }
    },
    { timeout: 1000 },
  );
}

function renderedBlockMetricsSignature(block: HTMLElement): string {
  const blockRect = block.getBoundingClientRect();
  const beforeStyle = getComputedStyle(block, "::before");
  return [
    Math.round(blockRect.top),
    Math.round(blockRect.height),
    beforeStyle.top,
    beforeStyle.height,
    beforeStyle.bottom,
    block.style.getPropertyValue("--rendered-comment-block-bottom"),
  ].join("|");
}

async function waitForRenderedSnapshotLayoutToSettle(
  root: HTMLElement,
): Promise<void> {
  let previous = renderedSnapshotLayoutSignature(root);
  let stableFrames = 0;
  await waitFor(
    async () => {
      await new Promise<void>((resolve) =>
        window.requestAnimationFrame(() => resolve()),
      );
      const current = renderedSnapshotLayoutSignature(root);
      if (current !== previous) {
        previous = current;
        stableFrames = 0;
        throw new Error("Rendered snapshot layout is still settling.");
      }
      stableFrames += 1;
      previous = current;
      if (stableFrames < 4) {
        throw new Error("Rendered snapshot layout needs another stable frame.");
      }
    },
    { timeout: 1500 },
  );
}

function renderedSnapshotLayoutSignature(root: HTMLElement): string {
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      [
        ".vivi-rendered-comment-block",
        ".rendered-comment-thread-host",
        ".rendered-comment-thread",
      ].join(","),
    ),
  )
    .map((element) => {
      const rect = element.getBoundingClientRect();
      return [
        element.localName,
        element.className,
        Math.round(rect.left),
        Math.round(rect.top),
        Math.round(rect.width),
        Math.round(rect.height),
        element.style.getPropertyValue("--rendered-comment-block-bottom"),
      ].join(":");
    })
    .join("|");
}

function clickRenderedBlock(element: Element): void {
  fireEvent.click(element);
}

function doubleClickRenderedBlock(element: Element): void {
  fireEvent.dblClick(element);
}

function rectanglesOverlap(left: DOMRect, right: DOMRect): boolean {
  return !(
    left.right <= right.left ||
    right.right <= left.left ||
    left.bottom <= right.top ||
    right.bottom <= left.top
  );
}

function SourceInputReturnHarness() {
  const [mode, setMode] = useState<ViewerMode>("source");
  return (
    <MarkdownViewer
      file={sampleFiles.markdown}
      mode={mode}
      theme="light"
      comments={[]}
      onModeChange={setMode}
      onCreateComment={fn()}
      onDiffToggle={fn()}
      onCloseComment={fn()}
      onOpenComment={fn()}
      onOpenPath={fn()}
    />
  );
}

function ExactResumeHarness() {
  const inputs = useCommentInputSessions();
  return (
    <>
      <div
        style={{ position: "fixed", left: 12, bottom: 12, zIndex: 2147483647 }}
      >
        {inputs.sessions
          .filter((session) => session.body.trim())
          .map((session) => (
            <button
              key={session.id}
              type="button"
              aria-label={`Resume ${session.body}`}
              onClick={() => inputs.resume(session.id)}
            >
              Resume
            </button>
          ))}
      </div>
      <MarkdownViewer
        file={sampleFiles.markdown}
        mode="rendered"
        theme="light"
        comments={[]}
        onCreateComment={fn()}
        onDiffToggle={fn()}
        onCloseComment={fn()}
        onOpenComment={fn()}
        onOpenPath={fn()}
      />
    </>
  );
}

function firstReadableTextRect(block: HTMLElement): DOMRect {
  for (const node of block.childNodes) {
    if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) {
      const range = document.createRange();
      range.selectNodeContents(node);
      const rect = range.getBoundingClientRect();
      return rect;
    }
  }
  return block.getBoundingClientRect();
}

export const SourceDiffMode: Story = {
  args: {
    mode: "source",
    diffEnabled: true,
    diff: markdownDiff,
  },
};
