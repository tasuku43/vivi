export interface WorkbenchDeepLink {
  path: string;
  diff: boolean;
}

export function parseWorkbenchDeepLink(
  search: string,
): WorkbenchDeepLink | null {
  const params = new URLSearchParams(search.startsWith("?") ? search : `?${search}`);
  const path = (params.get("path") ?? params.get("file") ?? "").trim();
  if (!path) return null;
  return {
    path,
    diff: isTruthyDeepLinkFlag(params.get("diff")),
  };
}

function isTruthyDeepLinkFlag(value: string | null): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "head";
}
