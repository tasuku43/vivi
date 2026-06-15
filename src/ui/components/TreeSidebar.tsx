import { useEffect, useMemo, useState } from "react";
import type { FsNode } from "../../domain/fs-node.js";
import { iconForPath } from "../state/file-icons.js";
import {
  boundedVisibleTreeRows,
  countTreeNodes,
  ensureVisibleAncestors,
  initialExpandedPaths,
} from "../state/tree-expansion.js";

interface Props {
  nodes: FsNode[];
  selectedPath: string | null;
  changedPaths?: Set<string>;
  removedPaths?: Set<string>;
  onSelect: (path: string) => void;
  onOpen: (path: string) => void;
}

export function TreeSidebar({
  nodes,
  selectedPath,
  changedPaths = new Set(),
  removedPaths = new Set(),
  onSelect,
  onOpen,
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
  const boundedRows = useMemo(
    () =>
      boundedVisibleTreeRows(nodes, expandedPaths, {
        forceVisiblePaths,
      }),
    [expandedPaths, forceVisiblePaths, nodes],
  );

  return (
    <>
      {totalRows > boundedRows.totalVisibleRows ? (
        <div className="tree-perf-note">
          Showing {boundedRows.totalVisibleRows} of {totalRows} rows. Expand
          folders as needed.
        </div>
      ) : null}
      {boundedRows.omittedRows > 0 ? (
        <div className="tree-perf-note">
          Rendering {boundedRows.rows.length} of {boundedRows.totalVisibleRows}{" "}
          visible rows. Narrow with changed-only view or collapse a folder to
          see more.
        </div>
      ) : null}
      <div className="tree">
        {boundedRows.rows.map(({ node, depth }) => (
          <TreeRow
            depth={depth}
            expanded={node.kind === "directory" && expandedPaths.has(node.path)}
            key={`${node.path}:${depth}`}
            node={node}
            selectedPath={selectedPath}
            changedPaths={changedPaths}
            removedPaths={removedPaths}
            onToggleDirectory={(path) =>
              setExpandedPaths((current) => togglePath(current, path))
            }
            onSelect={onSelect}
            onOpen={onOpen}
          />
        ))}
      </div>
    </>
  );
}

function TreeRow({
  node,
  depth,
  expanded,
  selectedPath,
  changedPaths,
  removedPaths,
  onToggleDirectory,
  onSelect,
  onOpen,
}: {
  node: FsNode;
  depth: number;
  expanded: boolean;
  selectedPath: string | null;
  changedPaths: Set<string>;
  removedPaths: Set<string>;
  onToggleDirectory: (path: string) => void;
  onSelect: (path: string) => void;
  onOpen: (path: string) => void;
}) {
  const indent = { paddingLeft: `${8 + depth * 14}px` };
  if (node.kind === "directory") {
    return (
      <button
        className="tree-row dir"
        data-tree-path={node.path}
        onClick={() => onToggleDirectory(node.path)}
        style={indent}
      >
        <span className="tree-twisty">{expanded ? "▾" : "▸"}</span>
        <span className="file-icon">📁</span>
        <span>{node.name}</span>
      </button>
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
      onDoubleClick={() => onOpen(node.path)}
      style={indent}
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
