# UI product decisions

## Product frame

The product thesis is documented in [`00-product-thesis.md`](00-product-thesis.md).

The UI should serve the human side of Vivi's review-adapter model: humans read in the browser, leave feedback in context, and coding agents consume that feedback through the CLI and API. This document describes the browser-side product decisions that make that loop feel low-friction for humans.

## Finalized direction

The product is a document-first reader with a real filtered directory tree, a
document inspector, and a modal search palette. This supersedes the earlier
generic-workspace and Review-Queue-first details retained later in this ADR as
implementation history.

The preferred mockup is:

```text
docs/ui-mocks/06-classic-reader-commandk.html
```

This direction keeps the mental model simple: the real directory tree stays
visible but contains only supported documents, open documents stay visible as
tabs, the clean rendered document is central, and feedback plus outline live in
the right inspector. Changes are an optional lens, not the default organizer.

## Color and theme system

Product UI colors should be consumed through semantic CSS custom properties named
`--vivi-color-*` and defined in `ui/src/styles.css`. Do not introduce short
alias tokens such as `--panel` or `--muted`; component CSS should read as if the
semantic token system had always existed.

The current product theme is Blueprint Ledger: dark mode is a quiet blue-black
review workspace with restrained cyan selection/focus and amber change signals;
light mode is its cool daylight pair with white reader surfaces and blue-gray
chrome. The theme is based on:

```text
docs/ui-mocks/35-theme-compare-11-12.html
```

Dark mode is the default token set on `:root`. Light mode is the
`:root[data-theme="light"]` override. Browser theme preference management stays
in `ui/src/state/theme.ts` as `system | light | dark`, with the resolved value
written to `document.documentElement.dataset.theme`.

Each semantic color token must be present in both light and dark theme blocks.
When a new product color role is needed, add it to `ui/src/state/color-tokens.ts`
and keep the corresponding token contract test updated. Snapshot tests should
show no visual diff for pure token migrations.

Prefer adding color roles by product state rather than by visual intensity:

- `brand-*` is for the wordmark and identity signal.
- `selection-*` is for selected tree rows, active command results, active panes,
  current review stops, and other spatial selection.
- `focus-*` is for keyboard and drag/drop focus rings.
- `change-*` is for changed, stale, pending, watcher, and unseen-change signals.
- `review-*` is for review work, open threads, unread review attention, and
  search/comment highlights.
- `comment-*` remains the lower-level inline comment surface family and should
  stay visually compatible with `review-*`.

## Workspace layout

The app should use this default layout:

```text
left sidebar     : live real directory tree filtered to supported documents
main center      : open-file tabs and active viewer
right inspector  : current-document outline, feedback, and disclosed source details
search overlay   : Cmd/Ctrl + K quick open, Cmd/Ctrl + Shift + F text search
bottom status    : watched file count, open tab count, connection/server status
```

The layout should degrade responsively. On narrow screens the right inspector may collapse first; the left tree should remain available unless explicitly hidden.

## Sidebar tree

The sidebar is the stable spatial map of the selected root directory. Labels
and nesting must come from real paths; Vivi must not invent semantic groups.

Requirements:

- It should update when files or directories are added, removed, renamed, or changed.
- It should preserve expanded/collapsed state across live updates whenever possible.
- It should preserve the selected path when the active file changes.
- It should ignore `.git`, `node_modules`, and common build caches by default.
- It should hide non-document files and directories with no supported document descendants.
- It should not mount a React component for every file in very large trees once virtualization is introduced.

## Tabs

Tabs are required because users will open several documents while reviewing.

Requirements:

- Opening a file from the tree should create or activate a tab.
- Tabs should preserve open-document context across supported document adapters.
- Open tabs, active panes, and split layout should survive browser refresh for the same selected root.
- Closing a tab should remove it from automatic refresh restoration, while keeping it eligible for recent-file affordances.
- The active tab should drive the main viewer.
- A changed but inactive file should show a subtle stale/changed indicator.
- Closing the active tab should select a neighboring tab predictably.

The refresh-restoration state is browser-local UI state, so it belongs in localStorage rather than the server process. Stored sessions are scoped by root path, pruned when older than 30 days, and validated against the current tree before restoration. File payloads are not stored; active files are refetched after restoration.

## Main viewer

The main viewer should dispatch by document kind:

- Markdown: rendered document with source toggle.
- HTML: sandboxed iframe preview with source toggle.
- Unsupported files do not appear as independent destinations.

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

## Feedback and right inspector

The right inspector opens on the repository-wide Review Queue. The queue is the
primary workflow for moving through work that needs attention. A persistent
Document entry switches the same inspector to the current document's outline,
open feedback/local drafts, and source details. This keeps queue processing
central without making diff the default document view.

Review Queue and Document are presented as two equal-width, persistent tabs at
the top of the inspector. Their labels and positions do not change between
surfaces. Review Queue remains selected by default and keeps its active queue
position while Document provides contextual reading helpers. “Next queued” is
a Review Queue workflow action below the tabs, not a third navigation mode.

The right inspector is primarily a review navigation surface. It should answer which files and threads need attention before it offers per-file helpers.

Requirements:

- Review Queue and Document should remain visible as stable inspector tabs on
  both surfaces, with the active destination clearly selected and the active
  queue count visible on Review Queue.
- The Review surface should lead with a deduplicated file queue, primarily from Git working-tree changes against `HEAD` when Git is available. It is the inspector's default surface; Document is the contextual secondary surface while reading.
- The Review Queue is a file-level work queue: it is the union of Git changes and files with authoritative `open` comment threads. Files with only `resolved` threads stay out of the queue and remain available from the Comments history filter; files with only `archived` threads are hidden from the browser UI.
- Accepting a change as-is is a local right-inspector review decision, not a Git operation. It hides the current `path + change fingerprint` from the active queue, keeps it recoverable while its recent receipt is visible, and never hides the file when an authoritative `open` comment thread or a saved pending draft exists.
- `Reviewed` is not a durable file or thread lifecycle state. It is a short-lived completion receipt for a review stop that just left active attention, such as a manually accepted diff or a resolved feedback thread. When that receipt expires, the item leaves the Reviewed section without returning to Needs Review as long as its current fingerprint is still covered by a review decision.
- Review decisions and Reviewed receipts are stored in the workspace-scoped local Vivi data directory as `review-ledger.jsonl`. The ledger is compacted on read/write so expired receipts and inactive decisions do not accumulate indefinitely.
- A changed file whose review conversation is resolved in the UI, or whose agent/CLI resolution is observed by the UI, is hidden from the active queue by a fingerprint-scoped review decision. The decision uses tree-stable file metadata so it survives reload without depending on an open file or loaded diff; new file evidence changes the fingerprint and returns the file to Needs Review.
- Each row should keep change kind and diff size visible while adding only the open-thread count, message count, latest attributed activity, and an unseen marker. Agent reads are visible activity but do not create unseen work; new threads, replies, and status changes do.
- Queue ordering should put files with open threads first, then unseen work and recent activity. The summary progress is explicitly files "seen", not a claim that review is complete.
- Activity is observation history. The UI must refresh authoritative comments after agent replies or status changes and must never infer a thread lifecycle status from an activity event.
- Watcher events may feed the queue when Git status is unavailable, but they should be collapsed by file path instead of shown as raw event history.
- Markdown and HTML documents should expose an H1/H2 outline under "In this file" below the Review Queue.
- Comments should preserve the surface where the issue was seen, such as rendered Markdown, HTML preview, source, or diff.
- Typed comment input is browser-local working state until the user saves it as a pending draft. Outside clicks do not close it. Escape and the close action collapse it without deleting text; explicit Discard removes it. Open and collapsed input survives file, tab, rendered/source navigation, and page reload for the same workspace. Saving the first comment promotes the text into a durable pending draft and removes the browser-local input session. Saving a follow-up clears that session body but keeps its textarea focused so consecutive replies do not require another click. Stored unsaved input expires after 30 days.
- Pending drafts are the Publish boundary. Unsaved input is shown separately and never contributes to the Publish count. Rendered Markdown and HTML preview show a compact Source-input return action when typed Source input exists for the active file. Saving the first rendered comment keeps the pending draft available through its document marker and inspector entry, turns the same composer into the saved thread's empty follow-up input, and keeps focus there for consecutive thoughts. Double-clicking another rendered block can still open a separate Markdown composer or replace the fixed HTML composer. Opening a marker or inspector entry resumes the same pending thread; later saves likewise keep that thread open and ready for the next input until focus moves or the user closes it. Deleting its last pending message closes the now-empty thread. Successful Publish retains the published thread while preserving any next unsaved thought at the same anchor. When the underlying file hash changes, an open input becomes stale and requires Re-anchor or Discard before it can be saved.
- HTML preview comments should use one fixed floating composer near the right-middle of the viewport. Unlike source/code comments, opening a second HTML preview target replaces the current composer instead of keeping multiple block-local forms open.
- The active heading should be highlightable later as the user scrolls.
- File type, path, watch status, size, and last update information should be minimized or kept behind a lightweight details disclosure.
- In Git worktrees, diff viewing is an independent `Diff from HEAD` toggle on the open file surface, not a right-inspector preview and not part of the rendered/source segmented control. While active, its label becomes `Back to file` so the exit action is explicit. The toggle should also be available with Cmd/Ctrl + D.
- Markdown and HTML diffs should follow the current viewer surface: rendered/preview mode treats each changed rendered block as a rendered change card with Added/Removed/Changed semantics, before/after rendered previews, and an explicit source hunk affordance. It should not try to overlay diff marks onto the final rendered document. Source mode shows source diff rows. Source/code/JSON/text/CSV/Mermaid and unknown text files use a read-only inline line diff with removed and added rows highlighted in-place. Image files expose the same diff surface; SVG can show source diffs when Git reports text changes, while binary image formats show an explicit binary diff status.
- For non-Markdown files, the inspector can show a compact empty state or lightweight symbols under "In this file."
- The Review Queue is not a staging UI or a full history browser. Rename-like watcher add/remove pairs are grouped as likely renames when they are close in time and share parent and extension, while Git status can surface explicit renamed files in the changed-file list.

Current diff support:

- Supported document destinations: Markdown (`.md`, `.markdown`, `.mdown`) and HTML (`.html`, `.htm`). Code, structured data, text, images, and unknown files do not appear as independent destinations.
- Not yet supported: none among files that can be opened in the current viewer surface.
- Later polish: CSV/TSV can graduate from source diff to table-aware diff, Mermaid can add rendered diagram comparison, and binary images can add side-by-side committed/working previews.

## Search palette

The overlay should stay small and search-oriented. It is not a separate command-first layout and should not become a universal command runner for every read-only action.

Shortcuts:

- Cmd/Ctrl + K opens quick open for fuzzy filename/path search.
- Cmd/Ctrl + Shift + F opens full-text search across text-previewable files.
- Cmd/Ctrl + W closes the active vivi tab when one is open.
- Cmd/Ctrl + / opens a bundled keyboard shortcut reference.
- Cmd/Ctrl + Shift + J/K moves to the next/previous Review Queue item, Cmd/Ctrl + Shift + U opens the next unseen work item, and Cmd/Ctrl + Shift + I opens the next in-review reply.
- Cmd/Ctrl + O is avoided because it conflicts with browser and operating-system file-open expectations.

The palette should close on Escape, open selected files with Enter, and preserve the current workspace state.

Non-search actions should live on their natural surfaces: tabs for tab management, viewer controls for source/rendered and diff, inspector controls for review events, and layout gestures for split panes. This keeps the overlay predictable and prevents command inventory from becoming the main product.

## Product intent

This is not an IDE clone. It is the human-facing browser surface of a local review adapter. Editing, git staging, remote collaboration, agent orchestration, and project-wide semantic intelligence are non-goals for the initial product.
