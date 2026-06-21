import { useEffect, useMemo, useState } from "react";
import type { SearchPaletteMode } from "../../state/search-palette.js";
import {
  buildCommandActionItems,
  buildFileSearchItems,
  buildTextSearchItems,
} from "../../state/search-palette.js";
import type { CommandActionItem } from "../../state/search-palette.js";
import {
  clampPaletteSelection,
  movePaletteSelection,
} from "../../state/command-palette.js";
import { iconForPath } from "../../state/file-icons.js";
import type {
  FileSearchResult,
  TextSearchResult,
} from "../../domain/search.js";

interface Props {
  open: boolean;
  mode: SearchPaletteMode;
  query: string;
  fileResults: FileSearchResult[];
  fileLoading: boolean;
  textResults: TextSearchResult[];
  textLoading: boolean;
  actions?: CommandActionItem[];
  onQueryChange: (query: string) => void;
  onModeChange: (mode: SearchPaletteMode) => void;
  onClose: () => void;
  onOpenPath: (path: string, preview: boolean) => void;
  onRunAction?: (id: string) => void;
}

export function CommandPalette({
  open,
  mode,
  query,
  fileResults,
  fileLoading,
  textResults,
  textLoading,
  actions = [],
  onQueryChange,
  onModeChange,
  onClose,
  onOpenPath,
  onRunAction,
}: Props) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const results = useMemo(() => {
    if (mode === "action") return buildCommandActionItems(actions);
    if (mode === "text") return buildTextSearchItems(textResults);
    return buildFileSearchItems(fileResults);
  }, [actions, fileResults, mode, textResults]);

  useEffect(() => {
    if (open) setSelectedIndex(0);
  }, [mode, open]);

  if (!open) return null;

  const title =
    mode === "file"
      ? "Quick open"
      : mode === "text"
        ? "Search text"
        : "Run command";
  const placeholder =
    mode === "file"
      ? "Type a filename or path..."
      : mode === "text"
        ? "Search file contents..."
        : "Type a command...";
  const visibleResults =
    mode === "action"
      ? results.filter((item) => {
          const queryText = query.trim().toLowerCase();
          if (!queryText) return true;
          return `${item.label} ${item.detail}`
            .toLowerCase()
            .includes(queryText);
        })
      : results;
  const activeVisibleIndex = clampPaletteSelection(
    selectedIndex,
    visibleResults.length,
  );

  return (
    <div className="palette-overlay" role="presentation" onClick={onClose}>
      <section
        className="palette"
        role="dialog"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="palette-top">
          <div
            className="palette-mode-bar"
            role="tablist"
            aria-label="Search mode"
          >
            <button
              className={mode === "file" ? "active" : ""}
              role="tab"
              aria-selected={mode === "file"}
              onClick={() => onModeChange("file")}
            >
              Files
            </button>
            <button
              className={mode === "text" ? "active" : ""}
              role="tab"
              aria-selected={mode === "text"}
              onClick={() => onModeChange("text")}
            >
              Text
            </button>
            <button
              className={mode === "action" ? "active" : ""}
              role="tab"
              aria-selected={mode === "action"}
              onClick={() => onModeChange("action")}
            >
              Actions
            </button>
          </div>
          <input
            autoFocus
            className="palette-input"
            placeholder={placeholder}
            value={query}
            aria-activedescendant={
              activeVisibleIndex >= 0
                ? `palette-result-${activeVisibleIndex}`
                : undefined
            }
            onChange={(event) => {
              setSelectedIndex(0);
              onQueryChange(event.currentTarget.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                onClose();
                return;
              }
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                setSelectedIndex((index) =>
                  movePaletteSelection(
                    index,
                    visibleResults.length,
                    event.key === "ArrowDown" ? 1 : -1,
                  ),
                );
                return;
              }
              if (event.key === "Enter" && activeVisibleIndex >= 0) {
                const item = visibleResults[activeVisibleIndex];
                if (item.kind === "action") {
                  if (!item.disabled)
                    onRunAction?.(item.id.replace(/^action:/, ""));
                  return;
                }
                onOpenPath(item.path, !(event.metaKey || event.ctrlKey));
              }
            }}
          />
        </div>
        <div className="palette-body">
          <div className="palette-results" role="listbox">
            {visibleResults.map((item, index) => (
              <button
                id={`palette-result-${index}`}
                key={item.id}
                role="option"
                aria-label={`${item.label} ${item.detail} ${
                  item.kind === "file"
                    ? "open file"
                    : item.kind === "text"
                      ? `line ${item.lineNumber}`
                      : "run action"
                }`}
                className={
                  index === activeVisibleIndex
                    ? "palette-result active"
                    : "palette-result"
                }
                aria-selected={index === activeVisibleIndex}
                disabled={item.kind === "action" && item.disabled}
                onClick={() => {
                  if (item.kind === "action") {
                    onRunAction?.(item.id.replace(/^action:/, ""));
                  } else {
                    onOpenPath(item.path, true);
                  }
                }}
                onMouseEnter={() => setSelectedIndex(index)}
              >
                <span className="file-icon">
                  {item.kind === "action"
                    ? "⌘"
                    : iconForPath(item.path, item.viewerKind)}
                </span>
                <span className="palette-result-main">
                  <strong>{item.label}</strong>
                  <small>{item.detail}</small>
                </span>
                <span className="palette-type">
                  {item.kind === "file"
                    ? "Open"
                    : item.kind === "text"
                      ? `L${item.lineNumber}`
                      : (item.shortcut ?? "Run")}
                </span>
              </button>
            ))}
            {textLoading && mode === "text" ? (
              <p className="muted palette-empty">Searching...</p>
            ) : null}
            {fileLoading && mode === "file" ? (
              <p className="muted palette-empty">Searching...</p>
            ) : null}
            {!visibleResults.length && !textLoading && !fileLoading && (
              <p className="muted palette-empty">
                {mode === "file"
                  ? "No matching files."
                  : mode === "text"
                    ? "No text matches."
                    : "No matching actions."}
              </p>
            )}
          </div>
          <aside className="palette-help">
            <div>
              <span>Preview</span>
              <kbd>Enter</kbd>
            </div>
            <div>
              <span>Keep open</span>
              <kbd>Cmd Enter</kbd>
            </div>
            <div>
              <span>Quick open</span>
              <kbd>Cmd K</kbd>
            </div>
            <div>
              <span>Search text</span>
              <kbd>Cmd Shift F</kbd>
            </div>
            <div>
              <span>Actions</span>
              <kbd>tab</kbd>
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
