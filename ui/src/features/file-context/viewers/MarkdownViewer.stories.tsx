import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import type { ViviComment } from "../../../domain/comments.js";
import {
  commentsForPath,
  humanTasuku,
  markdownDiff,
  sampleFiles,
  sampleThreadActivities,
} from "../../../storybook/fixtures/review-lab.js";
import { MarkdownViewer } from "./MarkdownViewer.js";

const meta = {
  title: "Viewers/Markdown/MarkdownViewer",
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
    onCommentStatusChange: fn(),
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

export const RenderedBlockClickDraft: Story = {
  tags: ["interaction"],
  args: {
    mode: "rendered",
    comments: [],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const heading = canvas.getByRole("heading", { name: "Review Surface" });
    await expect(heading).toHaveClass("vivi-rendered-comment-block");

    await userEvent.click(heading);

    await expect(canvas.getByLabelText("New line comment")).toBeInTheDocument();
    await expect(heading).toHaveClass("drafting-rendered-comment");
  },
};

export const MultipleRenderedDraftFormsStayOpen: Story = {
  tags: ["interaction"],
  args: {
    mode: "rendered",
    comments: [],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole("heading", { name: "Review Surface" }),
    );
    await expect(canvas.getAllByLabelText("New line comment")).toHaveLength(1);

    await userEvent.click(
      canvas.getByText(
        "Vivi keeps the human review surface close to the files that changed.",
      ),
    );

    await expect(canvas.getAllByLabelText("New line comment")).toHaveLength(2);
  },
};

export const RenderedListDraftFormsDoNotBridge: Story = {
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

    await userEvent.click(canvas.getByText(/long-form Markdown reading model/));
    await userEvent.click(
      canvas.getByText(/source\/rendered split-view exploration/),
    );

    await expect(canvas.getAllByLabelText("New line comment")).toHaveLength(2);
    await expect(docReader).toHaveClass("drafting-rendered-comment");
    await expect(splitWorkbench).toHaveClass("drafting-rendered-comment");
    await expect(previewLab).not.toHaveClass("drafting-rendered-comment");
    await expect(
      canvasElement.querySelectorAll(".rendered-comment-range-join-after"),
    ).toHaveLength(0);
    await waitFor(() =>
      expect(
        Number.parseFloat(
          docReader.style.getPropertyValue("--rendered-comment-block-bottom"),
        ),
      ).toBeGreaterThan(0),
    );
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
  tags: ["interaction"],
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

    await expect(listMetricsBefore.height).toBeLessThanOrEqual(34);
    await expect(adjacentListMetrics.height).toBeLessThanOrEqual(34);
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
    await expect(canvas.getByLabelText("Reply to thread")).toBeInTheDocument();
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
    await expect(listMetricsOpen.bottomPadding).toBeGreaterThanOrEqual(5);
    await expect(listMetricsOpen.height).toBeLessThanOrEqual(36);
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
    await expect(canvas.getByText("Lines 8-12")).toBeInTheDocument();
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
    await expect(
      listMetricsAfterCodeOpen.bottomPadding,
    ).toBeGreaterThanOrEqual(5);
    await expect(listMetricsAfterCodeOpen.height).toBeLessThanOrEqual(36);
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
  return marker.getBoundingClientRect().left - firstReadableTextRect(block).right;
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
