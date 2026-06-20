export type SplitDirection = "horizontal" | "vertical";
export type SplitEdge = "left" | "right" | "top" | "bottom";

export interface EditorPane {
  id: string;
  activePath: string | null;
}

export interface EditorPaneNode {
  kind: "pane";
  pane: EditorPane;
}

export interface EditorSplitNode {
  kind: "split";
  id: string;
  direction: SplitDirection;
  first: EditorLayoutNode;
  second: EditorLayoutNode;
}

export type EditorLayoutNode = EditorPaneNode | EditorSplitNode;

export interface EditorLayout {
  root: EditorLayoutNode;
  activePaneId: string;
  nextPaneNumber: number;
}

export const initialEditorLayout: EditorLayout = {
  root: { kind: "pane", pane: { id: "main", activePath: null } },
  activePaneId: "main",
  nextPaneNumber: 1,
};

export function flattenPanes(layout: EditorLayout): EditorPane[] {
  return flattenPaneNodes(layout.root);
}

export function setPaneActivePath(
  layout: EditorLayout,
  paneId: string,
  path: string | null,
): EditorLayout {
  return {
    ...layout,
    activePaneId: paneId,
    root: mapPane(layout.root, paneId, (pane) => ({
      ...pane,
      activePath: path,
    })),
  };
}

export function splitEditorPane(
  layout: EditorLayout,
  paneId: string,
  direction: SplitDirection,
  edge?: SplitEdge,
): EditorLayout {
  const pane = findPane(layout.root, paneId);
  if (!pane) return layout;

  const newPane: EditorPane = {
    id: `pane-${layout.nextPaneNumber}`,
    activePath: pane.activePath,
  };
  const placement = edge ?? (direction === "vertical" ? "right" : "bottom");
  const newNode: EditorPaneNode = { kind: "pane", pane: newPane };

  return {
    root: replacePane(layout.root, paneId, (target) => {
      const targetNode: EditorPaneNode = { kind: "pane", pane: target };
      const newFirst =
        placement === "left" || placement === "top" ? newNode : targetNode;
      const newSecond =
        placement === "left" || placement === "top" ? targetNode : newNode;
      return {
        kind: "split",
        id: `split-${target.id}-${newPane.id}`,
        direction,
        first: newFirst,
        second: newSecond,
      };
    }),
    activePaneId: newPane.id,
    nextPaneNumber: layout.nextPaneNumber + 1,
  };
}

export function closePaneIfEmpty(
  layout: EditorLayout,
  paneId: string,
  hasTabs: boolean,
): EditorLayout {
  if (hasTabs) return layout;
  const panes = flattenPanes(layout);
  if (panes.length <= 1) return layout;
  const nextRoot = removePane(layout.root, paneId);
  if (!nextRoot) return layout;
  const nextPanes = flattenPaneNodes(nextRoot);
  return {
    ...layout,
    root: nextRoot,
    activePaneId: nextPanes[0]?.id ?? "main",
  };
}

function flattenPaneNodes(node: EditorLayoutNode): EditorPane[] {
  if (node.kind === "pane") return [node.pane];
  return [...flattenPaneNodes(node.first), ...flattenPaneNodes(node.second)];
}

function findPane(node: EditorLayoutNode, paneId: string): EditorPane | null {
  if (node.kind === "pane") return node.pane.id === paneId ? node.pane : null;
  return findPane(node.first, paneId) ?? findPane(node.second, paneId);
}

function mapPane(
  node: EditorLayoutNode,
  paneId: string,
  map: (pane: EditorPane) => EditorPane,
): EditorLayoutNode {
  if (node.kind === "pane")
    return node.pane.id === paneId
      ? { kind: "pane", pane: map(node.pane) }
      : node;
  return {
    ...node,
    first: mapPane(node.first, paneId, map),
    second: mapPane(node.second, paneId, map),
  };
}

function replacePane(
  node: EditorLayoutNode,
  paneId: string,
  replacement: (pane: EditorPane) => EditorLayoutNode,
): EditorLayoutNode {
  if (node.kind === "pane")
    return node.pane.id === paneId ? replacement(node.pane) : node;
  return {
    ...node,
    first: replacePane(node.first, paneId, replacement),
    second: replacePane(node.second, paneId, replacement),
  };
}

function removePane(
  node: EditorLayoutNode,
  paneId: string,
): EditorLayoutNode | null {
  if (node.kind === "pane") return node.pane.id === paneId ? null : node;

  const first = removePane(node.first, paneId);
  const second = removePane(node.second, paneId);
  if (!first) return second;
  if (!second) return first;
  return { ...node, first, second };
}
