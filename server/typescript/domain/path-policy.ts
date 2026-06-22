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
