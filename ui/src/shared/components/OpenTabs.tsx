import type { KeyboardEvent } from "react";
import type { OpenTab } from "../../state/tabs.js";
import { iconForPath } from "../../state/file-icons.js";
import { tabKeyboardAction } from "../../state/tab-navigation.js";

export type { OpenTab };
export interface DraggedTabPayload {
  path: string;
  paneId: string;
}

const tabActionLabels = {
  keep: {
    label: "Keep tab",
    description: "Keep this preview open as a normal tab",
  },
  closeOthers: {
    label: "Close others",
    description: "Close every tab except the active file",
  },
  closeRight: {
    label: "Close right",
    description: "Close tabs to the right of the active file",
  },
  closeClean: {
    label: "Close clean",
    description: "Close tabs without pending file changes",
  },
  closePreviews: {
    label: "Close previews",
    description: "Close temporary preview tabs",
  },
} as const;

interface Props {
  tabs: OpenTab[];
  activePath: string | null;
  paneId: string;
  onActivate: (path: string) => void;
  onClose: (path: string) => void;
  onPromote: (path: string) => void;
  onCloseOtherTabs: () => void;
  onCloseTabsToRight: () => void;
  onCloseUnchangedTabs: () => void;
  onClosePreviewTabs: () => void;
  onDropTab: (
    path: string,
    fromPaneId: string,
    paneId: string,
    beforePath: string | null,
  ) => void;
  onDragStateChange: (dragging: boolean) => void;
  onManualDragStart: (payload: DraggedTabPayload) => void;
}

export function OpenTabs({
  tabs,
  activePath,
  paneId,
  onActivate,
  onClose,
  onPromote,
  onCloseOtherTabs,
  onCloseTabsToRight,
  onCloseUnchangedTabs,
  onClosePreviewTabs,
  onDropTab,
  onDragStateChange,
  onManualDragStart,
}: Props) {
  const activeTab = tabs.find((tab) => tab.path === activePath);
  const duplicateBasenames = duplicateTabBasenames(tabs);
  const tabListLabel = openTabsAriaLabel(tabs, activePath);
  function focusTab(path: string) {
    window.requestAnimationFrame(() => {
      Array.from(document.querySelectorAll<HTMLElement>("[data-tab-path]"))
        .find((element) => element.dataset.tabPath === path)
        ?.focus();
    });
  }

  function handleTabKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const action = tabKeyboardAction(tabs, activePath, event.key);
    if (!action) return;
    event.preventDefault();
    onActivate(action.path);
    focusTab(action.path);
  }

  return (
    <div
      className="tabs"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        const tab = readDraggedTab(event.dataTransfer);
        if (tab) onDropTab(tab.path, tab.paneId, paneId, null);
      }}
    >
      <div
        className="tab-strip"
        role="tablist"
        aria-label={tabListLabel}
        onKeyDown={handleTabKeyDown}
      >
        {tabs.map((tab) => {
          const title = basename(tab.path);
          const context = duplicateBasenames.has(title)
            ? parentPathLabel(tab.path)
            : "";
          return (
            <div
              key={tab.path}
              className={[
                "tab",
                tab.path === activePath ? "active" : "",
                tab.changed ? "changed" : "",
                tab.removed ? "removed" : "",
                tab.isPreview ? "preview" : "",
                context ? "duplicate-name" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              draggable
              onMouseDown={(event) => {
                if (event.button === 0)
                  onManualDragStart({ path: tab.path, paneId });
              }}
              onDragStart={(event) => {
                writeDraggedTab(event.dataTransfer, { path: tab.path, paneId });
                event.dataTransfer.effectAllowed = "move";
                onDragStateChange(true);
                onManualDragStart({ path: tab.path, paneId });
              }}
              onDragEnd={() => onDragStateChange(false)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                event.stopPropagation();
                const dragged = readDraggedTab(event.dataTransfer);
                if (dragged)
                  onDropTab(dragged.path, dragged.paneId, paneId, tab.path);
              }}
            >
              <button
                className="tab-main"
                type="button"
                role="tab"
                aria-selected={tab.path === activePath}
                tabIndex={tab.path === activePath ? 0 : -1}
                data-tab-path={tab.path}
                aria-label={`${tab.path}${tab.isPreview ? " preview" : ""}${tab.changed ? " changed" : ""}${tab.removed ? " removed" : ""}`}
                title={tab.path}
                onClick={() => onActivate(tab.path)}
              >
                <span className="file-icon">
                  {iconForPath(tab.path, tab.viewerKind)}
                </span>
                <span className="tab-title-stack">
                  <span className="tab-title">{title}</span>
                  {context ? (
                    <span className="tab-context" aria-hidden="true">
                      {context}
                    </span>
                  ) : null}
                </span>
                {tab.isPreview ? (
                  <span className="tab-preview-mark" title="Preview tab">
                    preview
                  </span>
                ) : null}
                {tab.removed ? (
                  <span className="tab-removed-mark" title="Removed from disk">
                    removed
                  </span>
                ) : null}
              </button>
              <button
                className="tab-close"
                type="button"
                aria-label={`Close ${tab.path}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onClose(tab.path);
                }}
              >
                x
              </button>
            </div>
          );
        })}
      </div>
      <div className="tab-actions" aria-label="Tab management">
        <button
          aria-label={tabActionLabels.keep.description}
          disabled={!activeTab?.isPreview}
          onClick={() => {
            if (activePath) onPromote(activePath);
          }}
          title={tabActionLabels.keep.description}
          type="button"
        >
          {tabActionLabels.keep.label}
        </button>
        <button
          aria-label={tabActionLabels.closeOthers.description}
          disabled={!activePath}
          onClick={onCloseOtherTabs}
          title={tabActionLabels.closeOthers.description}
          type="button"
        >
          {tabActionLabels.closeOthers.label}
        </button>
        <button
          aria-label={tabActionLabels.closeRight.description}
          disabled={!activePath}
          onClick={onCloseTabsToRight}
          title={tabActionLabels.closeRight.description}
          type="button"
        >
          {tabActionLabels.closeRight.label}
        </button>
        <button
          aria-label={tabActionLabels.closeClean.description}
          disabled={!tabs.some((tab) => !tab.changed)}
          onClick={onCloseUnchangedTabs}
          title={tabActionLabels.closeClean.description}
          type="button"
        >
          {tabActionLabels.closeClean.label}
        </button>
        <button
          aria-label={tabActionLabels.closePreviews.description}
          disabled={!tabs.some((tab) => tab.isPreview)}
          onClick={onClosePreviewTabs}
          title={tabActionLabels.closePreviews.description}
          type="button"
        >
          {tabActionLabels.closePreviews.label}
        </button>
      </div>
    </div>
  );
}

function basename(path: string): string {
  return path.split("/").filter(Boolean).at(-1) ?? path;
}

function parentPathLabel(path: string): string {
  const parts = path.split("/").filter(Boolean);
  if (parts.length <= 1) return "root";
  return parts.slice(0, -1).join("/");
}

function duplicateTabBasenames(tabs: OpenTab[]): Set<string> {
  const counts = new Map<string, number>();
  for (const tab of tabs) {
    const name = basename(tab.path);
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return new Set(
    [...counts.entries()]
      .filter(([, count]) => count > 1)
      .map(([name]) => name),
  );
}

function openTabsAriaLabel(tabs: OpenTab[], activePath: string | null): string {
  const previewCount = tabs.filter((tab) => tab.isPreview).length;
  const changedCount = tabs.filter((tab) => tab.changed).length;
  const removedCount = tabs.filter((tab) => tab.removed).length;
  return [
    "Open file tabs",
    countPhrase(tabs.length, "tab"),
    activePath ? `active ${activePath}` : "",
    countPhrase(previewCount, "preview tab"),
    countPhrase(changedCount, "changed tab"),
    countPhrase(removedCount, "removed tab"),
  ]
    .filter(Boolean)
    .join(", ");
}

function countPhrase(count: number, label: string): string {
  if (!count) return "";
  return `${count} ${label}${count === 1 ? "" : "s"}`;
}

export function readDraggedTab(
  dataTransfer: DataTransfer,
): DraggedTabPayload | null {
  const raw =
    dataTransfer.getData("application/x-vivi-tab") ||
    dataTransfer.getData("text/plain");
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<DraggedTabPayload>;
    if (typeof parsed.path === "string" && typeof parsed.paneId === "string")
      return { path: parsed.path, paneId: parsed.paneId };
  } catch {
    return { path: raw, paneId: "main" };
  }
  return null;
}

function writeDraggedTab(
  dataTransfer: DataTransfer,
  payload: DraggedTabPayload,
) {
  const raw = JSON.stringify(payload);
  dataTransfer.setData("application/x-vivi-tab", raw);
  dataTransfer.setData("text/plain", raw);
}
