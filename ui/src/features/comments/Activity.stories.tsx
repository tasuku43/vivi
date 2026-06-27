import type { Meta, StoryObj } from "@storybook/react-vite";
import { activityLabel } from "../../state/comment-activity.js";
import {
  sampleActivityEvents,
  sampleComments,
  sampleThreadActivities,
  storyNow,
} from "../../storybook/fixtures/review-lab.js";
import { CommentsPanel } from "./components/CommentsPanel.js";

const meta = {
  title: "Review/Activity States",
  parameters: {
    layout: "fullscreen",
    a11y: { test: "error" },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const ActivityIndicatorList: Story = {
  render: () => (
    <section style={{ padding: 24 }}>
      <div className="panel-title">
        <span>Activity</span>
        <span className="pill active">watch</span>
      </div>
      <div className="comment-activity-timeline inspector-timeline">
        <ol>
          {sampleActivityEvents.map((event) => (
            <li key={event.id}>{activityLabel(event, storyNow)}</li>
          ))}
        </ol>
      </div>
    </section>
  ),
};

export const UnreadActivityPresent: Story = {
  render: () => (
    <CommentsPanel
      open
      comments={sampleComments}
      query=""
      statusFilter="all"
      threadActivities={sampleThreadActivities}
      onQueryChange={() => undefined}
      onStatusFilterChange={() => undefined}
      onClose={() => undefined}
      onOpenComment={() => undefined}
    />
  ),
};

export const CommentsWatchDisconnected: Story = {
  render: () => (
    <section style={{ padding: 24 }}>
      <div className="panel-title">
        <span>Activity</span>
        <span className="pill active">offline</span>
      </div>
      <p className="muted compact-empty">
        Comment activity subscription disconnected; showing last known thread
        states.
      </p>
    </section>
  ),
};
