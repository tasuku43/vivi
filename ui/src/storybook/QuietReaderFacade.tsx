import { FolderIcon } from "../shared/components/FolderIcon.js";
import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import {
  closeOpenTab,
  closeOtherOpenTabs,
  closePreviewTabs,
  closeTabsToRight,
  closeUnchangedTabs,
  promoteOpenTab,
  type OpenTab,
} from "../state/tabs.js";
import {
  documentReaderFixture,
  type DocumentReaderNode,
} from "./fixtures/review-lab.js";
import styles from "./QuietReaderFacade.module.css";

const fixture = documentReaderFixture;
function filesIn(nodes: DocumentReaderNode[]): string[] {
  return nodes.flatMap((node) =>
    node.kind === "directory" ? filesIn(node.children) : [node.path],
  );
}
const extraPaths = [
  "docs/product/README.md",
  "docs/product/long-document-name-for-reviewing-first-time-user-experience.md",
  "docs/research/README.md",
];
const readerTree: DocumentReaderNode[] = fixture.documents.map((node) =>
  node.kind === "directory" && node.path === "docs"
    ? {
        ...node,
        children: [
          ...node.children,
          ...["product", "research"].map((name) => ({
            kind: "directory" as const,
            name,
            path: `docs/${name}`,
            children: extraPaths
              .filter((path) => path.startsWith(`docs/${name}/`))
              .map((path) => ({
                kind: "file" as const,
                path,
                name: path.split("/").at(-1)!,
                format: "markdown" as const,
                commentCount: 0,
                changeCount: 0,
              })),
          })),
        ],
      }
    : node,
);
const headings: Record<string, string> = {
  "README.md": "Vivi — local document workspace",
  "docs/getting-started.md": "はじめてのVivi",
  "docs/guides/agent-loop.md": "人とエージェントのフィードバックループ",
  "docs/product/README.md": "プロダクトの考え方",
  "docs/research/README.md": "プロダクトの考え方",
  "docs/product/long-document-name-for-reviewing-first-time-user-experience.md":
    "初めての利用でも迷わず読み始められる文書体験を設計する",
};
const documents = filesIn(readerTree);
const makeTab = (path: string): OpenTab => ({
  path,
  viewerKind: path.endsWith(".html") ? "html" : "markdown",
  paneId: "main",
  changed: path === "docs/guides/agent-loop.md",
  isPreview: path.includes("long-document-name"),
});

/** Local fixture state only: the approved concept's review surface, not the app. */
export function QuietReaderFacade({
  initial = "single",
  width,
  split = false,
  theme = "dark",
}: {
  initial?: "single" | "dense" | "empty";
  width?: number;
  split?: boolean;
  theme?: "dark" | "light";
}) {
  const [tabs, setTabs] = useState<OpenTab[]>(() =>
    initial === "empty"
      ? []
      : initial === "dense"
        ? documents.map(makeTab)
        : [makeTab("README.md")],
  );
  const [active, setActive] = useState<string | null>(
    initial === "empty" ? null : "README.md",
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [inspector, setInspector] = useState<"queue" | "document">("queue");
  const [drawer, setDrawer] = useState(false);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuShell = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const activeTab = tabs.find((tab) => tab.path === active);

  useEffect(() => {
    const previous = document.documentElement.dataset.theme;
    document.documentElement.dataset.theme = theme;
    return () => {
      if (previous === undefined) delete document.documentElement.dataset.theme;
      else document.documentElement.dataset.theme = previous;
    };
  }, [theme]);

  useEffect(() => {
    if (!menuOpen) return;
    menu.current
      ?.querySelector<HTMLButtonElement>("button:not(:disabled)")
      ?.focus();
    function outside(event: PointerEvent) {
      if (
        event.target instanceof Node &&
        !menuShell.current?.contains(event.target)
      )
        setMenuOpen(false);
    }
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [menuOpen]);
  useEffect(() => {
    if (searchOpen) {
      dialog.current?.showModal();
      input.current?.focus();
    } else dialog.current?.close();
  }, [searchOpen]);

  function closeMenu() {
    setMenuOpen(false);
    menuTrigger.current?.focus();
  }
  function apply(result: { tabs: OpenTab[]; nextActivePath: string | null }) {
    setTabs(result.tabs);
    setActive(result.nextActivePath);
    closeMenu();
  }
  function open(path: string) {
    if (!tabs.some((tab) => tab.path === path))
      setTabs((current) => [...current, makeTab(path)]);
    setActive(path);
    setSearchOpen(false);
    setQuery("");
  }
  function menuKeys(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeMenu();
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const buttons = Array.from(
      menu.current?.querySelectorAll<HTMLButtonElement>(
        "button:not(:disabled)",
      ) ?? [],
    );
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? buttons.length - 1
          : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) %
            buttons.length;
    buttons[next]?.focus();
  }
  function tabKeys(event: KeyboardEvent<HTMLDivElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    if (
      !(event.target instanceof HTMLElement) ||
      !event.target.hasAttribute("data-document-tab")
    )
      return;
    event.preventDefault();
    const index = tabs.findIndex((tab) => tab.path === active);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? tabs.length - 1
          : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) %
            tabs.length;
    setActive(tabs[next].path);
    event.currentTarget
      .querySelectorAll<HTMLButtonElement>("[data-document-tab]")
      [next]?.focus();
  }
  function renderTree(nodes: DocumentReaderNode[]) {
    return nodes.map((node) =>
      node.kind === "directory" ? (
        <details key={node.path} open>
          <summary>
            <FolderIcon />
            {node.name}
          </summary>
          <div className={styles.treeChildren}>{renderTree(node.children)}</div>
        </details>
      ) : (
        <button
          key={node.path}
          className={styles.treeFile}
          aria-current={active === node.path ? "page" : undefined}
          title={`${node.path}\n${headings[node.path] || "No H1"}`}
          onClick={() => open(node.path)}
        >
          <span>{node.name}</span>
          <small>{headings[node.path] || "No H1"}</small>
        </button>
      ),
    );
  }
  return (
    <div
      className={styles.boundary}
      style={{ maxWidth: width }}
      onKeyDown={(event) => {
        if (
          (event.metaKey || event.ctrlKey) &&
          event.key.toLowerCase() === "k"
        ) {
          event.preventDefault();
          setSearchOpen(true);
        }
      }}
    >
      <div className={styles.reviewNote}>
        Concept A · Storybook facade · fixture data
      </div>
      <div className={styles.workspace}>
        <header className={styles.topbar}>
          <strong className={styles.brand}>vivi</strong>
          <span>{fixture.workspace}</span>
          <button onClick={() => setSearchOpen(true)}>
            Find a document <kbd>⌘ / Ctrl K</kbd>
          </button>
        </header>
        <aside className={styles.tree} aria-label="Documents">
          <h2>Documents</h2>
          {renderTree(readerTree)}
        </aside>
        <main className={styles.reader}>
          <div className={styles.tabsRow}>
            <div
              className={styles.tabs}
              role="group"
              aria-label="Open documents"
              onKeyDown={tabKeys}
            >
              {tabs.map((tab) => (
                <div
                  className={styles.tabShell}
                  key={tab.path}
                  data-active={tab.path === active}
                >
                  <button
                    data-document-tab
                    aria-current={tab.path === active ? "page" : undefined}
                    aria-label={`Open ${tab.path}${tab.isPreview ? " preview" : ""}`}
                    tabIndex={tab.path === active ? 0 : -1}
                    title={tab.path}
                    onClick={() => setActive(tab.path)}
                  >
                    <span className={styles.tabName}>
                      {tab.path.split("/").at(-1)}
                    </span>
                    {tabs.filter(
                      (item) =>
                        item.path.split("/").at(-1) ===
                        tab.path.split("/").at(-1),
                    ).length > 1 && (
                      <small>
                        {tab.path.includes("/")
                          ? tab.path.slice(0, tab.path.lastIndexOf("/"))
                          : "workspace root"}
                      </small>
                    )}
                    {tab.isPreview && <small>Preview</small>}
                    {tab.changed && (
                      <small className={styles.changed}>Changed on disk</small>
                    )}
                  </button>
                  <button
                    className={styles.closeTab}
                    aria-label={`Close ${tab.path}`}
                    onClick={() => {
                      const result = closeOpenTab(tabs, tab.path, active);
                      setTabs(result.tabs);
                      setActive(result.nextActivePath);
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
            <div
              ref={menuShell}
              className={styles.menuShell}
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget))
                  setMenuOpen(false);
              }}
            >
              <button
                ref={menuTrigger}
                disabled={!tabs.length}
                aria-label="Tab actions"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen(!menuOpen)}
              >
                •••
              </button>
              {menuOpen && (
                <div
                  ref={menu}
                  className={styles.menu}
                  role="menu"
                  aria-label="Tab actions"
                  onKeyDown={menuKeys}
                >
                  <button
                    role="menuitem"
                    disabled={!activeTab?.isPreview}
                    onClick={() => {
                      if (active) setTabs(promoteOpenTab(tabs, active));
                      closeMenu();
                    }}
                  >
                    Keep preview open
                  </button>
                  <button
                    role="menuitem"
                    disabled={tabs.length < 2}
                    onClick={() => apply(closeOtherOpenTabs(tabs, active))}
                  >
                    Close other tabs
                  </button>
                  <button
                    role="menuitem"
                    disabled={tabs.at(-1)?.path === active}
                    onClick={() => apply(closeTabsToRight(tabs, active))}
                  >
                    Close tabs to the right
                  </button>
                  <button
                    role="menuitem"
                    disabled={!tabs.some((tab) => !tab.changed)}
                    onClick={() => apply(closeUnchangedTabs(tabs, active))}
                  >
                    Close unchanged tabs
                  </button>
                  <button
                    role="menuitem"
                    disabled={!tabs.some((tab) => tab.isPreview)}
                    onClick={() => apply(closePreviewTabs(tabs, active))}
                  >
                    Close preview tabs
                  </button>
                </div>
              )}
            </div>
          </div>
          <button
            className={styles.drawerToggle}
            aria-expanded={drawer}
            onClick={() => setDrawer(!drawer)}
          >
            {drawer ? "Close inspector" : "Review queue · 2"}
          </button>
          {active ? (
            <>
              <div className={styles.toolbar}>
                <span title={active}>{active}</span>
                <span>Rendered</span>
              </div>
              <div className={split ? styles.split : undefined}>
                <article
                  className={styles.document}
                  aria-label="Active document"
                >
                  <p className={styles.hint}>
                    Double-click a block to leave feedback. Save a draft, then
                    publish for your agent.
                  </p>
                  <h1>
                    {active === "README.md"
                      ? fixture.title
                      : active.split("/").at(-1)}
                  </h1>
                  {fixture.blocks.map((block) =>
                    block.kind === "heading" ? (
                      <h2 key={block.id} id={`quiet-${block.id}`}>
                        {block.text}
                      </h2>
                    ) : block.kind === "list" ? (
                      <ul key={block.id}>
                        {block.text.split("|").map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    ) : (
                      <p key={block.id}>{block.text}</p>
                    ),
                  )}
                </article>
                {split && (
                  <article
                    className={styles.document}
                    aria-label="Second document"
                  >
                    <small>docs / guides / agent-loop.md</small>
                    <h2>Keep review context close</h2>
                    <p>Compare another document without losing your place.</p>
                    <p>This second pane is a static layout sample.</p>
                  </article>
                )}
              </div>
            </>
          ) : (
            <section className={styles.empty}>
              <span>YOUR LOCAL REVIEW SPACE</span>
              <h1>
                Open a document.
                <br />
                Make your next thought precise.
              </h1>
              <p>Choose Markdown or HTML from the tree.</p>
              <button onClick={() => setSearchOpen(true)}>
                Find a document
              </button>
              <ol>
                <li>Read the document as it was written.</li>
                <li>Double-click a block to leave feedback.</li>
                <li>Save a draft, then publish for your agent.</li>
              </ol>
              <small>Local workspace · files stay read-only</small>
            </section>
          )}
        </main>
        <aside
          className={`${styles.inspector} ${drawer ? styles.drawerOpen : ""}`}
          aria-label="Review inspector"
        >
          <div
            className={styles.inspectorTabs}
            role="group"
            aria-label="Inspector view"
          >
            <button
              aria-pressed={inspector === "queue"}
              onClick={() => setInspector("queue")}
            >
              Review queue · 2
            </button>
            <button
              aria-pressed={inspector === "document"}
              onClick={() => setInspector("document")}
            >
              Document
            </button>
          </div>
          {inspector === "queue" ? (
            <>
              <h2>2 active files</h2>
              <p className={styles.hint}>Sorted by attention</p>
              <button
                className={styles.queueItem}
                onClick={() => open("docs/guides/reviewing.html")}
              >
                <strong>reviewing.html</strong>
                <small>docs / guides</small>
                <span>Unseen by agent</span>
              </button>
              <button
                className={styles.queueItem}
                onClick={() => open("README.md")}
              >
                <strong>README.md</strong>
                <small>workspace root</small>
                <span className={styles.changed}>Changed · +12 −3</span>
              </button>
              <p className={styles.hint}>
                Unseen feedback stays until an agent reads it. Recent activity
                recedes after 30 quiet minutes.
              </p>
            </>
          ) : (
            <>
              <h2>In this document</h2>
              {active ? (
                fixture.blocks
                  .filter((block) => block.kind === "heading")
                  .map((block) => (
                    <a
                      className={styles.outline}
                      href={`#quiet-${block.id}`}
                      key={block.id}
                    >
                      {block.text}
                    </a>
                  ))
              ) : (
                <p className={styles.hint}>
                  Open a document to see its outline.
                </p>
              )}
            </>
          )}
        </aside>
        <footer className={styles.status}>
          <span>● Live · sample</span>
          <span>
            {tabs.length} {tabs.length === 1 ? "tab" : "tabs"} open
          </span>
          <span>Document navigation only · feedback is a visual sample</span>
        </footer>
      </div>
      <dialog
        ref={dialog}
        className={styles.search}
        aria-labelledby="quiet-search-title"
        onCancel={() => setSearchOpen(false)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            setSearchOpen(false);
          }
        }}
        onClose={() => setSearchOpen(false)}
      >
        <div className={styles.searchHeading}>
          <h2 id="quiet-search-title">Find a document</h2>
          <button
            aria-label="Close document search"
            onClick={() => setSearchOpen(false)}
          >
            ×
          </button>
        </div>
        <label htmlFor="quiet-query">Filename or path</label>
        <input
          id="quiet-query"
          ref={input}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              const path = documents.find((path) =>
                path.toLowerCase().includes(query.toLowerCase()),
              );
              if (path) open(path);
            }
          }}
        />
        <div className={styles.searchResults}>
          {documents
            .filter((path) => path.toLowerCase().includes(query.toLowerCase()))
            .map((path) => (
              <button key={path} onClick={() => open(path)}>
                {path}
              </button>
            ))}
          {!documents.some((path) =>
            path.toLowerCase().includes(query.toLowerCase()),
          ) && <p>No matching documents.</p>}
        </div>
      </dialog>
    </div>
  );
}
