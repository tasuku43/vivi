export const defaultSidebarWidth = 280;
export const minSidebarWidth = 220;
export const maxSidebarWidth = 520;
export const defaultInspectorWidth = 280;
export const minInspectorWidth = 220;
export const maxInspectorWidth = 520;

export function clampSidebarWidth(width: number): number {
  if (!Number.isFinite(width)) return defaultSidebarWidth;
  return Math.min(maxSidebarWidth, Math.max(minSidebarWidth, Math.round(width)));
}

export function clampInspectorWidth(width: number): number {
  if (!Number.isFinite(width)) return defaultInspectorWidth;
  return Math.min(
    maxInspectorWidth,
    Math.max(minInspectorWidth, Math.round(width)),
  );
}
