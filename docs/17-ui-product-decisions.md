# UI product decisions

## Finalized direction

The first polished UI should be based on the classic explorer layout, with a document-reader inspector and a modal command palette.

The preferred mockup is:

```text
docs/ui-mocks/06-classic-reader-commandk.html
```

This direction was chosen because it keeps the mental model simple: the filesystem tree stays visible, open files stay visible as tabs, the active file is central, and secondary navigation lives in a right inspector.

## Workspace layout

The app should use this default layout:

```text
left sidebar     : live directory tree
main center      : open-file tabs and active viewer
right inspector  : Markdown H1/H2 outline, file metadata, recent file events
command overlay  : Cmd/Ctrl + K command palette
bottom status    : watched file count, open tab count, connection/server status
```

The layout should degrade responsively. On narrow screens the right inspector may collapse first; the left tree should remain available unless explicitly hidden.

## Sidebar tree

The sidebar is the stable spatial map of the selected root directory.

Requirements:

- It should update when files or directories are added, removed, renamed, or changed.
- It should preserve expanded/collapsed state across live updates whenever possible.
- It should preserve the selected path when the active file changes.
- It should ignore `.git`, `node_modules`, and common build caches by default.
- It should not mount a React component for every file in very large trees once virtualization is introduced.

## Tabs

Tabs are required because users will open several files while reviewing generated output and source files.

Requirements:

- Opening a file from the tree should create or activate a tab.
- Tabs should preserve open-file context across Markdown, HTML, code, text, and image files.
- Open tabs, active panes, and split layout should survive browser refresh for the same selected root.
- Closing a tab should remove it from automatic refresh restoration, while keeping it eligible for recent-file affordances.
- The active tab should drive the main viewer.
- A changed but inactive file should show a subtle stale/changed indicator.
- Closing the active tab should select a neighboring tab predictably.

The refresh-restoration state is browser-local UI state, so it belongs in localStorage rather than the server process. Stored sessions are scoped by root path, pruned when older than 30 days, and validated against the current tree before restoration. File payloads are not stored; active files are refetched after restoration.

## Main viewer

The main viewer should dispatch by viewer kind:

- Markdown: rendered document with source toggle.
- HTML: sandboxed iframe preview with source toggle.
- Code: syntax-highlighted source.
- Text/log: plain text viewer.
- Image: image preview.
- Structured files: readable code-style view initially; richer viewers can come later.
- Unsupported or large files: safe fallback with raw/download/size information.

The active viewer should update without a full page refresh when the open file changes on disk.

### Code Viewer Pro

Code is treated as a read-only inspection surface, not an editor. The code viewer should provide:

- stable line numbers,
- click and shift-click line/range selection,
- copyable `path:start-end` references,
- copyable selected code with path and line numbers,
- syntax highlighting,
- a sticky current-scope hint using lightweight local detection,
- subtle refreshed/changed status,
- code metadata and lightweight symbols in the inspector.

The implementation intentionally avoids editable textareas, project-wide indexing, language servers, and heavyweight parsers.

## Right inspector and outline

The right inspector is useful for long Markdown files and for making live file state visible without cluttering the main viewer.

Requirements:

- Markdown documents should expose an H1/H2 outline in the inspector.
- The active heading should be highlightable later as the user scrolls.
- The inspector should show file type, path, watch status, and last update information.
- Recent file events can be shown as a compact diagnostic/status feed.
- In Git worktrees, uncommitted working-tree changes can appear beside watcher events, with small side-by-side text diffs shown read-only from `HEAD` or another recent allowed commit base.
- For non-Markdown files, the inspector can show file metadata and related actions instead of an outline.
- For code files, the inspector shows language, line count, selected range, lightweight symbols, and recent filesystem events.
- The review queue is a live filesystem review surface with a read-only Git working-tree supplement. It is not a staging UI or a full history browser. Rename-like watcher add/remove pairs are grouped as likely renames when they are close in time and share parent and extension, while Git status can surface explicit renamed files in the changed-file list.

## Command palette

Cmd/Ctrl + K should open a modal command palette on top of the normal workspace. It is not a separate command-first layout.

Initial commands:

- Open file by fuzzy path search.
- Open changed file from the review queue.
- Show diff for a changed file.
- Reveal active file in the tree.
- Toggle rendered/source mode when supported.
- Copy a local raw preview URL.
- Focus outline.
- Toggle inspector.
- Split right for side-by-side reading.
- Close tab and reopen the last closed tab.
- Open recent file.
- Show keyboard shortcuts.
- Export current context.

The palette should close on Escape and preserve the current workspace state.

Palette commands stay read-only. They move focus, show diffs, change viewing mode, copy local context, and arrange panes; they do not edit, stage, commit, or mutate files.

## Product intent

This is not an IDE clone. It is a local live viewer for reading and inspecting files. Editing, git staging, remote collaboration, and project-wide semantic intelligence are non-goals for the initial product.
