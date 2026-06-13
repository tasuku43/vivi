import type { FilePayload } from "../../domain/fs-node.js";

export function ImageViewer({ file }: { file: FilePayload }) {
  const src =
    file.encoding === "base64" && file.mimeType
      ? `data:${file.mimeType};base64,${file.content}`
      : "";
  if (!src) {
    return (
      <div className="unsupported">
        <h2>{file.path}</h2>
        <p>This image could not be previewed.</p>
      </div>
    );
  }
  return <img className="image-preview" src={src} alt={file.path} />;
}
