import type { Meta, StoryObj } from "@storybook/react-vite";
import { summarizeThreadActivity } from "../../state/comment-activity.js";
import { Inspector } from "./Inspector.js";

const noop = () => undefined;
const meta = {
  title: "Review/ReviewQueuePanel",
  component: Inspector,
  args: {
    file: null,
    outline: [],
    reviewChanges: [
      { path: "ui/src/app/App.tsx", status: "modified", source: "git" },
      { path: "server/server.go", status: "modified", source: "git" },
    ],
    reviewDiffStats: {
      "ui/src/app/App.tsx": { additions: 12, deletions: 4 },
      "server/server.go": { additions: 3, deletions: 2 },
    },
    loadingReviewDiffs: {},
    unreadReviewPaths: new Set(["ui/src/app/App.tsx"]),
    pathActivities: {
      "ui/src/app/App.tsx": [
        summarizeThreadActivity(
          [
            {
              id: "activity-queue-1",
              threadId: "thread-app",
              type: "thread_read",
              actor: {
                id: "claude-code:run-1",
                kind: "claude-code",
                displayName: "Claude Code",
              },
              createdAt: "2026-06-20T00:00:48.000Z",
            },
          ],
          new Date("2026-06-20T00:01:00.000Z").getTime(),
        ),
      ],
    },
    selectedCodeRange: null,
    activePaneId: "main",
    onOutlineSelect: noop,
    onOpenEventPath: noop,
    onConfirmEventPath: noop,
    onOpenNextChanged: noop,
    onOpenPreviousChanged: noop,
    onOpenAllChanged: noop,
    onTargetHoverChange: noop,
    onRevealTarget: noop,
    onRevealInTree: noop,
  },
} satisfies Meta<typeof Inspector>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithChanges: Story = {};
