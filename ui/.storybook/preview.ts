import type { Preview } from "@storybook/react-vite";
import "../src/styles.css";

const preview: Preview = {
  parameters: {
    layout: "fullscreen",
    a11y: { test: "todo" },
  },
};

export default preview;
