export const defaultSidebarWidth = 280;
export const minSidebarWidth = 220;
export const maxSidebarWidth = 520;
export const defaultInspectorWidth = 280;
export const minInspectorWidth = 220;
export const maxInspectorWidth = 520;
export const inspectorCollapseBreakpoint = 1040;
export const compactLayoutBreakpoint = 720;
export const compactSidebarMinWidth = 168;
export const compactSidebarRatio = 0.46;

export function clampSidebarWidth(width: number): number {
  if (!Number.isFinite(width)) return defaultSidebarWidth;
  return Math.min(
    maxSidebarWidth,
    Math.max(minSidebarWidth, Math.round(width)),
  );
}

export function clampInspectorWidth(width: number): number {
  if (!Number.isFinite(width)) return defaultInspectorWidth;
  return Math.min(
    maxInspectorWidth,
    Math.max(minInspectorWidth, Math.round(width)),
  );
}

export function shouldCollapseInspector(viewportWidth: number): boolean {
  return Number.isFinite(viewportWidth)
    ? viewportWidth <= inspectorCollapseBreakpoint
    : false;
}

export function compactSidebarWidth(
  width: number,
  viewportWidth: number,
): number {
  const sidebarWidth = clampSidebarWidth(width);
  if (
    !Number.isFinite(viewportWidth) ||
    viewportWidth > compactLayoutBreakpoint
  ) {
    return sidebarWidth;
  }
  const responsiveMax = Math.max(
    compactSidebarMinWidth,
    Math.floor(viewportWidth * compactSidebarRatio),
  );
  return Math.min(sidebarWidth, responsiveMax);
}
