import styles from "./ReadyToPublishPanel.module.css";

export interface ReadyToPublishItem {
  id: string;
  title: string;
  detail: string;
  count: number;
}

export interface ReadyToPublishLocalInput {
  id?: string;
  path: string;
  location: string;
}

export interface ReadyToPublishPanelProps {
  scope: "workspace" | "document";
  items: ReadyToPublishItem[];
  localInput?: ReadyToPublishLocalInput | null;
  localInputs?: readonly ReadyToPublishLocalInput[];
  excludedInputCount?: number;
  onOpenItem?: (item: ReadyToPublishItem) => void;
  onResumeInput?: (input: ReadyToPublishLocalInput, index: number) => void;
  onReview: () => void;
  onPublish: () => void;
  publishDisabled?: boolean;
}

export function ReadyToPublishPanel({
  scope,
  items,
  localInput = null,
  localInputs,
  excludedInputCount = 0,
  onOpenItem,
  onResumeInput,
  onReview,
  onPublish,
  publishDisabled = false,
}: ReadyToPublishPanelProps) {
  const readyCount = items.reduce((total, item) => total + item.count, 0);
  const scopeLabel = scope === "workspace" ? "Workspace" : "Current document";
  const visibleLocalInputs = localInputs ?? (localInput ? [localInput] : []);
  const excludedCount = Math.max(
    excludedInputCount,
    visibleLocalInputs.length,
  );

  return (
    <section
      className={styles.root}
      aria-label={`${scopeLabel} ready to publish`}
    >
      <header className={styles.header}>
        <span>
          <strong>Ready to publish</strong>
          <small>{scopeLabel} · private until published</small>
        </span>
        <span className={styles.readyBadge}>{readyCount} ready</span>
      </header>

      <div className={styles.items}>
        {items.map((item) => (
          <button
            className={styles.item}
            key={item.id}
            type="button"
            onClick={() => onOpenItem?.(item)}
          >
            <strong>{item.title}</strong>
            <span className={styles.itemBadge}>{item.count} ready</span>
            <small>{item.detail}</small>
          </button>
        ))}

        {visibleLocalInputs.map((input, index) => (
          <button
            className={`${styles.item} ${styles.typingItem}`}
            key={input.id ?? `${input.path}:${input.location}:${index}`}
            type="button"
            aria-label={`Resume input in ${input.path}, ${input.location}`}
            onClick={() => onResumeInput?.(input, index)}
          >
            <strong>
              {basename(input.path)} · {input.location}
            </strong>
            <span className={styles.typingBadge}>1 typing</span>
            <small>Excluded from Publish · Resume input</small>
          </button>
        ))}
      </div>

      <footer className={styles.actions}>
        {!visibleLocalInputs.length && excludedCount ? (
          <span className={styles.scopeNote}>
            {excludedCount} workspace {excludedCount === 1 ? "input" : "inputs"}{" "}
            stays local
          </span>
        ) : null}
        <button
          className={styles.reviewButton}
          type="button"
          onClick={onReview}
        >
          Review {readyCount}
        </button>
        <button
          className={styles.publishButton}
          type="button"
          disabled={publishDisabled}
          onClick={onPublish}
        >
          Publish {readyCount}
        </button>
      </footer>
    </section>
  );
}

function basename(path: string): string {
  return path.split("/").pop() ?? path;
}
