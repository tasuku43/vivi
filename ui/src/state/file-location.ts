export interface FileLocationSegment {
  label: string;
  path: string;
  kind: "directory" | "file";
}

export function fileLocationSegments(path: string): FileLocationSegment[] {
  const parts = path.split("/").filter(Boolean);
  return parts.map((label, index) => ({
    label,
    path: parts.slice(0, index + 1).join("/"),
    kind: index === parts.length - 1 ? "file" : "directory",
  }));
}

export function fileLocationSummary(path: string): string {
  const segments = fileLocationSegments(path);
  if (!segments.length) return path;
  if (segments.length === 1) return segments[0]!.label;
  return `${segments.at(-2)!.label} / ${segments.at(-1)!.label}`;
}
