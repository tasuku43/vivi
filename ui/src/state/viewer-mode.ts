import type { FilePayload } from "../domain/fs-node.js";
import type { ViewerKind } from "../domain/viewer-kind.js";

export type ViewerMode = "rendered" | "preview" | "source";

export type DiffSupport =
  | { supported: true; renderKind: "source" | "markdown" | "html" }
  | { supported: false; reason: string };

export const diffUnsupportedViewerKinds: ReadonlyArray<{
  supported: false;
  viewerKind: ViewerKind;
  extensions: readonly string[];
  reason: string;
}> = [];

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
  return diffSupportForFile(file).supported;
}

export function diffSupportForFile(
  file: Pick<FilePayload, "viewerKind" | "encoding"> | null,
): DiffSupport {
  if (!file) return { supported: false, reason: "No active file." };
  if (file.viewerKind === "image")
    return { supported: true, renderKind: "source" };
  if (file.encoding !== "utf8") {
    return {
      supported: false,
      reason: "Only UTF-8 text payloads can use line diff.",
    };
  }
  if (file.viewerKind === "markdown")
    return { supported: true, renderKind: "markdown" };
  if (file.viewerKind === "html")
    return { supported: true, renderKind: "html" };
  if (
    file.viewerKind === "code" ||
    file.viewerKind === "json" ||
    file.viewerKind === "text" ||
    file.viewerKind === "mermaid" ||
    file.viewerKind === "unsupported"
  )
    return { supported: true, renderKind: "source" };
  return (
    diffUnsupportedViewerKinds.find(
      (item) => item.viewerKind === file.viewerKind,
    ) ?? {
      supported: false,
      reason: "This viewer kind does not have a diff renderer yet.",
    }
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
  return "Source";
}
