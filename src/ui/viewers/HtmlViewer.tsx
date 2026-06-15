import { useState } from "react";
import type { TextDiff } from "../../domain/change-review.js";
import type { FilePayload } from "../../domain/fs-node.js";
import type { ResolvedTheme } from "../state/theme.js";
import type { ViewerMode } from "../state/viewer-mode.js";
import { DiffViewer } from "./DiffViewer.js";

export function HtmlViewer({
  file,
  allowHtmlScripts,
  mode: controlledMode,
  diff,
  diffLoading,
  diffEnabled,
  diffFocusChanges,
  theme = "dark",
  onModeChange,
  onDiffToggle,
  onDiffFocusChange,
}: {
  file: FilePayload;
  allowHtmlScripts: boolean;
  mode?: ViewerMode;
  diff?: TextDiff | null;
  diffLoading?: boolean;
  diffEnabled?: boolean;
  diffFocusChanges?: boolean;
  theme?: ResolvedTheme;
  onModeChange?: (mode: ViewerMode) => void;
  onDiffToggle?: () => void;
  onDiffFocusChange?: (focusChanges: boolean) => void;
}) {
  const [localMode, setLocalMode] = useState<ViewerMode>("preview");
  const mode =
    controlledMode === "source" || controlledMode === "preview"
      ? controlledMode
      : localMode;
  const setMode = (nextMode: ViewerMode) => {
    setLocalMode(nextMode);
    onModeChange?.(nextMode);
  };

  return (
    <section className="html-viewer">
      <div className="viewer-toolbar">
        <strong>{file.path}</strong>
        <span className="sandbox-status">
          sandboxed · scripts {allowHtmlScripts ? "on" : "off"}
        </span>
        <div className="viewer-toolbar-actions">
          <div className="segmented-control" aria-label="HTML view mode">
            <button
              className={mode === "preview" ? "active" : ""}
              type="button"
              onClick={() => setMode("preview")}
            >
              Preview
            </button>
            <button
              className={mode === "source" ? "active" : ""}
              type="button"
              onClick={() => setMode("source")}
            >
              Source
            </button>
          </div>
          <button
            aria-pressed={Boolean(diffEnabled)}
            className={`diff-toggle${diffEnabled ? " active" : ""}`}
            type="button"
            onClick={onDiffToggle}
          >
            Diff from HEAD
          </button>
        </div>
      </div>
      {diffEnabled ? (
        <DiffViewer
          path={file.path}
          diff={diff ?? null}
          loading={diffLoading}
          focusChanges={diffFocusChanges}
          renderKind={mode === "source" ? "source" : "html"}
          theme={theme}
          onFocusChangesChange={onDiffFocusChange}
        />
      ) : mode === "preview" ? (
        <iframe
          className="html-frame"
          title={file.path}
          sandbox={
            allowHtmlScripts ? "allow-scripts allow-same-origin" : "allow-scripts"
          }
          src={`/preview/html?path=${encodeURIComponent(file.path)}&theme=${theme}`}
        />
      ) : (
        <pre className="markdown-source">{file.content}</pre>
      )}
    </section>
  );
}
