import type { ViviComment } from "../domain/comments.js";
import {
  renderedCommentBlockAttribute,
  renderedCommentBlockSelector,
} from "../domain/rendered-comment-blocks.js";
import type { SelectionCommentTarget } from "./comments.js";

export interface RenderedCommentBlockTarget extends SelectionCommentTarget {
  blockId: string;
  blockIds: string[];
  selector?: string;
  sourceLineStart?: number;
  sourceLineEnd?: number;
}

export interface RenderedCommentSummary {
  id: string;
  blockId?: string;
  selector?: string;
  textQuote?: string;
  sourceLineStart?: number;
  sourceLineEnd?: number;
  status: string;
}

const commentableBlockClass = "vivi-rendered-comment-block";

const interactiveSelector = [
  "a",
  "button",
  "input",
  "select",
  "textarea",
  "summary",
  "[contenteditable]",
].join(",");

export function closestRenderedCommentBlock(
  root: HTMLElement | null,
  target: EventTarget | null,
): HTMLElement | null {
  if (!root || !(target instanceof Element) || !root.contains(target)) {
    return null;
  }
  const block = target.closest<HTMLElement>(renderedCommentBlockSelector);
  return block && root.contains(block) ? block : null;
}

export function isInteractiveRenderedCommentTarget(
  target: EventTarget | null,
): boolean {
  return (
    target instanceof Element && Boolean(target.closest(interactiveSelector))
  );
}

export function renderedCommentBlocksForSelection(
  root: HTMLElement | null,
): HTMLElement[] {
  if (!root) return [];
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return [];
  if (!selection.toString().trim()) return [];
  const range = selection.getRangeAt(0);
  return commentableRenderedBlocks(root).filter((block) => {
    try {
      return range.intersectsNode(block);
    } catch {
      return false;
    }
  });
}

export function targetForRenderedCommentBlock(
  block: HTMLElement,
): RenderedCommentBlockTarget | null {
  return targetForRenderedCommentBlocks([block]);
}

export function targetForRenderedCommentBlocks(
  blocks: HTMLElement[],
  selectedText?: string,
): RenderedCommentBlockTarget | null {
  const targets = blocks
    .map((block) => ({
      block,
      blockId: block.dataset.viviCommentBlockId,
      sourceLineStart: positiveDatasetInt(block.dataset.viviSourceLineStart),
      sourceLineEnd: positiveDatasetInt(block.dataset.viviSourceLineEnd),
    }))
    .filter((target): target is typeof target & { blockId: string } =>
      Boolean(target.blockId),
    );
  if (!targets.length) return null;
  const text =
    selectedText?.trim() ||
    targets.map(({ block }) => readableBlockText(block)).join("\n");
  if (!text) return null;
  const first = targets[0];
  const last = targets.at(-1)!;
  const lineRange = renderedCommentSourceRange(
    targets.map(({ sourceLineStart, sourceLineEnd }) => ({
      sourceLineStart,
      sourceLineEnd,
    })),
  );
  return {
    blockId: first.blockId,
    blockIds: targets.map(({ blockId }) => blockId),
    selector: cssPathForElement(first.block),
    text,
    rect: rectLikeForElements(first.block, last.block),
    sourceLineStart: lineRange?.start,
    sourceLineEnd: lineRange?.end,
  };
}

export function renderedCommentSourceRange(
  blocks: Array<{
    sourceLineStart?: number;
    sourceLineEnd?: number;
  }>,
): { start: number; end: number } | undefined {
  const first = blocks.find((block) => block.sourceLineStart !== undefined);
  const last = [...blocks]
    .reverse()
    .find(
      (block) =>
        block.sourceLineEnd !== undefined ||
        block.sourceLineStart !== undefined,
    );
  if (first?.sourceLineStart === undefined || !last) return undefined;
  return {
    start: first.sourceLineStart,
    end: last.sourceLineEnd ?? last.sourceLineStart ?? first.sourceLineStart,
  };
}

export function applyRenderedCommentHighlights(
  root: HTMLElement | null,
  comments: ViviComment[],
  activeCommentId?: string | null,
  draftingBlockIds?: string[] | null,
  kind: "markdown" | "html" = "markdown",
  draftingBlockIdGroups?: string[][] | null,
): void {
  if (!root) return;
  const blocks = commentableRenderedBlocks(root);
  for (const block of blocks) {
    block.classList.add(commentableBlockClass);
    block.classList.remove(
      "has-rendered-comment",
      "active-rendered-comment",
      "drafting-rendered-comment",
      "rendered-comment-range-start",
      "rendered-comment-range-middle",
      "rendered-comment-range-end",
      "rendered-comment-range-join-after",
    );
    block.style.removeProperty("--rendered-comment-join-after");
    block.style.removeProperty("--rendered-comment-block-bottom");
    delete block.dataset.viviCommentId;
    delete block.dataset.viviCommentCount;
    removeRenderedCommentAction(block);
  }

  const summaries = comments
    .map((comment) => renderedCommentSummaryForComment(comment, kind))
    .filter((comment): comment is RenderedCommentSummary => Boolean(comment));

  const commentsByBlock = new Map<HTMLElement, RenderedCommentSummary[]>();
  const markerCommentsByBlock = new Map<
    HTMLElement,
    RenderedCommentSummary[]
  >();
  for (const comment of summaries) {
    const commentBlocks = findBlocksForRenderedComment(root, comment);
    applyRenderedCommentRangeBridge(commentBlocks);
    for (const block of commentBlocks) {
      const list = commentsByBlock.get(block) ?? [];
      list.push(comment);
      commentsByBlock.set(block, list);
    }
    const markerBlock = commentBlocks.at(-1);
    if (markerBlock) {
      const list = markerCommentsByBlock.get(markerBlock) ?? [];
      list.push(comment);
      markerCommentsByBlock.set(markerBlock, list);
    }
  }

  for (const [block, blockComments] of commentsByBlock) {
    const firstComment = blockComments[0];
    block.classList.add("has-rendered-comment");
    if (blockComments.some((comment) => comment.id === activeCommentId)) {
      block.classList.add("active-rendered-comment");
    }
    block.dataset.viviCommentId = firstComment.id;
    block.dataset.viviCommentCount = String(blockComments.length);
  }

  for (const [block, blockComments] of markerCommentsByBlock) {
    const firstComment = blockComments[0];
    const action = ensureRenderedCommentAction(block, blockComments.length);
    action.dataset.commentId = firstComment.id;
  }

  const draftingIds = new Set(draftingBlockIds ?? []);
  const draftGroups =
    draftingBlockIdGroups?.filter((group) => group.length) ??
    (draftingIds.size ? [Array.from(draftingIds)] : []);
  for (const group of draftGroups) {
    const groupIds = new Set(group);
    const draftingBlocks = blocks.filter((block) =>
      groupIds.has(block.dataset.viviCommentBlockId ?? ""),
    );
    applyRenderedCommentRangeBridge(draftingBlocks);
    for (const block of draftingBlocks) {
      block.classList.add("drafting-rendered-comment");
    }
  }
}

function applyRenderedCommentRangeBridge(blocks: HTMLElement[]): void {
  if (blocks.length < 2) return;
  for (const [index, block] of blocks.entries()) {
    block.classList.add(
      index === 0
        ? "rendered-comment-range-start"
        : index === blocks.length - 1
          ? "rendered-comment-range-end"
          : "rendered-comment-range-middle",
    );
    const next = blocks[index + 1];
    if (!next) continue;
    const gap = verticalGapBetween(block, next);
    if (gap <= 1) continue;
    block.classList.add("rendered-comment-range-join-after");
    block.style.setProperty("--rendered-comment-join-after", `${gap}px`);
  }
}

function verticalGapBetween(current: HTMLElement, next: HTMLElement): number {
  const currentRect = current.getBoundingClientRect();
  const nextRect = next.getBoundingClientRect();
  return Math.max(0, Math.round(nextRect.top - currentRect.bottom));
}

export function renderedCommentActionLabel(commentCount: number): string {
  return `Open comment thread with ${commentCount} ${commentCount === 1 ? "message" : "messages"}`;
}

export function renderedCommentSummaryForComment(
  comment: ViviComment,
  kind?: "markdown" | "html",
): RenderedCommentSummary | null {
  const rendered = comment.anchor.rendered;
  if (rendered && kind && rendered.kind !== kind) return null;
  const sourceLineStart = comment.anchor.canonical.lineStart;
  const sourceLineEnd =
    comment.anchor.canonical.lineEnd ?? comment.anchor.canonical.lineStart;
  if (!rendered && sourceLineStart === undefined) return null;
  return {
    id: comment.id,
    blockId: rendered?.blockId,
    selector: rendered?.selector,
    textQuote: rendered?.textQuote ?? comment.anchor.canonical.quote,
    sourceLineStart,
    sourceLineEnd,
    status: comment.status,
  };
}

export function findBlockForRenderedComment(
  root: HTMLElement,
  comment: RenderedCommentSummary,
): HTMLElement | null {
  return findBlocksForRenderedComment(root, comment)[0] ?? null;
}

export function findBlocksForRenderedComment(
  root: HTMLElement,
  comment: RenderedCommentSummary,
): HTMLElement[] {
  const bySourceRange = blocksForRenderedSourceRange(root, comment);
  if (comment.blockId) {
    const byBlockId = root.querySelector<HTMLElement>(
      `[${renderedCommentBlockAttribute}="${escapeSelectorValue(comment.blockId)}"]`,
    );
    const closest = byBlockId
      ? closestRenderedCommentBlock(root, byBlockId)
      : null;
    if (closest) {
      const spansMultipleLines =
        comment.sourceLineStart !== undefined &&
        comment.sourceLineEnd !== undefined &&
        comment.sourceLineEnd > comment.sourceLineStart;
      if (
        spansMultipleLines &&
        shouldProjectSourceRange(closest, bySourceRange)
      ) {
        return bySourceRange;
      }
      return [closest];
    }
  }
  if (comment.selector) {
    try {
      const bySelector = root.querySelector<HTMLElement>(comment.selector);
      if (bySelector?.matches(renderedCommentBlockSelector)) {
        const closest = closestRenderedCommentBlock(root, bySelector);
        if (closest) return [closest];
      }
      const nearest = bySelector?.closest<HTMLElement>(
        renderedCommentBlockSelector,
      );
      if (nearest && root.contains(nearest)) return [nearest];
    } catch {
      // Ignore stale or browser-specific selectors from older comments.
    }
  }
  if (bySourceRange.length) return bySourceRange;
  const quote = comment.textQuote?.trim();
  if (!quote) return [];
  const byQuote =
    Array.from(
      root.querySelectorAll<HTMLElement>(renderedCommentBlockSelector),
    ).find((block) => readableBlockText(block).includes(quote)) ?? null;
  return byQuote ? [byQuote] : [];
}

function shouldProjectSourceRange(
  closest: HTMLElement,
  blocks: HTMLElement[],
): boolean {
  return (
    blocks.length > 1 &&
    blocks.includes(closest) &&
    blocks.some((block) => block !== closest && !closest.contains(block))
  );
}

function blocksForRenderedSourceRange(
  root: HTMLElement,
  comment: RenderedCommentSummary,
): HTMLElement[] {
  if (comment.sourceLineStart === undefined) return [];
  const end = comment.sourceLineEnd ?? comment.sourceLineStart;
  return commentableRenderedBlocks(root).filter((block) => {
    const start = positiveDatasetInt(block.dataset.viviSourceLineStart);
    const blockEnd = positiveDatasetInt(block.dataset.viviSourceLineEnd);
    return (
      start !== undefined &&
      blockEnd !== undefined &&
      start <= end &&
      blockEnd >= comment.sourceLineStart!
    );
  });
}

function commentableRenderedBlocks(root: HTMLElement): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(renderedCommentBlockSelector),
  ).filter((block) => closestRenderedCommentBlock(root, block) === block);
}

function removeRenderedCommentAction(block: HTMLElement): void {
  for (const action of block.querySelectorAll(".rendered-comment-marker")) {
    action.remove();
  }
  block.classList.remove("vivi-rendered-comment-action-host");
  block.lastElementChild?.classList.remove("vivi-rendered-comment-action-host");
}

function ensureRenderedCommentAction(
  block: HTMLElement,
  commentCount: number,
): HTMLButtonElement {
  const host =
    block.localName === "tr" && block.lastElementChild instanceof HTMLElement
      ? block.lastElementChild
      : block;
  if (host !== block) host.classList.add("vivi-rendered-comment-action-host");

  const action = document.createElement("button");
  action.type = "button";
  action.className = "rendered-comment-marker";
  action.dataset.commentCount = String(commentCount);
  action.setAttribute("aria-label", renderedCommentActionLabel(commentCount));
  action.title = renderedCommentActionLabel(commentCount);

  const count = document.createElement("span");
  count.className = "rendered-comment-marker-count";
  count.setAttribute("aria-hidden", "true");
  count.textContent = String(commentCount);
  action.append(count);
  host.append(action);
  return action;
}

export function readableBlockText(element: HTMLElement): string {
  const readable = element.cloneNode(true) as HTMLElement;
  for (const decoration of readable.querySelectorAll(
    ".rendered-comment-marker, .rendered-comment-thread-host",
  )) {
    decoration.remove();
  }
  const raw = readable.textContent ?? "";
  return raw.replace(/\s+/g, " ").trim();
}

export function rectLikeFromElement(
  element: Element,
): SelectionCommentTarget["rect"] {
  const rect = element.getBoundingClientRect();
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

function rectLikeForElements(
  first: Element,
  last: Element,
): SelectionCommentTarget["rect"] {
  const firstRect = first.getBoundingClientRect();
  const lastRect = last.getBoundingClientRect();
  const left = Math.min(firstRect.left, lastRect.left);
  const top = Math.min(firstRect.top, lastRect.top);
  const right = Math.max(firstRect.right, lastRect.right);
  const bottom = Math.max(firstRect.bottom, lastRect.bottom);
  return {
    left,
    top,
    width: right - left,
    height: bottom - top,
  };
}

export function cssPathForElement(element: Element): string | undefined {
  if (!(element instanceof HTMLElement)) return undefined;
  if (element.id) return `#${escapeCssIdentifier(element.id)}`;
  const parts: string[] = [];
  let current: Element | null = element;
  while (current && current !== document.body) {
    const parentElement: HTMLElement | null = current.parentElement;
    if (!parentElement) break;
    const name = current.localName;
    const siblings: Element[] = Array.from(parentElement.children).filter(
      (item) => item.localName === name,
    );
    const index = siblings.indexOf(current) + 1;
    parts.unshift(siblings.length > 1 ? `${name}:nth-of-type(${index})` : name);
    current = parentElement;
  }
  return parts.join(">");
}

function escapeSelectorValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function escapeCssIdentifier(value: string): string {
  const css = globalThis.CSS as
    | { escape?: (value: string) => string }
    | undefined;
  return css?.escape
    ? css.escape(value)
    : value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

function positiveDatasetInt(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}
