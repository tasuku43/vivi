import { describe, expect, it } from "vitest";
import { reviewCommandActions } from "./review-command-actions.js";

describe("reviewCommandActions", () => {
  it("offers the active viewer diff toggle with the documented shortcut", () => {
    const actions = reviewCommandActions({
      activeComment: null,
      canToggleDiff: true,
      diffEnabled: false,
      feedbackTargetCount: 0,
      reviewItemCount: 0,
      unseenReviewCount: 0,
    });

    expect(actions).toEqual([
      expect.objectContaining({
        id: "toggle-diff",
        label: "Show diff from HEAD",
        shortcut: "Cmd/Ctrl D",
      }),
    ]);
  });

  it("updates the diff toggle label when diff mode is already enabled", () => {
    const actions = reviewCommandActions({
      activeComment: null,
      canToggleDiff: true,
      diffEnabled: true,
      feedbackTargetCount: 0,
      reviewItemCount: 0,
      unseenReviewCount: 0,
    });

    expect(actions).toEqual([
      expect.objectContaining({
        id: "toggle-diff",
        label: "Hide diff from HEAD",
        shortcut: "Cmd/Ctrl D",
      }),
    ]);
  });

  it("does not offer the diff toggle for files without diff support", () => {
    const actions = reviewCommandActions({
      activeComment: null,
      canToggleDiff: false,
      diffEnabled: false,
      feedbackTargetCount: 0,
      reviewItemCount: 0,
      unseenReviewCount: 0,
    });

    expect(actions).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "toggle-diff" })]),
    );
  });

  it("offers an action for unseen feedback without reply or lifecycle actions", () => {
    const actions = reviewCommandActions({
      activeComment: null,
      canToggleDiff: false,
      diffEnabled: false,
      feedbackTargetCount: 2,
      reviewItemCount: 3,
      unseenReviewCount: 1,
    });

    expect(actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "open-latest-unseen",
          label: "Open next unseen item",
          shortcut: "Cmd/Ctrl Shift U",
        }),
      ]),
    );
    expect(actions.map((action) => action.id)).not.toEqual(
      expect.arrayContaining([
        "open-in-review-reply",
        "mark-current-reviewed",
        "toggle-current-thread-status",
        "archive-current-thread",
      ]),
    );
  });
});
