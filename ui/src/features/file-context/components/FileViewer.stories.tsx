import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  commentsForPath,
  sampleFiles,
} from "../../../storybook/fixtures/review-lab.js";
import { FileViewer } from "./FileViewer.js";

const meta = {
  title: "Viewers/File Coverage/FileViewer",
  component: FileViewer,
  parameters: {
    layout: "fullscreen",
    a11y: { test: "todo" },
  },
  args: {
    file: sampleFiles.unknownText,
    allowHtmlScripts: false,
    theme: "light",
    selectedCodeRange: null,
    comments: [],
    onCodeSelectionChange: () => undefined,
    onViewerModeChange: () => undefined,
    onDiffToggle: () => undefined,
    onDiffFocusChange: () => undefined,
    onCreateComment: () => undefined,
    onOpenComment: () => undefined,
    onCloseComment: () => undefined,
    onCommentStatusChange: () => undefined,
  },
} satisfies Meta<typeof FileViewer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const UnknownTextFallback: Story = {};

export const MarkdownKnownViewer: Story = {
  args: {
    file: sampleFiles.markdown,
    viewerMode: "rendered",
    comments: commentsForPath(sampleFiles.markdown.path),
  },
};

export const HtmlKnownViewer: Story = {
  args: {
    file: sampleFiles.html,
    viewerMode: "preview",
    comments: commentsForPath(sampleFiles.html.path),
  },
};

export const JsonKnownViewer: Story = {
  args: {
    file: sampleFiles.json,
  },
};

export const CsvTableFallback: Story = {
  args: {
    file: sampleFiles.csv,
  },
};

export const MermaidKnownViewer: Story = {
  args: {
    file: sampleFiles.mermaid,
  },
};

export const ImageKnownViewer: Story = {
  args: {
    file: sampleFiles.image,
  },
};

export const BinaryMetadata: Story = {
  args: {
    file: sampleFiles.binary,
  },
};

export const LargeTextLimitedPreview: Story = {
  args: {
    file: sampleFiles.largeText,
  },
};

export const LargeBinaryMetadata: Story = {
  args: {
    file: sampleFiles.largeBinary,
  },
};
