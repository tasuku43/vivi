export type PathValidationResult =
  | { ok: true; relativePath: string }
  | { ok: false; reason: string };

export function normalizeRelativePath(input: string): PathValidationResult {
  const raw = input.trim().replace(/\\/g, "/");
  if (raw.includes("\0"))
    return { ok: false, reason: "path contains invalid characters" };
  if (raw === "" || raw === ".") return { ok: true, relativePath: "" };
  if (raw.startsWith("/"))
    return { ok: false, reason: "absolute paths are not allowed" };
  const segments: string[] = [];
  for (const segment of raw.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0)
        return { ok: false, reason: "path escapes root" };
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return { ok: true, relativePath: segments.join("/") };
}

export function isIgnoredPath(
  relativePath: string,
  ignoredNames = defaultIgnoredNames,
): boolean {
  return relativePath.split("/").some((segment) => ignoredNames.has(segment));
}

export type PathExcluder = (relativePath: string) => boolean;

export function createPathExcluder(values: string[] = []): PathExcluder {
  const patterns = values
    .flatMap((value) => value.split(","))
    .map((value) => compileExcludePattern(value))
    .filter((pattern): pattern is CompiledExcludePattern => Boolean(pattern));
  return (relativePath) => {
    const normalized = normalizeRelativePath(relativePath);
    if (!normalized.ok || !normalized.relativePath) return false;
    const target = normalized.relativePath.split("/");
    return patterns.some((pattern) =>
      matchExcludeSegments(pattern.segments, target),
    );
  };
}

interface CompiledExcludePattern {
  segments: Array<RegExp | "**">;
}

function compileExcludePattern(input: string): CompiledExcludePattern | null {
  let raw = input.trim().replace(/\\/g, "/");
  if (!raw) return null;
  const directoryPattern = raw.endsWith("/");
  raw = raw.replace(/^\.\//, "").replace(/^\//, "").replace(/\/$/, "");
  if (!raw) throw new Error(`invalid exclude glob ${JSON.stringify(input)}`);
  const sourceSegments = raw.split("/").filter((segment) => segment !== ".");
  if (sourceSegments.includes("..")) {
    throw new Error(
      `invalid exclude glob ${JSON.stringify(input)}: parent segments are not allowed`,
    );
  }
  const segments: Array<RegExp | "**"> = sourceSegments.map((segment) =>
    segment === "**" ? "**" : compileGlobSegment(segment, input),
  );
  if (!raw.includes("/")) segments.unshift("**");
  if (directoryPattern) segments.push("**");
  return { segments };
}

function compileGlobSegment(segment: string, input: string): RegExp {
  let source = "";
  for (let index = 0; index < segment.length; index += 1) {
    const character = segment[index]!;
    if (character === "*") {
      source += ".*";
      continue;
    }
    if (character === "?") {
      source += ".";
      continue;
    }
    if (character === "[") {
      const end = segment.indexOf("]", index + 1);
      if (end < 0) {
        throw new Error(`invalid exclude glob ${JSON.stringify(input)}`);
      }
      let content = segment.slice(index + 1, end);
      if (content.startsWith("!")) content = `^${content.slice(1)}`;
      source += `[${content.replace(/\\/g, "\\\\")}]`;
      index = end;
      continue;
    }
    source += character.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${source}$`);
}

function matchExcludeSegments(
  pattern: Array<RegExp | "**">,
  target: string[],
): boolean {
  if (pattern.length === 0) return target.length === 0;
  const [head, ...rest] = pattern;
  if (head === "**") {
    return (
      matchExcludeSegments(rest, target) ||
      (target.length > 0 && matchExcludeSegments(pattern, target.slice(1)))
    );
  }
  return (
    target.length > 0 &&
    head.test(target[0]!) &&
    matchExcludeSegments(rest, target.slice(1))
  );
}

export const defaultIgnoredNames = new Set([
  ".git",
  "node_modules",
  ".turbo",
  ".next",
  ".cache",
  ".parcel-cache",
  ".vite",
  ".tmp-go-build-cache",
  ".tmp-go-mod-cache",
  "dist",
  "coverage",
  "storybook-static",
]);
