import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  commentsForPath,
  htmlDiff,
  markdownDiff,
  sampleDiff,
  sampleFiles,
  sampleThreadActivities,
} from "../../storybook/fixtures/review-lab.js";
import { FileViewer } from "./components/FileViewer.js";

const meta = {
  title: "Viewers/FileViewer Shell",
  component: FileViewer,
  parameters: {
    layout: "fullscreen",
    a11y: { test: "error" },
  },
  args: {
    file: sampleFiles.code,
    allowHtmlScripts: false,
    theme: "light",
    selectedCodeRange: { start: 9, end: 12 },
    comments: commentsForPath(sampleFiles.code.path),
    threadActivities: sampleThreadActivities,
    onCodeSelectionChange: () => undefined,
    onViewerModeChange: () => undefined,
    onDiffToggle: () => undefined,
    onCreateComment: () => undefined,
    onOpenComment: () => undefined,
    onCloseComment: () => undefined,
    onCommentStatusChange: () => undefined,
  },
} satisfies Meta<typeof FileViewer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {
  args: {
    file: null,
    comments: [],
  },
};

export const CodeFile: Story = {};

export const CodeDiff: Story = {
  args: {
    diffEnabled: true,
    diff: sampleDiff,
  },
};

export const MarkdownRendered: Story = {
  args: {
    file: sampleFiles.markdown,
    viewerMode: "rendered",
    diff: markdownDiff,
    selectedCodeRange: null,
    comments: commentsForPath(sampleFiles.markdown.path),
  },
};

export const HtmlSource: Story = {
  args: {
    file: sampleFiles.html,
    viewerMode: "source",
    diff: htmlDiff,
    selectedCodeRange: null,
    comments: commentsForPath(sampleFiles.html.path),
  },
};

export const RemovedFile: Story = {
  args: {
    removed: true,
    onCloseRemoved: () => undefined,
  },
};

export const LargeTruncatedText: Story = {
  args: {
    file: {
      path: "logs/build.log",
      viewerKind: "text",
      encoding: "utf8",
      content: "Last 4KB of a large build log\n".repeat(60),
      etag: "story-large-log",
      size: 3_500_000,
      mtimeMs: Date.now(),
      truncated: true,
      maxSizeBytes: 1_000_000,
      previewBytes: 4_096,
    },
    selectedCodeRange: null,
    comments: [],
  },
};
