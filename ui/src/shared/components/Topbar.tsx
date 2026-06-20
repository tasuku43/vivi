import {
  themePreferenceLabel,
  type ThemePreference,
} from "../../state/theme.js";

interface TopbarProps {
  root: string | null;
  themePreference: ThemePreference;
  onThemeCycle: () => void;
  onQuickOpen: () => void;
  onSearchText: () => void;
  openCommentCount?: number;
  onOpenComments?: () => void;
  onOpenShortcuts: () => void;
}

export function Topbar({
  root,
  themePreference,
  onThemeCycle,
  onQuickOpen,
  onSearchText,
  openCommentCount = 0,
  onOpenComments,
  onOpenShortcuts,
}: TopbarProps) {
  const workspaceName = workspaceDisplayName(root);
  const workspaceParent = workspaceParentPath(root);
  const themeLabel = themePreferenceLabel(themePreference);

  return (
    <header className="topbar">
      <div className="topbar-brand" aria-label="Vivi">
        <span className="logo" aria-hidden="true" />
        <span className="brand-wordmark">Vivi</span>
      </div>

      <div className="workspace-strip" aria-label="Current workspace">
        <span className="workspace-label">Workspace</span>
        <span className="workspace-name">{workspaceName}</span>
        {workspaceParent ? (
          <span className="workspace-parent">{workspaceParent}</span>
        ) : null}
      </div>

      <div className="topbar-actions" aria-label="Workspace actions">
        <button
          type="button"
          className="shortcut-button"
          aria-label="Keyboard shortcuts"
          title="Keyboard shortcuts (Cmd /)"
          onClick={onOpenShortcuts}
        >
          ?
        </button>
        <button
          type="button"
          className="theme-button"
          aria-label={`Theme: ${themeLabel}`}
          title={`Theme: ${themeLabel}`}
          onClick={onThemeCycle}
        >
          <span className="action-eyebrow">Theme</span>
          <span>{themeLabel}</span>
        </button>
        <button
          type="button"
          className="command-button command-button-primary"
          onClick={onQuickOpen}
        >
          <span>Quick open</span>
          <kbd>Cmd K</kbd>
        </button>
        <button
          type="button"
          className="command-button command-button-secondary"
          onClick={onOpenComments}
        >
          <span>Comments</span>
          <span className="comment-count-badge">{openCommentCount}</span>
          <kbd>Cmd Shift C</kbd>
        </button>
        <button
          type="button"
          className="command-button command-button-secondary"
          onClick={onSearchText}
        >
          <span>Search</span>
          <kbd>Cmd Shift F</kbd>
        </button>
      </div>
    </header>
  );
}

export function workspaceDisplayName(root: string | null): string {
  if (!root) return "Local viewer";
  const normalized = root.replace(/\/+$/, "");
  if (!normalized) return root;
  return normalized.split("/").filter(Boolean).at(-1) ?? normalized;
}

export function workspaceParentPath(root: string | null): string {
  if (!root) return "Waiting for workspace";
  const normalized = root.replace(/\/+$/, "");
  const slashIndex = normalized.lastIndexOf("/");
  if (slashIndex <= 0) return normalized || root;
  return normalized.slice(0, slashIndex);
}
