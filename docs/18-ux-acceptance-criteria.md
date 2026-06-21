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
19. See source/code diffs as inline highlighted line rows, and rendered Markdown/HTML diffs as rendered visual panes.
20. Keep image, text/log, and structured file previews readable without implying editing.
21. See Git changes and files with open human/agent threads in one prioritized Review Queue, with compact thread/message counts, latest attributed activity, and seen/unseen progress.
22. Move through the Review Queue with Cmd/Ctrl + Shift + J/K and jump to unseen work with Cmd/Ctrl + Shift + U.
23. Keep resolved and archived threads in their Comments history filters rather than promoting them into the active Review Queue.

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
- diff-from-`HEAD` toggle rendering inside the open file surface, including inline source/code diffs, rendered Markdown/HTML diffs, and shortcut behavior.

Add an E2E test that starts the server against a fixture directory and verifies the UI can load the tree, open a Markdown file, open an HTML file, and receive at least one simulated filesystem event.
