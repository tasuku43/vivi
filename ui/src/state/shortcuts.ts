export type KeyboardShortcutAction =
  | "quick-open"
  | "search-text"
  | "toggle-diff"
  | "toggle-comments"
  | "open-latest-unread"
  | "open-next-review"
  | "open-previous-review"
  | "close-active-tab"
  | "toggle-shortcuts"
  | "dismiss-overlays";

export interface ShortcutKeyEvent {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey?: boolean;
}

export function keyboardShortcutAction(
  event: ShortcutKeyEvent,
): KeyboardShortcutAction | null {
  if (event.key === "Escape") return "dismiss-overlays";

  const commandKey = event.metaKey || event.ctrlKey;
  if (!commandKey || event.altKey) return null;

  const key = event.key.toLowerCase();
  if (!event.shiftKey && key === "k") return "quick-open";
  if (event.shiftKey && key === "f") return "search-text";
  if (event.shiftKey && key === "c") return "toggle-comments";
  if (!event.shiftKey && key === "d") return "toggle-diff";
  if (event.shiftKey && key === "u") return "open-latest-unread";
  if (event.shiftKey && key === "j") return "open-next-review";
  if (event.shiftKey && key === "k") return "open-previous-review";
  if (!event.shiftKey && key === "w") return "close-active-tab";
  if (!event.shiftKey && key === "/") return "toggle-shortcuts";

  return null;
}
