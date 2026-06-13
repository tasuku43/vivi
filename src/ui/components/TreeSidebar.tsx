import { useEffect, useMemo, useState } from "react";
import type { FsNode } from "../../domain/fs-node.js";
import { iconForPath } from "../state/file-icons.js";
import {
  countTreeNodes,
  ensureVisibleAncestors,
  initialExpandedPaths,
  visibleTreeRows,
} from "../state/tree-expansion.js";

interface Props {
  nodes: FsNode[];
  selectedPath: string | null;
  changedPaths?: Set<string>;
  removedPaths?: Set<string>;
  onSelect: (path: string) => void;
}

export function TreeSidebar({
  nodes,
  selectedPath,
  changedPaths = new Set(),
  removedPaths = new Set(),
  onSelect,
}: Props) {
  const forceVisiblePaths = useMemo(
    () =>
      [selectedPath, ...changedPaths, ...removedPaths].filter(
        (path): path is string => Boolean(path),
      ),
    [changedPaths, removedPaths, selectedPath],
  );
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() =>
    initialExpandedPaths(nodes, { forceVisiblePaths }),
  );

  useEffect(() => {
    setExpandedPaths((current) => {
      return ensureVisibleAncestors(current, forceVisiblePaths);
    });
  }, [forceVisiblePaths, nodes]);

  const totalRows = useMemo(() => countTreeNodes(nodes), [nodes]);
  const visibleRows = useMemo(
    () => visibleTreeRows(nodes, expandedPaths),
    [expandedPaths, nodes],
  );

  return (
    <>
      {totalRows > visibleRows ? (
        <div className="tree-perf-note">
          Showing {visibleRows} of {totalRows} rows. Expand folders as needed.
        </div>
      ) : null}
      <div className="tree">
        {nodes.map((node) => (
          <TreeNode
            key={node.path}
            node={node}
            selectedPath={selectedPath}
            changedPaths={changedPaths}
            removedPaths={removedPaths}
            expandedPaths={expandedPaths}
            onToggleDirectory={(path) =>
              setExpandedPaths((current) => togglePath(current, path))
            }
            onSelect={onSelect}
          />
        ))}
      </div>
    </>
  );
}

function TreeNode({
  node,
  selectedPath,
  changedPaths,
  removedPaths,
  expandedPaths,
  onToggleDirectory,
  onSelect,
}: {
  node: FsNode;
  selectedPath: string | null;
  changedPaths: Set<string>;
  removedPaths: Set<string>;
  expandedPaths: Set<string>;
  onToggleDirectory: (path: string) => void;
  onSelect: (path: string) => void;
}) {
  if (node.kind === "directory") {
    const expanded = expandedPaths.has(node.path);
    return (
      <div className="tree-node">
        <button
          className="tree-row dir"
          onClick={() => onToggleDirectory(node.path)}
        >
          <span className="tree-twisty">{expanded ? "▾" : "▸"}</span>
          <span className="file-icon">📁</span>
          <span>{node.name}</span>
        </button>
        {expanded && (
          <div className="tree-children">
            {node.children?.map((child) => (
              <TreeNode
                key={child.path}
                node={child}
                selectedPath={selectedPath}
                changedPaths={changedPaths}
                removedPaths={removedPaths}
                expandedPaths={expandedPaths}
                onToggleDirectory={onToggleDirectory}
                onSelect={onSelect}
              />
            ))}
          </div>
        )}
      </div>
    );
  }
  return (
    <button
      data-tree-path={node.path}
      className={[
        "tree-row file",
        node.path === selectedPath ? "selected" : "",
        changedPaths.has(node.path) ? "changed" : "",
        removedPaths.has(node.path) ? "removed" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={() => onSelect(node.path)}
    >
      <span className="tree-twisty" />
      <span className="file-icon">
        {iconForPath(node.path, node.viewerKind)}
      </span>
      <span>{node.name}</span>
      {changedPaths.has(node.path) ? (
        <span className="tree-badge">changed</span>
      ) : null}
    </button>
  );
}

function togglePath(paths: Set<string>, path: string): Set<string> {
  const next = new Set(paths);
  if (next.has(path)) next.delete(path);
  else next.add(path);
  return next;
}
