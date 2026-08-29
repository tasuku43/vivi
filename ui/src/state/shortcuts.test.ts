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

  it("leaves Cmd/Ctrl+Shift+I unassigned", () => {
    expect(
      keyboardShortcutAction(commandEvent({ key: "i", shiftKey: true })),
    ).toBeNull();
  });

  it("keeps Cmd/Ctrl+Shift+U mapped to unseen work", () => {
    expect(
      keyboardShortcutAction(commandEvent({ key: "u", shiftKey: true })),
    ).toBe("open-latest-unseen");
  });

  it("leaves the removed reviewed shortcut unassigned", () => {
    expect(
      keyboardShortcutAction(commandEvent({ key: "m", shiftKey: true })),
    ).toBeNull();
  });
});
