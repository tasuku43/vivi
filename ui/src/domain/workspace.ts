import type { TreeSnapshot, ViewerConfig } from "./fs-node.js";

export interface WorkspaceSnapshot {
  tree: TreeSnapshot;
  config: ViewerConfig;
}
