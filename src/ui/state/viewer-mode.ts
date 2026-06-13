import type { FilePayload } from "../../domain/fs-node.js";

export type ViewerMode = "rendered" | "preview" | "source" | "diff";

export function defaultViewerMode(
  file: Pick<FilePayload, "viewerKind">,
): ViewerMode {
  if (file.viewerKind === "html") return "preview";
  if (file.viewerKind === "markdown") return "rendered";
  return "source";
}

export function supportsSourceToggle(
  file: Pick<FilePayload, "viewerKind"> | null,
): boolean {
  return file?.viewerKind === "markdown" || file?.viewerKind === "html";
}

export function supportsDiffMode(
  file: Pick<FilePayload, "viewerKind" | "encoding"> | null,
): boolean {
  if (!file || file.encoding !== "utf8") return false;
  return (
    file.viewerKind === "markdown" ||
    file.viewerKind === "html" ||
    file.viewerKind === "code"
  );
}

export function nextViewerMode(
  file: Pick<FilePayload, "viewerKind"> | null,
  current?: ViewerMode,
): ViewerMode | null {
  if (!file) return null;
  if (file.viewerKind === "markdown")
    return current === "source" ? "rendered" : "source";
  if (file.viewerKind === "html")
    return current === "source" ? "preview" : "source";
  return null;
}

export function modeLabel(mode: ViewerMode): string {
  if (mode === "rendered") return "Rendered";
  if (mode === "preview") return "Preview";
  if (mode === "diff") return "Diff from HEAD";
  return "Source";
}
