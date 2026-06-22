import type { OpenTab } from "./tabs.js";

export type TabKeyboardAction = { kind: "activate"; path: string };

export function tabKeyboardAction(
  tabs: OpenTab[],
  activePath: string | null,
  key: string,
): TabKeyboardAction | null {
  if (!tabs.length) return null;
  const activeIndex = activePath
    ? tabs.findIndex((tab) => tab.path === activePath)
    : -1;
  const index = activeIndex >= 0 ? activeIndex : 0;
  if (key === "ArrowRight") {
    return { kind: "activate", path: tabs[(index + 1) % tabs.length]!.path };
  }
  if (key === "ArrowLeft") {
    return {
      kind: "activate",
      path: tabs[(index - 1 + tabs.length) % tabs.length]!.path,
    };
  }
  if (key === "Home") return { kind: "activate", path: tabs[0]!.path };
  if (key === "End") {
    return { kind: "activate", path: tabs[tabs.length - 1]!.path };
  }
  return null;
}
