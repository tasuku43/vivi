import type { FilePayload } from "../../domain/fs-node.js";
import { languageForPath } from "./file-icons.js";

export interface LineRange {
  start: number;
  end: number;
}

export interface CodeSymbol {
  kind: "import" | "export" | "function" | "class" | "heading";
  name: string;
  line: number;
}

export function splitCodeLines(content: string): string[] {
  const lines = content.split(/\r?\n/);
  if (lines.length > 1 && lines.at(-1) === "") return lines.slice(0, -1);
  return lines;
}

export function normalizeLineRange(
  start: number,
  end: number,
  lineCount: number,
): LineRange {
  const safeStart = clampLine(start, lineCount);
  const safeEnd = clampLine(end, lineCount);
  return {
    start: Math.min(safeStart, safeEnd),
    end: Math.max(safeStart, safeEnd),
  };
}

export function lineInRange(line: number, range: LineRange | null): boolean {
  return !!range && line >= range.start && line <= range.end;
}

export function formatLineReference(path: string, range: LineRange): string {
  return range.start === range.end
    ? `${path}:${range.start}`
    : `${path}:${range.start}-${range.end}`;
}

export function formatSelectedCodeWithLineNumbers(
  path: string,
  content: string,
  range: LineRange,
): string {
  const lines = splitCodeLines(content);
  const safeRange = normalizeLineRange(range.start, range.end, lines.length);
  const width = String(safeRange.end).length;
  const selected = lines
    .slice(safeRange.start - 1, safeRange.end)
    .map(
      (line, index) =>
        `${String(safeRange.start + index).padStart(width, " ")} | ${line}`,
    )
    .join("\n");
  return `${formatLineReference(path, safeRange)}\n${selected}`;
}

export function buildCodeMetadata(
  file: FilePayload,
  selected: LineRange | null,
) {
  const lines = splitCodeLines(file.content);
  return {
    path: file.path,
    language: languageForPath(file.path, file.viewerKind),
    lineCount: lines.length,
    symbols: detectCodeSymbols(file.path, file.content),
    selectedReference: selected
      ? formatLineReference(
          file.path,
          normalizeLineRange(selected.start, selected.end, lines.length),
        )
      : null,
  };
}

export function detectCodeSymbols(path: string, content: string): CodeSymbol[] {
  const language = languageForPath(path, "code");
  const symbols: CodeSymbol[] = [];
  const lines = splitCodeLines(content);

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    const trimmed = line.trim();
    if (!trimmed) return;

    if (language === "markdown") {
      const match = /^(#{1,3})\s+(.+?)\s*$/.exec(trimmed);
      if (match) {
        symbols.push({
          kind: "heading",
          name: match[2].replace(/#+\s*$/, "").trim(),
          line: lineNumber,
        });
      }
      return;
    }

    const importMatch =
      /^import\s+(?:type\s+)?(.+?)\s+from\s+["'][^"']+["']/.exec(trimmed);
    if (importMatch) {
      symbols.push({
        kind: "import",
        name: summarizeImport(importMatch[1]),
        line: lineNumber,
      });
      return;
    }

    const exportNamedMatch =
      /^export\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var|interface|type|enum)\s+([A-Za-z_$][\w$]*)/.exec(
        trimmed,
      );
    if (exportNamedMatch) {
      symbols.push({
        kind: "export",
        name: exportNamedMatch[1],
        line: lineNumber,
      });
      return;
    }

    const functionMatch =
      /^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)|^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>|^([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/.exec(
        trimmed,
      );
    if (functionMatch) {
      const name = functionMatch[1] ?? functionMatch[2] ?? functionMatch[3];
      if (isControlKeyword(name)) return;
      symbols.push({
        kind: "function",
        name,
        line: lineNumber,
      });
      return;
    }

    const classMatch = /^class\s+([A-Za-z_$][\w$]*)/.exec(trimmed);
    if (classMatch) {
      symbols.push({ kind: "class", name: classMatch[1], line: lineNumber });
    }
  });

  return symbols.slice(0, 80);
}

function isControlKeyword(name: string): boolean {
  return new Set([
    "catch",
    "do",
    "else",
    "finally",
    "for",
    "if",
    "switch",
    "try",
    "while",
    "with",
  ]).has(name);
}

export function currentScopeForLine(
  symbols: CodeSymbol[],
  line: number,
): CodeSymbol | null {
  const scopeKinds = new Set<CodeSymbol["kind"]>([
    "export",
    "function",
    "class",
    "heading",
  ]);
  let current: CodeSymbol | null = null;
  for (const symbol of symbols) {
    if (symbol.line > line) break;
    if (scopeKinds.has(symbol.kind)) current = symbol;
  }
  return current;
}

function clampLine(line: number, lineCount: number): number {
  if (!Number.isFinite(line)) return 1;
  return Math.min(Math.max(Math.trunc(line), 1), Math.max(lineCount, 1));
}

function summarizeImport(value: string): string {
  return value
    .replace(/[{}]/g, "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 3)
    .join(", ");
}
