# Goals

## Ideal state

`pathlens` is a polished local CLI tool that turns any selected directory into a live, browser-based viewer. The user starts it from a terminal, opens the generated local URL, and sees a responsive SPA with a live file tree and a main viewer that can render Markdown, HTML, source code, plain text, images, and structured files.

## Success criteria

The product is successful when a developer can run:

```bash
pathlens .
```

and use the browser UI to inspect a mixed directory without refreshing the page while files are edited, generated, added, moved, or removed.

## User workflows

1. Preview generated HTML output while another tool writes files.
2. Read Markdown documents and examples from a local project.
3. Inspect source files with syntax highlighting.
4. Watch a directory tree update during build or generation workflows.
5. Open a file from the sidebar and keep the sidebar selection state stable across content updates.
6. Select code lines or ranges and copy stable local references while staying in read-only mode.
7. Review recent filesystem changes and uncommitted Git working-tree changes from a compact queue without adding staging, editing, or IDE workflows.

## Evaluation criteria

- Correctness: tree and viewer reflect filesystem state under the selected root.
- Safety: path traversal and root escape are rejected.
- Usability: common file types preview sensibly with no manual refresh.
- Performance: large trees are usable through collapsed rendering and eventual virtualization.
- Stability: file event storms do not crash the server or UI.
- Agent usability: tests/evals make the next correct implementation step obvious.

## Current completed behaviors

- Classic workspace layout with live tree, tabs, main viewer, right inspector, command palette, and status bar.
- Markdown rendered/source views with H1/H2 outline.
- Sandboxed HTML preview/source views with scripts disabled by default, explicit opt-in, and script mode visible.
- Code Viewer Pro: syntax highlighting, line numbers, line/range selection, copy reference, copy selected code with path and line numbers, current-scope hinting, and code metadata/symbols in the inspector.
- Text/log wrap controls, image fit/actual modes, JSON tree/source, CSV table/source, and lightweight Mermaid previews.
- Command palette actions for changed files, reveal in tree, source/rendered toggles, local URLs, outline focus, inspector visibility, split right, close/reopen tab, recent files, shortcuts, and context export.
- Generated-review target surfacing for common output directories such as reports, coverage, screenshots, docs, dist, and build.
- SSE-driven recent event queue, active-file refresh markers, inactive changed-tab markers, and tree refresh on add/remove events.
- Read-only Git working-tree review for uncommitted added/modified/deleted/renamed files, with bounded text diffs against `HEAD`.
- Bounded initial tree expansion for large workspaces, with selected and changed paths kept revealable.
- Fixture eval coverage for mixed file opening and code references.

## Deferred extensions

- Full virtualized tree for very large workspaces.
- Text diff patching for very large open files.
- Full Mermaid rendering in Markdown.
- Fuzzy file picker.
- First-class rename events beyond add/remove watcher semantics.
- Multi-pane viewing.
- Rich side-by-side diff review and arbitrary commit comparison.
- Pluggable viewer registry.

## Explicit non-goals

- Editing files.
- Remote access by default.
- Authentication.
- Cloud storage.
- Full IDE behavior.
- Static-site generation.
- Persistent indexing.
- LLM features.

## Chosen interaction model

The preferred UI is documented in `docs/ui-mocks/06-classic-reader-commandk.html` and `docs/17-ui-product-decisions.md`.

The first polished version should feel like a lightweight local workspace viewer:

- a live file tree on the left,
- open-file tabs above the main viewer,
- a rendered/source-capable main viewer,
- a right inspector with Markdown H1/H2 outline and file metadata,
- a modal Cmd/Ctrl + K command palette for quick open and actions.

This model is intentionally more specific than a generic file browser. It should help users inspect generated artifacts, documentation, and source files while preserving spatial context.
