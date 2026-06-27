# Architecture

Vivi is a local application distributed as one Go CLI. The repository is
organized around the three runtime responsibilities:

```text
ui/      React workspace UI and its browser-side architecture
server/  Go local HTTP/API server, filesystem, review, comments, and events
cli/     Go process entrypoint and server composition
```

For the runtime flow between the CLI, Go server, workspace watcher, event
delivery, and browser state, see `docs/25-runtime-architecture.md`.

The project remains one Go module. `cli` may start `server`; `server` does not
depend on `cli`. The server may serve the generated `ui/dist` asset package but
does not import browser source from `ui/src`.

The preserved TypeScript server and CLI harness live below `server/typescript`
and `cli/typescript`. They support explicit development-only contract and
adapter tests. They are not the product CLI: release binaries, `go run ./cli`,
and the repository-local npm bin all route `vivi` to the Go CLI so agents see
one `review` and `comments` command surface.

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
methods, including `getFileContext`, `getCommentThreads`, and `exportComments`;
only infrastructure clients know endpoint paths, transport DTOs, `fetch`, or
`EventSource`. `GraphqlViviClient` is the normal browser data path and adapts
GraphQL response shapes before returning domain types. `RestViviClient` is a
compatibility-only adapter and is not wired into browser startup. The Go runtime
returns 404 for legacy `/api/*` data routes. Generated operation types stay
inside infrastructure and are converted by GraphQL adapters before reaching
application or domain code.

ESLint enforces the dangerous boundaries: features/application cannot import
infrastructure, application/domain cannot import React, domain cannot import
outer layers, UI components cannot consume DTOs, and features cannot call
`fetch` or construct `EventSource` directly. `npm run test:architecture` proves
the rules with intentionally invalid fixtures that are excluded from normal
lint.

Generated GraphQL types are additionally denied from `features`, components,
`application`, and `domain`. `scripts/verify-ui-architecture.mjs` runs
intentional `.violation.ts` fixtures and fails unless ESLint rejects every one.

Go boundaries are enforced twice. `server/architecture_boundary_test.go`
recursively checks package imports during `go test`, while
`scripts/verify-server-architecture.mjs` recursively scans the repository and
proves the checker with intentional `.go.fixture` violations. The forbidden
edges are `server/graphql -> server/http`, `server/http -> server/graphql`,
`server/application -> any transport package`, and root `server -> cli`.
Both checks are part of `task check` through `test:architecture` and `test:go`.

## Server scope

The Go server keeps a lightweight application service in `server/application`.
HTTP transports call that service rather than reaching directly into workspace,
Git review, or comment stores. Comment thread grouping and export live behind
that service boundary, so GraphQL resolvers and REST compatibility routes share
the same behavior. `server/graphql/schema.graphqls` is implemented with
generated `gqlgen` transport code, and REST data routes remain thin
compatibility wrappers. Existing REST routes, path containment, preview safety,
comments, git review, search, diff, and SSE behavior remain the contract during
the migration.

## Extension points

- Add browser concepts under `ui/src/domain`.
- Extend the browser API through `application/ports/ViviClient.ts`, then adapt
  the GraphQL implementation in `infrastructure/vivi-api`.
- Add viewers under `features/file-context/viewers`.
- Add server behavior under `server/application` first, then expose it through
  GraphQL resolvers or compatibility HTTP routes.
- Keep CLI parsing and process concerns in `cli/`.
