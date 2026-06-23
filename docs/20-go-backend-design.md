# Go Backend Design

Vivi's distribution target is a single `vivi` binary. The React/Vite frontend
stays in use and is embedded into the Go server after `vite build`.

## Module Layout

Target module path after repository rename:

```text
github.com/tasuku43/vivi
```

Initial Go layout:

```text
cli/main.go
server/server.go
server/workspace
server/gitreview
server/comments
ui/static_assets.go
```

## CLI Flags

```text
vivi [workspace]
vivi [workspace] --host 127.0.0.1
vivi [workspace] --port 4317
vivi [workspace] --open
vivi [workspace] --include md,html,ts
vivi [workspace] --max-file-size 1048576
vivi [workspace] --allow-html-scripts
vivi [workspace] --git-review-timeout 2s
vivi [workspace] --log-level info
vivi --version
vivi --help
```

Defaults:

- workspace: `.`
- host: `127.0.0.1`
- port: `4317`
- HTML scripts: disabled
- Git review timeout: bounded and cancelable
- telemetry: none

Use `--host 0.0.0.0` only when intentionally exposing the local server, such as
inside a development container.

## API Routes

The Go server keeps the existing web API:

- `GET /api/tree`
- `GET /api/files`
- `GET /api/file`
- `GET /api/search`
- `GET /api/config`
- `GET /api/changes`
- `GET /api/diff-bases`
- `GET /api/diff`
- `GET /api/v1/meta`
- `GET /api/v1/comments`
- `POST /api/v1/comments`
- `PATCH /api/v1/comments/:id`
- `GET /api/v1/comments/export`
- `GET /preview/html`
- `GET /preview/raw/*`
- `GET /events`
- SPA fallback from embedded static files

Error responses use:

```json
{
  "error": "filesystem error",
  "reason": "The requested path does not exist.",
  "status": "ENOENT"
}
```

## Static Frontend

Release builds run the Vite build first. The small Go package at
`ui/static_assets.go` embeds `ui/dist` with `embed.FS`; `server` depends only on
that generated asset package, not on `ui/src`.
The server serves those assets directly and falls back to `index.html` for SPA
routes. The archive contains only the `vivi` binary because the assets are
inside the binary.

## Filesystem Policy

- Normalize all API paths as relative slash-separated paths.
- Reject absolute paths, null bytes, and root escapes.
- Resolve symlinks before reading. Symlinks that point outside the workspace are
  rejected.
- Internal file symlinks are readable.
- Directory symlinks are not recursively walked in the initial implementation.
- Hidden files are visible unless they match the ignored-name policy.
- Default ignored names include `.git`, `node_modules`, `.turbo`, `.next`,
  `.cache`, `dist`, and `coverage`.
- Binary files are returned as base64 only for image viewer kinds.
- Large text-like files return a bounded leading partial preview.
- Large HTML, image, binary, and unsupported files return `encoding: "none"` and
  an explicit truncated payload.

## Git Review

Git review must never block initial tree display. The browser can request
`/api/changes` after tree load, and the server handles that request with a
bounded context.

Implementation notes:

- Use `context.Context` for every Git subprocess.
- Kill Git subprocesses on timeout or server shutdown.
- Prefer lightweight commands for tracked changes, for example
  `git diff --name-status -z --no-renames HEAD -- .`.
- Use a bounded untracked scan separately.
- Return `available: false` when Git is unavailable.
- Return a warning/reason for partial results instead of showing a false empty
  state.
- Do not poll rapidly after timeout; use cooldowns.

## Local State

File contents are not stored in browser `localStorage`. Browser storage is only
for UI state such as theme, open tabs, recent files, layout, and diff focus.
Comment metadata is stored outside the viewed workspace by default and scoped by
canonical workspace root before it is served to the UI or agent CLI.

## HTTP Headers

- API responses: `application/json; charset=utf-8`, `no-store` where relevant.
- Preview/raw responses: `x-content-type-options: nosniff`.
- HTML preview: conservative CSP and iframe sandbox defaults.
- CORS: no broad CORS by default. The local SPA uses same-origin requests.

## Logging

Default logs are concise human-readable startup, URL, shutdown, and request
failure messages. No telemetry or remote reporting is added.

## Release Archives

Archives are named for Homebrew and mise-friendly lookup:

```text
vivi_Darwin_arm64.tar.gz
vivi_Darwin_x86_64.tar.gz
vivi_Linux_arm64.tar.gz
vivi_Linux_x86_64.tar.gz
```

Each archive contains:

```text
vivi
```

The release workflow also writes `checksums.txt`. Artifact attestation can be
added when the repository release permissions are ready.
