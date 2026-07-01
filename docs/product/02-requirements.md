# Requirements

## Functional requirements

### CLI

- Accept a root directory argument, defaulting to `.`.
- Bind to `127.0.0.1` by default.
- Accept a configurable port.
- Optionally open the browser.
- Print the local URL.
- Refuse invalid or inaccessible roots.

### Tree

- Build an initial tree of supported files and directories.
- Ignore `.git`, `node_modules`, and common caches by default.
- Allow include/exclude patterns in future iterations.
- Preserve expanded/collapsed state across tree updates.
- Reflect add, delete, change, and rename-like events.

### Viewer

- Markdown: render to HTML.
- HTML: render in a sandboxed iframe.
- Code: render source with syntax highlighting.
- Text/log: render plain text safely.
- Images: render image preview.
- JSON/YAML: render as structured or highlighted code.
- Unknown files: show metadata and raw/download options.

### Live updates

- Use filesystem watcher events as the primary change signal.
- Notify the SPA using SSE or WebSocket.
- For MVP, refresh the open file content on change.
- For MVP, tree can be fully refetched on add/remove; semantic tree events are preferred later.

## Non-functional requirements

- Safe by default.
- No root escape.
- Reasonable performance for thousands of files.
- Graceful degradation for large files.
- Deterministic contracts for coding agents.
- Test/eval coverage for product-critical behavior.
