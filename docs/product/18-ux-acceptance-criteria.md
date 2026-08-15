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
10. Save, publish, resume, reply to, resolve, and archive anchored feedback without losing its document context.
11. Open Cmd/Ctrl + K and fuzzy-select a document by filename or path.
12. Save the active document externally and see it update without a full page reload.
13. Add or remove a Markdown or HTML document externally and see the filtered real directory tree update.
14. Keep the default rendered document free of diff rails, dimming, and review prerequisites.
15. Enable an independent Changes lens only when change evidence is useful, then return explicitly to the clean document.
16. Keep browser-local comment input across outside clicks, document/tab navigation, rendered/source changes, and reload. Explicit Discard removes it. Saving the first comment promotes it to a durable pending draft and closes the local composer so the next document block is immediately available; saving a follow-up clears the submitted body but keeps the same composer focused for consecutive replies.
17. Reject paths outside the selected root and keep watcher, search, tree, read, and Git-change boundaries aligned to supported document extensions.

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
- watcher-event filtering and SSE tree refresh for Markdown and HTML additions/removals,
- optional diff-from-`HEAD` rendering inside the open document surface,
- resumable comment input transitions: outside click, Escape/collapse, navigation and reload restoration, rendered-to-source return, explicit discard, successful save, individual pending-draft deletion, publish cleanup, and stale-anchor re-anchoring.

Add an E2E test that starts the server against a mixed fixture directory and verifies the UI exposes only the pruned Markdown and HTML directory tree, opens each document kind, preserves drag selection, starts feedback only on double-click, and receives at least one document-relevant filesystem event.
