export interface OutlineHeading {
  id: string;
  level: 1 | 2;
  text: string;
}

export function extractMarkdownOutline(markdown: string): OutlineHeading[] {
  return extractPlainHeadingOutline(
    markdown.split(/\r?\n/).flatMap((line) => {
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
  const htmlHeadings = [
    ...html.matchAll(/<h([12])\b([^>]*)>([\s\S]*?)<\/h\1>/gi),
  ].map((match) => {
    const existingId = /\sid\s*=\s*["']([^"']+)["']/i
      .exec(match[2])?.[1]
      ?.trim();
    return {
      existingId,
      level: Number(match[1]) as 1 | 2,
      text: stripTags(match[3]).trim(),
    };
  });
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
      return `<h${rawLevel}${rawAttributes} id="${escapeAttribute(heading.id)}">`;
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
      return `<h${rawLevel}${rawAttributes} id="${escapeAttribute(heading.id)}">`;
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
  return value.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ");
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}
