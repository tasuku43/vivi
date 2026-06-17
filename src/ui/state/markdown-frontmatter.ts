export type FrontMatterValue =
  | string
  | boolean
  | number
  | null
  | FrontMatterValue[]
  | { [key: string]: FrontMatterValue };

export interface FrontMatterEntry {
  key: string;
  value: FrontMatterValue;
}

export type ParsedFrontMatter =
  | { status: "none"; body: string }
  | {
      status: "valid";
      raw: string;
      body: string;
      entries: FrontMatterEntry[];
    }
  | {
      status: "invalid";
      raw: string;
      body: string;
      error: string;
    };

export function parseMarkdownFrontMatter(markdown: string): ParsedFrontMatter {
  const normalized = markdown.replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");
  if (!isFence(lines[0])) return { status: "none", body: markdown };

  const closingIndex = lines.findIndex(
    (line, index) => index > 0 && isFence(line),
  );
  if (closingIndex === -1) {
    return {
      status: "invalid",
      raw: lines.slice(1).join("\n"),
      body: "",
      error: "Missing closing front matter delimiter.",
    };
  }

  const raw = lines.slice(1, closingIndex).join("\n");
  const body = lines
    .slice(closingIndex + 1)
    .join("\n")
    .replace(/^\n/, "");
  const parsed = parseYamlLikeEntries(raw);
  if (!parsed.ok) {
    return { status: "invalid", raw, body, error: parsed.error };
  }
  return { status: "valid", raw, body, entries: parsed.entries };
}

function parseYamlLikeEntries(
  raw: string,
): { ok: true; entries: FrontMatterEntry[] } | { ok: false; error: string } {
  const lines = raw.split("\n");
  const entries: FrontMatterEntry[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim() || line.trimStart().startsWith("#")) {
      index += 1;
      continue;
    }

    const match = /^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/.exec(line);
    if (!match) {
      return {
        ok: false,
        error: `Could not parse front matter line ${index + 1}.`,
      };
    }

    const key = match[1];
    const inlineValue = match[2];
    index += 1;

    const blockLines: string[] = [];
    while (
      index < lines.length &&
      !/^([A-Za-z0-9_.-]+)\s*:\s*/.test(lines[index])
    ) {
      blockLines.push(lines[index]);
      index += 1;
    }

    const value =
      inlineValue.trim() === ""
        ? parseNestedValue(blockLines)
        : parseScalarValue(inlineValue.trim());
    entries.push({ key, value });
  }

  return { ok: true, entries };
}

function parseNestedValue(lines: string[]): FrontMatterValue {
  const meaningful = lines.filter((line) => line.trim());
  if (meaningful.length === 0) return "";

  if (meaningful.every((line) => /^\s*[-*]\s+/.test(line))) {
    return meaningful.map((line) =>
      parseScalarValue(line.replace(/^\s*[-*]\s+/, "").trim()),
    );
  }

  const object: { [key: string]: FrontMatterValue } = {};
  let matchedObject = false;
  let index = 0;
  while (index < meaningful.length) {
    const match = /^\s+([A-Za-z0-9_.-]+)\s*:\s*(.*)$/.exec(meaningful[index]);
    if (!match) return meaningful.join("\n").trim();

    matchedObject = true;
    const key = match[1];
    const inlineValue = match[2];
    index += 1;

    const nestedLines: string[] = [];
    while (
      index < meaningful.length &&
      !/^\s+([A-Za-z0-9_.-]+)\s*:\s*/.test(meaningful[index])
    ) {
      nestedLines.push(meaningful[index]);
      index += 1;
    }

    object[key] =
      inlineValue.trim() === ""
        ? parseNestedValue(nestedLines)
        : parseScalarValue(inlineValue.trim());
  }

  return matchedObject ? object : meaningful.join("\n").trim();
}

function parseScalarValue(value: string): FrontMatterValue {
  const trimmed = value.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null" || trimmed === "~") return null;
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    const inner = trimmed.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(",").map((item) => parseScalarValue(item.trim()));
  }
  return trimmed;
}

function isFence(line: string | undefined): boolean {
  return /^\uFEFF?---\s*$/.test(line ?? "");
}
