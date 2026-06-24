export const renderedCommentBlockAttribute = "data-vivi-comment-block-id";
export const renderedCommentBlockSelector = `[${renderedCommentBlockAttribute}]`;

const renderedCommentBlockTags = new Set([
  "a",
  "article",
  "button",
  "footer",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "main",
  "nav",
  "p",
  "li",
  "pre",
  "section",
  "tr",
  "blockquote",
  "aside",
  "figure",
]);
const rawTextTags = new Set(["script", "style", "textarea"]);
const voidTags = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

export interface RenderedCommentSourceBlock {
  blockId: string;
  tagName: string;
  sourceLineStart: number;
  sourceLineEnd: number;
}

interface ParsedCommentBlock extends RenderedCommentSourceBlock {
  openingStart: number;
  openingEnd: number;
}

interface OpenElement {
  tagName: string;
  block?: ParsedCommentBlock;
}

export function renderedCommentBlockId(index: number): string {
  return `vivi-block-${index + 1}`;
}

export function addRenderedCommentBlockIdsToHtml(
  html: string,
  options: { preserveSourceRanges?: boolean } = {},
): string {
  const parsed = parseRenderedCommentBlocks(html);
  let output = html;
  for (const block of [...parsed].reverse()) {
    const openingTag = output.slice(block.openingStart, block.openingEnd);
    const annotated = annotateOpeningTag(
      openingTag,
      block,
      options.preserveSourceRanges === true,
    );
    output =
      output.slice(0, block.openingStart) +
      annotated +
      output.slice(block.openingEnd);
  }
  return output;
}

export function renderedCommentBlocksForHtml(
  html: string,
): RenderedCommentSourceBlock[] {
  return parseRenderedCommentBlocks(html).map(
    ({ openingStart: _start, openingEnd: _end, ...block }) => block,
  );
}

function parseRenderedCommentBlocks(html: string): ParsedCommentBlock[] {
  const lowerHtml = html.toLowerCase();
  let index = 0;
  let cursor = 0;
  let rawTextTag: string | null = null;
  let templateDepth = 0;
  const blocks: ParsedCommentBlock[] = [];
  const stack: OpenElement[] = [];

  while (cursor < html.length) {
    if (rawTextTag) {
      const closingIndex = lowerHtml.indexOf(`</${rawTextTag}`, cursor);
      if (closingIndex < 0) break;
      cursor = closingIndex;
    }

    const tagStart = html.indexOf("<", cursor);
    if (tagStart < 0) break;

    if (html.startsWith("<!--", tagStart)) {
      const commentEnd = html.indexOf("-->", tagStart + 4);
      const end = commentEnd < 0 ? html.length : commentEnd + 3;
      cursor = end;
      continue;
    }

    const tagEnd = findHtmlTagEnd(html, tagStart + 1);
    if (tagEnd < 0) break;
    const tag = html.slice(tagStart, tagEnd + 1);
    const match = /^<\s*(\/?)\s*([a-zA-Z][\w:-]*)/.exec(tag);
    if (!match) {
      cursor = tagEnd + 1;
      continue;
    }

    const closing = match[1] === "/";
    const tagName = match[2].toLowerCase();
    if (closing) {
      closeOpenElements(stack, tagName, lineNumberAt(html, tagEnd));
      if (tagName === "template" && templateDepth > 0) templateDepth -= 1;
      if (tagName === rawTextTag) rawTextTag = null;
    } else {
      const insideTemplate = templateDepth > 0;
      autoCloseOptionalElements(
        stack,
        tagName,
        lineNumberAt(html, Math.max(0, tagStart - 1)),
      );
      if (tagName === "template") templateDepth += 1;
      if (rawTextTags.has(tagName)) rawTextTag = tagName;
      let block: ParsedCommentBlock | undefined;
      if (
        !insideTemplate &&
        tagName !== "template" &&
        renderedCommentBlockTags.has(tagName)
      ) {
        const lineStart = lineNumberAt(html, tagStart);
        block = {
          blockId: renderedCommentBlockId(index),
          tagName,
          sourceLineStart: lineStart,
          sourceLineEnd: lineStart,
          openingStart: tagStart,
          openingEnd: tagEnd + 1,
        };
        blocks.push(block);
        index += 1;
      }
      const selfClosing = /\/\s*>$/.test(tag) || voidTags.has(tagName);
      if (!selfClosing) {
        stack.push({ tagName, block });
      }
    }
    cursor = tagEnd + 1;
  }

  const finalLine = lineNumberAt(html, Math.max(0, html.length - 1));
  while (stack.length) {
    const element = stack.pop();
    if (element?.block) element.block.sourceLineEnd = finalLine;
  }
  return blocks;
}

function findHtmlTagEnd(html: string, start: number): number {
  let quote: '"' | "'" | null = null;
  for (let index = start; index < html.length; index += 1) {
    const character = html[index];
    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === ">") return index;
  }
  return -1;
}

function addAttributeToOpeningTag(tag: string, attribute: string): string {
  const suffix = /\/\s*>$/.test(tag) ? "/>" : ">";
  const body = tag.slice(0, -suffix.length).trimEnd();
  return `${body} ${attribute}${suffix}`;
}

function annotateOpeningTag(
  tag: string,
  block: RenderedCommentSourceBlock,
  preserveSourceRanges: boolean,
): string {
  let clean = tag.replace(
    /\sdata-vivi-comment-block-id\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi,
    "",
  );
  if (!preserveSourceRanges) {
    clean = clean.replace(
      /\sdata-vivi-source-line-(?:start|end)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi,
      "",
    );
  }
  const sourceAttributes = preserveSourceRanges
    ? ""
    : ` data-vivi-source-line-start="${block.sourceLineStart}" data-vivi-source-line-end="${block.sourceLineEnd}"`;
  return addAttributeToOpeningTag(
    clean,
    `${renderedCommentBlockAttribute}="${block.blockId}"${sourceAttributes}`,
  );
}

function closeOpenElements(
  stack: OpenElement[],
  tagName: string,
  endLine: number,
): void {
  const matchIndex = findLastIndex(stack, (item) => item.tagName === tagName);
  if (matchIndex < 0) return;
  while (stack.length > matchIndex) {
    const element = stack.pop();
    if (element?.block) element.block.sourceLineEnd = endLine;
  }
}

function autoCloseOptionalElements(
  stack: OpenElement[],
  nextTag: string,
  endLine: number,
): void {
  const top = stack[stack.length - 1];
  if (top?.tagName === "p" && isBlockOpeningTag(nextTag)) {
    closeOpenElements(stack, "p", endLine);
  }
  if (nextTag === "li") {
    closePeerWithinContainer(stack, "li", ["ul", "ol"], endLine);
  }
  if (nextTag === "tr") {
    closePeerWithinContainer(
      stack,
      "tr",
      ["table", "thead", "tbody", "tfoot"],
      endLine,
    );
  }
}

function closePeerWithinContainer(
  stack: OpenElement[],
  peer: string,
  containers: string[],
  endLine: number,
): void {
  const peerIndex = findLastIndex(stack, (item) => item.tagName === peer);
  const containerIndex = findLastIndex(stack, (item) =>
    containers.includes(item.tagName),
  );
  if (peerIndex > containerIndex) {
    while (stack.length > peerIndex) {
      const element = stack.pop();
      if (element?.block) element.block.sourceLineEnd = endLine;
    }
  }
}

function isBlockOpeningTag(tagName: string): boolean {
  return (
    renderedCommentBlockTags.has(tagName) ||
    [
      "address",
      "article",
      "div",
      "dl",
      "fieldset",
      "footer",
      "form",
      "header",
      "hr",
      "main",
      "nav",
      "ol",
      "section",
      "table",
      "ul",
    ].includes(tagName)
  );
}

function findLastIndex<T>(items: T[], predicate: (item: T) => boolean): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (predicate(items[index])) return index;
  }
  return -1;
}

function lineNumberAt(source: string, offset: number): number {
  return source.slice(0, offset).split(/\r?\n/).length;
}
