import viewerMessageStyles from "../../shared/components/ViewerMessage.module.css";

export interface WorkbenchErrorMessageProps {
  error: string;
  path?: string | null;
  sourceMissing?: boolean;
}

export function WorkbenchErrorMessage({
  error,
  path,
  sourceMissing = false,
}: WorkbenchErrorMessageProps) {
  const content = workbenchErrorContent(error, { path, sourceMissing });
  return (
    <div
      className={`${viewerMessageStyles.error} viewer-error`}
      role="alert"
    >
      <strong>{content.title}</strong>
      <span>{content.detail}</span>
    </div>
  );
}

export function workbenchErrorContent(
  error: string,
  options: { path?: string | null; sourceMissing?: boolean } = {},
): {
  title: string;
  detail: string;
} {
  const message = error.trim();
  if (options.sourceMissing || isMissingSourceFailure(message)) {
    const label = options.path ? basenameForPath(options.path) : "This file";
    return {
      title: "Source missing",
      detail: `${label} is not present in this workspace. The comment is still available so you can resolve, archive, or re-anchor it.`,
    };
  }
  if (isFetchFailure(message)) {
    return {
      title: "Preview unavailable",
      detail:
        "Vivi could not load this preview. Select the file again after the server is ready.",
    };
  }
  return {
    title: "Preview unavailable",
    detail: message || "The preview could not be loaded.",
  };
}

function isFetchFailure(message: string): boolean {
  return /^typeerror:\s*failed to fetch$/i.test(message);
}

function isMissingSourceFailure(message: string): boolean {
  return /\bno such file or directory\b/i.test(message);
}

function basenameForPath(path: string): string {
  return path.split("/").filter(Boolean).at(-1) ?? path;
}
