import type { Meta, StoryObj } from "@storybook/react-vite";
import { FileViewer } from "./components/FileViewer.js";

const meta = {
  title: "File Context/FileContextPane",
  component: FileViewer,
  args: {
    file: {
      path: "notes.txt",
      viewerKind: "text",
      encoding: "utf8",
      content: "A transport-independent file context.\n",
      etag: "story-etag",
      size: 38,
      mtimeMs: 0,
    },
    allowHtmlScripts: false,
    theme: "light",
    selectedCodeRange: null,
    onCodeSelectionChange: () => undefined,
  },
} satisfies Meta<typeof FileViewer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const TextFile: Story = {};
