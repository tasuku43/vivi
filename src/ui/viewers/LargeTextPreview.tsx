import { useState } from "react";
import type { FilePayload } from "../../domain/fs-node.js";

export function LargeTextPreview({ file }: { file: FilePayload }) {
  const [wrap, setWrap] = useState(true);
  return (
    <section className="text-viewer large-text-preview">
      <div className="text-toolbar">
        <div>
          <strong>{file.path}</strong>
          <small>
            partial preview · {formatBytes(file.previewBytes ?? 0)} of{" "}
            {formatBytes(file.size)}
          </small>
        </div>
        <button type="button" onClick={() => setWrap((value) => !value)}>
          {wrap ? "No wrap" : "Wrap"}
        </button>
      </div>
      <div className="large-preview-note">
        This file is larger than the {formatBytes(file.maxSizeBytes ?? 0)} rich
        preview limit, so pathlens is showing the first readable chunk only.
      </div>
      <pre className={wrap ? "plain-text wrap" : "plain-text no-wrap"}>
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
