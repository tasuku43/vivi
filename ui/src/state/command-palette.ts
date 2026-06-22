import type { SearchPaletteMode } from "./search-palette.js";

export function clampPaletteSelection(
  selectedIndex: number,
  resultCount: number,
): number {
  if (resultCount <= 0) return -1;
  if (selectedIndex < 0) return 0;
  return Math.min(selectedIndex, resultCount - 1);
}

export function movePaletteSelection(
  selectedIndex: number,
  resultCount: number,
  direction: 1 | -1,
): number {
  if (resultCount <= 0) return -1;
  const current = clampPaletteSelection(selectedIndex, resultCount);
  return (current + direction + resultCount) % resultCount;
}

export function paletteModeKeyboardAction(
  modes: SearchPaletteMode[],
  currentMode: SearchPaletteMode,
  key: string,
): SearchPaletteMode | null {
  if (!modes.length) return null;
  const currentIndex = Math.max(0, modes.indexOf(currentMode));
  if (key === "ArrowRight") return modes[(currentIndex + 1) % modes.length]!;
  if (key === "ArrowLeft") {
    return modes[(currentIndex - 1 + modes.length) % modes.length]!;
  }
  if (key === "Home") return modes[0]!;
  if (key === "End") return modes[modes.length - 1]!;
  return null;
}
