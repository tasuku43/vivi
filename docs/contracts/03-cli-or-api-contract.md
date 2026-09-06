# CLI and API contract

> Product-attention note: the standalone agent response command has been
> removed. The browser uses read receipts, drafts, and recent activity for
> attention; legacy agent-authored records remain readable only as stored-data
> compatibility.

## CLI contract

The canonical `vivi` command is the Go CLI/backend, whether invoked from a
release binary, Homebrew/mise install, `go run ./cli`, or the repository-local
`npm exec -- vivi <args>` shim. The preserved TypeScript server harness is
available only through explicit development commands such as
`npm run dev:server:typescript`; it is not an agent-facing CLI and does not
provide additional agent commands.

```bash
vivi [root]
vivi [root] --port 4317
vivi [root] --host 127.0.0.1
vivi [root] --open
vivi [root] --port 0 --ready-json
vivi [root] --include md,markdown,mdown,html,htm
vivi [root] --exclude package-lock.json --exclude '**/generated/**'
vivi [root] --exclude 'package-lock.json,snapshots/,**/generated/**'
vivi [root] --max-file-size 1048576
vivi [root] --allow-html-scripts
vivi servers
vivi open http://127.0.0.1:4317 docs/design.md
vivi open http://127.0.0.1:4317 docs/design.md --print
vivi inbox http://127.0.0.1:4317
vivi inbox http://127.0.0.1:4317 --read-as codex

```

### Open an existing workspace

`vivi open <url> [path] [--print]` verifies a document through the selected
server's GraphQL `file` query and opens its reader URL (`/?path=...`). The optional
path is relative to the **server root**, independent of the caller's current
directory. Omit it to validate `config` and open the workspace.

The URL must be the server base URL without credentials, query, fragment, or
path. File paths must be relative; missing, excluded, ignored, directory, and
outside-root symlink targets fail before browser launch. Paths are URL-encoded.
The command prints one browser URL on success. `--print` skips browser launch
for links and host-provided browsers; it still validates the target. A browser
launch failure returns nonzero and retains the URL for manual recovery.

This is a one-shot CLI adapter over existing GraphQL and reader deep links. It
does not start a server, broadcast navigation to connected tabs, or fetch/mark
comments read. System-browser tab reuse is controlled by the browser.

Default root: `.`

Default host: `127.0.0.1`

Default port: `4317`. When that default port is unavailable and the user did
not pass `--port`, the launcher increments mechanically to the next available
local port, such as `4318` or `4319`. Explicit `--port` values still fail if
that port cannot be bound.

Default document extensions: `.md`, `.markdown`, `.mdown`, `.html`, and `.htm`.
Tree, search, direct-read, watcher-event, and Git-change boundaries apply the
same allow-list. The tree preserves real directory nesting and omits directories
with no included document descendants. `--include` remains an explicit local
override; it is not a compatibility promise for the removed generic-viewer
product.

Default security posture: local-only, sandboxed HTML preview, local CSS enabled for practical artifact inspection, and HTML script execution disabled. Use `--allow-html-scripts` only when intentionally reviewing generated HTML that needs script execution.

Default rich preview limit: `1048576` bytes. Use `--max-file-size <bytes>` to change it for the current local run.

`--exclude <glob>` removes matching workspace-relative files and directories
from the file tree, direct file reads, file/text search, watcher events, and the
Git Review Queue. The flag is repeatable and each value may also be a
comma-separated list. Matching is case-sensitive, uses `/` separators, and
supports `*`, `?`, character classes, and `**` across path segments. A pattern
without `/` matches that basename at any depth; a trailing `/` excludes the
whole subtree. Exclusion is evaluated after `--include`, so exclusion wins.
Malformed patterns and patterns containing a `..` segment fail startup.

The server launcher also reads an optional global JSON config from the XDG
config directory at `vivi/config.json`. Its current public shape is:

```json
{
  "exclude": ["package-lock.json", "**/generated/**"]
}
```

The resolved default on macOS and Linux is
`$XDG_CONFIG_HOME/vivi/config.json`, or `~/.config/vivi/config.json` when
`XDG_CONFIG_HOME` is unset. An explicitly set `XDG_CONFIG_HOME` must be an
absolute path. On Windows, the default remains
`%AppData%\vivi\config.json`. `VIVI_CONFIG` overrides that path; because it is
explicit, pointing it to a missing file is an error. A missing default file is
valid and behaves like an empty config. Symlinks in the config path are
followed normally. Global `exclude` entries are evaluated together with all
CLI `--exclude` entries, so the CLI adds temporary exclusions but does not
undo global ones. Invalid JSON or invalid global exclude globs fail startup
and identify the config path.

Pass `--ready-json` when a launcher or coding agent needs a stable startup
handoff. After the local server is listening, Vivi emits one JSON object on
stdout with `event: "vivi_server_ready"`, the selected root, the resolved server
URL, and `suggestedCommands` that already include that resolved URL. Server
launch does not choose an agent identity. The primary startup suggestion is the
top-level `inbox <url>` command, which emits the currently published open
comments once and exits. Publish does not wait for an agent: the agent runs the
same one-shot command again when the human asks or when its workflow chooses to
refresh. This inbox command is the only startup suggestion. Launch, `servers`,
and one-shot top-level `inbox <url>` are the entire supported CLI surface.
The top-level `vivi --help` presents the product as local workspace review and
shows only launch, running-server discovery, synchronous inbox, and launch
options.

### Running-server discovery

`vivi servers` is the deterministic first step for an agent that was started
after one or more Vivi servers. The launcher registers its canonical workspace
root and resolved local URL in user-local runtime state. Discovery validates
each registration against the live server and removes malformed, unreachable,
or root-mismatched stale registrations before writing its result.

The result is a compact text projection:

```text
servers count=2 matches=1 external-text=untrusted escaped
* "/Users/tasuku/work" http://127.0.0.1:4317
  "/Users/tasuku/sandbox" http://127.0.0.1:4318
```

The header reports the number of validated servers and how many match the
current working directory. Each following record is
`<marker> <quoted-canonical-root> <url>`. `*` is the match marker: it means the
registered root contains the canonical current working directory. A blank
marker means the server is live but does not contain it. Roots are external,
untrusted text and use the same terminal-safe quoting boundary as compact
inbox output. With no validated registrations, output is exactly:

```text
servers count=0 matches=0
```

The command lists and marks candidates; it does not choose interactively. An
agent must apply these branches:

- `matches=1`: select that record's URL.
- `matches>1`: ask the user which matching server to use.
- `matches=0` and `count>0`: ask the user which live server, if any, to use.
- `count=0`: only then consider launching Vivi, and only when the intended
  workspace root is unambiguous.

Once selected, the exact URL must be reused for `inbox` and every requested
refresh. Discovery does not make the URL argument optional and does not
silently start a server.

### Top-level agent comment pipe

The first user-facing agent surface is intentionally small:

```bash
vivi servers
vivi inbox <url>
vivi inbox <url> --read-as codex
```

`inbox` requires the URL selected through discovery because multiple Vivi
servers may run at the same time. Plain `inbox <url>` is passive, returns the
current published open snapshot, and does not send actor headers or create read
receipts. It exits after that snapshot.
Use `--read-as codex` or `--read-as claude` only when the browser should show
that a named agent read the thread. Each explicit identified fetch records a
fresh observation; it does not reuse an idempotency key across later reads.

There is no top-level agent write-back command. The agent reports its result in
the terminal or workbench where the human is already directing it. Only
`--read-as` creates a browser-visible read receipt.

The default inbox result is a compact typed projection rather than JSON:

```text
inbox count=2 complete=true external-text=untrusted escaped
38f10500b96f4ddab26a64f5c233c1ac "README.md" rendered-markdown:L3-4 quote="この導入文"
  human "新規ユーザー向けに寄せてください。"
  codex "導入を短くしました。"
  human "もう少し具体例を足してください。"
9ac3f14828de4e44b410367482796be4 "src/app.ts" diff-new:L42-44 base="HEAD"
  human "nil の場合も扱ってください。"
```

Each unindented record is `<thread-id> <quoted-path> <anchor>` with optional
`base=`, `selector=`, and `quote=` facts. Indented records are the complete
conversation in order as `<actor> <quoted-body>`. Open status, timestamps, and
comment IDs are omitted because they are redundant for this task. Source,
rendered kind, source line/column range, diff side/range, and diff base are
preserved when available. External path, base, selector, quote, and body values
must be valid UTF-8 and are terminal-safe quoted under the explicit untrusted
text boundary. Invalid opaque thread references or invalid UTF-8 fail before
any snapshot bytes are written. An empty snapshot is exactly:

```text
inbox count=0
```

Pass `--json` to retain the previous newline-delimited JSON compatibility
projection. It emits one `{type,id,file,body,action,readBy?}` item per thread,
selects only the latest human body, and emits zero bytes for an empty snapshot.

Top-level `--watch` and `--initial` are rejected. Each refresh is an explicit,
one-shot invocation; Vivi does not schedule or supervise agent work.

### Removed task-management interfaces

Ownership, resident loops, and task lifecycle commands are removed, including
claim/renew/hold/release/mine, work/watch/follow, triage/done/dismiss,
and resolve/archive/reopen. The `comments` and `review` command families are
removed entirely, including their protocol, schema, doctor, receipt-verification,
and Git queue/diff adapters. Calling either family fails with a migration hint
to `vivi servers` and `vivi inbox <url>`; they are not hidden compatibility commands.
Use the coding workbench's normal filesystem and Git tools to investigate and
apply feedback. Browser Git Changes remains available.

Existing stored comments, conversations, actors, read receipts, and historical
lifecycle events remain readable. Storage is not rewritten or reset during this
simplification. Historical resolved/archived states remain queryable for export
and compatibility; new task-status and ownership mutations are not offered.
Reading feedback neither completes it nor removes it from future inbox reads.
Publishing another human comment creates new activity that requires a new read.

## GraphQL data API

`POST /graphql` is Vivi's canonical, schema-first API and the only normal SPA
data path. Requests use JSON GraphQL
envelopes with `query`, `operationName`, and optional `variables`; responses use
GraphQL-style `{ "data": ... }` or `{ "errors": [...] }` bodies.

The schema lives at `server/graphql/schema.graphqls`, with Go server code
generated by `gqlgen`. Run `task generate` after schema or UI operation changes;
it regenerates both Go bindings and TypeScript operation types. UI operations
live in `ui/src/infrastructure/vivi-api/graphql/operations` and generated types
remain private to the adjacent `generated` directory. The schema models Vivi concepts
directly: workspace config, tree snapshots, file payloads, file context, Git
review queue, diffs, file/text search, comments, and first-class
`CommentThread` objects. `FileContext` includes both the compatibility
`comments` list and `commentThreads`, so callers can move from flat comments to
the file -> thread -> comment graph without changing the file loading flow.
Comment storage remains compatible with existing comment records; GraphQL groups
comments into threads with an explicit `threadId` when present and otherwise
treats each existing comment as its own thread. New comments receive a
`threadId` matching their first comment id unless a caller supplies an existing
thread id. New comments are always open; creation inputs cannot set historical
statuses. `updateComment` edits a body; its input has no status field.
Thread ownership and lifecycle mutations are absent from the schema.
`comments(path, status, reviewBatchId)` and
`commentThreads(path, status, reviewBatchId)` support filtering by the
published review batch id. Historical status filters remain read-only.

Draft review comments are a separate pre-publish resource, not a
`CommentStatus`. `draftReviewComments(path)` lists unpublished draft comments
for the UI. `createDraftReviewComment`, `updateDraftReviewComment`, and
`deleteDraftReviewComment` manage that draft set. `publishDraftReviewComments`
converts all drafts, or the supplied `draftIds`, into `open` `CommentThread`
objects in one review batch and returns `{ reviewBatchId, publishedAt,
threads }`. Drafts with no `threadId` are grouped by path and anchor during
publish, so multiple drafts on the same anchor become comments in one new review
thread. A draft with an explicit `threadId` is published as a reply to that open
thread. Before publish, drafts are
intentionally absent from `comments`, `commentThreads(status: open)`, and the
agent inbox.

`commentExport` exposes the comment export data path through GraphQL. The
current supported format is `jsonl`, returned as `CommentExport.content` with
`contentType: "application/x-ndjson; charset=utf-8"`. Former REST comment
export routes are no longer served by the Go runtime.

Comment activity is read-only in the GraphQL schema. `commentThreadActivities`
returns bounded history and `commentThreadActivity` streams new events. Thread
read events are appended as an observed side effect of `comments`,
`commentThreads`, or `fileContext(includeComments: true)` when the request
includes `X-Vivi-Actor-Id`. `X-Vivi-Actor-Kind`, `X-Vivi-Actor-Name`, and
`X-Vivi-Client-Event-Id` are optional attribution and idempotency headers.

Preview routes remain HTTP rendering transports. GraphQL exposes preview
resource metadata and URLs, while `/preview/html` and `/preview/raw/*` continue
to serve sandboxed iframe/raw bytes with the existing security headers and
script opt-in behavior. Raw preview may also serve image dependencies omitted by
the document extension include filter. This does not add those images to the
tree or ordinary file reads. Root confinement, outside-root symlink rejection,
explicit exclusions, ignored directories, and file size limits still apply.
Standalone SVG resources use a sandbox CSP with scripts disabled.

The former REST data routes below remain in this document as migration history
for older clients and architectural audits.

## Removed legacy REST data API

The former `/api/*` and `/api/v1/*` data endpoints are not served by the Go
runtime. They are documented below only as migration history for older clients;
new code and tests must use the GraphQL operations above. Preview, static asset,
and event-stream transports remain HTTP because they carry resources rather
than workspace data.

### `GET /api/tree`

Returns the current filesystem tree under the selected root.

By default this returns the full tree for compatibility. The SPA may request a
bounded lazy tree with `depth=1`, and may request one directory's children with
`path=<relative-directory>&depth=1`. Lazy directory nodes include
`childrenLoaded: false` until their children have been requested.

The canonical Go server includes optional `documentHeading` metadata for
Markdown and HTML file nodes: the first H1 as plain text, an empty string when
a complete document has no H1, and omitted (GraphQL `null`) when unavailable.
HTML `<title>` is not used as a substitute. Reads are limited to the first
64 KiB (or the configured file-size limit if smaller); absence beyond that
limit is unknown, not “no H1”. Only nodes in the returned projection are read.
Metadata is cached by path, size and modification time, with at most 1,024
entries, and invalidated before watcher events are delivered. File identity,
filename sorting and directory nesting are unchanged. Older producers may omit
this additive metadata.

```json
{
  "root": ".",
  "version": 1,
  "path": "",
  "depth": 1,
  "nodes": [
    {
      "id": "README.md",
      "path": "README.md",
      "name": "README.md",
      "kind": "file",
      "viewerKind": "markdown",
      "parentPath": ""
    }
  ],
  "stats": {
    "durationMs": 3,
    "scannedDirectories": 1,
    "scannedFiles": 4,
    "returnedNodes": 6
  }
}
```

### `GET /api/files?q=<query>&limit=<count>`

Returns bounded file-path matches from backend filesystem traversal. This is
used by Quick open so the browser does not need to hold the full tree for large
workspaces. The Go backend may build an in-memory filename index on the first
query and reuse it for later queries in the same process; watcher-observed
workspace add/change/unlink events invalidate the index before later searches.
`stats.cached` is `true` only when a response reused that index without another
recursive filesystem walk.

```json
{
  "query": "guide",
  "results": [
    {
      "path": "docs/guide.md",
      "name": "guide.md",
      "viewerKind": "markdown",
      "size": 1200,
      "mtimeMs": 1710000000000,
      "score": 97
    }
  ],
  "stats": {
    "durationMs": 8,
    "scannedDirectories": 12,
    "scannedFiles": 240,
    "readFiles": 0,
    "skippedFiles": 0,
    "cached": false
  }
}
```

### `GET /api/file?path=<relative-path>`

Returns file content and metadata for a relative path under the root.

```json
{
  "path": "README.md",
  "viewerKind": "markdown",
  "encoding": "utf8",
  "content": "# Example",
  "etag": "sha256:...",
  "size": 10,
  "mtimeMs": 1710000000000,
  "mimeType": "text/markdown; charset=utf-8",
  "truncated": false,
  "maxSizeBytes": 1048576
}
```

Image payloads use `encoding: "base64"` and include a MIME type suitable for browser display. Unknown files are sniffed from a bounded leading byte sample: safe UTF-8 text falls back to `viewerKind: "text"`, while NUL bytes, invalid UTF-8, or a high control-character ratio fall back to `viewerKind: "binary"` with `encoding: "none"` and empty `content`. Files larger than the configured preview limit use `truncated: true`. Text-like large files may include a bounded leading UTF-8 `content` chunk with `previewBytes`; HTML, image, binary, and other non-text large files use `encoding: "none"` and empty `content`.

### `GET /api/search?q=<query>&limit=<count>`

Returns bounded, read-only full-text matches across text-previewable files under the selected root. Search is best-effort and skips binary, unsupported, ignored, excluded, and truncated files. Results are line-oriented and intended for opening the matching file in the SPA.

```json
{
  "query": "local",
  "results": [
    {
      "path": "README.md",
      "viewerKind": "markdown",
      "lineNumber": 3,
      "lineText": "Open a local workspace",
      "matchStart": 7,
      "matchLength": 5
    }
  ],
  "stats": {
    "durationMs": 24,
    "scannedDirectories": 18,
    "scannedFiles": 320,
    "readFiles": 46,
    "skippedFiles": 7
  }
}
```

### `GET /api/config`

Returns viewer configuration needed by the SPA.

```json
{
  "root": "/absolute/served/root",
  "allowHtmlScripts": false,
  "maxFileSizeBytes": 1048576
}
```

### `GET /api/v1/meta`

Returns versioned API metadata for comment clients.

```json
{
  "version": "v1",
  "comments": {
    "statuses": ["open", "resolved", "archived"],
    "surfaces": ["source", "rendered", "diff"],
    "exportFormats": ["jsonl"]
  }
}
```

### `GET /api/v1/comments?path=<relative-path>&status=open`

Returns persisted comments. `path` and `status` filters are optional. Status is
one of `open`, `resolved`, or `archived`.

Each comment has one shared identity and body across source, rendered, and diff
views. The canonical source anchor is the primary location. Rendered and diff
anchors are auxiliary view anchors that map back to that source anchor when
available.
Code and Markdown source views share one source-comment interaction: gutter
clicks, gutter drags, and partial text selections resolve to a canonical line or
line range and open an inline thread. A comment created on either source or
rendered Markdown is projected into the other view through that canonical
range; the persisted comment format and identity do not change.
Rendered Markdown and HTML comments target a readable rendered block rather than
an arbitrary text range. `rendered.blockId` is Vivi's per-render block identity
for paragraphs, headings, list items, code blocks, table rows, and similar
reader-visible units; `selector` and `textQuote` remain as fallback anchors.
In rendered mode, the same block owns the double-click-to-add interaction,
drafting highlight, persisted highlight, and active-comment highlight. Single
click and pointer-drag remain native reading and text-selection interactions and
must not open a composer. A saved Markdown
block also shows a compact comment marker whose badge reports the number of
messages mapped to that block; both the marker and highlighted block open the
same replyable inline thread. Because the thread
remains in document flow, it stays at the commented location while the reader
scrolls. Sandboxed HTML previews keep the
same block anchor and highlight model, while the HTML iframe receives only
anchor summaries and never comment bodies. Markdown source ranges come from
lexer tokens. HTML source ranges are computed by the parent/server from the
original file and injected as reserved `data-vivi-*` attributes; page-authored
values for those attributes are not trusted. The existing iframe sandbox and
script opt-in policy remain in force.

New clients use explicit thread ids for conversations. Anchor grouping is a
legacy UI fallback only. See `docs/contracts/22-comment-thread-lifecycle.md`.

### `POST /api/v1/comments`

Creates a comment. The request must be JSON and is intended for local-server use.
The server validates Host/Origin headers where practical. Diff comments are only
accepted for `side: "current"` and `changeKind: "context"` or `"added"`.

```json
{
  "path": "README.md",
  "viewerKind": "markdown",
  "body": "Clarify this paragraph.",
  "anchor": {
    "surface": "rendered",
    "canonical": {
      "path": "README.md",
      "lineStart": 12,
      "lineEnd": 12,
      "quote": "Rendered selected text",
      "fileHash": "sha256:..."
    },
    "rendered": {
      "kind": "markdown",
      "blockId": "vivi-block-4",
      "selector": "p:nth-of-type(3)",
      "textQuote": "Rendered selected text",
      "sourceLineStart": 12,
      "sourceLineEnd": 12
    }
  }
}
```

### `PATCH /api/v1/comments/:id`

Updates a comment body or status.

```json
{
  "status": "resolved"
}
```

### `GET /api/v1/comments/export?status=open&format=jsonl`

Exports thread-aware JSONL for coding agents. `format=jsonl` is required. Each
line is a schema v2 `commentThread` record containing thread status, anchor,
lifecycle timestamps, and ordered messages. Filters apply to threads.

### `GET /api/changes`

Returns read-only Git working-tree review status when the selected root is inside a Git repository. This is a viewer aid, not a staging or history API. If Git is unavailable or the root is not a worktree, the endpoint returns `available: false` with a reason.

```json
{
  "available": true,
  "changes": [
    { "path": "README.md", "status": "modified", "kind": "file" },
    { "path": "reports/new.csv", "status": "added", "kind": "file" },
    {
      "path": "vendor/charts",
      "status": "added",
      "kind": "embedded-repo"
    },
    {
      "path": "docs/new-name.md",
      "status": "renamed",
      "kind": "file",
      "originalPath": "docs/old-name.md"
    }
  ]
}
```

Statuses are `added`, `modified`, `deleted`, or `renamed`.
Kinds are `file`, `directory`, or `embedded-repo`. Git-backed review changes
normally report file entries; untracked embedded Git repositories are surfaced as
single `embedded-repo` entries and are not expanded.

Untracked directories are expanded to file-level `added` entries. Directory
paths are not review queue items unless the adapter cannot enumerate them; in
that case they are marked as `kind: "directory"` and treated as not diffable.

### `GET /api/diff-bases`

Returns recent read-only Git commit bases that the UI may use for diff comparison. The server only accepts bases from this allow-list.

```json
{
  "available": true,
  "options": [
    { "ref": "HEAD", "label": "HEAD", "subject": "current commit" },
    { "ref": "abc123...", "label": "HEAD~1", "subject": "previous commit" }
  ]
}
```

### `GET /api/diff?path=<relative-path>&base=<ref>`

Returns a bounded read-only text diff for a changed file. The comparison is the selected allowed base ref to the current working tree. If `base` is omitted, `HEAD` is used. Large and binary diffs are not returned; the response explains why.

```json
{
  "path": "README.md",
  "status": "available",
  "baseLabel": "HEAD",
  "compareLabel": "working tree",
  "content": "diff --git a/README.md b/README.md\n..."
}
```

Diff statuses are `available`, `too-large`, `binary`, or `unavailable`.
An `unavailable` response may include `kind: "directory"` or
`kind: "embedded-repo"` when the path is a valid review entry but cannot produce
a blob diff. These cases are returned as `200` with a reason rather than as
handler failures.

If a route throws a filesystem error before producing its normal response, the
server returns a diagnostic JSON body with `error`, `reason`, and `status`
fields. Known filesystem errors are mapped to request-level statuses such as
`400`, `403`, or `404`; unexpected errors remain `500` and are logged by the
server.

### `GET /preview/html?path=<relative-path>`

Returns HTML for iframe preview. The server must validate the path and send conservative headers.

### `GET /events`

SSE stream of filesystem events.

```json
{"type":"change","path":"README.md","version":2}
{"type":"add","path":"docs/new.md","kind":"file","version":3}
{"type":"unlink","path":"old.html","kind":"file","version":4}
```

## Contract stability rules

- Changes to API response shapes require tests and documentation updates.
- Additive fields are acceptable when documented.
- Removing fields or changing meanings requires an explicit contract-change note.
