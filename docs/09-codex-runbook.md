# Agent runbook

This file is context for coding agents. It is not a ready-to-send first prompt.

## Required reading

Before making changes, read:

- `AGENTS.md`
- `docs/00-product-thesis.md`
- `README.md`
- `docs/01-product-brief.md`
- `docs/03-cli-or-api-contract.md`
- `docs/13-test-and-eval-strategy.md`
- `docs/14-architecture.md`

## Working loop

1. Identify the smallest vertical slice that moves the project toward the ideal state.
2. Add or update tests/evals for the target behavior.
3. Implement within the architecture boundaries.
4. Run targeted checks.
5. Run `task check`.
6. Fix failures.
7. Update docs if the product contract changed.
8. Summarize implemented behavior, verification, remaining gaps, and any contract changes.

## Evaluation function

A change is acceptable when all of these are true:

- It preserves the local-first viewer product boundary.
- It improves or preserves user-visible behavior.
- It has tests/evals appropriate to the layer touched.
- It does not weaken root path safety.
- It does not introduce full-page reload requirements for normal live updates.
- It keeps TypeScript contracts explicit.
- It runs through `task check` or clearly documents why a subcommand could not run.

## Implementation priorities

1. Correct root path handling.
2. Working CLI/server endpoints.
3. Working SPA tree and viewer routing.
4. Live open-file refresh.
5. Dynamic tree updates.
6. HTML iframe safety.
7. Code highlighting and Markdown polish.
8. Performance improvements.

## Current polish pass notes

- Preserve the read-only boundary: do not add file editing, Git actions, remote browsing, auth, cloud sync, or LLM features.
- Code viewer behavior now includes line numbers, range selection, copyable references, selected-code copy, lightweight symbols, and current-scope hints.
- The Review Queue is a deduplicated file-level queue. Prefer HEAD changes when Git is available; use collapsed watcher events as a local fallback signal. Treat watcher-only rename as add/remove unless the watcher contract is intentionally extended.
- UI tests currently combine pure helper tests and render-to-static-markup tests; E2E tests cover server/API/SSE contracts.

## Reporting format for agents

At the end of a run, report:

- Implementation summary.
- Tests and evals added or updated.
- Commands run and outcomes.
- E2E coverage status.
- Architecture changes.
- Public contract changes.
- Deferred work.

## UI implementation reference

For UI work, read these files before changing React components:

- `docs/17-ui-product-decisions.md`
- `docs/18-ux-acceptance-criteria.md`
- `docs/ui-mocks/README.md`
- `docs/ui-mocks/06-classic-reader-commandk.html`

The mockup is product intent, not a requirement to copy static CSS verbatim. Preserve the component boundaries and testable state model while moving the implementation toward the mockup.
