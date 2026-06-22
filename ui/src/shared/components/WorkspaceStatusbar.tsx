import type { WorkspaceStatusSummary } from "../../state/workspace-status.js";

interface WorkspaceStatusbarProps {
  status: WorkspaceStatusSummary;
}

export function WorkspaceStatusbar({ status }: WorkspaceStatusbarProps) {
  return (
    <footer
      className="statusbar"
      aria-label={workspaceStatusbarLabel(status)}
    >
      <span
        className="statusbar-group"
        aria-label={`Workspace: ${status.workspace}`}
      >
        <span className="statusbar-label">Workspace</span>
        <span className="status-dot live" aria-hidden="true" />
        {status.workspace}
      </span>
      <span
        className="statusbar-group"
        aria-label={`Current file: ${status.activeFile}`}
      >
        <span className="statusbar-label">Current</span>
        {status.activeFile}
      </span>
      <span
        className="statusbar-group"
        aria-label={`Review: ${status.review}`}
        aria-live="polite"
      >
        <span className="statusbar-label">Review</span>
        {status.review}
      </span>
      <span
        className="statusbar-group"
        aria-label={`Live updates: ${status.server}`}
        aria-live="polite"
        title={status.detail || status.server}
      >
        <span className="statusbar-label">Live</span>
        <span className={`status-dot ${status.serverTone}`} aria-hidden="true" />
        {status.server}
      </span>
    </footer>
  );
}

export function workspaceStatusbarLabel(status: WorkspaceStatusSummary): string {
  return [
    "Workspace status",
    `Workspace: ${status.workspace}`,
    `Current file: ${status.activeFile}`,
    `Review: ${status.review}`,
    `Live updates: ${status.server}`,
  ].join(" · ");
}
