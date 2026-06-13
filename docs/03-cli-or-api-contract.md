# CLI and API contract

## CLI contract

```bash
pathlens [root]
pathlens [root] --port 4317
pathlens [root] --host 127.0.0.1
pathlens [root] --open
pathlens [root] --include md,html,ts,tsx,json
pathlens [root] --max-file-size 1048576
pathlens [root] --allow-html-scripts
```

Default root: `.`

Default host: `127.0.0.1`

Default security posture: local-only, sandboxed HTML preview, local CSS enabled for practical artifact inspection, and HTML script execution disabled. Use `--allow-html-scripts` only when intentionally reviewing generated HTML that needs script execution.

Default rich preview limit: `1048576` bytes. Use `--max-file-size <bytes>` to change it for the current local run.

## HTTP API

### `GET /api/tree`

Returns the current filesystem tree under the selected root.

```json
{
  "root": ".",
  "version": 1,
  "nodes": [
    {
      "id": "README.md",
      "path": "README.md",
      "name": "README.md",
      "kind": "file",
      "viewerKind": "markdown",
      "parentPath": ""
    }
  ]
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

Image payloads use `encoding: "base64"` and include a MIME type suitable for browser display. Files larger than the configured preview limit use `truncated: true`. Text-like large files may include a bounded leading UTF-8 `content` chunk with `previewBytes`; non-text large files use `encoding: "none"` and empty `content`.

### `GET /api/config`

Returns viewer configuration needed by the SPA.

```json
{
  "root": "/absolute/served/root",
  "allowHtmlScripts": false,
  "maxFileSizeBytes": 1048576
}
```

### `GET /api/changes`

Returns read-only Git working-tree review status when the selected root is inside a Git repository. This is a viewer aid, not a staging or history API. If Git is unavailable or the root is not a worktree, the endpoint returns `available: false` with a reason.

```json
{
  "available": true,
  "changes": [
    { "path": "README.md", "status": "modified" },
    { "path": "reports/new.csv", "status": "added" },
    {
      "path": "docs/new-name.md",
      "status": "renamed",
      "originalPath": "docs/old-name.md"
    }
  ]
}
```

Statuses are `added`, `modified`, `deleted`, or `renamed`.

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
