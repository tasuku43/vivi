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
7. See an H1/H2 outline for Markdown in the right inspector.
8. Preview HTML in a sandboxed iframe.
9. Open Cmd/Ctrl + K and fuzzy-select a file.
10. Save the active file externally and see the active viewer update without a full page reload.
11. Add or remove a file externally and see the tree update.
12. Open source code with syntax highlighting, line numbers, line/range selection, and copyable references.
13. Open recent changed files from a compact review queue.
14. Toggle Markdown and HTML between rendered/preview and source modes.
15. Switch changed Markdown, HTML, and source/code files into a read-only diff-from-`HEAD` viewer mode.
16. Keep image, text/log, and structured file previews readable without implying editing.

## Evaluation function

Score a UI implementation against these dimensions:

- Layout fidelity: resembles the preferred mockup enough that sidebar, tabs, viewer, inspector, and palette roles are obvious.
- Interaction correctness: tree selection, tabs, viewer dispatch, and command palette state behave predictably.
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
- command palette open/close and result selection,
- SSE change event reloading the active file,
- add/unlink event updating the tree,
- HTML preview route preserving sandbox defaults.
- code viewer line numbers, line selection, copy-reference formatting, and code inspector metadata.
- recent review queue event rendering and SSE event transport.
- JSON/structured formatting and text wrap behavior where feasible.
- diff-from-`HEAD` viewer mode rendering inside the open file surface, including rendered Markdown/HTML diffs.

Add an E2E test that starts the server against a fixture directory and verifies the UI can load the tree, open a Markdown file, open an HTML file, and receive at least one simulated filesystem event.
