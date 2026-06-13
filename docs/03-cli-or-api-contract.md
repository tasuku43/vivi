# CLI and API contract

## CLI contract

```bash
pathlens [root]
pathlens [root] --port 4317
pathlens [root] --host 127.0.0.1
pathlens [root] --open
pathlens [root] --include md,html,ts,tsx,json
pathlens [root] --no-html-scripts
```

Default root: `.`

Default host: `127.0.0.1`

Default security posture: local-only, sandboxed HTML preview, local CSS and scripts enabled for practical artifact inspection. Use `--no-html-scripts` to disable script execution while keeping stylesheet preview support.

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

Image payloads use `encoding: "base64"` and include a MIME type suitable for browser display. Files larger than the configured preview limit use `encoding: "none"`, empty `content`, and `truncated: true`.

### `GET /api/config`

Returns viewer configuration needed by the SPA.

```json
{
  "root": "/absolute/served/root",
  "allowHtmlScripts": true,
  "maxFileSizeBytes": 1048576
}
```

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
