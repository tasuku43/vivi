export function resolveWorkspaceLink(
  currentPath: string,
  href: string,
): string | null {
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("//")) {
    return null;
  }
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(trimmed)) return null;

  const pathPart = trimmed.split("#", 1)[0]?.split("?", 1)[0] ?? "";
  if (!pathPart) return null;

  const decoded = decodeHrefPath(pathPart);
  if (!decoded) return null;

  const candidate = decoded.startsWith("/")
    ? decoded.slice(1)
    : joinWorkspacePath(parentWorkspacePath(currentPath), decoded);
  return normalizeWorkspacePath(candidate);
}

function decodeHrefPath(path: string): string | null {
  try {
    return decodeURI(path);
  } catch {
    return null;
  }
}

function parentWorkspacePath(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");
  return index >= 0 ? normalized.slice(0, index) : "";
}

function joinWorkspacePath(parent: string, child: string): string {
  return parent ? `${parent}/${child}` : child;
}

function normalizeWorkspacePath(path: string): string | null {
  const parts: string[] = [];
  for (const part of path.replace(/\\/g, "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!parts.length) return null;
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.length ? parts.join("/") : null;
}

export function workspaceImageUrl(
  currentPath: string,
  source: string,
): string | null {
  const path = resolveWorkspaceLink(currentPath, source);
  if (!path) return null;
  const fragment = source.includes("#")
    ? source.slice(source.indexOf("#"))
    : "";
  return `/preview/raw/${path.split("/").map(encodeURIComponent).join("/")}${fragment}`;
}
