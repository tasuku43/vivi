import { useState } from "react";
import type { TextDiff } from "../../../domain/change-review.js";
import type { ViviComment } from "../../../domain/comments.js";
import type { FilePayload } from "../../../domain/fs-node.js";
import styles from "./RenderedChangeCardsFacade.module.css";

type RenderedChangeKind = "changed" | "added" | "removed";
type RenderedChangeSurface = "markdown" | "html";

export type RenderedChangeCard = {
  id: string;
  kind: RenderedChangeKind;
  surface: RenderedChangeSurface;
  title: string;
  path: string;
  meta: string;
  beforeLabel?: string;
  afterLabel?: string;
  before?: RenderedBlock;
  after?: RenderedBlock;
  sourceRows: RenderedSourceRow[];
  comment?: ViviComment;
};

type RenderedBlock =
  | {
      kind: "markdown";
      heading?: string;
      body: string;
    }
  | {
      kind: "html";
      heading: string;
      body: string;
      action?: string;
    };

type RenderedSourceRow = {
  line: string;
  kind: "add" | "remove" | "context";
  text: string;
};

export function RenderedChangeCardsFacade({
  markdownFile,
  markdownDiff,
  cards,
}: {
  markdownFile: FilePayload;
  markdownDiff: TextDiff;
  cards: RenderedChangeCard[];
}) {
  const [activeCardId, setActiveCardId] = useState(cards[0]?.id ?? "");
  const [sourceVisible, setSourceVisible] = useState<Record<string, boolean>>(
    Object.fromEntries(cards.map((card) => [card.id, true])),
  );
  const replacementCount = cards.filter(
    (card) => card.before && card.after,
  ).length;
  const commentCount = cards.filter((card) => card.comment).length;
  const hiddenBlockCount = 4;

  return (
    <section
      className={styles.facade}
      aria-label="Rendered change cards facade"
    >
      <header className={styles.toolbar}>
        <div className={styles.fileTitle}>
          <strong>{markdownFile.path}</strong>
          <span data-testid="rendered-change-cards-subtitle">
            Rendered diff facade · {markdownDiff.baseLabel} -&gt;{" "}
            {markdownDiff.compareLabel} · source diff remains canonical
          </span>
        </div>
        <div className={styles.segmented} aria-label="Viewer mode">
          <span className={styles.activeSegment}>Rendered</span>
          <span>Source</span>
        </div>
        <div className={styles.segmented} aria-label="Diff mode">
          <span className={styles.activeSegment}>Diff from HEAD</span>
        </div>
      </header>

      <div className={styles.layout}>
        <div className={styles.cardColumn}>
          <div
            className={styles.summaryGrid}
            aria-label="Rendered diff summary"
          >
            <SummaryTile value={cards.length} label="rendered change cards" />
            <SummaryTile value={replacementCount} label="replacement pairs" />
            <SummaryTile
              value={commentCount}
              label="comments mapped to cards"
            />
            <SummaryTile
              value={hiddenBlockCount}
              label="unchanged blocks hidden"
            />
          </div>

          <div className={styles.cardStack}>
            {cards.map((card, index) => (
              <RenderedChangeCardView
                key={card.id}
                card={card}
                index={index}
                active={card.id === activeCardId}
                sourceVisible={sourceVisible[card.id] ?? true}
                onSelect={() => setActiveCardId(card.id)}
                onToggleSource={() =>
                  setSourceVisible((state) => ({
                    ...state,
                    [card.id]: !(state[card.id] ?? true),
                  }))
                }
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function SummaryTile({ value, label }: { value: number; label: string }) {
  return (
    <div className={styles.summaryTile}>
      <b>{value}</b>
      <span>{label}</span>
    </div>
  );
}

function RenderedChangeCardView({
  card,
  index,
  active,
  sourceVisible,
  onSelect,
  onToggleSource,
}: {
  card: RenderedChangeCard;
  index: number;
  active: boolean;
  sourceVisible: boolean;
  onSelect: () => void;
  onToggleSource: () => void;
}) {
  const statusLabel =
    card.surface === "html" && card.kind === "changed"
      ? "HTML changed"
      : card.kind;
  return (
    <article
      className={`${styles.changeCard} ${styles[card.kind]} ${
        active ? styles.activeCard : ""
      }`}
      aria-label={`${card.title} rendered change card`}
      data-active={active ? "true" : "false"}
    >
      <div className={styles.cardRail} />
      <div className={styles.cardBody}>
        <header className={styles.cardHead}>
          <button
            type="button"
            className={`${styles.statusBadge} ${styles[card.kind]}`}
            aria-label={`Select ${card.title}`}
            aria-pressed={active}
            onClick={onSelect}
          >
            {statusLabel}
          </button>
          <span className={styles.cardMeta}>
            {card.title} · {card.meta}
          </span>
          <span className={styles.cardActions}>
            <button
              type="button"
              className={styles.iconButton}
              aria-label={
                card.comment
                  ? `Open comment for ${card.title}`
                  : `Add comment for ${card.title}`
              }
            >
              {card.comment ? "1" : "◌"}
            </button>
            <button
              type="button"
              className={styles.textButton}
              aria-pressed={sourceVisible}
              onClick={onToggleSource}
            >
              {sourceVisible ? "Hide source hunk" : "Show source hunk"}
            </button>
          </span>
        </header>

        <div className={styles.renderArea}>
          {card.before && card.after ? (
            <div className={styles.beforeAfter}>
              <RenderedPane
                label={card.beforeLabel ?? "Before"}
                block={card.before}
                tone="old"
              />
              <RenderedPane
                label={card.afterLabel ?? "After"}
                block={card.after}
                tone="new"
              />
            </div>
          ) : card.after ? (
            <RenderedPane
              label={card.afterLabel ?? "After"}
              block={card.after}
              tone="new"
            />
          ) : card.before ? (
            <RenderedPane
              label={card.beforeLabel ?? "Before"}
              block={card.before}
              tone="old"
            />
          ) : null}

          {index === 0 ? (
            <div className={styles.gapRow}>
              2 unchanged rendered blocks hidden
            </div>
          ) : null}

          {sourceVisible ? <SourceRows rows={card.sourceRows} /> : null}
        </div>
      </div>
    </article>
  );
}

function RenderedPane({
  label,
  block,
  tone,
}: {
  label: string;
  block: RenderedBlock;
  tone: "old" | "new";
}) {
  return (
    <div>
      <p className={styles.paneLabel}>
        <span>{label}</span>
      </p>
      <div className={`${styles.renderPane} ${styles[tone]}`}>
        {block.kind === "markdown" ? (
          <>
            {block.heading ? <h2>{block.heading}</h2> : null}
            <p>{block.body}</p>
          </>
        ) : (
          <div className={styles.htmlSnippet}>
            <h2>{block.heading}</h2>
            <p>{block.body}</p>
            {block.action ? (
              <button type="button">{block.action}</button>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

function SourceRows({ rows }: { rows: RenderedSourceRow[] }) {
  return (
    <div className={styles.sourceRows} aria-label="Source hunk preview">
      {rows.map((row) => (
        <div
          className={`${styles.sourceRow} ${styles[row.kind]}`}
          key={`${row.line}-${row.text}`}
        >
          <span>{row.line}</span>
          <code>{row.text || " "}</code>
        </div>
      ))}
    </div>
  );
}
