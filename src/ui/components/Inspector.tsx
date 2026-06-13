import type { FilePayload, FsEvent } from "../../domain/fs-node.js";
import type { OutlineHeading } from "../state/outline.js";

interface Props {
  file: FilePayload | null;
  outline: OutlineHeading[];
  events: FsEvent[];
  activePaneId: string;
  onOutlineSelect: (id: string) => void;
  onTargetHoverChange: (hovering: boolean) => void;
  onRevealTarget: () => void;
}

export function Inspector({
  file,
  outline,
  events,
  activePaneId,
  onOutlineSelect,
  onTargetHoverChange,
  onRevealTarget,
}: Props) {
  return (
    <aside className="inspector">
      <div className="panel-title">
        <span>Outline</span>
        <span className="pill">Focus</span>
      </div>
      <div className="inspect-body">
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
          <strong>Watching</strong>
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

        <h3 className="section-title">Document outline</h3>
        {outline.length ? (
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
          <p className="muted">
            Open a Markdown or HTML file to see H1/H2 headings.
          </p>
        )}

        <h3 className="section-title">Recent file events</h3>
        {events.length ? (
          events.slice(0, 5).map((event, index) => (
            <div className="event" key={`${event.type}-${event.path}-${index}`}>
              <b>{event.type}</b>
              <span>{event.path}</span>
            </div>
          ))
        ) : (
          <p className="muted">No events yet.</p>
        )}
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
