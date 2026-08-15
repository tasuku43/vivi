import { useEffect, useState } from "react";
import type {
  DocumentReaderFixture,
  DocumentReaderNode,
} from "./fixtures/review-lab.js";
import styles from "./DocumentReaderFacade.module.css";

export type DocumentReaderFacadeState =
  "reading" | "writing" | "thread" | "changes";

export interface DocumentReaderFacadeProps {
  fixture: DocumentReaderFixture;
  initialState?: DocumentReaderFacadeState;
}

export function DocumentReaderFacade({
  fixture,
  initialState = "reading",
}: DocumentReaderFacadeProps) {
  const [state, setState] = useState(initialState);
  const [surface, setSurface] = useState<"rendered" | "source">("rendered");
  const [activeDocument, setActiveDocument] = useState(fixture.activePath);
  const [expandedDirectories, setExpandedDirectories] = useState(
    () => new Set(collectDirectoryPaths(fixture.documents)),
  );
  const [activeBlock, setActiveBlock] = useState(
    initialState === "writing" || initialState === "thread"
      ? fixture.thread.blockId
      : null,
  );
  const [comment, setComment] = useState(
    initialState === "writing"
      ? "Keep this action available on every document block."
      : "",
  );
  const [savedComment, setSavedComment] = useState(fixture.thread.human);

  useEffect(() => {
    setState(initialState);
    setActiveBlock(
      initialState === "writing" || initialState === "thread"
        ? fixture.thread.blockId
        : null,
    );
  }, [fixture.thread.blockId, initialState]);

  const changesVisible = state === "changes";
  const documentCount = countDocuments(fixture.documents);

  function openComposer(blockId: string) {
    setActiveBlock(blockId);
    setComment("");
    setState("writing");
  }

  function saveComment() {
    if (!comment.trim()) return;
    setSavedComment(comment.trim());
    setState("thread");
  }

  function toggleChanges() {
    setState((current) => (current === "changes" ? "reading" : "changes"));
    setActiveBlock(null);
  }

  return (
    <div className={styles.facade} data-facade-state={state}>
      <header className={styles.topbar}>
        <div className={styles.brandGroup}>
          <strong className={styles.brand}>vivi</strong>
          <span className={styles.workspace}>{fixture.workspace}</span>
        </div>
        <div className={styles.topActions}>
          <span className={styles.liveStatus}>● live</span>
          <button type="button" className={styles.commandButton}>
            Search documents <kbd>⌘K</kbd>
          </button>
        </div>
      </header>

      <aside className={styles.library} aria-label="Documents">
        <div className={styles.paneHeading}>
          <span>Documents</span>
          <span>{documentCount}</span>
        </div>
        <div
          className={styles.documentTree}
          role="tree"
          aria-label="Document files"
        >
          <DocumentTreeRows
            nodes={fixture.documents}
            depth={0}
            activePath={activeDocument}
            expandedDirectories={expandedDirectories}
            onOpenDocument={setActiveDocument}
            onToggleDirectory={(path) =>
              setExpandedDirectories((current) => {
                const next = new Set(current);
                if (next.has(path)) next.delete(path);
                else next.add(path);
                return next;
              })
            }
          />
        </div>
      </aside>

      <main className={styles.main}>
        <div className={styles.tabbar}>
          <span className={styles.activeTab}>{activeDocument}</span>
        </div>
        <div className={styles.toolbar}>
          <div
            className={styles.surfaceControl}
            role="group"
            aria-label="Document surface"
          >
            <button
              type="button"
              className={surface === "rendered" ? styles.activeTool : ""}
              onClick={() => setSurface("rendered")}
              aria-pressed={surface === "rendered"}
            >
              Rendered
            </button>
            <button
              type="button"
              className={surface === "source" ? styles.activeTool : ""}
              onClick={() => setSurface("source")}
              aria-pressed={surface === "source"}
            >
              Source
            </button>
          </div>
          <button
            type="button"
            className={`${styles.changesButton} ${
              changesVisible ? styles.changesButtonActive : ""
            }`}
            onClick={toggleChanges}
            aria-pressed={changesVisible}
          >
            {changesVisible ? "Back to document" : "Changes 2"}
          </button>
        </div>

        <div className={styles.readerViewport}>
          <article
            className={`${styles.paper} ${
              changesVisible ? styles.paperWithChanges : ""
            }`}
            aria-label={fixture.title}
          >
            <p className={styles.eyebrow}>{fixture.eyebrow}</p>
            <h1>{fixture.title}</h1>

            <div className={styles.documentBody}>
              {fixture.blocks.map((block) => {
                const isActiveBlock = activeBlock === block.id;
                const isChanged = changesVisible && block.changed;
                return (
                  <section
                    key={block.id}
                    className={`${styles.commentableBlock} ${
                      isChanged ? styles.changedBlock : ""
                    } ${
                      changesVisible && !block.changed
                        ? styles.unchangedBlock
                        : ""
                    }`}
                    data-document-block={block.id}
                  >
                    {isChanged ? (
                      <span className={styles.changeLabel}>Changed</span>
                    ) : null}
                    <div
                      className={styles.blockContent}
                      data-comment-trigger={block.id}
                      onDoubleClick={() => openComposer(block.id)}
                    >
                      <DocumentBlock block={block} surface={surface} />
                    </div>
                    {isActiveBlock && state === "writing" ? (
                      <div className={styles.composer}>
                        <label htmlFor={`comment-${block.id}`}>
                          Comment on this {block.kind}
                        </label>
                        <textarea
                          id={`comment-${block.id}`}
                          autoFocus
                          value={comment}
                          onChange={(event) => setComment(event.target.value)}
                          placeholder="Tell the agent what should change…"
                        />
                        <div className={styles.composerActions}>
                          <span>Private until saved</span>
                          <button
                            type="button"
                            onClick={() => {
                              setState("reading");
                              setActiveBlock(null);
                            }}
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            className={styles.saveButton}
                            disabled={!comment.trim()}
                            onClick={saveComment}
                          >
                            Save comment
                          </button>
                        </div>
                      </div>
                    ) : null}
                    {isActiveBlock && state === "thread" ? (
                      <article
                        className={styles.thread}
                        aria-label="Open feedback thread"
                      >
                        <header>
                          <strong>Open thread</strong>
                          <span>2 messages</span>
                        </header>
                        <div className={styles.message}>
                          <span className={styles.humanAvatar}>T</span>
                          <p>{savedComment}</p>
                        </div>
                        <div className={styles.message}>
                          <span className={styles.agentAvatar}>C</span>
                          <p>{fixture.thread.agent}</p>
                        </div>
                        <button type="button" className={styles.replyButton}>
                          Reply in this thread
                        </button>
                      </article>
                    ) : null}
                  </section>
                );
              })}
            </div>
          </article>
        </div>
      </main>

      <aside className={styles.inspector} aria-label="Document inspector">
        <div className={styles.paneHeading}>Inspector</div>
        {changesVisible ? (
          <section className={styles.inspectorSection}>
            <div className={styles.inspectorTitle}>
              <h2>Changes in this document</h2>
              <span className={styles.changeCount}>2</span>
            </div>
            <button type="button" className={styles.inspectorChange}>
              <span>01</span>
              <strong>Feedback belongs to the document</strong>
            </button>
            <button type="button" className={styles.inspectorChange}>
              <span>02</span>
              <strong>Changes are a lens</strong>
            </button>
          </section>
        ) : null}
        <section className={styles.inspectorSection}>
          <h2>In this document</h2>
          <nav aria-label="Document outline">
            {fixture.outline.map((item) => (
              <a
                href={`#${item.label.toLowerCase().replaceAll(" ", "-")}`}
                className={item.depth === 2 ? styles.outlineChild : ""}
                key={item.label}
              >
                {item.label}
              </a>
            ))}
          </nav>
        </section>
        <section className={styles.inspectorSection}>
          <div className={styles.inspectorTitle}>
            <h2>Feedback</h2>
            <span>1 open</span>
          </div>
          <button
            type="button"
            className={styles.feedbackSummary}
            onClick={() => {
              setActiveBlock(fixture.thread.blockId);
              setSavedComment(fixture.thread.human);
              setState("thread");
            }}
          >
            <strong>Commenting is the core action</strong>
            <span>Agent replied · just now</span>
          </button>
        </section>
        <details className={styles.details}>
          <summary>Document details</summary>
          <dl>
            {fixture.details.map((detail) => (
              <div key={detail.label}>
                <dt>{detail.label}</dt>
                <dd>{detail.value}</dd>
              </div>
            ))}
          </dl>
        </details>
      </aside>

      <footer className={styles.statusbar}>
        <span>Watching {fixture.documents.length} documents</span>
        <span>
          {state === "writing"
            ? "1 comment in progress"
            : state === "thread"
              ? "1 open thread"
              : changesVisible
                ? "Changes lens on"
                : "Ready to comment anywhere"}
        </span>
      </footer>
    </div>
  );
}

function DocumentTreeRows({
  nodes,
  depth,
  activePath,
  expandedDirectories,
  onOpenDocument,
  onToggleDirectory,
}: {
  nodes: DocumentReaderNode[];
  depth: number;
  activePath: string;
  expandedDirectories: Set<string>;
  onOpenDocument: (path: string) => void;
  onToggleDirectory: (path: string) => void;
}) {
  return nodes.map((node) => {
    const inset = { paddingLeft: `${8 + depth * 15}px` };
    if (node.kind === "directory") {
      const expanded = expandedDirectories.has(node.path);
      return (
        <div key={node.path} role="treeitem" aria-expanded={expanded}>
          <button
            type="button"
            className={styles.directoryRow}
            style={inset}
            onClick={() => onToggleDirectory(node.path)}
          >
            <span className={styles.disclosure} aria-hidden="true">
              {expanded ? "⌄" : "›"}
            </span>
            <span className={styles.folderIcon} aria-hidden="true" />
            <strong>{node.name}</strong>
          </button>
          {expanded ? (
            <div role="group">
              <DocumentTreeRows
                nodes={node.children}
                depth={depth + 1}
                activePath={activePath}
                expandedDirectories={expandedDirectories}
                onOpenDocument={onOpenDocument}
                onToggleDirectory={onToggleDirectory}
              />
            </div>
          ) : null}
        </div>
      );
    }

    return (
      <button
        type="button"
        role="treeitem"
        className={`${styles.documentRow} ${
          activePath === node.path ? styles.activeDocument : ""
        }`}
        style={inset}
        key={node.path}
        onClick={() => onOpenDocument(node.path)}
        aria-current={activePath === node.path ? "page" : undefined}
      >
        <span
          className={`${styles.documentMark} ${
            node.commentCount > 0
              ? styles.commentMark
              : node.changeCount > 0
                ? styles.changeMark
                : styles.cleanMark
          }`}
          aria-hidden="true"
        />
        <span className={styles.documentIdentity}>
          <strong>{node.name}</strong>
        </span>
        <span className={styles.documentMeta}>
          {node.commentCount > 0
            ? `${node.commentCount} feedback`
            : node.format.toUpperCase()}
        </span>
      </button>
    );
  });
}

function collectDirectoryPaths(nodes: DocumentReaderNode[]): string[] {
  return nodes.flatMap((node) =>
    node.kind === "directory"
      ? [node.path, ...collectDirectoryPaths(node.children)]
      : [],
  );
}

function countDocuments(nodes: DocumentReaderNode[]): number {
  return nodes.reduce(
    (count, node) =>
      count + (node.kind === "file" ? 1 : countDocuments(node.children)),
    0,
  );
}

function DocumentBlock({
  block,
  surface,
}: {
  block: DocumentReaderFixture["blocks"][number];
  surface: "rendered" | "source";
}) {
  if (surface === "source") {
    return <pre className={styles.sourceBlock}>{block.source}</pre>;
  }
  if (block.kind === "heading") return <h2>{block.text}</h2>;
  if (block.kind === "list") {
    return (
      <ul>
        {block.text.split("|").map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    );
  }
  return <p>{block.text}</p>;
}
