import { useRef, useState } from "react";
import type { FsNode } from "../domain/fs-node.js";
import {
  boundedVisibleTreeRows,
  initialExpandedPaths,
} from "../state/tree-expansion.js";
import { treeKeyboardAction } from "../state/tree-navigation.js";
import { FolderIcon } from "../shared/components/FolderIcon.js";
import styles from "./SidebarSelectionFacade.module.css";

const file = (path: string, documentHeading: string): FsNode => ({
  id: path,
  path,
  name: path.split("/").at(-1)!,
  kind: "file",
  parentPath: path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : null,
  viewerKind: "markdown",
  documentHeading,
});
const nodes: FsNode[] = [
  file("README.md", "Vivi"),
  {
    id: "docs",
    path: "docs",
    name: "docs",
    kind: "directory",
    parentPath: null,
    children: [
      file("docs/README.md", "Documentation"),
      {
        id: "docs/architecture",
        path: "docs/architecture",
        name: "architecture",
        kind: "directory",
        parentPath: "docs",
        children: [
          file("docs/architecture/14-architecture.md", "Architecture"),
          file("docs/architecture/15-security-model.md", "Security model"),
          file("docs/architecture/16-performance.md", "Performance"),
        ],
      },
    ],
  },
  file("SECURITY.md", "Security policy"),
];

// Visual approval facade: fixture state only, no filesystem or app connections.
export function SidebarSelectionFacade({
  width = 210,
  light = false,
}: {
  width?: number;
  light?: boolean;
}) {
  const [selected, setSelected] = useState(
    "docs/architecture/15-security-model.md",
  );
  const [focused, setFocused] = useState(selected);
  const [expanded, setExpanded] = useState(() => initialExpandedPaths(nodes));
  const tree = useRef<HTMLDivElement>(null);
  const rows = boundedVisibleTreeRows(nodes, expanded).rows;
  function toggle(path: string) {
    setExpanded((current) => {
      const next = new Set(current);
      next.has(path) ? next.delete(path) : next.add(path);
      return next;
    });
  }
  function focus(path: string) {
    setFocused(path);
    tree.current
      ?.querySelectorAll<HTMLElement>("[data-path]")
      .forEach((item) => {
        if (item.dataset.path === path) item.focus();
      });
  }
  return (
    <section className={`${styles.stage} ${light ? styles.light : ""}`}>
      <p className={styles.note}>
        Concept 50 A · Storybook facade · クリックと矢印キーで比較
      </p>
      <aside
        className={styles.sidebar}
        style={{ width }}
        aria-label="Quiet selection concept A"
      >
        <h2>Documents</h2>
        <div
          role="tree"
          aria-label="Fixture documents"
          ref={tree}
          onKeyDown={(event) => {
            const action = treeKeyboardAction(
              rows,
              expanded,
              focused,
              event.key,
            );
            if (!action) return;
            event.preventDefault();
            if (action.kind === "focus") focus(action.path);
            else if (action.kind === "toggle") toggle(action.path);
            else {
              const node = rows.find(
                (row) => row.node.path === action.path,
              )?.node;
              if (node?.kind === "directory") toggle(action.path);
              else setSelected(action.path);
            }
          }}
        >
          {rows.map(({ node, depth }) => {
            const folder = node.kind === "directory";
            const hidden =
              folder &&
              !expanded.has(node.path) &&
              selected.startsWith(node.path + "/");
            return (
              <button
                key={node.path}
                data-path={node.path}
                role="treeitem"
                aria-level={depth + 1}
                aria-selected={node.path === selected}
                aria-expanded={folder ? expanded.has(node.path) : undefined}
                aria-label={`${node.path}${hidden ? ", contains selected document" : ""}`}
                tabIndex={focused === node.path ? 0 : -1}
                className={`${styles.row} ${node.path === selected ? styles.selected : ""}`}
                style={{ paddingLeft: 8 + depth * 14 + (folder ? 0 : 17) }}
                title={`${node.path}${node.documentHeading ? "\n" + node.documentHeading : ""}`}
                onFocus={() => setFocused(node.path)}
                onClick={() => {
                  folder ? toggle(node.path) : setSelected(node.path);
                }}
              >
                {Array.from({ length: depth }, (_, i) => (
                  <span
                    className={styles.guide}
                    style={{ left: 14 + i * 14 }}
                    key={i}
                    aria-hidden="true"
                  />
                ))}
                {folder ? (
                  <>
                    <span className={styles.chevron} aria-hidden="true">
                      {expanded.has(node.path) ? "⌄" : "›"}
                    </span>
                    <FolderIcon />
                  </>
                ) : null}
                <span className={styles.copy}>
                  <span className={styles.name}>{node.name}</span>
                  {node.documentHeading ? (
                    <span className={styles.heading}>
                      {node.documentHeading}
                    </span>
                  ) : null}
                </span>
                {hidden ? (
                  <span
                    className={styles.location}
                    data-current-location
                    aria-hidden="true"
                  />
                ) : node.path === "README.md" && node.path !== selected ? (
                  <span
                    className={styles.open}
                    title="Open in another tab"
                    aria-hidden="true"
                  />
                ) : null}
              </button>
            );
          })}
        </div>
      </aside>
      <p className={styles.note} aria-live="polite">
        Selected: {selected}
      </p>
    </section>
  );
}
