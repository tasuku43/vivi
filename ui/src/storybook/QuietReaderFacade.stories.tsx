import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { QuietReaderFacade } from "./QuietReaderFacade.js";

const meta = {
  title: "Workspace/Quiet Reader",
  component: QuietReaderFacade,
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta<typeof QuietReaderFacade>;
export default meta;
type Story = StoryObj<typeof meta>;
export const SingleDocument: Story = {};
export const DenseTabs: Story = { args: { initial: "dense" } };
export const EmptyWorkspace: Story = { args: { initial: "empty" } };
export const SplitDocuments: Story = {
  args: { initial: "dense", split: true },
};
export const NarrowReader: Story = { args: { width: 800 } };

export const TabMenuKeyboard: Story = {
  args: { initial: "dense" },
  tags: ["interaction"],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = canvas.getByRole("button", {
      name: "Tab actions",
    });
    await userEvent.click(trigger);
    await expect(
      canvas.getByRole("menuitem", { name: "Close other tabs" }),
    ).toHaveFocus();
    await userEvent.keyboard("{End}");
    await expect(
      canvas.getByRole("menuitem", { name: "Close preview tabs" }),
    ).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    await expect(trigger).toHaveFocus();
    await expect(canvas.queryByRole("menu")).not.toBeInTheDocument();
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard("{Enter}");
    await expect(
      canvas
        .getByRole("group", { name: "Open documents" })
        .querySelectorAll("[data-document-tab]"),
    ).toHaveLength(1);
    await expect(
      canvas.getByRole("button", { name: "Open README.md" }),
    ).toHaveAttribute("aria-current", "page");
    await expect(trigger).toHaveFocus();
    await userEvent.click(trigger);
    await expect(
      canvas.getByRole("menuitem", { name: "Close other tabs" }),
    ).toBeDisabled();
    await userEvent.click(canvas.getByRole("heading", { level: 1 }));
    await expect(canvas.queryByRole("menu")).not.toBeInTheDocument();
  },
};
export const FindFirstDocument: Story = {
  args: { initial: "empty" },
  tags: ["interaction"],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const find = canvas.getByRole("button", {
      name: "Find a document",
    });
    await userEvent.click(find);
    const input = canvas.getByRole("textbox", { name: "Filename or path" });
    await expect(input).toHaveFocus();
    await userEvent.type(input, "no-such-document");
    await expect(canvas.getByText("No matching documents.")).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await expect(find).toHaveFocus();
    await userEvent.click(find);
    await userEvent.clear(input);
    await userEvent.type(input, "getting-started");
    await userEvent.keyboard("{Enter}");
    await expect(canvas.queryByRole("dialog")).not.toBeInTheDocument();
    await expect(
      canvas.getByRole("button", {
        name: "Open docs/getting-started.md",
      }),
    ).toHaveAttribute("aria-current", "page");
    await expect(canvas.getByText("1 tab open")).toBeVisible();
  },
};
export const NarrowInspectorInteraction: Story = {
  args: { width: 800 },
  tags: ["interaction"],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("complementary", { name: "Documents" }),
    ).toBeVisible();
    await expect(
      canvas.queryByRole("complementary", { name: "Review inspector" }),
    ).not.toBeInTheDocument();
    await userEvent.click(
      canvas.getByRole("button", { name: "Review queue · 2" }),
    );
    await expect(
      canvas.getByRole("complementary", { name: "Review inspector" }),
    ).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Document" }));
    await expect(
      canvas.getByRole("link", { name: "Feedback belongs to the document" }),
    ).toBeVisible();
    await userEvent.click(
      canvas.getByRole("button", { name: "Close inspector" }),
    );
    await expect(
      canvas.queryByRole("complementary", { name: "Review inspector" }),
    ).not.toBeInTheDocument();
  },
};

export const LightReader: Story = { args: { theme: "light" } };
export const CompactReader: Story = { args: { width: 520 } };
export const PreviewAndChangedTabs: Story = {
  args: { initial: "dense" },
  tags: ["interaction"],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole("button", { name: /^Open .* preview$/ }),
    );
    await userEvent.click(canvas.getByRole("button", { name: "Tab actions" }));
    await userEvent.click(
      canvas.getByRole("menuitem", { name: "Keep preview open" }),
    );
    await expect(
      canvas.queryByRole("button", { name: /^Open .* preview$/ }),
    ).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "Tab actions" }));
    await userEvent.click(
      canvas.getByRole("menuitem", { name: "Close unchanged tabs" }),
    );
    await expect(
      canvas.getByRole("button", { name: "Open docs/guides/agent-loop.md" }),
    ).toHaveAttribute("aria-current", "page");
    await expect(canvas.getByText("1 tab open")).toBeVisible();
  },
};
