import type { FilePayload } from "../../domain/fs-node.js";

export function HtmlViewer({
  file,
  allowHtmlScripts,
}: {
  file: FilePayload;
  allowHtmlScripts: boolean;
}) {
  return (
    <iframe
      className="html-frame"
      title={file.path}
      sandbox={allowHtmlScripts ? "allow-scripts allow-same-origin" : ""}
      src={`/preview/html?path=${encodeURIComponent(file.path)}`}
    />
  );
}
