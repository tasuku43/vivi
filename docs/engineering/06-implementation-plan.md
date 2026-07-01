# Implementation plan

This is the historical build sequence. The current implementation contract is
kept in `docs/contracts/03-cli-or-api-contract.md`, `docs/architecture/14-architecture.md`, and
`docs/architecture/25-runtime-architecture.md`.

## Phase 0: Scaffold hardening

- Ensure package scripts run.
- Ensure all docs and tests are wired into CI.
- Keep contracts explicit.

## Phase 1: Minimal vertical slice

- CLI accepts root and port.
- Server exposes a browser data API, workspace events, and HTML preview.
- UI loads tree and file content.
- Markdown, HTML, code, text, image, and unsupported viewer kinds are routed.
- File change event refreshes the open file.

The original vertical slice used REST data routes. The current Go runtime uses
GraphQL for normal workspace data, while HTTP remains for preview resources,
SSE event streams, static assets, and the local review ledger.

## Phase 2: Live tree behavior

- Watch add, unlink, change, addDir, unlinkDir events.
- Either refetch tree or apply semantic tree events.
- Preserve expanded and selected state across updates.
- Add debouncing for event storms.

## Phase 3: Safety and UX

- Harden path traversal rejection.
- Add iframe sandbox options.
- Add large-file limits.
- Add clear error views.
- Add raw/rendered toggle for Markdown and HTML.

## Phase 4: Performance

- Normalize tree state in UI.
- Avoid rendering collapsed descendants.
- Add virtualization for large trees.
- Add ETag/version checks.

## Phase 5: Polish

- Better command help.
- Browser auto-open.
- File type icons.
- Keyboard navigation.
- Fuzzy open.

## UI milestone update

The UI milestone should now target the integrated mockup in `docs/ui-mocks/06-classic-reader-commandk.html`.

Suggested vertical slices:

1. Replace the current two-pane shell with a three-zone shell: sidebar, center, inspector.
2. Introduce open-file tab state and make tree selection open or activate tabs.
3. Add viewer mode controls for rendered/source where supported.
4. Add Markdown H1/H2 extraction and inspector rendering.
5. Add a search palette: Cmd/Ctrl + K for quick open and Cmd/Ctrl + Shift + F for text search.
6. Wire SSE file events to active viewer refresh, tree refresh, and tab changed indicators.
7. Add E2E coverage for the minimum UX acceptance criteria in `docs/product/18-ux-acceptance-criteria.md`.
