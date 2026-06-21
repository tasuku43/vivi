# Goals

## Ideal state

`vivi` is a polished local CLI tool that turns any selected directory into a live, browser-based review surface for humans and a CLI-readable feedback surface for coding agents. The user starts it from a terminal, opens the generated local URL, and sees a responsive SPA with a live file tree and a main viewer that can render Markdown, HTML, source code, plain text, images, and structured files.

The highest-level product thesis is documented in `docs/00-product-thesis.md`.

## Success criteria

The product is successful when a developer can run:

```bash
vivi .
```

and use the browser UI to inspect a mixed directory without refreshing the page while files are edited, generated, added, moved, or removed. When feedback is left in the UI, a coding agent should be able to read and respond to that feedback through the CLI without scraping the browser or relying on copied prompts.

## User workflows

1. Preview generated HTML output while another tool writes files.
2. Read Markdown documents and examples from a local project.
3. Inspect source files with syntax highlighting.
4. Watch a directory tree update during build or generation workflows.
5. Open a file from the sidebar and keep the sidebar selection state stable across content updates.
6. Select code lines or ranges and copy stable local references while staying in read-only mode.
7. Review recent filesystem changes and uncommitted Git working-tree changes from a compact queue without adding staging, editing, or IDE workflows.
8. Leave context-rich feedback on rendered views, source views, and diffs so a coding agent can read, reply to, resolve, or archive the thread through the CLI.

## Evaluation criteria

- Correctness: tree and viewer reflect filesystem state under the selected root.
- Safety: path traversal and root escape are rejected.
- Usability: common file types preview sensibly with no manual refresh.
- Performance: large trees are usable through collapsed rendering and eventual virtualization.
- Stability: file event storms do not crash the server or UI.
- Agent usability: tests/evals make the next correct implementation step obvious.
- Feedback loop quality: human comments preserve enough view context for agents to act without ambiguity.

## Current completed behaviors

- Classic workspace layout with live tree, tabs, main viewer, right inspector, command palette, and status bar.
- Markdown rendered/source views with H1/H2 outline.
- Safe HTML preview/source views with explicit mode visibility.
- Code Viewer Pro: syntax highlighting, line numbers, line/range selection, copy reference, copy selected code with path and line numbers, current-scope hinting, and code metadata/symbols in the inspector.
- Text/log wrap controls, image fit/actual modes, JSON tree/source, CSV table/source, lightweight Mermaid file previews, and safe Mermaid previews inside Markdown fences.
- Command palette actions for changed files, reveal in tree, source/rendered toggles, local URLs, outline focus, inspector visibility, split right, close/reopen tab, recent files, shortcuts, and context export.
- Generated-review target surfacing for common output directories such as reports, coverage, screenshots, docs, dist, and build.
- Recent event queue, active-file refresh markers, inactive changed-tab markers, and tree refresh on add/remove events.
- Read-only Git working-tree review for uncommitted added/modified/deleted/renamed files, with bounded side-by-side text diffs from `HEAD` or another recent commit base.
- Rename-like watcher add/remove file pairs grouped as likely renames when parent, extension, and timing make the match safe.
- Bounded initial tree expansion and bounded visible tree rendering for large workspaces, with selected and changed paths kept revealable.
- Fixture eval coverage for mixed file opening and code references.

## Deferred extensions

- Full virtualized tree with smooth scrolling for very large workspaces.
- Text diff patching for very large open files.
- Fuzzy file picker.
- Multi-pane viewing.
- Arbitrary commit comparison beyond recent allowed bases.
- Pluggable viewer registry.

## Explicit non-goals

- Editing files.
- Running or orchestrating coding agents.
- Remote access by default.
- Authentication.
- Cloud storage.
- Full IDE behavior.
- Static-site generation.
- Persistent indexing.
- Built-in LLM features.

## Chosen interaction model

The preferred UI is documented in `docs/ui-mocks/06-classic-reader-commandk.html` and `docs/17-ui-product-decisions.md`.

The first polished version should feel like a lightweight local workspace viewer and review adapter:

- a live file tree on the left,
- open-file tabs above the main viewer,
- a rendered/source-capable main viewer,
- a right inspector with Review Queue, comments, Markdown H1/H2 outline, and file metadata,
- a modal Cmd/Ctrl + K command palette for quick open and actions,
- a CLI-facing comment lifecycle for agent read/reply/resolve/archive flows.

This model is intentionally more specific than a generic file browser. It should help humans inspect generated artifacts, documentation, and source files while preserving enough feedback context for coding agents to act.