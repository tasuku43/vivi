import { createElement } from "react";
import type { Preview } from "@storybook/react-vite";
import "../src/styles.css";
import sharedUiStyles from "../src/shared/styles/SharedUi.module.css";
import { CommentInputSessionProvider } from "../src/features/comments/CommentInputSessionProvider.js";

const preview: Preview = {
  decorators: [
    (Story) =>
      createElement(
        CommentInputSessionProvider,
        null,
        createElement(
          "div",
          { className: sharedUiStyles.sharedUiStyles },
          createElement(Story),
        ),
      ),
  ],
  parameters: {
    layout: "fullscreen",
    a11y: { test: "todo" },
    options: {
      storySort: {
        order: [
          "Design Review",
          ["Workflow"],
          "Workspace",
          ["Workbench States", "Navigation Chrome"],
          "Review",
          [
            "Activity States",
            "Comments Inbox States",
            "Diff States",
            "Draft Review States",
            "Inline Comment States",
            "Queue States",
          ],
          "Files",
          [
            "Code Review States",
            "HTML Preview States",
            "Markdown Review States",
            "Open File Surface States",
            "Viewer Coverage States",
          ],
          "Navigation",
          ["Search and Command States"],
        ],
      },
    },
  },
};

export default preview;
