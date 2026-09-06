# UX acceptance criteria

This file defines user-visible checks for the first production-quality UI pass.

## Minimum acceptable UI

A build is acceptable when a user can:

1. Start the CLI against a local directory.
2. See a live sidebar that preserves the selected root's real directory nesting.
3. See only supported documents and directories containing supported descendants; code, assets, structured files, and empty document directories stay absent.
4. Open Markdown and HTML documents from the tree and keep multiple documents open as tabs.
5. Switch tabs without losing tree expansion state.
6. View Markdown as a rendered document and HTML in a sandboxed preview, and toggle either source as supporting evidence.
7. Start from a repository-wide Review Queue, move through items needing attention, and switch the right inspector to the current document's H1/H2 outline and open feedback when local context is needed.
8. Double-click any rendered heading, paragraph, list item, or similar block to open a comment composer, whether or not Git reports a change.
9. Single-click and pointer-drag document text normally without opening a composer; drag selection remains selectable and copyable.
10. Save, publish, resume, and add review notes without losing document context; show whether an agent has observed published feedback without requiring an agent reply or an explicit resolved/archive status.
11. Open Cmd/Ctrl + K and fuzzy-select a document by filename or path.
12. Save the active document externally and see it update without a full page reload.
13. Add or remove a Markdown or HTML document externally and see the filtered real directory tree update.
14. Keep the default rendered document free of diff rails, dimming, and review prerequisites.
15. Enable an independent Changes lens only when change evidence is useful, then return explicitly to the clean document.
16. Keep browser-local comment input across outside clicks, document/tab navigation, rendered/source changes, and reload. Explicit Discard removes it. Show input-in-progress links only for files that are currently open; expose every visible input as a direct resume target that restores the correct file, surface, anchor, body, and focus. In rendered Markdown and HTML preview, keep exactly one anchored, no-reflow popover expanded, preserve the selected block as readable context, and collapse the previous target without discarding text. Saving the first comment promotes it to a durable pending thread, clears the same composer into an empty additional-note input, and keeps that input focused. Saving later notes likewise clears the submitted body and preserves focus for consecutive review thoughts. Publishing saved drafts must not discard a next unsaved thought at the same anchor.
17. Reject paths outside the selected root and keep watcher, search, tree, read, and Git-change boundaries aligned to supported document extensions.
18. Move between the repository Review Queue and current Document through two persistent inspector tabs whose labels and positions stay fixed; keep Review selected by default and keep “Next queued” within the Review workflow rather than treating it as navigation.
19. Scan active Markdown and HTML review files in one compact signal ledger, filter them by All, Unseen, Drafts, or Changed, and retain each parent path plus exact per-file diff totals. Pending drafts and published feedback not yet observed by an agent do not expire. Once every current published comment has an agent read receipt, that latest read joins watcher events and user opens in one thirty-minute inactivity window; after thirty quiet minutes the file simply leaves active attention without entering a Reviewed state. A later file change, user open, pending draft, or newly published unseen comment makes it visible again. Keep draft publication on the actionable file row while global “Next queued” order remains unchanged. When a source path is confirmed missing, remove it from all active counts and navigation immediately, retain its feedback under a collapsed Unavailable feedback section, and restore it after a file-add event or successful read.

## Quiet Reader acceptance

- Preserve the real filename as the primary sidebar label and show a document's
  first H1 underneath when available. Missing metadata must not prevent opening
  a document; heading updates must not change path identity, order or selection.
- Use understated outline folder icons and thin ancestor guide lines in the
  sidebar. Omit document icons so filename/H1 rows retain more text width.
  Guides follow visible nesting through lazy loading, collapse and keyboard
  expansion; decorative SVGs and lines do not add screen-reader stops.
- Keep tab close controls visible and group bulk operations in a keyboard-accessible
  Tab actions menu. Preview promotion and close-other/right/unchanged/preview
  operations preserve their existing semantics and operate only on their pane.
- Start fresh workspaces with 210 px sidebar and 310 px inspector widths; restore
  saved user widths. Keep document filenames legible while many tabs scroll.
- Offer Find a document from the toolbar and the empty reader, opening the real
  document palette. Explain reading, double-click feedback, saved drafts and
  explicit publication without adding new workflow states.
- At compact widths, expose the inspector through a visible bar and preserve its
  Review / Document choice. Escape closes the drawer and restores trigger focus.
- At 800 px and 520 px, keep document prose and viewer controls inside the pane,
  with reachable tab actions and inspector controls. Split panes retain independent
  tab operations and keyboard focus even when the same path is open twice.

## Evaluation function

Score a UI implementation against these dimensions:

- Layout fidelity: resembles the preferred mockup enough that sidebar, tabs, viewer, inspector, and palette roles are obvious.
- Interaction correctness: tree selection, tabs, viewer dispatch, and search palette state behave predictably.
- Live update correctness: active file and tree changes update without full page refresh.
- Safety: path traversal is rejected and HTML preview is sandboxed by default.
- Performance posture: implementation does not require one watcher per tree node or full React remounts for normal updates.
- Accessibility posture: keyboard access exists for palette, tabs, tree focus, and Escape-to-close interactions.
- Agent maintainability: UI state is decomposed into testable components and helpers, not one monolithic component.

## Suggested tests and evals

Add or update tests for:

- document extension filtering and empty-directory pruning,
- tab open/activate/close behavior,
- heading extraction for Markdown H1/H2 outline,
- search palette open/close, mode selection, and result selection,
- shortcut reference rendering and global shortcut mapping,
- SSE change event reloading the active file,
- add/unlink event updating the tree,
- rendered Markdown and HTML single-click/drag/double-click comment gesture separation,
- document-focused feedback and outline rendering,
- Document/Review inspector switching and review-queue navigation,
- Review Queue signal filtering, compact Markdown/HTML rows, parent-path metadata, inline draft publication, diff totals, and global next-item ordering,
- watcher-event filtering and SSE tree refresh for Markdown and HTML additions/removals,
- optional diff-from-`HEAD` rendering inside the open document surface,
- resumable comment input transitions: outside click, Escape/collapse, navigation and reload restoration, rendered-to-source return, explicit discard, successful save, individual pending-draft deletion, publish cleanup, and stale-anchor re-anchoring.

Add an E2E test that starts the server against a mixed fixture directory and verifies the UI exposes only the pruned Markdown and HTML Explorer tree, filters Review Queue files by signal without changing their global order, opens each document kind, preserves drag selection, starts feedback only on double-click, and receives at least one document-relevant filesystem event.

## Quiet workspace details

- The selected file owns one tree-row fill. Expanded ancestors remain quiet;
  collapsing a selected descendant's folder preserves a small location cue.
- A normally collapsed tree is not described as truncated. Genuine row limits,
  directory loading, and load failures retain their notices.
- Saving feedback says **Save draft**. Publishing remains a separate action.
- Connection state and unpublished drafts remain visible at narrow widths.
  Watcher counts and refresh details live in a keyboard-accessible disclosure.
- Search puts filename and parent directory together and keeps key hints below
  the result list. Full path identity remains available to assistive technology.
- Review Queue does not repeat its total in the heading and All filter. Unseen,
  drafts, and changes stay independent signals, each shown once per row.
- The Markdown reading surface has no outer card frame or shadow. A first-visit
  feedback tip can be dismissed; returning readers do not see it repeatedly.
- Passive rendered comments retain a discoverable marker without persistent
  paragraph fills. The open/input target receives the emphasis. Published/read
  state remains on feedback rather than recoloring the document.
- Rendered/source selection uses one labeled native control; source inputs and
  the optional Changes lens retain their state across mode switches.
- Markdown feedback markers occupy the text column's right margin without adding
  a line or overlapping the paragraph. Text-layer positioning must never override
  the marker's absolute positioning in either document adapter.
