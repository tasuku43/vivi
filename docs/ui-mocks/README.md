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
- `19-right-inspector-concepts.html`: right inspector review-state concepts with A/B/C mode comparison and hidden-history treatment.
- `20-draft-review-flow.html`: draft-first feedback flow that separates private draft batching from the published Comments inbox.
- `21-comments-hub-concepts.html`: three alternatives that put private drafts, open threads, attention, and history under the Cmd/Ctrl+Shift+C Comments entry point.
- `22-review-queue-language.html`: review queue language mock that separates Queued, In Review, and Reviewed from the softer unread dot.
- `23-review-queue-modern-patterns.html`: five modern review queue patterns that keep the three-state language while exploring denser inspector, file tree, and file-view placement.
- `24-review-queue-flat-inspector-patterns.html`: five flatter right-inspector refinements for Pattern A that avoid nested group and file blocks.
- `25-review-queue-hairline-workbench.html`: full-workbench Hairline Groups direction with stronger In Review indicators only when an agent reply needs attention.
- `26-review-queue-empty-state-patterns.html`: empty-state alternatives for zero-count Queued/In Review groups when Reviewed still has recoverable history.
- `32-right-inspector-draft-absorption.html`: three alternatives for absorbing private drafts and the old Comments shortcut role into the right inspector.
- `33-in-review-draft-thread-label-patterns.html`: four alternatives for labeling private draft threads inside expanded In Review file rows.
- `34-line-thread-comment-concepts.html`: three current-UI-respecting concepts that separate line-thread model fixes from cautious rendered/preview commenting affordances.
- `35-theme-exploration.html`: same-state theme explorations for the classic workspace, keeping the file tree, tabs, active Markdown viewer, right inspector, review queue, watcher state, and command palette constant while varying only the visual theme. Includes `35-theme-compare-01-11.html` for comparing Graphite Ledger with the Blueprint Ledger hybrid and `35-theme-compare-11-12.html` for comparing the Blueprint Ledger dark/light pair.
- `36-rendered-change-cards.html`: concept mock for treating rendered Markdown/HTML diffs as reviewable change cards with explicit Added/Removed/Changed rails, source hunk affordances, and comment anchors outside the rendered content.

## Implementation guidance

Use the mockups as product intent, not as literal CSS requirements. Implement the React UI through components and state boundaries that preserve the architecture in `docs/architecture/14-architecture.md`.

Early implementation should prioritize:

1. Left sidebar tree with stable expansion and selection state.
2. Tabs for several open files.
3. Main viewer dispatch by file type.
4. Right outline for Markdown H1/H2 headings and file metadata.
5. Cmd/Ctrl + K command palette for file open and actions.
6. SSE-driven live updates without full page refresh.

The React implementation now adds a more specific code inspection mode on top of this mock direction: line numbers, read-only line range selection, copyable local references, a sticky current-scope hint, and code metadata/symbols in the inspector. The static mock remains the layout reference rather than a complete inventory of newer viewer controls.
