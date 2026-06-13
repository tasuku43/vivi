import type { FilePayload } from "../../domain/fs-node.js";
import { MarkdownViewer } from "../viewers/MarkdownViewer.js";
import { HtmlViewer } from "../viewers/HtmlViewer.js";
import { CodeViewer } from "../viewers/CodeViewer.js";
import { ImageViewer } from "../viewers/ImageViewer.js";

export function FileViewer({
  file,
  allowHtmlScripts,
}: {
  file: FilePayload | null;
  allowHtmlScripts: boolean;
}) {
  if (!file)
    return <div className="empty-viewer">Select a file from the tree.</div>;

  if (file.truncated) {
    return (
      <div className="unsupported">
        <h2>{file.path}</h2>
        <p>
          This file is {formatBytes(file.size)}, which is larger than the{" "}
          {formatBytes(file.maxSizeBytes ?? 0)} preview limit.
        </p>
      </div>
    );
  }

  if (file.viewerKind === "markdown") return <MarkdownViewer file={file} />;
  if (file.viewerKind === "html")
    return <HtmlViewer file={file} allowHtmlScripts={allowHtmlScripts} />;
  if (file.viewerKind === "code" || file.viewerKind === "json")
    return <CodeViewer file={file} />;
  if (file.viewerKind === "image") return <ImageViewer file={file} />;
  if (file.viewerKind === "text")
    return <pre className="plain-text">{file.content}</pre>;

  return (
    <div className="unsupported">
      <h2>{file.path}</h2>
      <p>This file type is not supported yet.</p>
    </div>
  );
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}
