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
  openCommentThreadCount?: number;
  reviewOpenCommentThreadCount?: number;
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
  openCommentThreadCount = 0,
  reviewOpenCommentThreadCount,
  commentAttentionCount = 0,
  onOpenComments,
  onOpenShortcuts,
}: TopbarProps) {
  const workspaceName = workspaceDisplayName(root);
  const workspaceParent = workspaceParentPath(root);
  const themeLabel = themePreferenceLabel(themePreference);
  const commentsButton = commentsButtonState({
    attentionCount: commentAttentionCount,
    openThreadCount: openCommentThreadCount,
    reviewOpenThreadCount: reviewOpenCommentThreadCount,
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
          data-topbar-action="shortcuts"
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
          aria-label="Open command palette"
          aria-keyshortcuts="Meta+K Control+K"
          title="Open command palette"
          data-topbar-action="quick-open"
          onClick={onQuickOpen}
        >
          <span>Command</span>
          <kbd>Cmd/Ctrl K</kbd>
        </button>
        <button
          type="button"
          className={`command-button command-button-secondary${commentAttentionCount ? " needs-attention" : ""}`}
          aria-label={commentsButton.ariaLabel}
          aria-keyshortcuts="Meta+Shift+C Control+Shift+C"
          title={commentsButton.title}
          data-topbar-action="comments"
          onClick={onOpenComments}
        >
          <span>{commentsButton.label}</span>
          <span className="comment-count-badge">{commentsButton.count}</span>
          <kbd>Cmd/Ctrl Shift C</kbd>
        </button>
        <button
          type="button"
          className="command-button command-button-secondary"
          aria-label="Search workspace text"
          aria-keyshortcuts="Meta+Shift+F Control+Shift+F"
          title="Search workspace text (Cmd/Ctrl+Shift+F)"
          data-topbar-action="search"
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
  openThreadCount,
  reviewOpenThreadCount,
}: {
  attentionCount: number;
  openThreadCount: number;
  reviewOpenThreadCount?: number;
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

  const noun = openThreadCount === 1 ? "thread" : "threads";
  const summary = openThreadCount
    ? `${openThreadCount} open ${noun}`
    : "no open threads";
  const reviewSummary =
    reviewOpenThreadCount !== undefined &&
    reviewOpenThreadCount >= 0 &&
    reviewOpenThreadCount !== openThreadCount
      ? `, ${openReviewThreadSummary(reviewOpenThreadCount)}`
      : "";
  return {
    ariaLabel: `Open Comments inbox, ${summary}${reviewSummary}`,
    count: openThreadCount,
    label: "Comments",
    title: `Open Comments inbox: ${summary}${reviewSummary} (Cmd/Ctrl+Shift+C)`,
  };
}

function openReviewThreadSummary(count: number): string {
  if (count === 0) return "no open review threads";
  return `${count} open review ${count === 1 ? "thread" : "threads"}`;
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
