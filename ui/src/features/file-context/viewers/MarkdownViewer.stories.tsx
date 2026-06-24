import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
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
