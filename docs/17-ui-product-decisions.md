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
- The active tab should drive the main viewer.
- A changed but inactive file should show a subtle stale/changed indicator.
- Closing the active tab should select a neighboring tab predictably.

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

## Right inspector and outline

The right inspector is useful for long Markdown files and for making live file state visible without cluttering the main viewer.

Requirements:

- Markdown documents should expose an H1/H2 outline in the inspector.
- The active heading should be highlightable later as the user scrolls.
- The inspector should show file type, path, watch status, and last update information.
- Recent file events can be shown as a compact diagnostic/status feed.
- For non-Markdown files, the inspector can show file metadata and related actions instead of an outline.

## Command palette

Cmd/Ctrl + K should open a modal command palette on top of the normal workspace. It is not a separate command-first layout.

Initial commands:

- Open file by fuzzy path search.
- Open result in current tab.
- Open result in a new tab.
- Focus tree.
- Focus outline.
- Toggle rendered/source mode when supported.

The palette should close on Escape and preserve the current workspace state.

## Product intent

This is not an IDE clone. It is a local live viewer for reading and inspecting files. Editing, git staging, remote collaboration, and project-wide semantic intelligence are non-goals for the initial product.
