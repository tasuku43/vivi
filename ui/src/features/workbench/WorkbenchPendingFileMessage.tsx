import viewerMessageStyles from "../../shared/components/ViewerMessage.module.css";

export function WorkbenchPendingFileMessage({ path }: { path: string }) {
  return (
    <div
      className={`${viewerMessageStyles.empty} empty-viewer`}
      aria-live="polite"
    >
      Loading preview for <strong>{path}</strong>...
    </div>
  );
}
