import { useState } from "react";
import type { FilePayload } from "../../../domain/fs-node.js";
import { ViewerToolbar } from "../components/ViewerControlButton.js";
import surfaceStyles from "./ViewerSurface.module.css";

export function LargeTextPreview({ file }: { file: FilePayload }) {
  const [wrap, setWrap] = useState(true);
  return (
    <section
      className={`${surfaceStyles.textViewer} text-viewer large-text-preview`}
    >
      <ViewerToolbar
        ariaLabel={`Large text viewer controls for ${file.path}`}
        status={
          <>
            partial preview · {formatBytes(file.previewBytes ?? 0)} of{" "}
            {formatBytes(file.size)}
          </>
        }
      >
        <button type="button" onClick={() => setWrap((value) => !value)}>
          {wrap ? "No wrap" : "Wrap"}
        </button>
      </ViewerToolbar>
      <div className={`${surfaceStyles.largePreviewNote} large-preview-note`}>
        This file is larger than the {formatBytes(file.maxSizeBytes ?? 0)} rich
        preview limit, so Vivi is showing the first readable chunk only.
      </div>
      <pre
        className={
          wrap
            ? `${surfaceStyles.plainText} ${surfaceStyles.plainTextBlock} plain-text wrap`
            : `${surfaceStyles.plainText} ${surfaceStyles.plainTextBlock} ${surfaceStyles.plainTextNoWrap} plain-text no-wrap`
        }
      >
        {file.content}
      </pre>
    </section>
  );
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}
