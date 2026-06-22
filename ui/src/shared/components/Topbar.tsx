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
  commentAttentionCount?: number;
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
  commentAttentionCount = 0,
  onOpenComments,
  onOpenShortcuts,
}: TopbarProps) {
  const workspaceName = workspaceDisplayName(root);
  const workspaceParent = workspaceParentPath(root);
  const themeLabel = themePreferenceLabel(themePreference);
  const commentsButton = commentsButtonState({
    attentionCount: commentAttentionCount,
    openCount: openCommentCount,
  });

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
          title="Keyboard shortcuts (Cmd/Ctrl+/)"
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
          aria-keyshortcuts="Meta+K Control+K"
          onClick={onQuickOpen}
        >
          <span>Quick open</span>
          <kbd>Cmd/Ctrl K</kbd>
        </button>
        <button
          type="button"
          className={`command-button command-button-secondary${commentAttentionCount ? " needs-attention" : ""}`}
          aria-label={commentsButton.ariaLabel}
          aria-keyshortcuts="Meta+Shift+C Control+Shift+C"
          title={commentsButton.title}
          onClick={onOpenComments}
        >
          <span>{commentsButton.label}</span>
          <span className="comment-count-badge">{commentsButton.count}</span>
          <kbd>Cmd/Ctrl Shift C</kbd>
        </button>
        <button
          type="button"
          className="command-button command-button-secondary"
          aria-keyshortcuts="Meta+Shift+F Control+Shift+F"
          onClick={onSearchText}
        >
          <span>Search</span>
          <kbd>Cmd/Ctrl Shift F</kbd>
        </button>
      </div>
    </header>
  );
}

function commentsButtonState({
  attentionCount,
  openCount,
}: {
  attentionCount: number;
  openCount: number;
}): {
  ariaLabel: string;
  count: number;
  label: string;
  title: string;
} {
  if (attentionCount > 0) {
    const noun = attentionCount === 1 ? "thread" : "threads";
    const verb = attentionCount === 1 ? "needs" : "need";
    return {
      ariaLabel: `Open Attention inbox, ${attentionCount} comment ${noun} ${verb} attention`,
      count: attentionCount,
      label: "Attention",
      title: `Open Attention inbox: ${attentionCount} comment ${noun} ${verb} attention (Cmd/Ctrl+Shift+C)`,
    };
  }

  const noun = openCount === 1 ? "comment" : "comments";
  const summary = openCount
    ? `${openCount} open ${noun}`
    : "no open comments";
  return {
    ariaLabel: `Open Comments inbox, ${summary}`,
    count: openCount,
    label: "Comments",
    title: `Open Comments inbox: ${summary} (Cmd/Ctrl+Shift+C)`,
  };
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
