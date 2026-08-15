import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { buildDiffStat } from "../../state/git-review.js";
import { extractMarkdownOutline } from "../../state/outline.js";
import {
  markdownDiff,
  sampleComments,
  sampleDraftComments,
  sampleFiles,
  sampleReviewChanges,
} from "../../storybook/fixtures/review-lab.js";
import { DocumentInspector } from "./DocumentInspector.js";

const markdownComments = sampleComments.filter(
  (comment) => comment.path === sampleFiles.markdown.path,
);
const markdownChange = sampleReviewChanges.find(
  (change) => change.path === sampleFiles.markdown.path,
);

const meta = {
  title: "Documents/Inspector States",
  component: DocumentInspector,
  decorators: [
    (Story) => (
      <div style={{ width: 320, height: 760 }}>
        <Story />
      </div>
    ),
  ],
  args: {
    file: sampleFiles.markdown,
    outline: extractMarkdownOutline(sampleFiles.markdown.content),
    activeOutlineId: "review-surface",
    comments: markdownComments,
    draftComments: sampleDraftComments,
    change: markdownChange,
    diffStat: buildDiffStat(markdownDiff),
    changesVisible: false,
    onOutlineSelect: fn(),
    onOpenComment: fn(),
    onOpenDraft: fn(),
    onPublishDrafts: fn(),
    onToggleChanges: fn(),
    onOpenReviewQueue: fn(),
    reviewQueueCount: 4,
  },
  parameters: {
    layout: "centered",
    a11y: { test: "error" },
  },
} satisfies Meta<typeof DocumentInspector>;

export default meta;
type Story = StoryObj<typeof meta>;

export const CurrentDocument: Story = {};

export const DocumentNavigationInteraction: Story = {
  tags: ["interaction"],
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(
      canvas.getByRole("button", { name: /Feedback layer/ }),
    );
    await expect(args.onOutlineSelect).toHaveBeenCalledWith("feedback-layer");

    await userEvent.click(canvas.getByRole("button", { name: "Show changes" }));
    await expect(args.onToggleChanges).toHaveBeenCalled();

    await userEvent.click(
      canvas.getByRole("button", { name: "Open review queue, 4 items" }),
    );
    await expect(args.onOpenReviewQueue).toHaveBeenCalled();

    const thread = canvas.getByRole("button", {
      name: /This sentence captures the feedback layer well/,
    });
    await userEvent.click(thread);
    await expect(args.onOpenComment).toHaveBeenCalled();
  },
};

export const ChangesVisible: Story = {
  args: {
    changesVisible: true,
  },
};
