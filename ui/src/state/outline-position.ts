export interface OutlineHeadingPosition {
  id: string;
  top: number;
}

export function activeOutlineHeadingId(
  positions: OutlineHeadingPosition[],
  thresholdPx = 96,
): string | null {
  if (!positions.length) return null;
  const sorted = [...positions].sort((a, b) => a.top - b.top);
  let active = sorted[0]!.id;
  for (const position of sorted) {
    if (position.top > thresholdPx) break;
    active = position.id;
  }
  return active;
}
