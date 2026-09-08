import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import {
  deletionFeedback,
  PublishedCommentDeletionFacade,
} from "../../storybook/PublishedCommentDeletionFacade.js";

const meta = {
  title: "Review/Published Comment Deletion",
  component: PublishedCommentDeletionFacade,
  parameters: { layout: "centered", a11y: { test: "error" } },
  args: { comments: [deletionFeedback], onDeleteRequest: fn() },
} satisfies Meta<typeof PublishedCommentDeletionFacade>;
export default meta;
type Story = StoryObj<typeof meta>;

async function confirmFirstComment(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await userEvent.click(
    canvas.getByRole("button", { name: "Delete published comment 1" }),
  );
  await expect(canvas.getByRole("button", { name: "Cancel" })).toHaveFocus();
  await expect(canvas.getByText(deletionFeedback.body)).toBeVisible();
  return canvas;
}

export const Unseen: Story = {};

export const Confirmation: Story = {
  tags: ["interaction"],
  play: async ({ canvasElement }) => {
    await confirmFirstComment(canvasElement);
  },
};

export const DeleteLastUnseen: Story = {
  tags: ["interaction"],
  play: async ({ canvasElement, args }) => {
    const canvas = await confirmFirstComment(canvasElement);
    await userEvent.keyboard("{Escape}");
    const trigger = canvas.getByRole("button", {
      name: "Delete published comment 1",
    });
    await expect(trigger).toHaveFocus();
    await expect(
      canvas.queryByRole("group", { name: "Delete this comment?" }),
    ).toBeNull();
    await expect(args.onDeleteRequest).not.toHaveBeenCalled();
    await userEvent.keyboard("{Enter}");
    await userEvent.click(canvas.getByRole("button", { name: "Cancel" }));
    await expect(trigger).toHaveFocus();
    await userEvent.keyboard("{Enter}{Tab}{Enter}");
    await expect(args.onDeleteRequest).toHaveBeenCalledWith(
      deletionFeedback.id,
    );
    await expect(canvas.getByRole("status")).toHaveTextContent(
      "Comment deleted.",
    );
    await expect(canvas.queryByText(deletionFeedback.body)).toBeNull();
    await expect(canvas.getByText("No feedback to review")).toBeVisible();
    await expect(
      canvas.getByRole("heading", { name: "A quiet place to read" }),
    ).toHaveFocus();
  },
};

export const Deleting: Story = {
  tags: ["interaction"],
  args: { outcome: "pending" },
  play: async ({ canvasElement, args }) => {
    const canvas = await confirmFirstComment(canvasElement);
    await userEvent.click(
      canvas.getByRole("button", { name: "Delete comment" }),
    );
    await expect(canvas.getByRole("button", { name: "Cancel" })).toBeDisabled();
    await expect(
      canvas.getByRole("button", { name: "Delete published comment 1" }),
    ).toBeDisabled();
    await expect(
      canvas.getByRole("button", { name: "Deleting…" }),
    ).toBeDisabled();
    await userEvent.keyboard("{Escape}");
    await expect(
      canvas.getByRole("group", { name: "Delete this comment?" }),
    ).toBeVisible();
    await expect(canvas.getByText(deletionFeedback.body)).toBeVisible();
    await expect(args.onDeleteRequest).toHaveBeenCalledTimes(1);
  },
};

export const DeleteFailure: Story = {
  tags: ["interaction"],
  args: { outcome: "fail-once" },
  play: async ({ canvasElement }) => {
    const canvas = await confirmFirstComment(canvasElement);
    await userEvent.click(
      canvas.getByRole("button", { name: "Delete comment" }),
    );
    await expect(canvas.getByRole("alert")).toHaveTextContent(
      "Couldn’t delete this comment. Try again.",
    );
    await expect(canvas.getByText(deletionFeedback.body)).toBeVisible();
    await expect(
      canvas.getByRole("button", { name: "Try again" }),
    ).toBeEnabled();
    await expect(
      within(canvas.getByRole("region", { name: "Feedback" })).getByText(
        "Unseen",
      ),
    ).toBeVisible();
  },
};

export const RetryAfterFailure: Story = {
  tags: ["interaction"],
  args: { outcome: "fail-once" },
  play: async ({ canvasElement, args }) => {
    const canvas = await confirmFirstComment(canvasElement);
    await userEvent.click(
      canvas.getByRole("button", { name: "Delete comment" }),
    );
    await expect(canvas.getByRole("alert")).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Try again" }));
    await expect(canvas.getByRole("status")).toHaveTextContent(
      "Comment deleted.",
    );
    await expect(args.onDeleteRequest).toHaveBeenCalledTimes(2);
    await expect(canvas.queryByText(deletionFeedback.body)).toBeNull();
  },
};

export const OtherUnseenRemains: Story = {
  tags: ["interaction"],
  args: {
    comments: [
      deletionFeedback,
      {
        ...deletionFeedback,
        id: "published-feedback-2",
        body: "Keep the example near the introduction.",
      },
    ],
  },
  play: async ({ canvasElement, args }) => {
    const canvas = await confirmFirstComment(canvasElement);
    await userEvent.click(
      canvas.getByRole("button", { name: "Delete comment" }),
    );
    await expect(canvas.queryByText(deletionFeedback.body)).toBeNull();
    await expect(
      canvas.getByText("Keep the example near the introduction."),
    ).toBeVisible();
    await expect(
      within(canvas.getByRole("region", { name: "Feedback" })).getByText(
        "Unseen",
      ),
    ).toBeVisible();
    await expect(
      canvas.getByRole("article", { name: "Comment thread for line 3" }),
    ).toHaveFocus();
    await expect(args.onDeleteRequest).toHaveBeenCalledWith(
      deletionFeedback.id,
    );
  },
};

export const PendingDraftRemains: Story = {
  tags: ["interaction"],
  args: { pendingDraftCount: 1 },
  play: async ({ canvasElement }) => {
    const canvas = await confirmFirstComment(canvasElement);
    await userEvent.click(
      canvas.getByRole("button", { name: "Delete comment" }),
    );
    await expect(canvas.getByRole("status")).toHaveTextContent(
      "Comment deleted.",
    );
    await expect(canvas.getByText("Pending draft")).toBeVisible();
    await expect(canvas.queryByText("Unseen")).toBeNull();
  },
};

export const MovesToRecent: Story = {
  tags: ["interaction"],
  args: { recent: true },
  play: async ({ canvasElement }) => {
    const canvas = await confirmFirstComment(canvasElement);
    await userEvent.click(
      canvas.getByRole("button", { name: "Delete comment" }),
    );
    await expect(canvas.getByText("No feedback to review")).toBeVisible();
    await expect(
      within(canvas.getByRole("region", { name: "Recent" })).getByText(
        "Opened · 2m ago",
      ),
    ).toBeVisible();
  },
};

export const SeenComment: Story = {
  tags: ["interaction"],
  args: { seen: true, recent: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Seen", { exact: true })).toBeVisible();
    await confirmFirstComment(canvasElement);
  },
};
