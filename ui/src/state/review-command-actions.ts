import type { ViviComment } from "../domain/comments.js";
import type { CommandActionItem } from "./search-palette.js";
import { commentLineLabel } from "./comments.js";

const shortcutPrefix = "Cmd/Ctrl";

export interface ReviewCommandActionState {
  activeComment: ViviComment | null;
  canToggleDiff: boolean;
  diffEnabled: boolean;
  feedbackTargetCount: number;
  reviewItemCount: number;
  unseenReviewCount: number;
}

export function reviewCommandActions({
  activeComment,
  canToggleDiff,
  diffEnabled,
  feedbackTargetCount,
  reviewItemCount,
  unseenReviewCount,
}: ReviewCommandActionState): CommandActionItem[] {
  const actions: CommandActionItem[] = [];

  if (activeComment) {
    actions.push({
      id: "return-current-stop",
      label: "Return to current thread",
      detail: `${activeComment.path} · ${commentLineLabel(activeComment)}`,
      shortcut: `${shortcutPrefix} I`,
    });
  }

  if (unseenReviewCount) {
    actions.push({
      id: "open-latest-unseen",
      label: "Open next unseen item",
      detail: `${unseenReviewCount} unseen review ${unseenReviewCount === 1 ? "file" : "files"}`,
      shortcut: `${shortcutPrefix} Shift U`,
    });
  }

  if (reviewItemCount) {
    actions.push(
      {
        id: "open-next-review",
        label: "Next review item",
        detail: `${reviewItemCount} review ${reviewItemCount === 1 ? "file" : "files"} in queue`,
        shortcut: `${shortcutPrefix} Shift J`,
      },
      {
        id: "focus-review-queue",
        label: "Focus Review Queue",
        detail: "Move keyboard focus to the right inspector queue",
      },
    );
  }

  if (feedbackTargetCount) {
    actions.push(
      {
        id: "open-next-thread",
        label: "Next feedback",
        detail: `${feedbackTargetCount} feedback ${feedbackTargetCount === 1 ? "item" : "items"}`,
        shortcut: `${shortcutPrefix} ]`,
      },
      {
        id: "open-previous-thread",
        label: "Previous feedback",
        detail: `${feedbackTargetCount} feedback ${feedbackTargetCount === 1 ? "item" : "items"}`,
        shortcut: `${shortcutPrefix} [`,
      },
    );
  }

  if (canToggleDiff) {
    actions.push({
      id: "toggle-diff",
      label: diffEnabled ? "Hide diff from HEAD" : "Show diff from HEAD",
      detail: "Toggle the active viewer diff surface",
      shortcut: `${shortcutPrefix} D`,
    });
  }

  return actions;
}
