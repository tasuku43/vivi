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
