# UI mockups

This directory contains static HTML mockups that define the intended product feel for the first polished implementation. They are self-contained files with no external CDN or package dependency.

## Current product direction

The preferred direction is `06-classic-reader-commandk.html`.

It combines:

- the stable workspace structure from the classic explorer mock,
- the readable document layout and H1/H2 outline from the document reader mock, and
- the keyboard-first command palette from the command focus mock.

The command palette is modal. It should not replace the normal layout. The normal layout remains a three-zone workspace:

```text
left   : live file tree
center : tabs plus active viewer
right  : document outline, metadata, and recent file events
modal  : Cmd/Ctrl + K command palette
```

## Mockup roles

- `01-classic-explorer.html`: baseline layout with sidebar tree, tabs, viewer, and status bar.
- `02-doc-reader.html`: long-form Markdown reading model with right-side outline/inspector.
- `03-preview-lab.html`: HTML preview and live event diagnostics exploration.
- `04-split-workbench.html`: source/rendered split-view exploration.
- `05-command-focus.html`: command palette and keyboard-heavy workflow exploration.
- `06-classic-reader-commandk.html`: preferred integrated direction.

## Implementation guidance

Use the mockups as product intent, not as literal CSS requirements. Implement the React UI through components and state boundaries that preserve the architecture in `docs/14-architecture.md`.

Early implementation should prioritize:

1. Left sidebar tree with stable expansion and selection state.
2. Tabs for several open files.
3. Main viewer dispatch by file type.
4. Right outline for Markdown H1/H2 headings and file metadata.
5. Cmd/Ctrl + K command palette for file open and actions.
6. SSE-driven live updates without full page refresh.
