import { parseMarkdownFrontMatter } from "./markdown-frontmatter.js";

export interface OutlineHeading {
  id: string;
  lineStart?: number;
  level: 1 | 2;
  text: string;
}

export function extractMarkdownOutline(markdown: string): OutlineHeading[] {
  const frontMatter = parseMarkdownFrontMatter(markdown);
  if (frontMatter.status === "invalid" && !frontMatter.body) return [];
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const startIndex = markdownBodyStartIndex(lines);
  return extractPlainHeadingOutline(
    lines.slice(startIndex).flatMap((line, index) => {
      const match = /^(#{1,2})\s+(.+?)\s*$/.exec(line);
      if (!match) return [];
      return [
        {
          lineStart: startIndex + index + 1,
          level: match[1].length as 1 | 2,
          text: match[2].replace(/#+\s*$/, "").trim(),
        },
      ];
    }),
  );
}

export function extractHtmlOutline(html: string): OutlineHeading[] {
  const htmlHeadings: Array<{
    level: 1 | 2;
    lineStart?: number;
    text: string;
    existingId?: string;
  }> = [];
  let index = 0;
  while (index < html.length) {
    const start = findNextHeadingStart(html, index);
    if (start === -1) break;
    const level = html[start + 2];
    const tagEnd = findTagEnd(html, start);
    if (tagEnd === -1 || (level !== "1" && level !== "2")) break;
    const openingTag = html.slice(start, tagEnd + 1);
    const closingTag = `</h${level}>`;
    const closeStart = html.toLowerCase().indexOf(closingTag, tagEnd + 1);
    if (closeStart === -1) {
      index = tagEnd + 1;
      continue;
    }
    const existingId = /\sid\s*=\s*["']([^"']+)["']/i
      .exec(openingTag)?.[1]
      ?.trim();
    htmlHeadings.push({
      existingId,
      lineStart: lineNumberAt(html, start),
      level: Number(level) as 1 | 2,
      text: stripTags(html.slice(tagEnd + 1, closeStart)).trim(),
    });
    index = closeStart + closingTag.length;
  }
  return extractPlainHeadingOutline(htmlHeadings);
}

export function renderMarkdownHtmlWithHeadingIds(
  html: string,
  outline: OutlineHeading[],
): string {
  let index = 0;
  return html.replace(
    /<h([12])(\s[^>]*)?>/gi,
    (match, rawLevel: string, rawAttributes = "") => {
      const heading = outline[index];
      index += 1;
      if (
        !heading ||
        Number(rawLevel) !== heading.level ||
        /\sid\s*=/i.test(rawAttributes)
      )
        return match;
      return `<h${rawLevel} id="${escapeAttribute(heading.id)}"${rawAttributes}>`;
    },
  );
}

export function addHtmlHeadingIds(html: string): string {
  const outline = extractHtmlOutline(html);
  let index = 0;
  return html.replace(
    /<h([12])(\s[^>]*)?>/gi,
    (match, rawLevel: string, rawAttributes = "") => {
      const heading = outline[index];
      index += 1;
      if (
        !heading ||
        Number(rawLevel) !== heading.level ||
        /\sid\s*=/i.test(rawAttributes)
      )
        return match;
      return `<h${rawLevel} id="${escapeAttribute(heading.id)}"${rawAttributes}>`;
    },
  );
}

function extractPlainHeadingOutline(
  items: Array<{
    level: 1 | 2;
    lineStart?: number;
    text: string;
    existingId?: string;
  }>,
): OutlineHeading[] {
  const outline: OutlineHeading[] = [];
  const used = new Map<string, number>();

  for (const item of items) {
    const level = item.level;
    const text = item.text;
    if (!text) continue;

    const base =
      item.existingId || slugify(text) || `heading-${outline.length + 1}`;
    const count = used.get(base) ?? 0;
    used.set(base, count + 1);
    const id = count === 0 ? base : `${base}-${count + 1}`;
    outline.push({
      id,
      lineStart: item.lineStart,
      level,
      text,
    });
  }

  return outline;
}

function markdownBodyStartIndex(lines: string[]): number {
  if (!isFence(lines[0])) return 0;
  const closingIndex = lines.findIndex(
    (line, index) => index > 0 && isFence(line),
  );
  if (closingIndex === -1) return lines.length;
  return closingIndex + 1;
}

function isFence(line: string | undefined): boolean {
  return line?.trim() === "---";
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/`([^`]+)`/g, "$1")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

function stripTags(value: string): string {
  let output = "";
  let index = 0;
  while (index < value.length) {
    const tagStart = value.indexOf("<", index);
    if (tagStart === -1) {
      output += value.slice(index);
      break;
    }
    output += value.slice(index, tagStart);
    const tagEnd = findTagEnd(value, tagStart);
    if (tagEnd === -1) break;
    const tagName = tagNameFromOpeningTag(value.slice(tagStart, tagEnd + 1));
    if (tagName === "script" || tagName === "style") {
      const closeTag = `</${tagName}>`;
      const closeStart = value.toLowerCase().indexOf(closeTag, tagEnd + 1);
      index = closeStart === -1 ? tagEnd + 1 : closeStart + closeTag.length;
      continue;
    }
    index = tagEnd + 1;
  }
  return output.replace(/&nbsp;/g, " ");
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

function findTagEnd(value: string, start: number): number {
  let quote: string | null = null;
  for (let index = start + 1; index < value.length; index += 1) {
    const character = value[index];
    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === `"` || character === `'`) {
      quote = character;
      continue;
    }
    if (character === ">") return index;
  }
  return -1;
}

function findNextHeadingStart(html: string, from: number): number {
  for (let index = from; index < html.length - 2; index += 1) {
    if (html[index] !== "<") continue;
    const h = html[index + 1];
    const level = html[index + 2];
    if ((h !== "h" && h !== "H") || (level !== "1" && level !== "2")) {
      continue;
    }
    const boundary = html[index + 3];
    if (boundary === ">" || boundary === "/" || /\s/.test(boundary ?? "")) {
      return index;
    }
  }
  return -1;
}

function lineNumberAt(value: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset; index += 1) {
    if (value[index] === "\n") line += 1;
  }
  return line;
}

function tagNameFromOpeningTag(tag: string): string | null {
  const trimmed = tag.slice(1).trimStart();
  let name = "";
  for (const character of trimmed) {
    if (!/[a-z0-9]/i.test(character)) break;
    name += character.toLowerCase();
  }
  return name || null;
}
