# Runtime architecture

This document describes how Vivi runs after the Go CLI has started a local
workspace server and delivered the browser SPA. It complements
`docs/14-architecture.md`, which defines package boundaries and dependency
rules.

## Runtime shape

```text
user shell
  |
  v
cli/main.go
  - parse process flags
  - choose root, host, port, review options
  - compose workspace, git review, comments, and server options
  |
  v
server.Start
  - bind local HTTP listener
  - build application.Service
  - serve UI assets, REST compatibility routes, GraphQL, and SSE
  - start workspace watcher runtime
  |
  v
browser SPA
  - GraphQL client for data
  - SSE subscriptions for workspace and comment activity events
  - decomposed UI state for tree, tabs, viewer, inspector, review, commands
```

The default host remains `127.0.0.1`. The server is a local process for a
selected root; Vivi does not expose a hosted, authenticated, or multi-user
runtime.

## Layer ownership

```text
cli
  owns process arguments, stdout/stderr, exit codes, and server composition

server
  owns HTTP/SSE transports, filesystem adapters, watcher runtime, comments,
  git review, preview safety, and UI asset delivery

server/application
  owns transport-independent service methods and event publication

server/workspace
  owns root containment, path normalization, ignore/include policy, file
  metadata, tree reads, content reads, search scans, and watcher metadata

ui/src/infrastructure
  owns browser transports, GraphQL DTOs, fetch, and EventSource

ui/src/application and ui/src/domain
  own browser use cases and pure concepts

ui/src/features
  owns product-facing browser views and interactions
```

The important dependency direction is inward toward policy and domain concepts:

```text
cli -> server -> server/application -> server/workspace
ui/src/app -> features/application/infrastructure/domain
ui/src/infrastructure -> ui/src/application + ui/src/domain
```

The browser never reads the filesystem directly. React components never own HTTP
route logic or Node-only APIs. Filesystem and watcher behavior stays in the Go
server runtime.

## Workspace safety policy

`server/workspace.FS` is the canonical filesystem boundary. All server features
that need files go through this type or through services backed by it.

Responsibilities:

- convert incoming paths to normalized slash-separated relative paths,
- reject paths that escape the selected root,
- evaluate symlinks before exposing files or directories,
- apply default ignores such as `.git`, `node_modules`, and build caches,
- apply explicit include policy for previewable files,
- attach size, mtime, hash, version, and viewer metadata.

The watcher runtime also uses `workspace.FS` for single-path metadata. That
keeps platform event handling from becoming a second path-policy
implementation.

## Watcher runtime

The watcher is a server-side infrastructure adapter. It turns platform
filesystem notifications into `application.WorkspaceEvent` values, while using
workspace reconciliation scans only where events are insufficient.

```text
server.watchWorkspace
  |
  | startup
  v
add root directory watch
full startup reconciliation scan
add watches for known directories
drain startup event queue
signal SSE readiness
  |
  | steady state
  v
platform fs event
  -> normalize absolute path through workspace.FS
  -> stat one path through workspace.FS.WatchEntry
  -> publish add/change/unlink
  -> invalidate warm filename-search index when something changed
```

Directory creation has one extra step:

```text
directory add event
  -> add a watch for the new directory
  -> focused subtree reconciliation
  -> add watches for descendants
  -> publish missed add events from that subtree
```

Watcher error handling is explicit:

```text
watcher error
  -> schedule full reconciliation after a short backoff
  -> fill missed semantic events by diffing previous and current state
  -> ensure directory watches exist for current directories
```

If the platform watcher cannot be created or cannot watch the root, Vivi falls
back to the older polling loop. That fallback is degraded mode; the default
runtime path is platform events plus reconciliation.

## Event delivery

Workspace events have one application-level shape:

```go
type WorkspaceEvent struct {
    Type    string
    Path    string
    Kind    string
    Version int
}
```

The server publishes through `application.Service.PublishWorkspaceEvent`.
Transports subscribe to the application event service:

```text
watcher runtime
  -> application.EventService
     -> /events REST SSE
     -> GraphQL workspaceEvents SSE
        -> browser infrastructure client
           -> UI state reducers
```

The REST SSE and GraphQL SSE paths expose the same semantic event stream. The
initial `connected` comment is sent only after the watcher has completed startup
reconciliation and directory watch registration, so a client that writes a file
after seeing `connected` should not race against watcher initialization.

Subscribers use a bounded application buffer. The buffer is large enough for
short coding-agent style write storms, but still finite so disconnected or slow
clients cannot make the server retain an unbounded event backlog. The watcher
remains the source of truth for future events; clients that need recovery should
refetch current tree/file state rather than relying on an infinite event log.

## Search and invalidation

Filename search keeps a warm in-process index in `workspace.FS`. The watcher
invalidates that index after observed add/change/unlink events. This keeps warm
filename search cheap without rebuilding on every idle tick.

Content search is still scan-based. It is intentionally separate from watcher
state so the watcher does not become a hidden content indexer. Future content
search improvements should introduce an explicit search index or streaming
search path rather than adding content reads to the watcher.

## Telemetry boundary

Normal builds do not initialize OpenTelemetry resource sampling:

```bash
npm run build:go
```

The perf binary is opt-in:

```bash
npm run build:go:otel
```

The same operation names appear in perf results:

- `server.watch_loop`: startup, subtree, or recovery reconciliation,
- `server.watch_event`: platform event handling,
- `workspace.watch_entries`: reconciliation scan,
- `workspace.file_search`,
- `workspace.content_search`,
- `git.review_status_refresh`.

Normal hot paths call `telemetry.StartOperation`, which is a no-op unless the
otel build tag has initialized export.

## Performance-sensitive contracts

- Startup reconciliation may scan the workspace once to establish truth.
- Steady idle watching must not perform recurring full recursive scans.
- Ordinary file edits should use platform event handling and single-path stat.
- New directories may use focused subtree reconciliation.
- Rapid write storms should stay in the event hot path after the initial new
  directory reconciliation; they must not schedule recurring full recursive
  scans per file.
- Recovery from watcher errors may use a full reconciliation scan.
- Watcher state updates must be in-place for single-file events; cloning a
  linux-scale watch map per event is too allocation-heavy.
- Browser event contracts remain semantic. The UI should not care whether an
  event came from platform notification, focused reconciliation, or recovery
  reconciliation.

## Design pressure points

Current known pressure points:

- Startup reconciliation is still a full tree walk and can take 1.4-1.9s on a
  linux-scale repository.
- Content search reads thousands of files per query and is the largest remaining
  CPU/allocation path.
- The perf harness must measure startup, steady idle, and burst latency as
  separate concerns so improvements are visible. It also includes a
  coding-agent write storm scenario so rapid generated edits are not hidden by
  slower human-edit bursts.
- Large directory-watch sets increase RSS, but the measured linux-scale runtime
  remains below the current 150 MB server target.
