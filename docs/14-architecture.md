# Architecture

Vivi is a local application distributed as one Go CLI. The repository is
organized around the three runtime responsibilities:

```text
ui/      React workspace UI and its browser-side architecture
server/  Go local HTTP/API server, filesystem, review, comments, and events
cli/     Go process entrypoint and server composition
```

The project remains one Go module. `cli` may start `server`; `server` does not
depend on `cli`. The server may serve the generated `ui/dist` asset package but
does not import browser source from `ui/src`.

The preserved TypeScript server and CLI harnesses live below
`server/typescript` and `cli/typescript`. They continue to support fast contract
and adapter tests while the Go binary remains the release target.

## Browser layers

```text
ui/src/app             startup and dependency wiring
ui/src/features        workbench, file context, comments, review, commands
ui/src/application     transport-independent use cases and ports
ui/src/domain          Vivi concepts such as FileContext and Comment
ui/src/infrastructure  REST DTOs, adapters, fetch, and EventSource
ui/src/shared          reusable browser presentation
```

Allowed dependency direction:

```text
app -> features / application / infrastructure / domain / shared
features -> application / domain / shared
application -> domain / shared
infrastructure -> application / domain / shared
domain -> shared
```

`ViviClient` is the browser API boundary. Features work with its domain-facing
methods, including `getFileContext`; only `RestViviClient` knows endpoint paths,
query parameters, REST DTOs, `fetch`, or `EventSource`. A future GraphQL client
must implement the same port and adapt generated types before returning them.

ESLint enforces the dangerous boundaries: features/application cannot import
infrastructure, application/domain cannot import React, domain cannot import
outer layers, UI components cannot consume DTOs, and features cannot call
`fetch` or construct `EventSource` directly. `npm run test:architecture` proves
the rules with intentionally invalid fixtures that are excluded from normal
lint.

## Server scope

The current refactor moves the existing Go packages into `server/` without
forcing a resolver/use-case/repository redesign. That internal design is left
for the later API evolution. Existing REST routes, path containment, preview
safety, comments, git review, search, diff, and SSE behavior remain the contract.

## Extension points

- Add browser concepts under `ui/src/domain`.
- Extend the browser API through `application/ports/ViviClient.ts`, then adapt
  the REST implementation in `infrastructure/vivi-api`.
- Add viewers under `features/file-context/viewers`.
- Add server behavior under `server/` and preserve the documented HTTP contract.
- Keep CLI parsing and process concerns in `cli/`.
