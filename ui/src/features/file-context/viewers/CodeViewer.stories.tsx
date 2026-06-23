import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import {
  commentsForPath,
  sampleDiff,
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
    await userEvent.click(
      canvas.getByRole("button", { name: "Diff from HEAD" }),
    );
    await expect(args.onDiffToggle).toHaveBeenCalled();
    await expect(canvas.getByText("Current scope")).toBeInTheDocument();
  },
};

export const SourceWithAgentReply: Story = {
  args: {
    activeCommentId: "comment-workbench-agent-1",
  },
};

export const DiffMode: Story = {
  args: {
    diffEnabled: true,
    diff: sampleDiff,
    activeCommentId: "comment-diff-added",
  },
};

export const LoadingHighlightFallback: Story = {
  args: {
    selectedRange: null,
    comments: [],
  },
};
