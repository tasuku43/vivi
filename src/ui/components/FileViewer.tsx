import type { TextDiff } from "../../domain/change-review.js";
import type { FilePayload } from "../../domain/fs-node.js";
import { MarkdownViewer } from "../viewers/MarkdownViewer.js";
import { HtmlViewer } from "../viewers/HtmlViewer.js";
import { CodeViewer } from "../viewers/CodeViewer.js";
import { CsvViewer, isDelimitedPath } from "../viewers/CsvViewer.js";
import { ImageViewer } from "../viewers/ImageViewer.js";
import { JsonViewer } from "../viewers/JsonViewer.js";
import { LargeTextPreview } from "../viewers/LargeTextPreview.js";
import { MermaidViewer } from "../viewers/MermaidViewer.js";
import { TextViewer } from "../viewers/TextViewer.js";
import type { LineRange } from "../state/code-viewer.js";
import type { ResolvedTheme } from "../state/theme.js";
import type { ViewerMode } from "../state/viewer-mode.js";

export function FileViewer({
  file,
  allowHtmlScripts,
  theme,
  selectedCodeRange,
  viewerMode,
  diff,
  diffLoading,
  refreshedAt,
  onCodeSelectionChange,
  onViewerModeChange,
  onReloadDiff,
}: {
  file: FilePayload | null;
  allowHtmlScripts: boolean;
  theme: ResolvedTheme;
  selectedCodeRange: LineRange | null;
  viewerMode?: ViewerMode;
  diff?: TextDiff | null;
  diffLoading?: boolean;
  refreshedAt?: number;
  onCodeSelectionChange: (range: LineRange | null) => void;
  onViewerModeChange?: (mode: ViewerMode) => void;
  onReloadDiff?: () => void;
}) {
  if (!file)
    return <div className="empty-viewer">Select a file from the tree.</div>;

  if (file.truncated) {
    if (file.encoding === "utf8" && file.content)
      return <LargeTextPreview file={file} />;
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

  if (file.viewerKind === "markdown")
    return (
      <MarkdownViewer
        file={file}
        mode={viewerMode}
        diff={diff}
        diffLoading={diffLoading}
        onModeChange={onViewerModeChange}
        onReloadDiff={onReloadDiff}
      />
    );
  if (file.viewerKind === "html")
    return (
      <HtmlViewer
        file={file}
        allowHtmlScripts={allowHtmlScripts}
        mode={viewerMode}
        diff={diff}
        diffLoading={diffLoading}
        onModeChange={onViewerModeChange}
        onReloadDiff={onReloadDiff}
      />
    );
  if (file.viewerKind === "json") return <JsonViewer file={file} />;
  if (file.viewerKind === "mermaid") return <MermaidViewer file={file} />;
  if (file.viewerKind === "code")
    return (
      <CodeViewer
        file={file}
        theme={theme}
        selectedRange={selectedCodeRange}
        refreshedAt={refreshedAt}
        mode={viewerMode}
        diff={diff}
        diffLoading={diffLoading}
        onSelectionChange={onCodeSelectionChange}
        onModeChange={onViewerModeChange}
        onReloadDiff={onReloadDiff}
      />
    );
  if (file.viewerKind === "text" && isDelimitedPath(file.path))
    return <CsvViewer file={file} />;
  if (file.viewerKind === "image") return <ImageViewer file={file} />;
  if (file.viewerKind === "text") return <TextViewer file={file} />;

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
