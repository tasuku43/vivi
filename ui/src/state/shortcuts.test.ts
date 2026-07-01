import { describe, expect, it } from "vitest";
import { keyboardShortcutAction, type ShortcutKeyEvent } from "./shortcuts.js";

function commandEvent(input: Partial<ShortcutKeyEvent>): ShortcutKeyEvent {
  return {
    key: "i",
    metaKey: true,
    ctrlKey: false,
    shiftKey: false,
    ...input,
  };
}

describe("keyboardShortcutAction", () => {
  it("maps Cmd/Ctrl+D to the active viewer diff toggle", () => {
    expect(keyboardShortcutAction(commandEvent({ key: "d" }))).toBe(
      "toggle-diff",
    );
    expect(keyboardShortcutAction(commandEvent({ key: "D" }))).toBe(
      "toggle-diff",
    );
  });

  it("does not let shifted or alt-modified D toggle diff mode", () => {
    expect(
      keyboardShortcutAction(commandEvent({ key: "d", shiftKey: true })),
    ).toBeNull();
    expect(
      keyboardShortcutAction(commandEvent({ key: "d", altKey: true })),
    ).toBeNull();
  });

  it("keeps Cmd/Ctrl+I focused on the current inline thread", () => {
    expect(keyboardShortcutAction(commandEvent({ key: "i" }))).toBe(
      "focus-current-inline-thread",
    );
  });

  it("maps Cmd/Ctrl+Shift+I to in-review replies", () => {
    expect(
      keyboardShortcutAction(commandEvent({ key: "i", shiftKey: true })),
    ).toBe("open-in-review-reply");
  });

  it("keeps Cmd/Ctrl+Shift+U mapped to unseen work", () => {
    expect(
      keyboardShortcutAction(commandEvent({ key: "u", shiftKey: true })),
    ).toBe("open-latest-unread");
  });

  it("maps Cmd/Ctrl+Shift+M to marking the current file reviewed", () => {
    expect(
      keyboardShortcutAction(commandEvent({ key: "m", shiftKey: true })),
    ).toBe("mark-current-reviewed");
  });
});
