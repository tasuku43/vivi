import {
  useEffect,
  useLayoutEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import type { OpenTab } from "../../state/tabs.js";
import { tabKeyboardAction } from "../../state/tab-navigation.js";
import styles from "./OpenTabs.module.css";

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
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const activeTab = tabs.find((tab) => tab.path === activePath);
  const activeIndex = tabs.findIndex((tab) => tab.path === activePath);
  const actions = [
    {
      label: "Keep preview open",
      disabled: !activeTab?.isPreview,
      run: () => {
        if (activePath) onPromote(activePath);
      },
    },
    {
      label: "Close other tabs",
      disabled: !activeTab || tabs.length < 2,
      run: onCloseOtherTabs,
    },
    {
      label: "Close tabs to the right",
      disabled: activeIndex < 0 || activeIndex === tabs.length - 1,
      run: onCloseTabsToRight,
    },
    {
      label: "Close unchanged tabs",
      disabled: !tabs.some((tab) => !tab.changed),
      run: onCloseUnchangedTabs,
    },
    {
      label: "Close preview tabs",
      disabled: !tabs.some((tab) => tab.isPreview),
      run: onClosePreviewTabs,
    },
  ];
  function closeMenu(restoreFocus = true) {
    setMenuOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }
  useLayoutEffect(() => {
    if (!menuOpen) return;
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect)
      setMenuPosition({
        top: rect.bottom + 4,
        left: Math.max(8, Math.min(rect.right - 230, window.innerWidth - 238)),
      });
    menuRef.current
      ?.querySelector<HTMLButtonElement>("button:not(:disabled)")
      ?.focus();
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !menuRef.current?.contains(event.target) &&
        !triggerRef.current?.contains(event.target)
      )
        setMenuOpen(false);
    };
    const dismiss = () => setMenuOpen(false);
    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", dismiss);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("resize", dismiss);
    };
  }, [menuOpen]);
  useEffect(() => {
    Array.from(
      stripRef.current?.querySelectorAll<HTMLElement>("[data-tab-path]") ?? [],
    )
      .find((element) => element.dataset.tabPath === activePath)
      ?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [activePath, tabs.length]);
  function handleMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeMenu();
      return;
    }
    if (event.key === "Tab") {
      closeMenu();
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>(
        "button:not(:disabled)",
      ) ?? [],
    );
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? items.length - 1
          : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) %
            items.length;
    items[next]?.focus();
  }

  const duplicateBasenames = duplicateTabBasenames(tabs);
  const tabListLabel = openTabsAriaLabel(tabs, activePath);
  function focusTab(path: string) {
    window.requestAnimationFrame(() => {
      Array.from(
        stripRef.current?.querySelectorAll<HTMLElement>("[data-tab-path]") ??
          [],
      )
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
      className={styles.tabs}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        const tab = readDraggedTab(event.dataTransfer);
        if (tab) onDropTab(tab.path, tab.paneId, paneId, null);
      }}
    >
      <div
        ref={stripRef}
        className={styles.strip}
        role="group"
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
                styles.shell,
                tab.path === activePath ? styles.active : "",
                tab.changed ? styles.changed : "",
                tab.removed ? styles.removed : "",
                tab.isPreview ? styles.preview : "",
                context ? styles.duplicateName : "",
              ]
                .filter(Boolean)
                .join(" ")}
              title={`${tab.path}${tab.isPreview ? " — Preview; double-click to keep open" : ""}`}
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
                className={styles.tab}
                type="button"
                aria-current={tab.path === activePath ? "true" : undefined}
                tabIndex={tab.path === activePath ? 0 : -1}
                data-tab-path={tab.path}
                aria-label={`${tab.path}${tab.isPreview ? " preview" : ""}${tab.changed ? " changed" : ""}${tab.removed ? " removed" : ""}`}
                title={`${tab.path}${tab.isPreview ? " — Preview; double-click to keep open" : ""}`}
                draggable
                onMouseDown={(event) => {
                  if (event.button === 0)
                    onManualDragStart({ path: tab.path, paneId });
                }}
                onClick={() => onActivate(tab.path)}
                onDragStart={(event) => {
                  writeDraggedTab(event.dataTransfer, {
                    path: tab.path,
                    paneId,
                  });
                  event.dataTransfer.effectAllowed = "move";
                  onDragStateChange(true);
                  onManualDragStart({ path: tab.path, paneId });
                }}
                onDragEnd={() => onDragStateChange(false)}
              >
                <span className={styles.main} aria-hidden="true">
                  <span className={styles.titleStack}>
                    <span className={styles.title}>{title}</span>
                    {context ? (
                      <span className={styles.context} aria-hidden="true">
                        {context}
                      </span>
                    ) : null}
                  </span>
                  {tab.removed ? (
                    <span
                      className={styles.removedMark}
                      title="Removed from disk"
                    >
                      removed
                    </span>
                  ) : null}
                </span>
              </button>
              <button
                className={styles.close}
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
      <div className={styles.actions} aria-label="Tab management">
        <button
          ref={triggerRef}
          type="button"
          aria-label="Tab actions"
          title="Tab actions"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-controls={menuOpen ? menuId : undefined}
          disabled={tabs.length === 0}
          onClick={() => setMenuOpen((open) => !open)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              setMenuOpen(true);
            }
          }}
        >
          <span aria-hidden="true">•••</span>
        </button>
      </div>
      {menuOpen &&
        createPortal(
          <div
            ref={menuRef}
            id={menuId}
            role="menu"
            aria-label="Tab actions"
            className={styles.menu}
            style={menuPosition}
            onKeyDown={handleMenuKeyDown}
            onBlur={(event) => {
              if (
                event.relatedTarget instanceof Node &&
                !event.currentTarget.contains(event.relatedTarget)
              )
                setMenuOpen(false);
            }}
          >
            {actions.map((action) => (
              <button
                key={action.label}
                role="menuitem"
                type="button"
                disabled={action.disabled}
                onClick={() => {
                  action.run();
                  closeMenu();
                }}
              >
                {action.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
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
