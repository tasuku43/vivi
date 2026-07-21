import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import {
  ResumableCommentComposerFacade,
  type ResumableCommentInput,
} from "../../storybook/ResumableCommentComposerFacade.js";

const linesByPath = {
  "docs/thesis.md": [
    "# Vivi is a local reading workspace",
    "",
    "Keep the file tree as a stable spatial map.",
    "Humans review files and publish feedback when ready.",
    "",
    "The agent fetches published feedback when useful.",
    "Mermaid and HTML remain first-class viewer surfaces.",
  ],
  "docs/flow.mmd": [
    "sequenceDiagram",
    "  Human->>Vivi: Save pending drafts",
    "  Human->>Vivi: Publish",
    "  Agent->>Vivi: Fetch once when useful",
  ],
  "public/preview.html": ["<main>", "  <h1>Generated preview</h1>", "</main>"],
};

const openInputs: ResumableCommentInput[] = [
  {
    id: "input-publish-boundary",
    path: "docs/thesis.md",
    line: 4,
    body: "Publish後は必要な時にagentが一度だけ取得すればいい。",
    state: "open",
  },
  {
    id: "input-mermaid",
    path: "docs/thesis.md",
    line: 7,
    body: "Mermaidのthemeとlive refreshも安定させたい。",
    state: "open",
  },
];

const meta = {
  title: "Review/Resumable Comment Composer",
  component: ResumableCommentComposerFacade,
  parameters: {
    layout: "fullscreen",
    a11y: { test: "error" },
  },
  args: {
    tabs: ["docs/thesis.md", "docs/flow.mmd", "public/preview.html"],
    initialPath: "docs/thesis.md",
    linesByPath,
    initialInputs: openInputs,
    initialSavedDraftCount: 2,
    onPublish: fn(),
    onSave: fn(),
    onDiscard: fn(),
    onReanchor: fn(),
  },
} satisfies Meta<typeof ResumableCommentComposerFacade>;

export default meta;
type Story = StoryObj<typeof meta>;

export const MultipleInlineInputs: Story = {};

export const CollapsedInput: Story = {
  args: {
    initialInputs: [{ ...openInputs[0], state: "collapsed" }],
  },
};

export const StaleAnchor: Story = {
  args: {
    initialInputs: [{ ...openInputs[0], state: "stale" }],
  },
};

export const FileNavigationRetention: Story = {
  args: {
    initialInputs: [
      openInputs[0],
      {
        id: "input-flow",
        path: "docs/flow.mmd",
        line: 4,
        body: "取得は常駐watchではなくone-shotにする。",
        state: "collapsed",
      },
    ],
  },
};

export const ResumableInputInteraction: Story = {
  tags: ["interaction"],
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const firstInput = canvas.getByLabelText("Unsent comment text on line 4");

    await userEvent.click(canvas.getByTestId("facade-document"));
    await expect(firstInput).toBeVisible();

    await userEvent.type(firstInput, " 追記");
    await userEvent.keyboard("{Escape}");
    await expect(
      canvas.getByTestId("collapsed-input-publish-boundary"),
    ).toBeVisible();

    await userEvent.click(
      canvas.getByRole("button", { name: /Resume line 4/ }),
    );
    await expect(
      canvas.getByLabelText("Unsent comment text on line 4"),
    ).toHaveValue("Publish後は必要な時にagentが一度だけ取得すればいい。 追記");

    await userEvent.click(canvas.getByRole("tab", { name: /flow\.mmd/ }));
    await expect(
      canvas.getByRole("heading", { name: "flow.mmd" }),
    ).toBeVisible();
    await userEvent.click(canvas.getByRole("tab", { name: /thesis\.md/ }));
    await expect(
      canvas.getByLabelText("Unsent comment text on line 4"),
    ).toHaveValue("Publish後は必要な時にagentが一度だけ取得すればいい。 追記");

    await userEvent.click(
      canvas.getAllByRole("button", { name: "Save pending draft" })[0],
    );
    await expect(
      canvas.getByTestId("saved-input-publish-boundary"),
    ).toBeVisible();
    await expect(args.onSave).toHaveBeenCalled();
    await expect(
      canvas.getByRole("button", { name: "Publish 3 saved drafts" }),
    ).toBeEnabled();
  },
};

export const StaleAnchorInteraction: Story = {
  tags: ["interaction"],
  args: {
    initialInputs: [{ ...openInputs[0], state: "stale" }],
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Anchor changed")).toBeVisible();
    await expect(
      canvas.getByRole("button", { name: "Save pending draft" }),
    ).toBeDisabled();
    await userEvent.click(
      canvas.getByRole("button", { name: "Re-anchor here" }),
    );
    await expect(canvas.getByText("Line 4 · Unsent input")).toBeVisible();
    await expect(args.onReanchor).toHaveBeenCalledWith(
      "input-publish-boundary",
    );
  },
};
