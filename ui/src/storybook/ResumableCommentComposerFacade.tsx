import { useMemo, useState, type KeyboardEvent } from "react";
import styles from "./ResumableCommentComposerFacade.module.css";

export type ResumableCommentInputState =
  "open" | "collapsed" | "stale" | "saved";

export interface ResumableCommentInput {
  id: string;
  path: string;
  line: number;
  body: string;
  state: ResumableCommentInputState;
}

export interface ResumableCommentComposerFacadeProps {
  tabs: string[];
  initialPath: string;
  linesByPath: Record<string, string[]>;
  initialInputs: ResumableCommentInput[];
  initialSavedDraftCount?: number;
  onPublish?: (count: number) => void;
  onSave?: (input: ResumableCommentInput) => void;
  onDiscard?: (id: string) => void;
  onReanchor?: (id: string) => void;
}

export function ResumableCommentComposerFacade({
  tabs,
  initialPath,
  linesByPath,
  initialInputs,
  initialSavedDraftCount = 0,
  onPublish,
  onSave,
  onDiscard,
  onReanchor,
}: ResumableCommentComposerFacadeProps) {
  const [activePath, setActivePath] = useState(initialPath);
  const [inputs, setInputs] = useState(initialInputs);
  const [savedDraftCount, setSavedDraftCount] = useState(
    initialSavedDraftCount,
  );
  const lines = linesByPath[activePath] ?? [];
  const activeInputs = useMemo(
    () => inputs.filter((input) => input.path === activePath),
    [activePath, inputs],
  );
  const unsentByPath = useMemo(() => {
    const counts = new Map<string, number>();
    for (const input of inputs) {
      if (input.state === "saved") continue;
      counts.set(input.path, (counts.get(input.path) ?? 0) + 1);
    }
    return counts;
  }, [inputs]);
  const unsentCount = Array.from(unsentByPath.values()).reduce(
    (sum, count) => sum + count,
    0,
  );

  const updateInput = (
    id: string,
    update: (input: ResumableCommentInput) => ResumableCommentInput,
  ) => {
    setInputs((current) =>
      current.map((input) => (input.id === id ? update(input) : input)),
    );
  };

  const collapseInput = (id: string) => {
    updateInput(id, (input) =>
      input.body.trim() ? { ...input, state: "collapsed" } : input,
    );
  };

  const discardInput = (id: string) => {
    setInputs((current) => current.filter((input) => input.id !== id));
    onDiscard?.(id);
  };

  const saveInput = (id: string) => {
    const input = inputs.find((item) => item.id === id);
    if (!input?.body.trim()) return;
    const saved = { ...input, state: "saved" as const };
    updateInput(id, () => saved);
    setSavedDraftCount((count) => count + 1);
    onSave?.(saved);
  };

  const reanchorInput = (id: string) => {
    updateInput(id, (input) => ({ ...input, state: "open" }));
    onReanchor?.(id);
  };

  const onComposerKeyDown = (
    event: KeyboardEvent<HTMLTextAreaElement>,
    id: string,
  ) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    collapseInput(id);
  };

  return (
    <section className={styles.facade} aria-label="Resumable comment composer">
      <header className={styles.topbar}>
        <div>
          <span className={styles.brand}>vivi</span>
          <span className={styles.workspace}>local reading workspace</span>
        </div>
        <button
          className={styles.publish}
          type="button"
          disabled={savedDraftCount === 0}
          onClick={() => onPublish?.(savedDraftCount)}
        >
          Publish {savedDraftCount} saved{" "}
          {savedDraftCount === 1 ? "draft" : "drafts"}
        </button>
      </header>

      <div className={styles.tabs} role="tablist" aria-label="Open files">
        {tabs.map((path) => {
          const active = path === activePath;
          const unsent = unsentByPath.get(path) ?? 0;
          return (
            <button
              className={`${styles.tab} ${active ? styles.tabActive : ""}`}
              type="button"
              role="tab"
              aria-selected={active}
              key={path}
              onClick={() => setActivePath(path)}
            >
              {path.split("/").at(-1)}
              {unsent > 0 ? (
                <span className={styles.unsentBadge}>{unsent} unsent</span>
              ) : null}
            </button>
          );
        })}
      </div>

      <div className={styles.workbench}>
        <div className={styles.reader}>
          <div className={styles.toolbar}>
            <span>{activePath}</span>
            <span>Source · local input</span>
          </div>
          <div className={styles.document} data-testid="facade-document">
            <h2>{activePath.split("/").at(-1)}</h2>
            <p className={styles.documentLead}>
              Typed feedback stays local until it is saved and published.
            </p>
            <ol className={styles.sourceLines}>
              {lines.map((line, index) => {
                const lineNumber = index + 1;
                const lineInputs = activeInputs.filter(
                  (input) => input.line === lineNumber,
                );
                return (
                  <li
                    className={styles.sourceRow}
                    key={`${activePath}:${lineNumber}`}
                  >
                    <div className={styles.sourceText}>
                      <span className={styles.lineNumber}>{lineNumber}</span>
                      <code>{line || " "}</code>
                    </div>
                    {lineInputs.map((input) => (
                      <CommentInputCard
                        key={input.id}
                        input={input}
                        onBodyChange={(body) =>
                          updateInput(input.id, (current) => ({
                            ...current,
                            body,
                          }))
                        }
                        onCollapse={() => collapseInput(input.id)}
                        onDiscard={() => discardInput(input.id)}
                        onResume={() =>
                          updateInput(input.id, (current) => ({
                            ...current,
                            state: "open",
                          }))
                        }
                        onSave={() => saveInput(input.id)}
                        onReanchor={() => reanchorInput(input.id)}
                        onKeyDown={(event) =>
                          onComposerKeyDown(event, input.id)
                        }
                      />
                    ))}
                  </li>
                );
              })}
            </ol>
          </div>
        </div>

        <aside className={styles.inspector} aria-label="Draft summary">
          <div className={styles.inspectorHeading}>Review</div>
          <div className={styles.metric}>
            <strong>{savedDraftCount}</strong>
            <span>saved for Publish</span>
          </div>
          <div className={styles.metric}>
            <strong>{unsentCount}</strong>
            <span>unsent · local only</span>
          </div>
          <div className={styles.boundaryNote}>
            Publish makes saved drafts agent-visible. It never waits for an
            agent; fetching happens later with a one-shot inbox command.
          </div>
        </aside>
      </div>

      <footer className={styles.statusbar}>
        <span>{activePath}</span>
        <span className={styles.localStatus}>
          {unsentCount} unsent input{unsentCount === 1 ? "" : "s"} · local only
        </span>
        <span className={styles.live}>Live</span>
      </footer>
    </section>
  );
}

function CommentInputCard({
  input,
  onBodyChange,
  onCollapse,
  onDiscard,
  onResume,
  onSave,
  onReanchor,
  onKeyDown,
}: {
  input: ResumableCommentInput;
  onBodyChange: (body: string) => void;
  onCollapse: () => void;
  onDiscard: () => void;
  onResume: () => void;
  onSave: () => void;
  onReanchor: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
}) {
  if (input.state === "collapsed") {
    return (
      <div className={styles.collapsed} data-testid={`collapsed-${input.id}`}>
        <button type="button" onClick={onResume}>
          Resume line {input.line} · {input.body.slice(0, 44)}
        </button>
        <button type="button" className={styles.discard} onClick={onDiscard}>
          Discard
        </button>
      </div>
    );
  }

  if (input.state === "saved") {
    return (
      <div className={styles.saved} data-testid={`saved-${input.id}`}>
        <strong>Saved pending draft · line {input.line}</strong>
        <span>{input.body}</span>
      </div>
    );
  }

  const stale = input.state === "stale";
  return (
    <article
      className={`${styles.composer} ${stale ? styles.composerStale : ""}`}
      aria-label={`Unsent comment on line ${input.line}`}
    >
      <header>
        <strong>
          {stale ? "Anchor changed" : `Line ${input.line} · Unsent input`}
        </strong>
        <button
          type="button"
          aria-label={`Collapse unsent comment on line ${input.line}`}
          onClick={onCollapse}
        >
          ×
        </button>
      </header>
      {stale ? (
        <p className={styles.staleNotice}>
          The file changed after this input started. Keep the text, then
          re-anchor or discard it explicitly.
        </p>
      ) : null}
      <textarea
        aria-label={`Unsent comment text on line ${input.line}`}
        value={input.body}
        onChange={(event) => onBodyChange(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <footer>
        {stale ? (
          <button type="button" onClick={onReanchor}>
            Re-anchor here
          </button>
        ) : (
          <span>Esc or × collapses safely</span>
        )}
        <button type="button" className={styles.discard} onClick={onDiscard}>
          Discard
        </button>
        <button
          type="button"
          className={styles.save}
          disabled={!input.body.trim() || stale}
          onClick={onSave}
        >
          Save pending draft
        </button>
      </footer>
    </article>
  );
}
