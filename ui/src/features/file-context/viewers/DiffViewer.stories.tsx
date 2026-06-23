import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, within } from "storybook/test";
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
  title: "Review/Diff/Diff Viewer",
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
  tags: ["interaction"],
  args: {
    activeCommentId: "comment-diff-added",
  },
  play: async ({ canvasElement }) => {
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
    await expect(
      canvas.getAllByRole("button", {
        name: /Open comment thread on line/,
      })[0],
    ).toBeInTheDocument();
  },
};

export const DiffCommentOnRemovedLine: Story = {
  args: {
    activeCommentId: "comment-diff-removed",
  },
};

export const RenderedMarkdownComment: Story = {
  args: {
    path: sampleFiles.markdown.path,
    renderKind: "markdown",
    file: sampleFiles.markdown,
    diff: markdownDiff,
    comments: commentsForPath(sampleFiles.markdown.path),
    activeCommentId: "comment-md-rendered",
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
