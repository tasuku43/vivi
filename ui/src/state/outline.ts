import { parseMarkdownFrontMatter } from "./markdown-frontmatter.js";

export interface OutlineHeading {
  id: string;
  level: 1 | 2;
  text: string;
}

export function extractMarkdownOutline(markdown: string): OutlineHeading[] {
  const frontMatter = parseMarkdownFrontMatter(markdown);
  const body = frontMatter.status === "none" ? markdown : frontMatter.body;
  return extractPlainHeadingOutline(
    body.split(/\r?\n/).flatMap((line) => {
      const match = /^(#{1,2})\s+(.+?)\s*$/.exec(line);
      if (!match) return [];
      return [
        {
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
  items: Array<{ level: 1 | 2; text: string; existingId?: string }>,
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
    outline.push({ id, level, text });
  }

  return outline;
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

function tagNameFromOpeningTag(tag: string): string | null {
  const trimmed = tag.slice(1).trimStart();
  let name = "";
  for (const character of trimmed) {
    if (!/[a-z0-9]/i.test(character)) break;
    name += character.toLowerCase();
  }
  return name || null;
}
