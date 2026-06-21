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

## Comments

The normative thread/message responsibilities, lifecycle, compatibility
projection, and export format are documented in
[`22-comment-thread-lifecycle.md`](22-comment-thread-lifecycle.md).

Comments are stored outside the viewed workspace so read-only mounts remain
compatible. The first storage adapter writes JSONL to the Vivi data directory:
`$VIVI_DATA_DIR/comments.jsonl` when set, then `$XDG_DATA_HOME/vivi/comments.jsonl`,
then the platform user data fallback.
Unpublished draft review comments live in the same data directory as
`comment-drafts.jsonl`; they are not projected into public comment threads until
publish.

The canonical comment anchor is a source file location:

```ts
type CommentStatus = "open" | "resolved" | "archived";
type CommentSurface = "source" | "rendered" | "diff";

interface ViviComment {
  id: string;
  threadId?: string;
  path: string;
  reviewBatchId?: string;
  anchor: {
    surface: CommentSurface;
    canonical: {
      path: string;
      lineStart?: number;
      lineEnd?: number;
      quote?: string;
      fileHash?: string;
    };
    rendered?: {
      kind: "markdown" | "html";
      selector?: string;
      textQuote?: string;
      sourceLineStart?: number;
      sourceLineEnd?: number;
    };
    diff?: {
      path: string;
      lineStart: number;
      lineEnd: number;
      side: "current";
      changeKind?: "context" | "added";
    };
  };
  body: string;
  status: CommentStatus;
  createdAt: string;
  updatedAt: string;
}
```

Draft review comments use the same path, body, actor, and anchor shape without
`status`, `threadId`, or lifecycle timestamps:

```ts
interface DraftReviewComment {
  id: string;
  path: string;
  viewerKind: string;
  anchor: ViviComment["anchor"];
  body: string;
  createdAt: string;
  updatedAt: string;
}
```

Rendered Markdown and HTML comments store selected rendered text and any
best-effort source line mapping available at creation time. Diff comments only
target current-file lines. Deleted lines from the old file are not valid comment
anchors.

The UI treats comments as messages in a thread regardless of where they were created.
Source, rendered, and diff views are creation contexts that feed the same stable
comment id and canonical source anchor. Saved comments are surfaced in files as
line-level highlights and subtle gutter markers when a line anchor is available.
The right inspector intentionally shows only a lightweight current-file summary;
the global Comments panel is the primary browsing and processing surface.

New comments carry an explicit `threadId`; legacy comments without one project
to a one-message thread whose id is the comment id. UI anchor grouping remains
only as a fallback for old flat records. Thread lifecycle is the authoritative
status; message status fields are compatibility projections.

Publishing draft review comments assigns one `reviewBatchId` to every resulting
thread and first message. Agents use that id to read all threads from the same
human review batch together.

Code comment ranges can be created by dragging across the fixed line-number
gutter, Shift-selecting line numbers, or selecting part of the source text. The
selected rows retain a custom gutter bar after the native text selection is
cleared, and the inline thread editor is inserted after the range's final line.
Single-line comments use the fixed plus button beside the line number; no comment
control follows the variable-width end of the source line.
