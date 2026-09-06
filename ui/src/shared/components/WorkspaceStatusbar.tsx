import { useEffect, useId, useRef, useState } from "react";
import type { WorkspaceStatusSummary } from "../../state/workspace-status.js";
import styles from "./WorkspaceStatusbar.module.css";

interface WorkspaceStatusbarProps {
  status: WorkspaceStatusSummary;
}

export function WorkspaceStatusbar({ status }: WorkspaceStatusbarProps) {
  const [expanded, setExpanded] = useState(false);
  const root = useRef<HTMLElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const detailsId = useId();
  useEffect(() => {
    if (!expanded) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target))
        setExpanded(false);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [expanded]);
  const connection =
    status.connectionLabel ??
    (status.serverTone === "offline"
      ? "Disconnected · updates paused"
      : status.serverTone === "pending"
        ? "Updating"
        : "Live");
  return (
    <footer
      ref={root}
      className={styles.statusbar}
      aria-label={workspaceStatusbarLabel(status)}
      onKeyDown={(event) => {
        if (event.key === "Escape" && expanded) {
          event.stopPropagation();
          setExpanded(false);
          trigger.current?.focus();
        }
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          setExpanded(false);
      }}
    >
      <button
        ref={trigger}
        className={styles.trigger}
        aria-label="Workspace status details"
        aria-expanded={expanded}
        aria-controls={detailsId}
        title={status.detail || status.server}
        onClick={() => setExpanded(!expanded)}
      >
        <span
          className={`${styles.dot} ${styles[status.serverTone]}`}
          aria-hidden="true"
        />
        <span aria-live="polite">{connection}</span>
        <span className={styles.chevron} aria-hidden="true">
          ⌃
        </span>
      </button>
      <span className={styles.attention} aria-live="polite">
        {Boolean(status.unavailableFeedbackCount) && (
          <span>{status.unavailableFeedbackCount} unavailable</span>
        )}
        {Boolean(status.draftCount) && (
          <span>
            {status.draftCount} {status.draftCount === 1 ? "draft" : "drafts"} ·
            not published
          </span>
        )}
      </span>
      <section
        id={detailsId}
        className={styles.details}
        hidden={!expanded}
        aria-label="Workspace details"
      >
        <dl>
          <dt>Workspace</dt>
          <dd aria-label={`Workspace: ${status.workspace}`}>
            {status.workspace}
          </dd>
          <dt>Current file</dt>
          <dd aria-label={`Current file: ${status.activeFile}`}>
            {status.activeFile}
          </dd>
          <dt>Feedback</dt>
          <dd aria-label={`Feedback: ${status.review}`}>{status.review}</dd>
          <dt>Live updates</dt>
          <dd aria-label={`Live updates: ${status.server}`}>{status.server}</dd>
        </dl>
        {status.detail && <p>{status.detail}</p>}
      </section>
    </footer>
  );
}
export function workspaceStatusbarLabel(
  status: WorkspaceStatusSummary,
): string {
  return [
    "Workspace status",
    `Workspace: ${status.workspace}`,
    `Current file: ${status.activeFile}`,
    `Feedback: ${status.review}`,
    `Live updates: ${status.server}`,
  ].join(" · ");
}
