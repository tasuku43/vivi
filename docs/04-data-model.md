# Data model

## `FsNode`

A filesystem node represented with normalized relative paths.

```ts
type NodeKind = "file" | "directory";
type ViewerKind =
  | "markdown"
  | "html"
  | "code"
  | "text"
  | "image"
  | "json"
  | "unsupported";

interface FsNode {
  id: string;
  path: string;
  name: string;
  kind: NodeKind;
  viewerKind?: ViewerKind;
  parentPath: string | null;
  children?: FsNode[];
  size?: number;
  mtimeMs?: number;
  hash?: string;
  version?: number;
}
```

## Normalized path policy

- Paths are relative to the selected root.
- Paths use `/` separators in API responses.
- Absolute user-supplied paths are rejected for file APIs.
- `..` segments must not escape the root.
- Empty path represents the root only where explicitly allowed.

## Tree state strategy

In the UI, tree state should eventually be normalized:

```ts
interface TreeState {
  nodesByPath: Record<string, FsNode>;
  childrenByPath: Record<string, string[]>;
  expandedPaths: Set<string>;
  selectedPath: string | null;
  version: number;
}
```

This avoids re-rendering the entire tree for every update and keeps expansion state independent of server snapshots.

## Version and hash strategy

- Version numbers prevent stale updates.
- Content hashes or ETags validate whether content changed.
- Directory hashes may be added later as a Merkle-style optimization.
- Do not make recursive full-directory hashing the primary change-detection mechanism.
