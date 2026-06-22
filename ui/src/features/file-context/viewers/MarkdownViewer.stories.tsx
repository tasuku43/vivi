import type { Meta, StoryObj } from "@storybook/react-vite";
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
    onModeChange: () => undefined,
    onDiffToggle: () => undefined,
    onCreateComment: () => undefined,
    onOpenComment: () => undefined,
    onCloseComment: () => undefined,
    onCommentStatusChange: () => undefined,
  },
} satisfies Meta<typeof MarkdownViewer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const RenderedMarkdownComment: Story = {
  args: {
    mode: "rendered",
    activeCommentId: "comment-md-rendered",
  },
};

export const SourceMarkdownComment: Story = {
  args: {
    mode: "source",
    activeCommentId: "comment-md-rendered",
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
