# Vivi Goals

`vivi` is a local-first review surface for agent-written workspaces. It should
let a human launch one CLI command, inspect a live directory tree in the browser,
preview common local artifacts safely, and leave feedback that a coding agent can
read through stable local contracts.

Near-term goals:

- Preserve a read-only local browser app with safe defaults.
- Keep the file tree, open tabs, active viewer, inspector, and command palette
  as separate testable UI state.
- Preview Markdown, sandboxed HTML, code, text, images, structured files,
  diagrams, diffs, unknown text-like files, and binary metadata.
- Refuse paths outside the selected root and ignore common build/cache
  directories by default.
- Use watcher events and file versions or hashes to keep open previews fresh.
- Keep the CLI/API contracts documented and covered by tests.

Non-goals stay in `docs/07-non-goals.md`; the broader product context is in
`docs/01-product-brief.md`.
