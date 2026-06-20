import type { Meta, StoryObj } from "@storybook/react-vite";
import { CommandPalette } from "./CommandPalette.js";

const meta = {
  title: "Commands/CommandPalette",
  component: CommandPalette,
  args: {
    open: true,
    mode: "file",
    query: "read",
    fileResults: [
      {
        path: "README.md",
        name: "README.md",
        viewerKind: "markdown",
        score: 1,
      },
    ],
    fileLoading: false,
    textResults: [],
    textLoading: false,
    onQueryChange: () => undefined,
    onModeChange: () => undefined,
    onClose: () => undefined,
    onOpenPath: () => undefined,
  },
} satisfies Meta<typeof CommandPalette>;

export default meta;
type Story = StoryObj<typeof meta>;

export const QuickOpen: Story = {};
