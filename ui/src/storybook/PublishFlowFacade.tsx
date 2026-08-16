import type { CSSProperties, ReactNode } from "react";
import {
  ReadyToPublishPanel,
  type ReadyToPublishItem,
} from "../shared/components/ReadyToPublishPanel.js";
import { InspectorSurfaceTabs } from "../shared/components/InspectorSurfaceTabs.js";
import styles from "./PublishFlowFacade.module.css";

export interface PublishFlowFacadeProps {
  surface: "review" | "document";
  items: ReadyToPublishItem[];
  excludedInputCount?: number;
  onOpenItem: (item: ReadyToPublishItem) => void;
  onResumeInput: () => void;
  onReview: () => void;
  onPublish: () => void;
  onSelectSurface: () => void;
}

export function PublishFlowFacade({
  surface,
  items,
  excludedInputCount = 1,
  onOpenItem,
  onResumeInput,
  onReview,
  onPublish,
  onSelectSurface,
}: PublishFlowFacadeProps) {
  const isReview = surface === "review";

  return (
    <aside
      className={styles.inspector}
      aria-label={`${surface} publish facade`}
    >
      <InspectorSurfaceTabs
        activeSurface={surface}
        reviewQueueCount={6}
        onSelectReview={isReview ? undefined : onSelectSurface}
        onSelectDocument={isReview ? onSelectSurface : undefined}
      />

      {isReview ? (
        <>
          <header className={styles.contextHeader}>
            <span>
              <strong>5 attention items</strong>
              <small>Changes and open feedback</small>
            </span>
            <button type="button">Next queued</button>
          </header>
          <div className={styles.scrollBody}>
            <ReviewQueueContext
              readyPanel={
                <ReadyToPublishPanel
                  scope="workspace"
                  items={items}
                  localInput={{ path: "docs/index.html", location: "L5" }}
                  onOpenItem={onOpenItem}
                  onResumeInput={onResumeInput}
                  onReview={onReview}
                  onPublish={onPublish}
                />
              }
            />
          </div>
        </>
      ) : (
        <>
          <header className={styles.documentHeader}>
            <span>
              <strong>18-ux-acceptance-criteria.md</strong>
              <small>docs/product · Markdown</small>
            </span>
            <b>4 ready</b>
          </header>
          <div className={styles.scrollBody}>
            <DocumentOutline />
            <section className={styles.documentSection}>
              <header>
                <strong>Feedback</strong>
                <span>4 ready</span>
              </header>
              <p>
                Double-click a rendered block to comment. Drag still selects
                text.
              </p>
              <ReadyToPublishPanel
                scope="document"
                items={items}
                excludedInputCount={excludedInputCount}
                onOpenItem={onOpenItem}
                onResumeInput={onResumeInput}
                onReview={onReview}
                onPublish={onPublish}
              />
              <div className={styles.openFeedback}>
                <span>Open</span>
                <strong>L18</strong>
                <small>Agent-visible threads stay separate.</small>
              </div>
            </section>
          </div>
        </>
      )}
    </aside>
  );
}

function ReviewQueueContext({ readyPanel }: { readyPanel: ReactNode }) {
  return (
    <div aria-label="Review queue context">
      <section className={styles.metrics}>
        {[
          ["4", "Queued"],
          ["2", "In Review"],
          ["0", "Reviewed"],
        ].map(([count, label]) => (
          <span key={label}>
            <strong>{count}</strong>
            <small>{label}</small>
          </span>
        ))}
      </section>
      <section className={styles.queueSection} aria-label="Queued">
        <header>
          <strong>Queued</strong>
          <span>4 files</span>
        </header>
        <QueueRow
          title="41-review-document-navigation.html"
          detail="unread HEAD diff"
          badge="+1192"
        />
        <QueueRow title="index.html" detail="read HEAD diff" badge="typing" />
      </section>
      <section className={styles.queueSection} aria-label="In Review">
        <header>
          <strong>In Review</strong>
          <span>2 files</span>
        </header>
        <div className={styles.panelInset}>{readyPanel}</div>
        <QueueRow
          title="CommentStatusBadge.module.css"
          detail="1 open · unread activity"
          badge="1 open"
        />
      </section>
    </div>
  );
}

function QueueRow({
  title,
  detail,
  badge,
}: {
  title: string;
  detail: string;
  badge: string;
}) {
  return (
    <div className={styles.queueRow}>
      <i aria-hidden="true" />
      <span>
        <strong>{title}</strong>
        <small>{detail}</small>
      </span>
      <b>{badge}</b>
    </div>
  );
}

function DocumentOutline() {
  const headings = [
    ["UX acceptance criteria", ":1"],
    ["Minimum acceptable UI", ":5"],
    ["Evaluation function", ":28"],
  ];
  return (
    <section className={styles.documentSection}>
      <header>
        <strong>In this document</strong>
        <span>4</span>
      </header>
      <nav aria-label="Document outline">
        {headings.map(([label, line], index) => (
          <button
            type="button"
            className={index === 0 ? styles.activeOutline : undefined}
            key={label}
          >
            <span>{label}</span>
            <small>{line}</small>
          </button>
        ))}
      </nav>
    </section>
  );
}

export const publishFacadeFrameStyle: CSSProperties = {
  width: 340,
  height: 720,
};
