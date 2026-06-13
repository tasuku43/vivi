import type { FsNode } from "../../domain/fs-node.js";
import { iconForPath } from "../state/file-icons.js";
import { fuzzyFileResults } from "../state/files.js";

interface Props {
  open: boolean;
  query: string;
  nodes: FsNode[];
  onQueryChange: (query: string) => void;
  onClose: () => void;
  onOpenPath: (path: string) => void;
}

export function CommandPalette({
  open,
  query,
  nodes,
  onQueryChange,
  onClose,
  onOpenPath,
}: Props) {
  if (!open) return null;

  const results = fuzzyFileResults(nodes, query);

  return (
    <div className="palette-overlay" role="presentation" onClick={onClose}>
      <section
        className="palette"
        role="dialog"
        aria-label="Command palette"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="palette-top">
          <input
            autoFocus
            className="palette-input"
            placeholder="Open file or run command..."
            value={query}
            onChange={(event) => onQueryChange(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") onClose();
              if (event.key === "Enter" && results[0])
                onOpenPath(results[0].path);
            }}
          />
        </div>
        <div className="palette-body">
          <div className="palette-results">
            {results.map((file, index) => (
              <button
                key={file.path}
                className={
                  index === 0 ? "palette-result active" : "palette-result"
                }
                onClick={() => onOpenPath(file.path)}
              >
                <span className="file-icon">
                  {iconForPath(file.path, file.viewerKind)}
                </span>
                <span>
                  <strong>{file.path}</strong>
                  <small>{file.viewerKind ?? "file"}</small>
                </span>
                <span className="palette-type">Open</span>
              </button>
            ))}
            {!results.length && (
              <p className="muted palette-empty">No matching files.</p>
            )}
          </div>
          <aside className="palette-help">
            <p>
              Command K is modal. It should preserve the sidebar, tabs, viewer,
              and outline state underneath.
            </p>
            <div>
              <span>Open</span>
              <kbd>Enter</kbd>
            </div>
            <div>
              <span>New tab</span>
              <kbd>Cmd Enter</kbd>
            </div>
            <div>
              <span>Close</span>
              <kbd>Esc</kbd>
            </div>
          </aside>
        </div>
      </section>
    </div>
  );
}
