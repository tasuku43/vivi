export interface RectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface RenderedCommentThreadPosition {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
  placement: "left" | "right" | "above" | "below";
}

export function sameRenderedCommentThreadPosition(
  left: RenderedCommentThreadPosition | null,
  right: RenderedCommentThreadPosition,
): boolean {
  return (
    left?.left === right.left &&
    left.top === right.top &&
    left.width === right.width &&
    left.maxHeight === right.maxHeight &&
    left.placement === right.placement
  );
}

export function positionRenderedCommentThread(
  anchor: RectLike,
  viewport: { width: number; height: number },
  container?: RectLike,
  card: { width?: number; height?: number } = {},
): RenderedCommentThreadPosition {
  const margin = 16;
  const gap = 12;
  const bounds = intersectionBounds(
    container ?? {
      left: 0,
      top: 0,
      width: viewport.width,
      height: viewport.height,
    },
    viewport,
  );
  const availableWidth = Math.max(0, bounds.width - margin * 2);
  const availableHeight = Math.max(0, bounds.height - margin * 2);
  const width = Math.min(Math.max(300, card.width ?? 520), availableWidth);
  const maxHeight = Math.min(
    Math.max(180, card.height ?? 430),
    availableHeight,
  );
  const boundsRight = bounds.left + bounds.width;
  const boundsBottom = bounds.top + bounds.height;
  const anchorRight = anchor.left + anchor.width;
  const anchorBottom = anchor.top + anchor.height;
  const preferredTop = clamp(
    anchor.top - 16,
    bounds.top + margin,
    Math.max(bounds.top + margin, boundsBottom - margin - maxHeight),
  );

  if (anchorRight + gap + width <= boundsRight - margin) {
    return {
      left: anchorRight + gap,
      top: preferredTop,
      width,
      maxHeight,
      placement: "right",
    };
  }
  if (anchor.left - gap - width >= bounds.left + margin) {
    return {
      left: anchor.left - gap - width,
      top: preferredTop,
      width,
      maxHeight,
      placement: "left",
    };
  }

  const verticalWidth = Math.min(
    width,
    Math.max(Math.min(300, availableWidth), availableWidth * 0.72),
  );
  const left = clamp(
    anchorRight - verticalWidth,
    bounds.left + margin,
    Math.max(bounds.left + margin, boundsRight - margin - verticalWidth),
  );
  const roomBelow = boundsBottom - margin - (anchorBottom + gap);
  const roomAbove = anchor.top - gap - (bounds.top + margin);
  if (roomBelow >= Math.min(180, maxHeight) || roomBelow >= roomAbove) {
    const belowHeight = Math.max(0, Math.min(maxHeight, roomBelow));
    return {
      left,
      top: anchorBottom + gap,
      width: verticalWidth,
      maxHeight: belowHeight,
      placement: "below",
    };
  }
  const aboveHeight = Math.max(0, Math.min(maxHeight, roomAbove));
  return {
    left,
    top: anchor.top - gap - aboveHeight,
    width: verticalWidth,
    maxHeight: aboveHeight,
    placement: "above",
  };
}

function intersectionBounds(
  container: RectLike,
  viewport: { width: number; height: number },
): RectLike {
  const left = clamp(container.left, 0, viewport.width);
  const top = clamp(container.top, 0, viewport.height);
  const right = clamp(container.left + container.width, left, viewport.width);
  const bottom = clamp(container.top + container.height, top, viewport.height);
  return {
    left,
    top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
