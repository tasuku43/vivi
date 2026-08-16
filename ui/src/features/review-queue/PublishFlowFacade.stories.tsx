import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { sampleDraftComments } from "../../storybook/fixtures/review-lab.js";
import {
  PublishFlowFacade,
  publishFacadeFrameStyle,
} from "../../storybook/PublishFlowFacade.js";

const workspaceItems = [
  {
    id: "workspace-document-drafts",
    ["title"]: "18-ux-acceptance-criteria.md",
    detail: "4 comments · current document",
    count: 4,
  },
];

const documentItems = [
  {
    id: sampleDraftComments[1]!.id,
    ["title"]: "L5 · “Minimum acceptable UI”",
    detail: "fadsaf · fasf · fdasf · afa",
    count: 4,
  },
];

const meta = {
  title: "Review/Publish Flow",
  component: PublishFlowFacade,
  decorators: [
    (Story) => (
      <div style={publishFacadeFrameStyle}>
        <Story />
      </div>
    ),
  ],
  args: {
    surface: "review",
    items: workspaceItems,
    excludedInputCount: 1,
    onOpenItem: fn(),
    onResumeInput: fn(),
    onReview: fn(),
    onPublish: fn(),
    onSelectSurface: fn(),
  },
  parameters: {
    layout: "centered",
    a11y: { test: "error" },
  },
} satisfies Meta<typeof PublishFlowFacade>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WorkspaceScope: Story = {};

export const CurrentDocumentScope: Story = {
  args: {
    surface: "document",
    items: documentItems,
  },
};

export const UnifiedPublishInteraction: Story = {
  tags: ["interaction"],
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const panel = within(
      within(canvas.getByRole("region", { name: "In Review" })).getByRole(
        "region",
        { name: "Workspace ready to publish" },
      ),
    );

    await expect(
      panel.getByText("Workspace · private until published"),
    ).toBeVisible();
    await userEvent.click(
      panel.getByRole("button", { name: /index\.html · L5/ }),
    );
    await expect(args.onResumeInput).toHaveBeenCalledOnce();

    await userEvent.click(panel.getByRole("button", { name: "Review 4" }));
    await expect(args.onReview).toHaveBeenCalledOnce();

    await userEvent.click(panel.getByRole("button", { name: "Publish 4" }));
    await expect(args.onPublish).toHaveBeenCalledOnce();
  },
};
