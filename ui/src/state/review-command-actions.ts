import type { CommentStatus, ViviComment } from "../domain/comments.js";
import type { CommandActionItem } from "./search-palette.js";
import { commentLineLabel } from "./comments.js";

const shortcutPrefix = "Cmd/Ctrl";

export interface ReviewCommandActionState {
  activeComment: ViviComment | null;
  attentionThreadCount: number;
  canToggleDiff: boolean;
  diffEnabled: boolean;
  openThreadTargetCount: number;
  reviewItemCount: number;
  unreadReviewCount: number;
}

export function reviewCommandActions({
  activeComment,
  attentionThreadCount,
  canToggleDiff,
  diffEnabled,
  openThreadTargetCount,
  reviewItemCount,
  unreadReviewCount,
}: ReviewCommandActionState): CommandActionItem[] {
  const actions: CommandActionItem[] = [];

  if (activeComment) {
    actions.push({
      id: "return-current-stop",
      label: "Return to current stop",
      detail: `${activeComment.path} · ${commentLineLabel(activeComment)}`,
      shortcut: `${shortcutPrefix} I`,
    });
    actions.push({
      id: "toggle-current-thread-status",
      label:
        activeComment.status === "open"
          ? "Resolve current stop"
          : "Reopen current stop",
      detail: `${activeComment.path} · ${commentLineLabel(activeComment)}`,
      shortcut: `${shortcutPrefix} Shift Enter`,
    });
    if (activeComment.status !== "archived") {
      actions.push({
        id: "archive-current-thread",
        label: "Archive current stop",
        detail: `${activeComment.path} · ${commentLineLabel(activeComment)}`,
        shortcut: `${shortcutPrefix} Shift Backspace`,
      });
    }
  }

  if (attentionThreadCount || openThreadTargetCount) {
    actions.push({
      id: "open-comments",
      label: attentionThreadCount
        ? "Open attention inbox"
        : "Open comments inbox",
      detail: attentionThreadCount
        ? `${attentionThreadCount} attention ${attentionThreadCount === 1 ? "thread" : "threads"}`
        : `${openThreadTargetCount} open ${openThreadTargetCount === 1 ? "thread" : "threads"}`,
      shortcut: `${shortcutPrefix} Shift C`,
    });
  }

  if (unreadReviewCount) {
    actions.push({
      id: "open-latest-unread",
      label: "Open next unseen item",
      detail: `${unreadReviewCount} unseen review ${unreadReviewCount === 1 ? "file" : "files"}`,
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
        shortcut: `${shortcutPrefix} Shift R`,
      },
    );
  }

  if (openThreadTargetCount) {
    actions.push(
      {
        id: "open-next-thread",
        label: "Next open thread",
        detail: `${openThreadTargetCount} open ${openThreadTargetCount === 1 ? "thread" : "threads"}`,
        shortcut: `${shortcutPrefix} ]`,
      },
      {
        id: "open-previous-thread",
        label: "Previous open thread",
        detail: `${openThreadTargetCount} open ${openThreadTargetCount === 1 ? "thread" : "threads"}`,
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

export type CurrentThreadLifecycleShortcut =
  | "toggle-current-thread-status"
  | "archive-current-thread";

export function currentThreadLifecycleShortcutStatus(
  activeComment: ViviComment | null,
  shortcut: CurrentThreadLifecycleShortcut,
): CommentStatus | null {
  if (!activeComment) return null;
  if (shortcut === "toggle-current-thread-status") {
    return activeComment.status === "open" ? "resolved" : "open";
  }
  if (activeComment.status === "archived") return null;
  return "archived";
}
