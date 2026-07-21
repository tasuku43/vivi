import viewerMessageStyles from "../../shared/components/ViewerMessage.module.css";

export function WorkbenchPendingFileMessage({ path }: { path: string }) {
  return (
    <div
      className={`${viewerMessageStyles.loadingPreview} loading-preview`}
      aria-live="polite"
      aria-busy="true"
    >
      <div className={viewerMessageStyles.loadingPreviewHeader}>
        <span className={viewerMessageStyles.loadingPreviewPulse} />
        <span>
          Loading preview for <strong>{path}</strong>...
        </span>
      </div>
      <div
        className={viewerMessageStyles.loadingPreviewBody}
        aria-hidden="true"
      >
        <span />
        <span />
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}
