import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fireEvent, userEvent, within } from "storybook/test";
import { DocumentReaderFacade } from "../../storybook/DocumentReaderFacade.js";
import { documentReaderFixture } from "../../storybook/fixtures/review-lab.js";

const meta = {
  title: "Documents/Reader States",
  component: DocumentReaderFacade,
  parameters: {
    layout: "fullscreen",
    a11y: { test: "error" },
  },
  args: {
    fixture: documentReaderFixture,
  },
} satisfies Meta<typeof DocumentReaderFacade>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ReadingDocument: Story = {
  args: {
    initialState: "reading",
  },
};

export const WritingComment: Story = {
  args: {
    initialState: "writing",
  },
};

export const OpenThread: Story = {
  args: {
    initialState: "thread",
  },
};

export const ChangesLens: Story = {
  args: {
    initialState: "changes",
  },
};

export const CommentAnywhereInteraction: Story = {
  tags: ["interaction"],
  args: {
    initialState: "reading",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(
      canvas.getByRole("heading", {
        name: "Review work where it is meant to be read",
      }),
    ).toBeVisible();
    await expect(
      canvas.queryByText("Changes in this document"),
    ).not.toBeInTheDocument();

    const docsButton = canvas.getByRole("button", { name: "docs" });
    const docsDirectory = docsButton.closest('[role="treeitem"]');
    await expect(docsDirectory).toHaveAttribute("aria-expanded", "true");
    await userEvent.click(docsButton);
    await expect(
      canvas.queryByText("getting-started.md", { exact: true }),
    ).not.toBeInTheDocument();
    await userEvent.click(docsButton);
    await expect(
      canvas.getByText("getting-started.md", { exact: true }),
    ).toBeVisible();

    const commentTarget = canvas.getByText(
      /A reader can comment on any heading, paragraph/,
    );

    await userEvent.click(commentTarget);
    await expect(
      canvas.queryByRole("textbox", { name: "Comment on this paragraph" }),
    ).not.toBeInTheDocument();

    await fireEvent.mouseDown(commentTarget, { clientX: 20, clientY: 10 });
    await fireEvent.mouseMove(commentTarget, { clientX: 180, clientY: 10 });
    await fireEvent.mouseUp(commentTarget, { clientX: 180, clientY: 10 });
    await expect(
      canvas.queryByRole("textbox", { name: "Comment on this paragraph" }),
    ).not.toBeInTheDocument();

    await userEvent.dblClick(commentTarget);

    const composer = canvas.getByRole("textbox", {
      name: "Comment on this paragraph",
    });
    await expect(composer).toHaveFocus();
    await userEvent.type(
      composer,
      "Keep commenting independent from Git changes.",
    );
    await userEvent.click(canvas.getByRole("button", { name: "Save comment" }));

    await expect(
      canvas.getByRole("article", { name: "Published feedback" }),
    ).toHaveTextContent("Keep commenting independent from Git changes.");

    const changesButton = canvas.getByRole("button", { name: "Changes 2" });
    await userEvent.click(changesButton);
    await expect(
      canvas.getByRole("button", { name: "Back to document" }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(canvas.getByText("Changes in this document")).toBeVisible();
  },
};
