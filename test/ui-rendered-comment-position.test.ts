import { expect, it } from "vitest";
import {
  positionRenderedCommentThread,
  renderedCommentContentBounds,
} from "../ui/src/state/rendered-comment-position.js";

const viewport = { width: 1200, height: 800 };
const viewer = { left: 200, top: 80, width: 800, height: 680 };

it("places rendered feedback beside its anchor without covering it", () => {
  const anchor = { left: 320, top: 240, width: 180, height: 60 };
  const position = positionRenderedCommentThread(anchor, viewport, viewer, {
    width: 360,
    height: 300,
  });

  expect(position.placement).toBe("right");
  expect(position.left).toBeGreaterThanOrEqual(anchor.left + anchor.width);
});

it("excludes the sticky viewer toolbar from popover positioning bounds", () => {
  expect(
    renderedCommentContentBounds(
      { left: 20, top: 40, width: 660, height: 620 },
      { left: 20, top: 40, width: 660, height: 54 },
    ),
  ).toEqual({ left: 20, top: 94, width: 660, height: 566 });
});

it("moves rendered feedback below a wide anchor instead of obscuring it", () => {
  const anchor = { left: 260, top: 220, width: 680, height: 80 };
  const position = positionRenderedCommentThread(anchor, viewport, viewer, {
    width: 520,
    height: 300,
  });

  expect(position.placement).toBe("below");
  expect(position.top).toBeGreaterThanOrEqual(anchor.top + anchor.height);
  expect(position.left + position.width).toBe(anchor.left + anchor.width);
});

it("keeps the anchored composer inside the visible viewer near an edge", () => {
  const anchor = { left: 300, top: 700, width: 640, height: 40 };
  const position = positionRenderedCommentThread(anchor, viewport, viewer, {
    width: 520,
    height: 320,
  });

  expect(position.placement).toBe("above");
  expect(position.left).toBeGreaterThanOrEqual(viewer.left);
  expect(position.left + position.width).toBeLessThanOrEqual(
    viewer.left + viewer.width,
  );
  expect(position.top).toBeGreaterThanOrEqual(viewer.top);
});

it("shrinks the composer to the available width in a narrow split pane", () => {
  const position = positionRenderedCommentThread(
    { left: 110, top: 80, width: 120, height: 30 },
    { width: 900, height: 700 },
    { left: 80, top: 40, width: 280, height: 500 },
    { width: 520, height: 430 },
  );

  expect(position.width).toBe(248);
  expect(position.left).toBeGreaterThanOrEqual(96);
  expect(position.left + position.width).toBeLessThanOrEqual(344);
});

it("leaves a readable leading edge when a vertical popover fills a compact viewer", () => {
  const compactViewer = { left: 312, top: 80, width: 552, height: 680 };
  const anchor = { left: 339, top: 220, width: 485, height: 40 };
  const position = positionRenderedCommentThread(
    anchor,
    viewport,
    compactViewer,
    { width: 520, height: 300 },
  );

  expect(position.placement).toBe("below");
  expect(position.width).toBeLessThan(520);
  expect(position.left).toBeGreaterThan(anchor.left + 100);
});

it("never intersects the selected content across viewer edges", () => {
  const anchors = [
    { left: 220, top: 96, width: 120, height: 44 },
    { left: 430, top: 260, width: 220, height: 80 },
    { left: 250, top: 560, width: 680, height: 52 },
    { left: 210, top: 700, width: 760, height: 36 },
  ];

  for (const anchor of anchors) {
    const position = positionRenderedCommentThread(anchor, viewport, viewer, {
      width: 520,
      height: 430,
    });
    expect(
      rectanglesOverlap(anchor, {
        left: position.left,
        top: position.top,
        width: position.width,
        height: position.maxHeight,
      }),
    ).toBe(false);
  }
});

it("keeps feedback usable when a tall target consumes all vertical room", () => {
  const compactViewer = { left: 80, top: 40, width: 360, height: 320 };
  const tallTarget = { left: 104, top: 52, width: 312, height: 296 };
  const position = positionRenderedCommentThread(
    tallTarget,
    { width: 900, height: 700 },
    compactViewer,
    { width: 520, height: 430 },
  );

  expect(position.placement).toBe("overlay");
  expect(position.maxHeight).toBeGreaterThanOrEqual(180);
  expect(position.top).toBeGreaterThanOrEqual(compactViewer.top + 16);
  expect(position.top + position.maxHeight).toBeLessThanOrEqual(
    compactViewer.top + compactViewer.height - 16,
  );
  expect(position.width).toBeLessThan(compactViewer.width - 32);
});

function rectanglesOverlap(
  left: { left: number; top: number; width: number; height: number },
  right: { left: number; top: number; width: number; height: number },
): boolean {
  return !(
    left.left + left.width <= right.left ||
    right.left + right.width <= left.left ||
    left.top + left.height <= right.top ||
    right.top + right.height <= left.top
  );
}
