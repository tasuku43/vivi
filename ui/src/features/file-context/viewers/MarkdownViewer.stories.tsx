import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import {
  commentsForPath,
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

export const RenderedDiffMode: Story = {
  args: {
    mode: "rendered",
    diffEnabled: true,
    diff: markdownDiff,
    activeCommentId: "comment-md-rendered",
  },
};

export const SourceDiffMode: Story = {
  args: {
    mode: "source",
    diffEnabled: true,
    diff: markdownDiff,
  },
};
