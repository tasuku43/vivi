import type { FilePayload } from "../../domain/fs-node.js";
import { buildCodeMetadata, type LineRange } from "../state/code-viewer.js";
import {
  changeStatusLabel,
  reviewQueueSourceLabel,
  type ReviewChangeItem,
} from "../state/git-review.js";
import type { OutlineHeading } from "../state/outline.js";

interface Props {
  file: FilePayload | null;
  outline: OutlineHeading[];
  reviewChanges: ReviewChangeItem[];
  selectedCodeRange: LineRange | null;
  refreshedAt?: number;
  activePaneId: string;
  onOutlineSelect: (id: string) => void;
  onOpenEventPath: (path: string) => void;
  onOpenNextChanged: () => void;
  onOpenPreviousChanged: () => void;
  onOpenAllChanged: () => void;
  onTargetHoverChange: (hovering: boolean) => void;
  onRevealTarget: () => void;
}

export function Inspector({
  file,
  outline,
  reviewChanges,
  selectedCodeRange,
  refreshedAt,
  activePaneId,
  onOutlineSelect,
  onOpenEventPath,
  onOpenNextChanged,
  onOpenPreviousChanged,
  onOpenAllChanged,
  onTargetHoverChange,
  onRevealTarget,
}: Props) {
  const codeMetadata =
    file && (file.viewerKind === "code" || file.viewerKind === "json")
      ? buildCodeMetadata(file, selectedCodeRange)
      : null;
  const fileKindLabel = file ? viewerKindLabel(file.viewerKind) : "No file";
  const activeChange = file
    ? reviewChanges.find((change) => change.path === file.path)
    : null;
  return (
    <aside className="inspector">
      <div className="panel-title">
        <span>Review</span>
        <span className="pill">Read-only</span>
      </div>
      <div className="inspect-body">
        <div className="section-title with-action primary-section">
          <span>Review Queue</span>
          {reviewChanges.length ? (
            <span className="queue-actions">
              <button type="button" onClick={onOpenPreviousChanged}>
                Open previous
              </button>
              <button type="button" onClick={onOpenNextChanged}>
                Open next
              </button>
            </span>
          ) : null}
        </div>
        {reviewChanges.length ? (
          <div className="review-queue">
            {reviewChanges.slice(0, 12).map((change) => (
              <button
                className="change-open"
                disabled={change.status === "deleted"}
                key={`${change.source}:${change.path}`}
                onClick={() => onOpenEventPath(change.path)}
                type="button"
              >
                <b>{changeStatusLabel(change.status)}</b>
                <span>
                  {change.status === "renamed" && change.originalPath
                    ? `${change.originalPath} → ${change.path}`
                    : change.path}
                </span>
                <small>{reviewQueueSourceLabel(change.source)}</small>
              </button>
            ))}
          </div>
        ) : null}
        {!reviewChanges.length ? (
          <p className="muted compact-empty">No files to review.</p>
        ) : null}

        <p className="active-file-line">
          {file ? (
            <>
              <span>{file.path}</span> · {fileKindLabel}
              {activeChange
                ? ` · ${changeStatusLabel(activeChange.status)}`
                : ""}
            </>
          ) : (
            "No file selected"
          )}
        </p>

        <h3 className="section-title">In this file</h3>
        {codeMetadata ? (
          codeMetadata.symbols.length ? (
            <nav className="symbol-list">
              {codeMetadata.symbols.slice(0, 14).map((symbol) => (
                <a
                  href={`#L${symbol.line}`}
                  key={`${symbol.kind}-${symbol.name}-${symbol.line}`}
                  onClick={(event) => {
                    event.preventDefault();
                    document
                      .querySelector<HTMLElement>(
                        `.code-line[data-line="${symbol.line}"]`,
                      )
                      ?.scrollIntoView({
                        block: "center",
                        behavior: "smooth",
                      });
                  }}
                >
                  <span>{symbol.kind}</span>
                  <strong>{symbol.name}</strong>
                  <small>{symbol.line}</small>
                </a>
              ))}
            </nav>
          ) : (
            <p className="muted compact-empty">No symbols for this file.</p>
          )
        ) : outline.length ? (
          <nav className="outline">
            {outline.map((heading, index) => (
              <a
                key={heading.id}
                className={`${heading.level === 2 ? "h2 " : ""}${index === 0 ? "active" : ""}`}
                href={`#${heading.id}`}
                onClick={(event) => {
                  event.preventDefault();
                  onOutlineSelect(heading.id);
                }}
              >
                {heading.text}
              </a>
            ))}
          </nav>
        ) : (
          <p className="muted compact-empty">No outline for this file.</p>
        )}

        <details className="file-details">
          <summary>Details</summary>
          <button
            className="focus-target"
            onClick={onRevealTarget}
            onMouseEnter={() => onTargetHoverChange(true)}
            onMouseLeave={() => onTargetHoverChange(false)}
            type="button"
          >
            <span>Inspector target</span>
            <strong>{inspectorTargetLabel(file, activePaneId)}</strong>
          </button>
          <div className="kv">
            <span>Type</span>
            <strong>{file?.viewerKind ?? "none"}</strong>
          </div>
          <div className="kv">
            <span>Path</span>
            <strong>{file?.path ?? "No file selected"}</strong>
          </div>
          <div className="kv">
            <span>Status</span>
            <strong>{refreshedAt ? "Refreshed" : "Watching"}</strong>
          </div>
          <div className="kv">
            <span>Size</span>
            <strong>{file ? formatBytes(file.size) : "-"}</strong>
          </div>
          <div className="kv">
            <span>Updated</span>
            <strong>
              {file ? new Date(file.mtimeMs).toLocaleTimeString() : "-"}
            </strong>
          </div>
          {refreshedAt ? (
            <div className="kv">
              <span>Reloaded</span>
              <strong>{new Date(refreshedAt).toLocaleTimeString()}</strong>
            </div>
          ) : null}
          {codeMetadata ? (
            <>
              <div className="kv">
                <span>Language</span>
                <strong>{codeMetadata.language}</strong>
              </div>
              <div className="kv">
                <span>Lines</span>
                <strong>{codeMetadata.lineCount}</strong>
              </div>
              <div className="kv">
                <span>Selection</span>
                <strong>{codeMetadata.selectedReference ?? "None"}</strong>
              </div>
            </>
          ) : null}
          {reviewChanges.length ? (
            <button
              className="secondary-action"
              type="button"
              onClick={onOpenAllChanged}
            >
              Open all changed files as tabs
            </button>
          ) : null}
        </details>
      </div>
    </aside>
  );
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export function inspectorTargetLabel(
  file: FilePayload | null,
  paneId: string,
): string {
  const name = file?.path.split("/").filter(Boolean).at(-1) ?? "No file";
  return `${name} · ${paneId}`;
}

function viewerKindLabel(viewerKind: FilePayload["viewerKind"]): string {
  if (viewerKind === "markdown") return "Markdown";
  if (viewerKind === "html") return "HTML";
  if (viewerKind === "json") return "JSON";
  if (viewerKind === "image") return "Image";
  if (viewerKind === "code") return "Code";
  if (viewerKind === "mermaid") return "Mermaid";
  if (viewerKind === "unsupported") return "Unsupported";
  return "Text";
}
