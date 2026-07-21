# UX acceptance criteria

This file defines user-visible checks for the first production-quality UI pass.

## Minimum acceptable UI

A build is acceptable when a user can:

1. Start the CLI against a local directory.
2. See a live sidebar tree for the selected root.
3. Open at least Markdown, HTML, code, text, and image files from the tree.
4. Keep multiple files open as tabs.
5. Switch tabs without losing tree expansion state.
6. View Markdown as a rendered document.
7. See an H1/H2 outline for Markdown under "In this file" in the right inspector.
8. Preview HTML in a sandboxed iframe.
9. Open Cmd/Ctrl + K and fuzzy-select a file by filename or path.
10. Open Cmd/Ctrl + Shift + F and select a text match from searchable file contents.
11. Open the shortcut reference with Cmd/Ctrl + / and see search, diff, review, palette, and tab-closing shortcuts listed together.
12. Close the active app tab with Cmd/Ctrl + W without closing the browser tab.
13. Save the active file externally and see the active viewer update without a full page reload.
14. Add or remove a file externally and see the tree update.
15. Open source code with syntax highlighting, line numbers, line/range selection, and copyable references.
16. Use Review Queue as a deduplicated file list for paths that need review, primarily from the HEAD diff when Git is available and from collapsed watcher signals otherwise.
17. Toggle Markdown and HTML between rendered/preview and source modes.
18. Toggle read-only diff-from-`HEAD` independently from rendered/source mode, including with Cmd/Ctrl + D.
19. See source/code diffs as inline highlighted line rows, and rendered Markdown/HTML diffs as rendered change cards with clear Added/Removed/Changed meaning and accessible source hunk context.
20. Leave typed Source feedback, switch to Rendered/Preview, see the active-file input count, and return directly to the restored composer.
21. Reload the page without losing browser-local comment input for the same workspace; saving keeps a pending draft visible, while successful Publish removes the empty local composer.
22. See a stable preview skeleton while a newly selected file loads, an explicit `Back to file` action while viewing a diff, and Review Queue attention counts labeled by what they represent.
23. Keep image, text/log, and structured file previews readable without implying editing.
24. See Git changes and files with open human/agent threads in one prioritized Review Queue, with compact thread/message counts, latest attributed activity, and seen/unseen progress.
25. Move through the Review Queue with Cmd/Ctrl + Shift + J/K, jump to unseen work with Cmd/Ctrl + Shift + U, and jump to in-review replies with Cmd/Ctrl + Shift + I.
26. Keep resolved threads in the Comments history filter, hide archived threads from the browser UI, and never promote terminal threads into the active Review Queue.
27. Keep typed comment input when the user clicks elsewhere, switches files or tabs, changes rendered/source mode, reloads the page, or collapses with Escape/close; remove it only through an explicit Discard action or after successful Publish.
28. Count only saved pending drafts in Publish actions, label unsaved input separately, and require an explicit Re-anchor or Discard decision when the anchored file version changes.
29. Delete an individual saved pending draft from its comment thread before publishing, without affecting other pending drafts.

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

- viewer kind dispatch,
- tab open/activate/close behavior,
- heading extraction for Markdown H1/H2 outline,
- search palette open/close, mode selection, and result selection,
- shortcut reference rendering and global shortcut mapping,
- SSE change event reloading the active file,
- add/unlink event updating the tree,
- HTML preview route preserving sandbox defaults.
- code viewer line numbers, line selection, copy-reference formatting, and code inspector metadata.
- Review Queue rendering, HEAD-change lifecycle, watcher-event deduplication, and SSE event transport.
- agent-aware Review Queue derivation, lifecycle-safe activity display, seen/unseen priority, and next/previous keyboard navigation.
- JSON/structured formatting and text wrap behavior where feasible.
- diff-from-`HEAD` toggle rendering inside the open file surface, including inline source/code diffs, rendered Markdown/HTML change cards, and shortcut behavior.
- resumable comment input transitions: outside click, Escape/collapse, navigation and reload restoration, rendered-to-source return, explicit discard, successful save, individual pending-draft deletion, publish cleanup, and stale-anchor re-anchoring.

Add an E2E test that starts the server against a fixture directory and verifies the UI can load the tree, open a Markdown file, open an HTML file, and receive at least one simulated filesystem event.
