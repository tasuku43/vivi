import { useState } from "react";
import type { TextDiff } from "../../domain/change-review.js";
import type { FilePayload } from "../../domain/fs-node.js";
import type { ViewerMode } from "../state/viewer-mode.js";
import { DiffViewer } from "./DiffViewer.js";

export function HtmlViewer({
  file,
  allowHtmlScripts,
  mode: controlledMode,
  diff,
  diffLoading,
  onModeChange,
  onReloadDiff,
}: {
  file: FilePayload;
  allowHtmlScripts: boolean;
  mode?: ViewerMode;
  diff?: TextDiff | null;
  diffLoading?: boolean;
  onModeChange?: (mode: ViewerMode) => void;
  onReloadDiff?: () => void;
}) {
  const [localMode, setLocalMode] = useState<ViewerMode>("preview");
  const mode =
    controlledMode === "source" ||
    controlledMode === "preview" ||
    controlledMode === "diff"
      ? controlledMode
      : localMode;
  const setMode = (nextMode: ViewerMode) => {
    setLocalMode(nextMode);
    onModeChange?.(nextMode);
  };

  if (mode === "diff") {
    return (
      <DiffViewer
        path={file.path}
        diff={diff ?? null}
        loading={diffLoading}
        renderKind="html"
        sourceMode="preview"
        onModeChange={setMode}
        onReload={onReloadDiff}
      />
    );
  }

  return (
    <section className="html-viewer">
      <div className="viewer-toolbar">
        <strong>{file.path}</strong>
        <span className="sandbox-status">
          sandboxed · scripts {allowHtmlScripts ? "on" : "off"}
        </span>
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
          <button type="button" onClick={() => setMode("diff")}>
            Diff from HEAD
          </button>
        </div>
      </div>
      {mode === "preview" ? (
        <iframe
          className="html-frame"
          title={file.path}
          sandbox={allowHtmlScripts ? "allow-scripts allow-same-origin" : ""}
          src={`/preview/html?path=${encodeURIComponent(file.path)}`}
        />
      ) : (
        <pre className="markdown-source">{file.content}</pre>
      )}
    </section>
  );
}
