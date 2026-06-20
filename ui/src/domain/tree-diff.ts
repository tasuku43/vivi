import type { FsEvent, FsNode } from "./fs-node.js";

export function flattenTree(nodes: FsNode[]): Map<string, FsNode> {
  const result = new Map<string, FsNode>();
  const visit = (node: FsNode) => {
    result.set(node.path, node);
    for (const child of node.children ?? []) visit(child);
  };
  for (const node of nodes) visit(node);
  return result;
}

export function diffTree(
  before: FsNode[],
  after: FsNode[],
  version: number,
): FsEvent[] {
  const beforeMap = flattenTree(before);
  const afterMap = flattenTree(after);
  const events: FsEvent[] = [];

  for (const [path, node] of afterMap) {
    if (!beforeMap.has(path))
      events.push({ type: "add", path, kind: node.kind, version });
  }
  for (const [path, node] of beforeMap) {
    if (!afterMap.has(path))
      events.push({ type: "unlink", path, kind: node.kind, version });
  }
  for (const [path, node] of afterMap) {
    const old = beforeMap.get(path);
    if (!old || node.kind !== "file") continue;
    if (
      old.mtimeMs !== node.mtimeMs ||
      old.size !== node.size ||
      old.hash !== node.hash
    ) {
      events.push({ type: "change", path, version, hash: node.hash });
    }
  }

  return events;
}
