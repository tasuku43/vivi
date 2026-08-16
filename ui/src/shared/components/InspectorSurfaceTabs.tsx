import styles from "./InspectorSurfaceTabs.module.css";

export type InspectorSurface = "review" | "document";

export function InspectorSurfaceTabs({
  activeSurface,
  reviewQueueCount = 0,
  onSelectReview,
  onSelectDocument,
}: {
  activeSurface: InspectorSurface;
  reviewQueueCount?: number;
  onSelectReview?: () => void;
  onSelectDocument?: () => void;
}) {
  return (
    <div className={styles.root} role="tablist" aria-label="Inspector view">
      <button
        className={`${styles.tab} ${activeSurface === "review" ? styles.active : ""}`}
        type="button"
        role="tab"
        aria-selected={activeSurface === "review"}
        onClick={onSelectReview}
      >
        <span>Review queue</span>
        {reviewQueueCount ? (
          <span
            className={styles.count}
            aria-label={`${reviewQueueCount} items`}
          >
            {reviewQueueCount}
          </span>
        ) : null}
      </button>
      <button
        className={`${styles.tab} ${activeSurface === "document" ? styles.active : ""}`}
        type="button"
        role="tab"
        aria-selected={activeSurface === "document"}
        onClick={onSelectDocument}
      >
        Document
      </button>
    </div>
  );
}
