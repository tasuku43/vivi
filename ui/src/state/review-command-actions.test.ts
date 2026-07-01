import { describe, expect, it } from "vitest";
import { reviewCommandActions } from "./review-command-actions.js";

describe("reviewCommandActions", () => {
  it("offers the active viewer diff toggle with the documented shortcut", () => {
    const actions = reviewCommandActions({
      activeComment: null,
      canMarkCurrentReviewPathReviewed: false,
      canToggleDiff: true,
      diffEnabled: false,
      inReviewReplyTargetCount: 0,
      openThreadTargetCount: 0,
      reviewItemCount: 0,
      unreadReviewCount: 0,
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
      canMarkCurrentReviewPathReviewed: false,
      canToggleDiff: true,
      diffEnabled: true,
      inReviewReplyTargetCount: 0,
      openThreadTargetCount: 0,
      reviewItemCount: 0,
      unreadReviewCount: 0,
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
      canMarkCurrentReviewPathReviewed: false,
      canToggleDiff: false,
      diffEnabled: false,
      inReviewReplyTargetCount: 0,
      openThreadTargetCount: 0,
      reviewItemCount: 0,
      unreadReviewCount: 0,
    });

    expect(actions).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "toggle-diff" })]),
    );
  });

  it("offers separate actions for unseen work and in-review replies", () => {
    const actions = reviewCommandActions({
      activeComment: null,
      canMarkCurrentReviewPathReviewed: false,
      canToggleDiff: false,
      diffEnabled: false,
      inReviewReplyTargetCount: 2,
      openThreadTargetCount: 2,
      reviewItemCount: 3,
      unreadReviewCount: 1,
    });

    expect(actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "open-latest-unread",
          label: "Open next unseen item",
          shortcut: "Cmd/Ctrl Shift U",
        }),
        expect.objectContaining({
          id: "open-in-review-reply",
          label: "Open next in-review reply",
          shortcut: "Cmd/Ctrl Shift I",
        }),
      ]),
    );
  });

  it("offers a reviewed-and-advance action only for a queued current file", () => {
    expect(
      reviewCommandActions({
        activeComment: null,
        canMarkCurrentReviewPathReviewed: true,
        canToggleDiff: false,
        diffEnabled: false,
        inReviewReplyTargetCount: 0,
        openThreadTargetCount: 0,
        reviewItemCount: 2,
        unreadReviewCount: 0,
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "mark-current-reviewed",
          label: "Mark current file reviewed",
          shortcut: "Cmd/Ctrl Shift M",
        }),
      ]),
    );

    expect(
      reviewCommandActions({
        activeComment: null,
        canMarkCurrentReviewPathReviewed: false,
        canToggleDiff: false,
        diffEnabled: false,
        inReviewReplyTargetCount: 0,
        openThreadTargetCount: 0,
        reviewItemCount: 2,
        unreadReviewCount: 0,
      }),
    ).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "mark-current-reviewed" }),
      ]),
    );
  });
});
