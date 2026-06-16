interface WorkspaceRestoreNoticeProps {
  tabCount: number;
  onDismiss: () => void;
  onStartFresh: () => void;
}

export function WorkspaceRestoreNotice({
  tabCount,
  onDismiss,
  onStartFresh,
}: WorkspaceRestoreNoticeProps) {
  return (
    <section className="restore-notice" aria-live="polite">
      <div>
        <strong>
          Restored {tabCount} {tabCount === 1 ? "tab" : "tabs"}
        </strong>
        <span>from your last local session.</span>
      </div>
      <button type="button" onClick={onStartFresh}>
        Start fresh
      </button>
      <button
        type="button"
        className="restore-notice-dismiss"
        aria-label="Dismiss restored tabs notice"
        onClick={onDismiss}
      >
        x
      </button>
    </section>
  );
}
