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
    onResumeInput: fn(),
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

    const reviewTab = canvas.getByRole("tab", {
      name: "Review queue 4 items",
    });
    await expect(reviewTab).toHaveAttribute("aria-selected", "false");
    await expect(canvas.getByRole("tab", { name: "Document" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await userEvent.click(reviewTab);
    await expect(args.onOpenReviewQueue).toHaveBeenCalled();

    const readyPanel = within(
      canvas.getByRole("region", {
        name: "Current document ready to publish",
      }),
    );
    await expect(readyPanel.getByText("Ready to publish")).toBeVisible();
    await userEvent.click(
      readyPanel.getByRole("button", { name: /Review \d+/ }),
    );
    await expect(args.onOpenDraft).toHaveBeenCalled();
    await userEvent.click(
      readyPanel.getByRole("button", { name: /Publish \d+/ }),
    );
    await expect(args.onPublishDrafts).toHaveBeenCalled();

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

export const MultipleInputsRemainIndividuallyResumable: Story = {
  tags: ["interaction"],
  args: {
    unsavedInputCount: 2,
    resumableInputs: [
      {
        id: "input-review-surface",
        path: sampleFiles.markdown.path,
        location: "line 12",
      },
      {
        id: "input-publish-boundary",
        path: sampleFiles.markdown.path,
        location: "line 28",
      },
    ],
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(
      canvas.getByRole("button", {
        name: `Resume input in ${sampleFiles.markdown.path}, line 12`,
      }),
    );
    await expect(args.onResumeInput).toHaveBeenCalledWith(
      "input-review-surface",
    );

    await userEvent.click(
      canvas.getByRole("button", {
        name: `Resume input in ${sampleFiles.markdown.path}, line 28`,
      }),
    );
    await expect(args.onResumeInput).toHaveBeenCalledWith(
      "input-publish-boundary",
    );
  },
};
