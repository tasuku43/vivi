import { useState } from "react";
import type { FsNode } from "../../domain/fs-node.js";
import { iconForPath } from "../state/file-icons.js";

interface Props {
  nodes: FsNode[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
}

export function TreeSidebar({ nodes, selectedPath, onSelect }: Props) {
  return (
    <div className="tree">
      {nodes.map((node) => (
        <TreeNode
          key={node.path}
          node={node}
          selectedPath={selectedPath}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

function TreeNode({
  node,
  selectedPath,
  onSelect,
}: {
  node: FsNode;
  selectedPath: string | null;
  onSelect: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  if (node.kind === "directory") {
    return (
      <div className="tree-node">
        <button
          className="tree-row dir"
          onClick={() => setExpanded((value) => !value)}
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
      className={
        node.path === selectedPath ? "tree-row file selected" : "tree-row file"
      }
      onClick={() => onSelect(node.path)}
    >
      <span className="tree-twisty" />
      <span className="file-icon">
        {iconForPath(node.path, node.viewerKind)}
      </span>
      <span>{node.name}</span>
    </button>
  );
}
