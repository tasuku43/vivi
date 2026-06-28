import type { WorkspaceStatusSummary } from "../../state/workspace-status.js";
import styles from "./WorkspaceStatusbar.module.css";

interface WorkspaceStatusbarProps {
  status: WorkspaceStatusSummary;
}

export function WorkspaceStatusbar({ status }: WorkspaceStatusbarProps) {
  return (
    <footer
      className={styles.statusbar}
      aria-label={workspaceStatusbarLabel(status)}
    >
      <span
        className={styles.group}
        aria-label={`Workspace: ${status.workspace}`}
      >
        <span className={styles.label}>Workspace</span>
        <span className={`${styles.dot} ${styles.live}`} aria-hidden="true" />
        {status.workspace}
      </span>
      <span
        className={styles.group}
        aria-label={`Current file: ${status.activeFile}`}
      >
        <span className={styles.label}>Current</span>
        {status.activeFile}
      </span>
      <span
        className={styles.group}
        aria-label={`Review: ${status.review}`}
        aria-live="polite"
      >
        <span className={styles.label}>Review</span>
        {status.review}
      </span>
      <span
        className={styles.group}
        aria-label={`Live updates: ${status.server}`}
        aria-live="polite"
        title={status.detail || status.server}
      >
        <span className={styles.label}>Live</span>
        <span
          className={`${styles.dot} ${styles[status.serverTone]}`}
          aria-hidden="true"
        />
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
