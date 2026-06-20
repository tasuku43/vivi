import { Renderer, marked } from "marked";
import type { Token, Tokens } from "marked";
import { escapeAttribute, escapeHtml } from "../domain/mermaid-preview.js";
import { addRenderedCommentBlockIdsToHtml } from "../domain/rendered-comment-blocks.js";

export interface MarkdownCommentBlockRange {
  lineStart: number;
  lineEnd: number;
}

const sourceStartAttribute = "data-vivi-source-line-start";
const sourceEndAttribute = "data-vivi-source-line-end";

export function renderMarkdownHtmlWithSourceRanges(
  markdown: string,
  lineOffset = 0,
): string {
  const tokens = marked.lexer(markdown);
  const ranges = new WeakMap<object, MarkdownCommentBlockRange>();
  const tableRows = new WeakMap<object, MarkdownCommentBlockRange[]>();
  assignTokenRanges(tokens, markdown, lineOffset, ranges, tableRows);

  const renderer = new Renderer();
  const baseHeading = renderer.heading;
  const baseParagraph = renderer.paragraph;
  const baseBlockquote = renderer.blockquote;
  const baseListItem = renderer.listitem;
  const baseCode = renderer.code;
  const baseTable = renderer.table;
  const baseHtml = renderer.html;

  renderer.heading = function (token) {
    return annotateFirstTag(
      baseHeading.call(this, token),
      "h[1-6]",
      ranges.get(token),
    );
  };
  renderer.paragraph = function (token) {
    return annotateFirstTag(
      baseParagraph.call(this, token),
      "p",
      ranges.get(token),
    );
  };
  renderer.blockquote = function (token) {
    return annotateFirstTag(
      baseBlockquote.call(this, token),
      "blockquote",
      ranges.get(token),
    );
  };
  renderer.listitem = function (token) {
    return annotateFirstTag(
      baseListItem.call(this, token),
      "li",
      ranges.get(token),
    );
  };
  renderer.code = function (token) {
    const range = ranges.get(token);
    const language = token.lang?.trim().split(/\s+/)[0]?.toLowerCase();
    if (language === "mermaid" || language === "mmd") {
      return renderMermaidFigure(token.text, range);
    }
    return annotateFirstTag(baseCode.call(this, token), "pre", range);
  };
  renderer.table = function (token) {
    const html = baseTable.call(this, token);
    const rows = tableRows.get(token) ?? [];
    let index = 0;
    return html.replace(/<tr(\s[^>]*)?>/gi, (match) => {
      const range = rows[index];
      index += 1;
      return range ? addAttributes(match, range) : match;
    });
  };
  renderer.html = function (token) {
    const html = baseHtml.call(this, token);
    const range = ranges.get(token);
    if (!range || !token.block) return html;
    const annotated = addRenderedCommentBlockIdsToHtml(html);
    const lineDelta = range.lineStart - 1;
    return annotated
      .replace(
        /data-vivi-source-line-start="(\d+)"/g,
        (_match, value: string) =>
          `data-vivi-source-line-start="${Number(value) + lineDelta}"`,
      )
      .replace(
        /data-vivi-source-line-end="(\d+)"/g,
        (_match, value: string) =>
          `data-vivi-source-line-end="${Number(value) + lineDelta}"`,
      );
  };

  return marked.parser(tokens, { renderer }) as string;
}

export function markdownBodyLineOffset(markdown: string): number {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  if (!/^\uFEFF?---\s*$/.test(lines[0] ?? "")) return 0;
  const closingIndex = lines.findIndex(
    (line, index) => index > 0 && /^\uFEFF?---\s*$/.test(line),
  );
  if (closingIndex < 0) return 0;
  const firstBodyIndex =
    lines[closingIndex + 1] === "" ? closingIndex + 2 : closingIndex + 1;
  return firstBodyIndex;
}

function assignTokenRanges(
  tokens: Token[],
  source: string,
  lineOffset: number,
  ranges: WeakMap<object, MarkdownCommentBlockRange>,
  tableRows: WeakMap<object, MarkdownCommentBlockRange[]>,
  searchStart = 0,
): number {
  let cursor = searchStart;
  for (const token of tokens) {
    if (!("raw" in token) || typeof token.raw !== "string") continue;
    const start = findTokenStart(source, token.raw, cursor);
    const end = start + token.raw.length;
    const range = rangeForOffsets(source, start, end, lineOffset);
    cursor = Math.max(cursor, end);

    if (
      token.type === "heading" ||
      token.type === "paragraph" ||
      token.type === "code" ||
      token.type === "blockquote" ||
      (token.type === "html" && Boolean((token as Tokens.HTML).block))
    ) {
      ranges.set(token, range);
    }

    if (token.type === "list") {
      assignListItemRanges(
        token as Tokens.List,
        source,
        start,
        lineOffset,
        ranges,
        tableRows,
      );
    }

    if (token.type === "table") {
      tableRows.set(
        token,
        tableRowRanges(token as Tokens.Table, range.lineStart),
      );
    }
  }
  return cursor;
}

function assignListItemRanges(
  token: Tokens.List,
  source: string,
  listStart: number,
  lineOffset: number,
  ranges: WeakMap<object, MarkdownCommentBlockRange>,
  tableRows: WeakMap<object, MarkdownCommentBlockRange[]>,
): void {
  let cursor = listStart;
  for (const item of token.items) {
    const itemStart = findTokenStart(source, item.raw, cursor);
    const itemEnd = itemStart + item.raw.length;
    ranges.set(item, rangeForOffsets(source, itemStart, itemEnd, lineOffset));
    cursor = Math.max(cursor, itemEnd);
    const nestedLists = item.tokens.filter(
      (child): child is Tokens.List => child.type === "list",
    );
    for (const nested of nestedLists) {
      const nestedStart = findTokenStart(source, nested.raw, itemStart);
      assignListItemRanges(
        nested,
        source,
        nestedStart,
        lineOffset,
        ranges,
        tableRows,
      );
    }
  }
}

function tableRowRanges(
  token: Tokens.Table,
  tableStartLine: number,
): MarkdownCommentBlockRange[] {
  const lines = token.raw.replace(/\r\n?/g, "\n").split("\n");
  const rows: MarkdownCommentBlockRange[] = [];
  if (lines.length > 0) {
    rows.push({ lineStart: tableStartLine, lineEnd: tableStartLine });
  }
  for (let index = 2; index < lines.length; index += 1) {
    rows.push({
      lineStart: tableStartLine + index,
      lineEnd: tableStartLine + index,
    });
  }
  return rows;
}

function findTokenStart(source: string, raw: string, cursor: number): number {
  const exact = source.indexOf(raw, cursor);
  return exact >= 0 ? exact : cursor;
}

function rangeForOffsets(
  source: string,
  start: number,
  end: number,
  lineOffset: number,
): MarkdownCommentBlockRange {
  const meaningfulEnd = trimTrailingLineBreaks(source, start, end);
  return {
    lineStart: lineOffset + lineNumberAt(source, start),
    lineEnd:
      lineOffset + lineNumberAt(source, Math.max(start, meaningfulEnd - 1)),
  };
}

function trimTrailingLineBreaks(
  source: string,
  start: number,
  end: number,
): number {
  let cursor = end;
  while (cursor > start && /[\r\n]/.test(source[cursor - 1] ?? "")) {
    cursor -= 1;
  }
  return cursor;
}

function lineNumberAt(source: string, offset: number): number {
  return source.slice(0, offset).split(/\r?\n/).length;
}

function annotateFirstTag(
  html: string,
  tagPattern: string,
  range: MarkdownCommentBlockRange | undefined,
): string {
  if (!range) return html;
  return html.replace(
    new RegExp(`<(${tagPattern})(\\s[^>]*)?>`, "i"),
    (match) => addAttributes(match, range),
  );
}

function addAttributes(
  openingTag: string,
  range: MarkdownCommentBlockRange,
): string {
  return openingTag.replace(
    />$/,
    ` ${sourceStartAttribute}="${range.lineStart}" ${sourceEndAttribute}="${range.lineEnd}">`,
  );
}

function renderMermaidFigure(
  diagram: string,
  range: MarkdownCommentBlockRange | undefined,
): string {
  const attributes = range
    ? ` ${sourceStartAttribute}="${range.lineStart}" ${sourceEndAttribute}="${range.lineEnd}"`
    : "";
  const source = `<details class="markdown-mermaid-source"><summary>Mermaid source</summary><pre><code>${escapeHtml(diagram.trim())}</code></pre></details>`;
  return `<figure class="markdown-mermaid" data-mermaid-status="pending" data-mermaid-source="${escapeAttribute(diagram.trim())}"${attributes}><figcaption>Mermaid preview · strict security</figcaption><div class="mermaid-render-target"></div><div class="markdown-mermaid-fallback unsupported"><p>Mermaid preview is loading. Source is shown below if rendering fails.</p>${source}</div></figure>`;
}
