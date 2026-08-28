import { useMemo, useState, type CSSProperties } from "react";
import { InspectorSurfaceTabs } from "../shared/components/InspectorSurfaceTabs.js";
import styles from "./ReviewQueueDirectoryFacade.module.css";

export type ReviewQueueSignalFilter = "all" | "unread" | "drafts" | "changed";

export interface ReviewQueueSignalLedgerItem {
  path: string;
  unread: boolean;
  changed: boolean;
  draftCount: number;
  additions?: number;
  deletions?: number;
}

export interface ReviewQueueSignalLedgerFacadeProps {
  items: ReviewQueueSignalLedgerItem[];
  selectedPath: string | null;
  reviewedCount: number;
  onNextQueued: () => void;
  onSelectDocument: () => void;
  onSelectPath: (path: string) => void;
  onOpenPath: (path: string) => void;
  onPublishPath: (path: string) => void;
  onFilterChange?: (filter: ReviewQueueSignalFilter) => void;
}

const filters: Array<{ id: ReviewQueueSignalFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "unread", label: "Unread" },
  { id: "drafts", label: "Drafts" },
  { id: "changed", label: "Changed" },
];

export function ReviewQueueSignalLedgerFacade({
  items,
  selectedPath,
  reviewedCount,
  onNextQueued,
  onSelectDocument,
  onSelectPath,
  onOpenPath,
  onPublishPath,
  onFilterChange,
}: ReviewQueueSignalLedgerFacadeProps) {
  const [filter, setFilter] = useState<ReviewQueueSignalFilter>("all");
  const counts = useMemo(
    () => ({
      all: items.length,
      unread: items.filter((item) => item.unread).length,
      drafts: items.filter((item) => item.draftCount > 0).length,
      changed: items.filter((item) => item.changed).length,
    }),
    [items],
  );
  const visibleItems = items.filter((item) => matchesFilter(item, filter));

  return (
    <aside
      className={styles.inspector}
      aria-label="Review queue signal ledger facade"
    >
      <InspectorSurfaceTabs
        activeSurface="review"
        reviewQueueCount={items.length}
        onSelectDocument={onSelectDocument}
      />

      <header className={styles.contextHeader}>
        <span>
          <strong>{items.length} active files</strong>
          <small>Sorted by attention</small>
        </span>
        <button type="button" disabled={!items.length} onClick={onNextQueued}>
          Open top
        </button>
      </header>

      <div
        className={styles.filters}
        role="radiogroup"
        aria-label="Filter review queue by signal"
      >
        {filters.map((option) => (
          <button
            aria-checked={filter === option.id}
            disabled={option.id !== "all" && counts[option.id] === 0}
            key={option.id}
            role="radio"
            type="button"
            onClick={() => {
              setFilter(option.id);
              onFilterChange?.(option.id);
            }}
          >
            {option.label} <span>{counts[option.id]}</span>
          </button>
        ))}
      </div>

      <div className={styles.scrollBody}>
        {items.length ? (
          <section
            className={styles.ledger}
            aria-label="Active review files sorted by attention"
          >
            {visibleItems.map((item) => (
              <article
                className={
                  item.path === selectedPath ? styles.selected : undefined
                }
                data-review-path={item.path}
                key={item.path}
              >
                <button
                  className={styles.rowMain}
                  type="button"
                  onClick={() => onSelectPath(item.path)}
                  onDoubleClick={() => onOpenPath(item.path)}
                >
                  <span className={styles.filename}>{basename(item.path)}</span>
                  <span className={styles.meta}>
                    {item.unread ? (
                      <i className={styles.unread}>Unread</i>
                    ) : null}
                    {item.draftCount ? (
                      <i className={styles.draft}>{item.draftCount} draft</i>
                    ) : null}
                    <span>{directory(item.path)}</span>
                  </span>
                  {item.changed ? (
                    <span
                      className={styles.diff}
                      aria-label="Diff line changes"
                    >
                      <b>+{item.additions ?? 0}</b>
                      <b>-{item.deletions ?? 0}</b>
                    </span>
                  ) : null}
                </button>
                {item.draftCount ? (
                  <button
                    className={styles.publish}
                    type="button"
                    aria-label={`Publish ${item.draftCount} draft for ${item.path}`}
                    onClick={() => onPublishPath(item.path)}
                  >
                    Publish
                  </button>
                ) : null}
              </article>
            ))}
          </section>
        ) : (
          <div className={styles.emptyQueue}>
            <span aria-hidden="true">✓</span>
            <strong>Active queue clear</strong>
            <small>
              Recent document edits and open feedback will appear here.
            </small>
          </div>
        )}
        <div className={styles.reviewed}>
          <span>Reviewed history</span>
          <span>{reviewedCount} · hidden</span>
        </div>
      </div>
    </aside>
  );
}

function matchesFilter(
  item: ReviewQueueSignalLedgerItem,
  filter: ReviewQueueSignalFilter,
): boolean {
  if (filter === "unread") return item.unread;
  if (filter === "drafts") return item.draftCount > 0;
  if (filter === "changed") return item.changed;
  return true;
}

function basename(path: string): string {
  return path.split("/").filter(Boolean).at(-1) ?? path;
}

function directory(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts.length > 1 ? parts.slice(0, -1).join("/") : ".";
}

export const reviewQueueSignalLedgerFrameStyle: CSSProperties = {
  width: 392,
  height: 720,
};
