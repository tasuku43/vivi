import type { CSSProperties } from "react";
import type { FsNode } from "../domain/fs-node.js";
import { InspectorSurfaceTabs } from "../shared/components/InspectorSurfaceTabs.js";
import {
  ReadyToPublishPanel,
  type ReadyToPublishItem,
} from "../shared/components/ReadyToPublishPanel.js";
import { TreeSidebar } from "../shared/components/TreeSidebar.js";
import styles from "./ReviewQueueDirectoryFacade.module.css";

export interface ReviewQueueDirectoryFacadeProps {
  nodes: FsNode[];
  selectedPath: string | null;
  queuedPaths: string[];
  unreadPaths: string[];
  changedPaths: string[];
  activePaths?: string[];
  currentStopPath?: string | null;
  openThreadCountsByPath?: Record<string, number>;
  queuedCount: number;
  inReviewCount: number;
  seenCount: number;
  branchCount: number;
  readyItems: ReadyToPublishItem[];
  onNextQueued: () => void;
  onSelectDocument: () => void;
  onSelectPath: (path: string) => void;
  onOpenPath: (path: string) => void;
  onOpenReadyItem: (item: ReadyToPublishItem) => void;
  onReviewReady: () => void;
  onPublishReady: () => void;
}

export function ReviewQueueDirectoryFacade({
  nodes,
  selectedPath,
  queuedPaths,
  unreadPaths,
  changedPaths,
  activePaths = [],
  currentStopPath = null,
  openThreadCountsByPath = {},
  queuedCount,
  inReviewCount,
  seenCount,
  branchCount,
  readyItems,
  onNextQueued,
  onSelectDocument,
  onSelectPath,
  onOpenPath,
  onOpenReadyItem,
  onReviewReady,
  onPublishReady,
}: ReviewQueueDirectoryFacadeProps) {
  const hasQueue = nodes.length > 0;

  return (
    <aside className={styles.inspector} aria-label="Review queue directory facade">
      <InspectorSurfaceTabs
        activeSurface="review"
        reviewQueueCount={queuedCount + inReviewCount}
        onSelectDocument={onSelectDocument}
      />

      <header className={styles.contextHeader}>
        <span>
          <strong>{queuedCount + inReviewCount} attention items</strong>
          <small>Across {branchCount} document areas</small>
        </span>
        <button type="button" disabled={!queuedCount} onClick={onNextQueued}>
          Next queued
        </button>
      </header>

      <section className={styles.metrics} aria-label="Review queue totals">
        {[
          [queuedCount, "Queued"],
          [inReviewCount, "In Review"],
          [seenCount, "Seen"],
        ].map(([count, label]) => (
          <span key={label}>
            <strong>{count}</strong>
            <small>{label}</small>
          </span>
        ))}
      </section>

      <div className={styles.scrollBody}>
        <section className={styles.queueSection} aria-label="Queued by directory">
          <header>
            <strong>Queued</strong>
            <span>
              {branchCount} {branchCount === 1 ? "branch" : "branches"} ·{" "}
              {queuedCount} {queuedCount === 1 ? "file" : "files"}
            </span>
          </header>

          {hasQueue ? (
            <>
              <div className={styles.treeLegend}>
                <span>
                  Same interactions as <strong>Explorer</strong>
                </span>
                <span>Attention branches only</span>
              </div>
              <div className={styles.queueTree}>
                <TreeSidebar
                  nodes={nodes}
                  ariaLabel={`Queued documents by directory, ${queuedCount} ${queuedCount === 1 ? "file" : "files"}`}
                  selectedPath={selectedPath}
                  changedPaths={new Set(changedPaths)}
                  reviewPaths={new Set(queuedPaths)}
                  unreadReviewPaths={new Set(unreadPaths)}
                  activePaths={new Set(activePaths)}
                  currentStopPath={currentStopPath}
                  openThreadCountsByPath={openThreadCountsByPath}
                  onSelect={onSelectPath}
                  onOpen={onOpenPath}
                />
              </div>
            </>
          ) : (
            <div className={styles.emptyQueue}>
              <span aria-hidden="true">✓</span>
              <strong>No queued documents</strong>
              <small>New document changes and open feedback will appear here.</small>
            </div>
          )}
        </section>

        <section className={styles.inReviewSection} aria-label="In Review">
          <header>
            <strong>In Review</strong>
            <span>{inReviewCount} files</span>
          </header>
          {readyItems.length ? (
            <div className={styles.panelInset}>
              <ReadyToPublishPanel
                scope="workspace"
                items={readyItems}
                onOpenItem={onOpenReadyItem}
                onReview={onReviewReady}
                onPublish={onPublishReady}
              />
            </div>
          ) : (
            <p className={styles.noReviewWork}>Nothing is currently in review.</p>
          )}
        </section>
      </div>
    </aside>
  );
}

export const reviewQueueDirectoryFrameStyle: CSSProperties = {
  width: 520,
  height: 860,
};
