# Agent instructions

This repository is a scaffold for `vivi`, a CLI that launches a local browser SPA for live viewing a directory tree and previewing Markdown, HTML, code, text, images, and structured files.

## Operating mode

Move the repository toward the ideal state described in `GOALS.md` and `docs/01-product-brief.md`. Implement in small vertical slices. Each behavior change must be paired with at least one of:

- a domain unit test,
- an app/use-case test,
- an infra adapter test,
- an E2E test,
- a fixture-driven eval case, or
- a stable golden snapshot.

Tests are the control system, not a final cleanup step.

## Architecture boundary

Preserve the layered architecture:

```text
cli              -> process args, stdout/stderr, exit codes
server           -> local HTTP/SSE, filesystem, comments, review, browser delivery
ui/src/app       -> browser startup and dependency wiring
ui/src/features  -> browser feature packages
ui/src/application -> browser use cases and ports
ui/src/domain    -> pure browser/domain concepts
ui/src/infrastructure -> REST DTOs, adapters, fetch, and EventSource
```

Dependency direction:

```text
cli/server/ui -> app -> domain
app -> ports/interfaces
infra -> app ports + domain types
```

Forbidden moves:

- Do not put filesystem reads inside `ui/src/domain`.
- Do not parse CLI flags inside `ui/src/application` or `ui/src/domain`.
- Do not put HTTP route logic inside React components.
- Do not let UI components depend on Node-only APIs.
- Do not make each tree node open its own watcher.
- Do not replace the entire application architecture with a single large server file.

## Product defaults

- Bind to `127.0.0.1` by default.
- Refuse to serve paths outside the selected root.
- Ignore `.git`, `node_modules`, and common build caches by default.
- Render HTML in a sandboxed iframe by default.
- Make script execution in HTML preview opt-in.
- Use watcher events as the primary change signal.
- Use hashes or versions for validation, cache keys, and stale-update prevention.
- For MVP, reload open file contents on change; text patching is a later optimization.
- Update tree state by semantic events when feasible; full tree refetch is acceptable for early implementation.

## Quality bar

Before finishing a coding pass, run:

```bash
task check
```

If dependencies are unavailable, run the parts that can run, especially:

```bash
node scripts/validate-scaffold.mjs
```

Report exactly what ran, what failed, and what remains.

## Non-goals

Do not implement remote multi-user browsing, cloud sync, editing, git staging, LLM summarization, authentication, collaboration, or a hosted service unless the product docs are intentionally changed with tests/evals.

## Change checklist

For every meaningful change:

1. Update or add tests/evals first or alongside implementation.
2. Preserve public contracts documented in `docs/03-cli-or-api-contract.md`.
3. Keep docs current when behavior changes.
4. Run `task check`.
5. Summarize changed behavior, verification, and deferred work.

## Current UI direction

Use `docs/17-ui-product-decisions.md`, `docs/18-ux-acceptance-criteria.md`, and `docs/ui-mocks/06-classic-reader-commandk.html` as the product reference for the first polished UI pass.

The target UI is not a command-first layout. It is a classic local workspace:

```text
left sidebar     : live file tree
main center      : open-file tabs and active viewer
right inspector  : Markdown H1/H2 outline, metadata, and recent file events
command overlay  : Cmd/Ctrl + K modal palette
```

Implementation priorities for UI work:

- Preserve the sidebar tree as the stable spatial map.
- Add real open-file tabs before adding advanced viewer features.
- Add a Markdown H1/H2 outline in the right inspector.
- Treat Cmd/Ctrl + K as a modal overlay, not a permanent layout.
- Keep UI state decomposed: tree state, open tabs, active viewer, inspector state, and command palette state should be separate enough to test.
