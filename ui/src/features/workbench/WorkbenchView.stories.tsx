import type { Meta, StoryObj } from "@storybook/react-vite";
import { WorkbenchView } from "./WorkbenchView.js";

const meta = {
  title: "Workbench/WorkbenchView",
  component: WorkbenchView,
} satisfies Meta<typeof WorkbenchView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ClassicWorkspace: Story = {
  args: {
    sidebar: <div style={{ padding: 16 }}>docs / README.md</div>,
    viewer: (
      <article style={{ padding: 24 }}>
        <h1>Vivi</h1>
        <p>Local workspace preview</p>
      </article>
    ),
    inspector: <div style={{ padding: 16 }}>Review Queue · 2</div>,
  },
};
