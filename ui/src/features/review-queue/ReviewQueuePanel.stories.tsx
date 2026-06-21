import type { Meta, StoryObj } from "@storybook/react-vite";
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
    reviewItems: [
      {
        path: "ui/src/app/App.tsx",
        change: {
          path: "ui/src/app/App.tsx",
          status: "modified",
          source: "git",
        },
        threadCounts: { open: 2, resolved: 1, archived: 0 },
        commentCount: 5,
        unread: true,
        latestActivity: {
          id: "activity-queue-1",
          threadId: "thread-app",
          type: "comment_added",
          actor: {
            id: "codex:run-1",
            kind: "codex",
            displayName: "Codex",
          },
          createdAt: new Date(Date.now() - 4 * 60_000).toISOString(),
        },
      },
      {
        path: "docs/agent-handoff.md",
        change: null,
        threadCounts: { open: 1, resolved: 0, archived: 0 },
        commentCount: 2,
        unread: false,
        latestActivity: {
          id: "activity-queue-2",
          threadId: "thread-handoff",
          type: "thread_read",
          actor: {
            id: "claude-code:run-2",
            kind: "claude-code",
            displayName: "Claude Code",
          },
          createdAt: new Date(Date.now() - 11 * 60_000).toISOString(),
        },
      },
      {
        path: "server/server.go",
        change: {
          path: "server/server.go",
          status: "modified",
          source: "git",
        },
        threadCounts: { open: 0, resolved: 1, archived: 0 },
        commentCount: 3,
        unread: false,
        latestActivity: {
          id: "activity-queue-3",
          threadId: "thread-server",
          type: "thread_status_changed",
          actor: {
            id: "codex:run-1",
            kind: "codex",
            displayName: "Codex",
          },
          previousStatus: "open",
          status: "resolved",
          createdAt: new Date(Date.now() - 18 * 60_000).toISOString(),
        },
      },
    ],
    reviewDiffStats: {
      "ui/src/app/App.tsx": { additions: 12, deletions: 4 },
      "server/server.go": { additions: 3, deletions: 2 },
    },
    loadingReviewDiffs: {},
    unreadReviewPaths: new Set(["ui/src/app/App.tsx"]),
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

export const AgentWorkQueue: Story = {};

export const AllSeen: Story = {
  args: {
    unreadReviewPaths: new Set(),
    reviewItems: [
      {
        path: "README.md",
        change: { path: "README.md", status: "modified", source: "git" },
        threadCounts: { open: 0, resolved: 2, archived: 1 },
        commentCount: 4,
        unread: false,
      },
      {
        path: "src/index.ts",
        change: { path: "src/index.ts", status: "added", source: "git" },
        threadCounts: { open: 0, resolved: 0, archived: 0 },
        commentCount: 0,
        unread: false,
      },
    ],
  },
};

export const ManyFiles: Story = {
  args: {
    reviewChanges: Array.from({ length: 18 }, (_, index) => ({
      path: `src/features/feature-${index + 1}.ts`,
      status: "modified" as const,
      source: "git" as const,
    })),
    reviewItems: Array.from({ length: 18 }, (_, index) => ({
      path: `src/features/feature-${index + 1}.ts`,
      change: {
        path: `src/features/feature-${index + 1}.ts`,
        status: "modified" as const,
        source: "git" as const,
      },
      threadCounts: {
        open: index < 3 ? 1 : 0,
        resolved: index % 4 === 0 ? 1 : 0,
        archived: 0,
      },
      commentCount: index < 3 ? 2 : 0,
      unread: index < 6,
    })),
  },
};
