import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import { DraftReviewTray } from "./components/DraftReviewTray.js";
import {
  manyDraftReviewComments,
  sampleDraftComments,
  samplePublishedReviewBatch,
} from "../../storybook/fixtures/review-lab.js";

const meta = {
  title: "Review/Draft Review States",
  component: DraftReviewTray,
  parameters: {
    layout: "fullscreen",
    a11y: { test: "error" },
  },
  args: {
    drafts: sampleDraftComments,
    publishing: false,
    onOpenDraft: fn(),
    onUpdateDraft: fn(),
    onDeleteDraft: fn(),
    onPublishAll: fn(),
  },
} satisfies Meta<typeof DraftReviewTray>;

export default meta;
type Story = StoryObj<typeof meta>;

export const PublishCtaEnabled: Story = {
  tags: ["interaction"],
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("complementary", { name: "Draft review tray" }),
    ).toBeInTheDocument();
    await expect(
      canvas.getByRole("button", { name: /Publish \d+ draft comments/ }),
    ).toHaveAttribute("aria-keyshortcuts", "Meta+Shift+P Control+Shift+P");
    await userEvent.click(
      canvas.getByRole("button", { name: /Publish \d+ draft comments/ }),
    );
    await expect(args.onPublishAll).toHaveBeenCalled();
    await userEvent.click(
      canvas.getAllByRole("button", { name: /Open private draft in/ })[0]!,
    );
    await expect(args.onOpenDraft).toHaveBeenCalled();
  },
};

export const PublishingBatch: Story = {
  args: {
    publishing: true,
  },
};

export const EmptyDrafts: Story = {
  args: {
    drafts: [],
    initialOpen: true,
  },
};

export const SingleDraftComment: Story = {
  args: {
    drafts: [sampleDraftComments[0]!],
  },
};

export const MultipleDraftComments: Story = {
  args: {
    drafts: sampleDraftComments.slice(0, 3),
  },
};

export const EditingDraft: Story = {
  args: {
    drafts: [sampleDraftComments[0]!],
    initialEditingDraftId: sampleDraftComments[0]!.id,
  },
};

export const PublishCtaDisabled: Story = {
  args: {
    drafts: [],
    initialOpen: true,
  },
};

export const PublishFailure: Story = {
  args: {
    publishError: "The selected target thread is no longer open.",
  },
};

export const PublishedStateWithOpenThreads: Story = {
  args: {
    drafts: [],
    publishedBatchId: samplePublishedReviewBatch.reviewBatchId,
  },
};

export const DiffDraft: Story = {
  args: {
    drafts: sampleDraftComments.filter(
      (draft) => draft.anchor.surface === "diff",
    ),
  },
};

export const MarkdownRenderedDraft: Story = {
  args: {
    drafts: sampleDraftComments.filter(
      (draft) => draft.anchor.rendered?.kind === "markdown",
    ),
  },
};

export const HtmlRenderedDraft: Story = {
  args: {
    drafts: sampleDraftComments.filter(
      (draft) => draft.anchor.rendered?.kind === "html",
    ),
  },
};

export const ManyDrafts: Story = {
  tags: ["interaction"],
  args: {
    drafts: manyDraftReviewComments,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("complementary", { name: "Draft review tray" }),
    ).toBeInTheDocument();
    const list = canvasElement.querySelector<HTMLElement>(
      ".draft-review-list",
    );
    const panel = canvasElement.querySelector<HTMLElement>(
      ".draft-review-panel",
    );
    await expect(list).toBeInTheDocument();
    await expect(panel).toBeInTheDocument();
    expect(list!.scrollHeight).toBeGreaterThan(list!.clientHeight);
    expect(panel!.clientHeight).toBeLessThanOrEqual(
      Math.min(520, window.innerHeight - 128),
    );

    const initialScrollTop = list!.scrollTop;
    list!.scrollTop = 96;
    list!.dispatchEvent(new Event("scroll", { bubbles: true }));
    await waitFor(() => {
      expect(list!.scrollTop).toBeGreaterThan(initialScrollTop);
    });
  },
};
