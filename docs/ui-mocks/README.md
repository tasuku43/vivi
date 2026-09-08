# UI mockups

This directory contains static HTML mockups that define the intended product feel for the first polished implementation. They are self-contained files with no external CDN or package dependency.

## Current implementation reference

The currently wired UI was based on `06-classic-reader-commandk.html`.

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

## Approved replacement direction

`40-living-document-review-states.html` is the approved replacement direction.
It narrows the library to documents, keeps ordinary rendered reading and
comment-anywhere as the core loop, and exposes changes only as an optional lens.
The matching Storybook facade is the visual contract before this direction is
wired into the application.

## Mockup roles

- `53-delete-published-feedback.html`: published-comment deletion concepts: direct Delete (recommended), overflow menu, and Feedback-based management. Includes confirmation, last-unseen removal, remaining feedback, Recent, and failure states. Concept A and facade approved; wired to the published-comment deletion API. Storybook `Review/Published Comment Deletion` preserves the interactive visual contract.

- `52-now-reading.html`: proposed “いま見る” inspector with persistent feedback, a 30-minute recent section, simulated time, agent reads and presentation, temporary dismissal, and empty state. Specification: `docs/research/33-now-reading-spec.md`.

- `48-document-titles-in-tree.html`: four sidebar H1 concepts using identical paths and ordering: H1 replacement, filename-first with H1 (recommended), H1-first with filename, and focused-title disclosure. Includes narrow/wide comparisons, a composed reader, duplicate/long/missing/unloaded headings, and a heading-update simulation. These are alternatives for review, not an approved title-extraction or tree-contract change.
- `47-reader-ux-refinement.html`: UX refinement concepts based on a live walkthrough: quieter tab controls and reader proportions, contextual feedback entry, and explicit publication scope. Concept A is selected, with an interactive facade in Storybook under `Workspace/Quiet Reader`; application wiring awaits facade approval. Includes light/dark, narrow, empty, stale-input, and disconnected comparisons.
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
- `37-in-review-read-receipts.html`: three alternatives for showing agent read receipts, unread agent replies, and human read boundaries in the In Review workflow.
- `38-resumable-comment-composer.html`: three policies for preserving typed comment input across line, file, tab, mode, inspector, outside-click, Escape, and file-change transitions without changing Publish into an agent synchronization gate.
- `39-document-only-directions.html`: three product-boundary concepts for narrowing Vivi to document review, from a reversible document filter to a document-native semantic review model and a guided review journey.
- `40-living-document-review-states.html`: the selected document-first direction with normal reading and comment-anywhere as the default, plus optional comment, thread, and change-lens states.
- `41-review-document-navigation.html`: four alternatives for moving between the queue-first review workflow and contextual document inspector without treating workflow actions as peer navigation.
- `42-unified-publish-flow.html`: three current-UI concepts for making Typing, Ready, and Published/Open feedback use one recognizable Publish experience across Review Queue and Document.
- `43-review-queue-directory-organization.html`: three queue-first concepts for restoring directory context across mixed workspaces. The selected direction is an independently collapsible, attention-only tree that reuses the left Explorer's row, icon, indentation, hover, and selection language.
- `44-compact-review-queue-inspector.html`: three compact right-inspector alternatives that remove the duplicate queue directory tree and keep paths as per-file metadata. Concept C, the signal ledger with attention filters, is the selected direction.
- `45-shared-attention-window.html`: the selected state model: unseen feedback stays pinned, an agent read starts the same 30-minute window as file changes and user opens, and quiet work recedes without Resolved, Archived, or Reviewed browser states.
- `46-floating-rendered-feedback.html`: three no-reflow Markdown feedback concepts plus a shared policy that removes missing sources from active queue counts while keeping their feedback recoverable.

- `49-sidebar-structure.html`: three sidebar structure concepts with the adopted filename/H1 rows held constant: all-row outline icons, folder-only icons with hierarchy guides, and icon-free hierarchy guides. Includes width and theme controls. Concept B selected: folder-only outline icons and hierarchy guides, with filename/H1 document rows.

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

- [50 · Sidebar selection](50-sidebar-selection.html): compare a single-row fill, a short selection marker, and branch/text emphasis at 210px and 280px in both themes. A is accepted and wired; the comparison is preserved as the design record.

- [51 · Workspace detail review](51-workspace-detail-review.html): eight observed UX details across comments, navigation, status, review, reader chrome, search, tabs, and empty states; compare conservative, document-centered, and focus concepts. The document-centered direction is wired; see [implementation evidence](../research/32-workspace-detail-review.md).
