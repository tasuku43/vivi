import { useEffect, useMemo, useState } from "react";
import type { SearchPaletteMode } from "../state/search-palette.js";
import {
  buildFileSearchItems,
  buildTextSearchItems,
} from "../state/search-palette.js";
import {
  clampPaletteSelection,
  movePaletteSelection,
} from "../state/command-palette.js";
import { iconForPath } from "../state/file-icons.js";
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
  onQueryChange: (query: string) => void;
  onModeChange: (mode: SearchPaletteMode) => void;
  onClose: () => void;
  onOpenPath: (path: string, preview: boolean) => void;
}

export function CommandPalette({
  open,
  mode,
  query,
  fileResults,
  fileLoading,
  textResults,
  textLoading,
  onQueryChange,
  onModeChange,
  onClose,
  onOpenPath,
}: Props) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const results = useMemo(() => {
    if (mode === "text") return buildTextSearchItems(textResults);
    return buildFileSearchItems(fileResults);
  }, [fileResults, mode, textResults]);
  const activeIndex = clampPaletteSelection(selectedIndex, results.length);

  useEffect(() => {
    if (open) setSelectedIndex(0);
  }, [mode, open]);

  if (!open) return null;

  const title = mode === "file" ? "Quick open" : "Search text";
  const placeholder =
    mode === "file" ? "Type a filename or path..." : "Search file contents...";

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
          </div>
          <input
            autoFocus
            className="palette-input"
            placeholder={placeholder}
            value={query}
            aria-activedescendant={
              activeIndex >= 0 ? `palette-result-${activeIndex}` : undefined
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
                    results.length,
                    event.key === "ArrowDown" ? 1 : -1,
                  ),
                );
                return;
              }
              if (event.key === "Enter" && activeIndex >= 0) {
                onOpenPath(
                  results[activeIndex].path,
                  !(event.metaKey || event.ctrlKey),
                );
              }
            }}
          />
        </div>
        <div className="palette-body">
          <div className="palette-results" role="listbox">
            {results.map((item, index) => (
              <button
                id={`palette-result-${index}`}
                key={item.id}
                role="option"
                aria-label={`${item.label} ${item.detail} ${item.kind === "file" ? "open file" : `line ${item.lineNumber}`}`}
                className={
                  index === activeIndex
                    ? "palette-result active"
                    : "palette-result"
                }
                aria-selected={index === activeIndex}
                onClick={() => onOpenPath(item.path, true)}
                onMouseEnter={() => setSelectedIndex(index)}
              >
                <span className="file-icon">
                  {iconForPath(item.path, item.viewerKind)}
                </span>
                <span className="palette-result-main">
                  <strong>{item.label}</strong>
                  <small>{item.detail}</small>
                </span>
                <span className="palette-type">
                  {item.kind === "file" ? "Open" : `L${item.lineNumber}`}
                </span>
              </button>
            ))}
            {textLoading && mode === "text" ? (
              <p className="muted palette-empty">Searching...</p>
            ) : null}
            {fileLoading && mode === "file" ? (
              <p className="muted palette-empty">Searching...</p>
            ) : null}
            {!results.length && !textLoading && !fileLoading && (
              <p className="muted palette-empty">
                {mode === "file" ? "No matching files." : "No text matches."}
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
              <span>Close</span>
              <kbd>Esc</kbd>
            </div>
          </aside>
        </div>
      </section>
    </div>
  );
}
