import type { KeyboardEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import type { SearchPaletteMode } from "../../state/search-palette.js";
import {
  buildCommandActionItems,
  buildFileSearchItems,
  buildRecentFileSearchItems,
  buildTextSearchItems,
  textSearchPreviewSegments,
} from "../../state/search-palette.js";
import type {
  CommandActionItem,
  RecentFileSearchResult,
} from "../../state/search-palette.js";
import {
  clampPaletteSelection,
  movePaletteSelection,
  paletteModeKeyboardAction,
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
  recentFiles?: RecentFileSearchResult[];
  fileLoading: boolean;
  textResults: TextSearchResult[];
  textLoading: boolean;
  actions?: CommandActionItem[];
  onQueryChange: (query: string) => void;
  onModeChange: (mode: SearchPaletteMode) => void;
  onClose: () => void;
  onOpenPath: (path: string, preview: boolean, lineNumber?: number) => void;
  onRunAction?: (id: string) => void;
}

export function CommandPalette({
  open,
  mode,
  query,
  fileResults,
  recentFiles = [],
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
  const hasActionMode = actions.length > 0 || mode === "action";
  const availableModes = useMemo<SearchPaletteMode[]>(
    () => (hasActionMode ? ["file", "text", "action"] : ["file", "text"]),
    [hasActionMode],
  );
  const results = useMemo(() => {
    if (mode === "action") return buildCommandActionItems(actions);
    if (mode === "text") return buildTextSearchItems(textResults);
    if (!query.trim()) return buildRecentFileSearchItems(recentFiles);
    return buildFileSearchItems(fileResults);
  }, [actions, fileResults, mode, query, recentFiles, textResults]);

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

  function switchMode(nextMode: SearchPaletteMode) {
    onModeChange(nextMode);
    window.requestAnimationFrame(() => {
      document
        .querySelector<HTMLButtonElement>(
          `.palette-mode-bar [data-palette-mode="${nextMode}"]`,
        )
        ?.focus();
    });
  }

  function handleModeKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const nextMode = paletteModeKeyboardAction(
      availableModes,
      mode,
      event.key,
    );
    if (!nextMode || nextMode === mode) return;
    event.preventDefault();
    switchMode(nextMode);
  }

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
            onKeyDown={handleModeKeyDown}
          >
            <button
              className={mode === "file" ? "active" : ""}
              role="tab"
              aria-selected={mode === "file"}
              tabIndex={mode === "file" ? 0 : -1}
              data-palette-mode="file"
              onClick={() => onModeChange("file")}
            >
              Files
            </button>
            <button
              className={mode === "text" ? "active" : ""}
              role="tab"
              aria-selected={mode === "text"}
              tabIndex={mode === "text" ? 0 : -1}
              data-palette-mode="text"
              onClick={() => onModeChange("text")}
            >
              Text
            </button>
            {hasActionMode ? (
              <button
                className={mode === "action" ? "active" : ""}
                role="tab"
                aria-selected={mode === "action"}
                tabIndex={mode === "action" ? 0 : -1}
                data-palette-mode="action"
                onClick={() => onModeChange("action")}
              >
                Actions
              </button>
            ) : null}
          </div>
          <input
            autoFocus
            className="palette-input"
            placeholder={placeholder}
            value={query}
            aria-label={`${title} query`}
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
                onOpenPath(
                  item.path,
                  !(event.metaKey || event.ctrlKey),
                  item.kind === "text" ? item.lineNumber : undefined,
                );
              }
            }}
          />
        </div>
        <div className="palette-body">
          <div
            className="palette-results"
            role="listbox"
            aria-label={`${title} results`}
          >
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
                    onOpenPath(
                      item.path,
                      true,
                      item.kind === "text" ? item.lineNumber : undefined,
                    );
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
                  <small>
                    {item.kind === "text" ? (
                      <TextSearchPreview item={item} />
                    ) : (
                      item.detail
                    )}
                  </small>
                </span>
                <span className="palette-type">
                  {item.kind === "file"
                    ? filePaletteType(item.source)
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
                  ? query.trim()
                    ? "No matching files."
                    : "No recent files yet."
                  : mode === "text"
                    ? "No text matches."
                    : "No matching actions."}
              </p>
            )}
          </div>
          <aside className="palette-help">
            {mode === "action" ? (
              <>
                <div>
                  <span>Run action</span>
                  <kbd>Enter</kbd>
                </div>
                <div>
                  <span>Filter actions</span>
                  <kbd>Type</kbd>
                </div>
                <div>
                  <span>Quick open</span>
                  <kbd>Cmd/Ctrl K</kbd>
                </div>
                <div>
                  <span>Search text</span>
                  <kbd>Cmd/Ctrl Shift F</kbd>
                </div>
              </>
            ) : (
              <>
                <div>
                  <span>Preview</span>
                  <kbd>Enter</kbd>
                </div>
                <div>
                  <span>Keep open</span>
                  <kbd>Cmd/Ctrl Enter</kbd>
                </div>
                <div>
                  <span>Quick open</span>
                  <kbd>Cmd/Ctrl K</kbd>
                </div>
                <div>
                  <span>Search text</span>
                  <kbd>Cmd/Ctrl Shift F</kbd>
                </div>
              </>
            )}
            {hasActionMode ? (
              <div>
                <span>Switch mode</span>
                <kbd>Tab</kbd>
              </div>
            ) : null}
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

function filePaletteType(
  source: "search" | "active" | "open" | "recent" | undefined,
): string {
  if (source === "active") return "Active";
  if (source === "recent") return "Recent";
  return "Open";
}

function TextSearchPreview({
  item,
}: {
  item: Extract<
    ReturnType<typeof buildTextSearchItems>[number],
    { kind: "text" }
  >;
}) {
  return (
    <>
      <span className="palette-line-prefix">L{item.lineNumber}</span>{" "}
      {textSearchPreviewSegments(
        item.lineText,
        item.matchStart,
        item.matchLength,
      ).map((segment, index) =>
        segment.match ? (
          <mark className="palette-search-match" key={index}>
            {segment.text}
          </mark>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </>
  );
}
