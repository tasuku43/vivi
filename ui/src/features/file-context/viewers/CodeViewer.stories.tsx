import type { Meta, StoryObj } from "@storybook/react-vite";
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
    theme: "light",
    selectedRange: { start: 9, end: 12 },
    comments: commentsForPath(sampleFiles.code.path),
    threadActivities: sampleThreadActivities,
    onSelectionChange: () => undefined,
    onCreateComment: () => undefined,
    onOpenComment: () => undefined,
    onCloseComment: () => undefined,
    onCommentStatusChange: () => undefined,
    onDiffToggle: () => undefined,
  },
} satisfies Meta<typeof CodeViewer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SourceWithOpenThread: Story = {
  args: {
    activeCommentId: "comment-workbench-open-1",
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
