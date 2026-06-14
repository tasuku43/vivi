# Architecture

## Layer diagram

```text
             browser
               |
             src/ui
               |
HTTP/SSE boundary in src/server
               |
             src/app
               |
           src/domain
               ^
               |
            src/infra
```

CLI entry:

```text
src/cli -> src/server -> src/app -> src/domain
                         ^
                         |
                      src/infra
```

## Package responsibilities

### `src/cli`

- Parse command-line arguments.
- Validate process-level options.
- Print URL and status.
- Set exit codes.

### `src/server`

- Expose HTTP routes.
- Serve the SPA.
- Implement SSE event stream.
- Translate app results into HTTP responses.

### `src/app`

- Own use cases.
- Define ports for filesystem and watcher adapters.
- Own response DTOs consumed by server/UI.
- Apply high-level product policy.

### `src/domain`

- Pure types and deterministic logic.
- Path policy functions.
- Viewer classification.
- Tree diff/event models.

### `src/infra`

- Node filesystem reads.
- Watcher implementation.
- Hashing and metadata collection.
- Browser opening integration.

### `src/ui`

- React SPA.
- Sidebar tree state.
- File viewer routing.
- EventSource client.
- Markdown/HTML/code/text/image renderers.

## Dependency direction

- `domain` has no dependency on `app`, `infra`, `server`, `cli`, or `ui`.
- `app` depends on `domain` and defines ports.
- `infra` implements app ports.
- `server` composes app and infra.
- `cli` composes server startup.
- `ui` consumes HTTP/SSE contracts and shared DTO types only when bundler-safe.

## Extension points

- Add new viewer kinds in `src/domain/viewer-kind.ts` and `src/ui/viewers/`.
- Add new event transport in `src/server/`.
- Add advanced watcher logic in `src/infra/`.
- Add normalized tree-state helpers in `src/ui/state/`.

## Anti-patterns

- Domain code reading from disk.
- UI components importing Node modules.
- Per-node filesystem watchers.
- Whole-tree re-render as the only long-term update strategy.
- Path strings accepted without root validation.
- HTML preview with unsafe defaults.

## Why this architecture

The product crosses filesystem, server, and browser boundaries. Keeping a pure domain and explicit app ports makes it easier for coding agents to add behavior without scattering filesystem, HTTP, and React concerns through the codebase.

## UI state architecture

The preferred UI direction introduces these browser-side state domains:

- tree state: nodes, expansion, selected path, live update markers,
- tab state: open files, active tab, changed/stale indicators,
- viewer state: file payload, rendered/source mode, scroll position,
- inspector state: Review Queue, heading outline, collapsed file details,
- command palette state: open/closed, query, focused result, action mode.

Do not collapse these into one monolithic React component. Add `src/ui/state/` helpers or focused hooks when implementation grows beyond the scaffold. UI helpers may transform HTTP/SSE DTOs into view models, but they must not read files directly or import Node-only modules.
