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
import fileIconStyles from "../../shared/components/FileIcon.module.css";
import sharedUiStyles from "../../shared/styles/SharedUi.module.css";
import styles from "./CommandPalette.module.css";

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
        .querySelector<HTMLButtonElement>(`[data-palette-mode="${nextMode}"]`)
        ?.focus();
    });
  }

  function handleModeKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const nextMode = paletteModeKeyboardAction(availableModes, mode, event.key);
    if (!nextMode || nextMode === mode) return;
    event.preventDefault();
    switchMode(nextMode);
  }

  return (
    <div className={styles.overlay} role="presentation" onClick={onClose}>
      <section
        className={styles.palette}
        role="dialog"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.top}>
          <div
            className={styles.modeBar}
            role="tablist"
            aria-label="Search mode"
            onKeyDown={handleModeKeyDown}
          >
            <button
              className={`${styles.modeButton}${mode === "file" ? ` ${styles.activeMode}` : ""}`}
              role="tab"
              aria-selected={mode === "file"}
              tabIndex={mode === "file" ? 0 : -1}
              data-palette-mode="file"
              onClick={() => onModeChange("file")}
            >
              Files
            </button>
            <button
              className={`${styles.modeButton}${mode === "text" ? ` ${styles.activeMode}` : ""}`}
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
                className={`${styles.modeButton}${mode === "action" ? ` ${styles.activeMode}` : ""}`}
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
            className={styles.input}
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
        <div className={styles.body}>
          <div
            className={styles.results}
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
                    ? `${styles.result} ${styles.activeResult}`
                    : styles.result
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
                <span className={`${fileIconStyles.icon} file-icon`}>
                  {item.kind === "action"
                    ? "⌘"
                    : iconForPath(item.path, item.viewerKind)}
                </span>
                <span className={styles.resultMain}>
                  <strong>{item.label}</strong>
                  <small>
                    {item.kind === "text" ? (
                      <TextSearchPreview item={item} />
                    ) : (
                      item.detail
                    )}
                  </small>
                </span>
                <span className={styles.type}>
                  {item.kind === "file"
                    ? filePaletteType(item.source)
                    : item.kind === "text"
                      ? `L${item.lineNumber}`
                      : (item.shortcut ?? "Run")}
                </span>
              </button>
            ))}
            {textLoading && mode === "text" ? (
              <p className={`${sharedUiStyles.muted} muted`} aria-live="polite">
                Searching workspace text...
              </p>
            ) : null}
            {fileLoading && mode === "file" ? (
              <p className={`${sharedUiStyles.muted} muted`} aria-live="polite">
                Searching file names...
              </p>
            ) : null}
            {!visibleResults.length && !textLoading && !fileLoading && (
              <p className={`${sharedUiStyles.muted} muted`}>
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
          <aside className={styles.help}>
            {mode === "action" ? (
              <>
                <div>
                  <span>Run action</span>
                  <kbd className={sharedUiStyles.keycap}>Enter</kbd>
                </div>
                <div>
                  <span>Filter actions</span>
                  <kbd className={sharedUiStyles.keycap}>Type</kbd>
                </div>
                <div>
                  <span>Command palette</span>
                  <kbd className={sharedUiStyles.keycap}>Cmd/Ctrl K</kbd>
                </div>
                <div>
                  <span>Search text</span>
                  <kbd className={sharedUiStyles.keycap}>
                    Cmd/Ctrl Shift F
                  </kbd>
                </div>
              </>
            ) : (
              <>
                <div>
                  <span>Preview</span>
                  <kbd className={sharedUiStyles.keycap}>Enter</kbd>
                </div>
                <div>
                  <span>Keep open</span>
                  <kbd className={sharedUiStyles.keycap}>Cmd/Ctrl Enter</kbd>
                </div>
                <div>
                  <span>Command palette</span>
                  <kbd className={sharedUiStyles.keycap}>Cmd/Ctrl K</kbd>
                </div>
                <div>
                  <span>Search text</span>
                  <kbd className={sharedUiStyles.keycap}>
                    Cmd/Ctrl Shift F
                  </kbd>
                </div>
              </>
            )}
            {hasActionMode ? (
              <div>
                <span>Switch mode</span>
                <kbd className={sharedUiStyles.keycap}>Tab</kbd>
              </div>
            ) : null}
            <div>
              <span>Close</span>
              <kbd className={sharedUiStyles.keycap}>Esc</kbd>
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
      <span className={styles.linePrefix}>L{item.lineNumber}</span>{" "}
      {textSearchPreviewSegments(
        item.lineText,
        item.matchStart,
        item.matchLength,
      ).map((segment, index) =>
        segment.match ? (
          <mark className={styles.searchMatch} key={index}>
            {segment.text}
          </mark>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </>
  );
}
