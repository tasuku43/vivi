import type { OpenTab } from "../../state/tabs.js";
import { iconForPath } from "../../state/file-icons.js";

export type { OpenTab };
export interface DraggedTabPayload {
  path: string;
  paneId: string;
}

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
      <div className="tab-strip">
        {tabs.map((tab) => (
          <div
            key={tab.path}
            className={`tab ${tab.path === activePath ? "active" : ""} ${tab.changed ? "changed" : ""} ${tab.removed ? "removed" : ""} ${tab.isPreview ? "preview" : ""}`}
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
              aria-label={`${tab.path}${tab.isPreview ? " preview" : ""}${tab.changed ? " changed" : ""}${tab.removed ? " removed" : ""}`}
              onClick={() => onActivate(tab.path)}
            >
              <span className="file-icon">
                {iconForPath(tab.path, tab.viewerKind)}
              </span>
              <span className="tab-title">{basename(tab.path)}</span>
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
        ))}
      </div>
      <div className="tab-actions" aria-label="Tab actions">
        <button
          disabled={!activeTab?.isPreview}
          onClick={() => {
            if (activePath) onPromote(activePath);
          }}
          type="button"
        >
          Keep
        </button>
        <button disabled={!activePath} onClick={onCloseOtherTabs} type="button">
          Others
        </button>
        <button
          disabled={!activePath}
          onClick={onCloseTabsToRight}
          type="button"
        >
          Right
        </button>
        <button
          disabled={!tabs.some((tab) => !tab.changed)}
          onClick={onCloseUnchangedTabs}
          type="button"
        >
          Clean
        </button>
        <button
          disabled={!tabs.some((tab) => tab.isPreview)}
          onClick={onClosePreviewTabs}
          type="button"
        >
          Previews
        </button>
      </div>
    </div>
  );
}

function basename(path: string): string {
  return path.split("/").filter(Boolean).at(-1) ?? path;
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
