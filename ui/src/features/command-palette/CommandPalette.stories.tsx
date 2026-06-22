import type { Meta, StoryObj } from "@storybook/react-vite";
import { sampleFiles } from "../../storybook/fixtures/review-lab.js";
import { CommandPalette } from "./CommandPalette.js";

const meta = {
  title: "Navigation/Command Palette",
  component: CommandPalette,
  parameters: {
    layout: "fullscreen",
    a11y: { test: "error" },
  },
  args: {
    open: true,
    mode: "file",
    query: "review",
    fileResults: [
      {
        path: sampleFiles.markdown.path,
        name: "product-review.md",
        viewerKind: "markdown",
        score: 1,
      },
      {
        path: sampleFiles.code.path,
        name: "WorkbenchContainer.tsx",
        viewerKind: "code",
        score: 0.92,
      },
      {
        path: sampleFiles.html.path,
        name: "review-preview.html",
        viewerKind: "html",
        score: 0.8,
      },
    ],
    fileLoading: false,
    textResults: [
      {
        path: sampleFiles.markdown.path,
        viewerKind: "markdown",
        lineNumber: 7,
        lineText:
          "Comment threads are the shared contract between the browser UI and coding agents.",
        matchStart: 0,
        matchLength: 15,
      },
    ],
    textLoading: false,
    actions: [],
    onQueryChange: () => undefined,
    onModeChange: () => undefined,
    onClose: () => undefined,
    onOpenPath: () => undefined,
    onRunAction: () => undefined,
  },
} satisfies Meta<typeof CommandPalette>;

export default meta;
type Story = StoryObj<typeof meta>;

export const QuickOpen: Story = {};

export const TextSearch: Story = {
  args: {
    mode: "text",
    query: "comment threads",
  },
};

export const Actions: Story = {
  args: {
    mode: "action",
    query: "review",
    actions: [
      {
        id: "next-open-thread",
        label: "Next open thread",
        detail: "Move to the next unresolved thread across review files",
        shortcut: "Cmd/Ctrl ]",
      },
      {
        id: "focus-review-queue",
        label: "Focus Review Queue",
        detail: "Move keyboard focus to the inspector work list",
        shortcut: "Cmd/Ctrl Shift R",
      },
      {
        id: "publish-drafts",
        label: "Publish draft review comments",
        detail: "Create a PublishedReviewBatch from unpublished drafts",
        shortcut: "Cmd/Ctrl Enter",
      },
    ],
  },
};

export const Loading: Story = {
  args: {
    fileResults: [],
    fileLoading: true,
    query: "workbench",
  },
};

export const Empty: Story = {
  args: {
    fileResults: [],
    textResults: [],
    actions: [],
    query: "missing",
  },
};
