# pathlens

A live local viewer for Markdown, HTML, code, and assets.

`pathlens` is a CLI-launched local web app for reviewing local files and generated artifacts. It serves a selected directory, opens a browser-based SPA, renders a live file tree in the sidebar, and previews Markdown, HTML, source code, plain text, images, JSON, CSV/TSV, SVG, Mermaid, logs, and other structured files in the main pane.

## Why this exists

Opening an HTML file through `file://` solves only the single-file case. Static servers such as `python -m http.server` serve files but do not provide a live tree, Markdown rendering, source-code viewing, or a cohesive browser UI. Markdown previewers solve only one media type. `pathlens` is intended to be a local workspace lens: one UI for inspecting generated artifacts, documentation, examples, and code while files change underneath it.

## Core workflows

```bash
pathlens .
pathlens ./docs
pathlens ./dist --open
pathlens . --include md,html,ts,tsx,json,css,png,jpg
pathlens . --max-file-size 2097152
pathlens . --allow-html-scripts
```

Expected user experience:

1. Run the CLI in or against a directory.
2. A local server starts on localhost.
3. The browser SPA shows a sidebar tree and main viewer.
4. Markdown renders as a polished document by default, with a source toggle.
5. HTML renders in a sandboxed iframe with local CSS enabled and scripts disabled by default, with a source toggle and clear script status.
6. Code renders in a read-only inspection view with syntax highlighting, stable line numbers, line-range selection, copyable line references, and lightweight symbols in the inspector.
7. Text/log files use a readable monospace viewer with wrapping controls.
8. Images preview with fit-to-screen and actual-size modes.
9. JSON uses an expandable tree/source viewer; CSV/TSV uses a table/source viewer; Mermaid uses a lightweight safe preview/source viewer, including simple Mermaid fences inside Markdown.
10. File changes update the currently open viewer without a full page reload and mark inactive tabs as changed.
11. File additions, deletions, and rename-like add/remove pairs update the sidebar tree dynamically and are grouped as likely renames when safe.
12. Recent filesystem events appear in a compact review queue so changed files can be opened quickly, and the tree can be filtered to changed files only.
13. Generated-review targets under directories such as `dist/`, `build/`, `reports/`, `coverage/`, `screenshots/`, and `docs/` are surfaced in the inspector.
14. In Git worktrees, uncommitted added, modified, deleted, and renamed files appear in the changed-file review list, with a bounded side-by-side text diff for small files.
15. Large trees start with a bounded auto-expanded view and cap rendered visible rows, while selected or changed files remain easy to reveal.

## What pathlens is not

`pathlens` is not an IDE, editor, Git staging tool, Git history browser, remote file browser, cloud sync service, static-site generator, hosted documentation platform, or LLM product. It focuses on reading, comparing, checking, and following local output as it changes.

## Run With Docker

Docker is the recommended way to run `pathlens` locally because it keeps the Node runtime isolated while mounting the directory you want to inspect as read-only.

```bash
docker run --rm -it \
  -p 4317:4317 \
  -v "$PWD:/workspace:ro" \
  ghcr.io/tasuku43/pathlens:latest
```

Then open:

```text
http://127.0.0.1:4317
```

The Docker image defaults to serving `/workspace` and binding `0.0.0.0` inside the container so the published port works from the host. The CLI default outside Docker remains `127.0.0.1`.

The image includes Git and runs it with read-only-safe defaults so the Review Queue can list uncommitted working-tree changes from a read-only bind mount.

If `git rev-parse --git-dir` points outside the directory you are mounting, as it does in a linked Git worktree, also mount the common Git metadata directory at the same absolute path:

```bash
git_common_dir="$(git rev-parse --path-format=absolute --git-common-dir)"
docker run --rm -it \
  -p 4317:4317 \
  -v "$PWD:/workspace:ro" \
  -v "$git_common_dir:$git_common_dir:ro" \
  pathlens:local
```

Because the mount is read-only, pathlens can still restore browser UI state: open tabs, split panes, recent files, and inspector visibility are stored in browser `localStorage`, scoped by the absolute served root and pruned after 30 days. File contents are never stored in the session.

### Build The Docker Image Locally

Use Taskfile for local project tasks:

```bash
task docker:build
task docker:run
```

Stop the foreground Docker run with `Ctrl+C`. The container uses `tini` and the CLI handles `SIGINT`/`SIGTERM`, so the local watcher and HTTP server shut down cleanly.

Equivalent Docker commands:

```bash
docker build -t pathlens:local .
docker run --rm -it -p 4317:4317 -v "$PWD:/workspace:ro" pathlens:local
```

To validate a multi-architecture build locally with Docker Buildx:

```bash
task docker:buildx IMAGE=ghcr.io/tasuku43/pathlens TAG=dev
```

The local Buildx task targets `linux/amd64,linux/arm64` by default. Override the target platforms when needed:

```bash
task docker:buildx PLATFORMS=linux/arm64 IMAGE=pathlens TAG=arm64
```

You can override the image tag, served directory, host port, or Buildx target platforms:

```bash
task docker:build IMAGE=pathlens TAG=dev
task docker:run IMAGE=pathlens TAG=dev ROOT="$PWD/docs" PORT=4320
```

## Other Run Options

Use `npx` when you want to run the npm package without installing it globally:

```bash
npx pathlens . --open
```

Or install it as an npm package:

```bash
npm install -g pathlens
pathlens . --open
```

For source checkouts:

```bash
npm install
npm run build
node dist/cli/main.js . --open
```

### HTML script safety

HTML preview is sandboxed and script execution is disabled by default. Local CSS and images can still load through pathlens preview routes so generated reports remain useful. When a generated artifact genuinely needs JavaScript, opt in explicitly:

```bash
pathlens ./dist --open --allow-html-scripts
```

When scripts are allowed, the UI shows `scripts on` in the HTML toolbar and the preview CSP permits inline scripts inside the sandboxed iframe. Only use this for local artifacts you trust.

### Large file limits

By default, rich previews read up to 1 MiB per file. Oversized text-like files show an explicit partial preview of the leading chunk, while oversized HTML, images, and binary-like files stop with a safe explanation. You can raise or lower the limit for a local run:

```bash
pathlens ./reports --open --max-file-size 2097152
```

## Keyboard Flow

- `Cmd/Ctrl+K`: quick open by filename or path.
- `Cmd/Ctrl+Shift+F`: search text across searchable file contents.
- `Enter`: open the selected file.
- `Esc`: close the search palette.
- In code viewers, click a line number to select a line; shift-click extends the selected range.

## Release Images

The release workflow builds and pushes Docker images to GitHub Container Registry:

```text
ghcr.io/tasuku43/pathlens
```

Pushing a semver tag such as `v0.1.0` runs the release workflow and pushes both the version tag and `latest`:

```bash
git tag v0.1.0
git push origin v0.1.0
```

Release images are multi-architecture manifests for `linux/amd64` and `linux/arm64`. Manual workflow runs are available for validation builds. Provide a `release_tag` value matching `vMAJOR.MINOR.PATCH` only when intentionally publishing that tag; otherwise the workflow publishes a `sha-...` image tag.

## Current product status

This repository is an active implementation of the local read-only viewer. It includes the CLI/server boundary, live tree and SSE plumbing, Git working-tree review for uncommitted changes, multi-file tabs, viewer dispatch, a polished code inspection surface, contextual inspector, fixture-driven evals, and server/UI tests. It is still intentionally scoped as a local viewer rather than an editor, IDE, Git client, hosted service, or LLM product.

## Technical direction

TypeScript is the chosen implementation language because the product spans:

- a CLI entrypoint,
- a local HTTP/SSE server,
- a React SPA,
- shared filesystem event contracts,
- shared viewer type definitions, and
- test/eval fixtures.

Using one typed language keeps the API contract between server and client explicit.

## Development

Install [Task](https://taskfile.dev/) first if it is not already available.

```bash
npm install
task check
task build
```

Run the full local validation suite:

```bash
task check
```

The scaffold validator can run without installed dependencies:

```bash
node scripts/validate-scaffold.mjs
```

## Repository layout

```text
src/cli/       CLI parsing and process boundary
src/server/    local HTTP, preview, and event transport
src/app/       use cases and application contracts
src/domain/    pure filesystem tree model, path policy, and diff logic
src/infra/     Node filesystem and watcher adapters
src/ui/        React SPA, sidebar tree, and viewers
test/          unit, integration, and E2E tests
evals/         fixture-driven product evaluations
docs/          product, architecture, requirements, and agent context
```

## Product boundary

`pathlens` is a local read-only viewer, not an IDE, not a static-site generator, not a Git staging or history client, not a remote file browser, not an LLM product, and not a hosted documentation platform. It should remain fast to start, local-first, and safe by default.

## Viewer behavior

- Markdown: rendered document by default, source toggle, document typography, tables, code blocks, callouts, and H1/H2 outline in the inspector.
- HTML: sandboxed iframe preview by default, source toggle, local asset preview support, scripts disabled unless explicitly allowed, and visible script-mode status.
- Code: syntax-highlighted read-only code viewer with line numbers, line/range selection, copyable references, copyable selected code with path and line numbers, current-scope hinting, and inspector metadata.
- JSON: expandable tree/source viewer.
- CSV/TSV: bounded table/source viewer for local reports and exports.
- Mermaid: lightweight safe preview/source viewer for simple flowchart files and Markdown fenced Mermaid blocks.
- Text/log: monospaced read-only viewer with wrap/no-wrap toggle.
- Images/SVG: fit-to-screen and actual-size preview modes with size metadata; SVG renders as an image so scripts stay inactive.
- Large or unsupported files: safe fallback that explains why a richer preview is unavailable; large text-like files show a bounded leading chunk as an explicit partial preview.

Recent filesystem events are shown as a compact review queue. Change events refresh the active file and mark inactive tabs/changed tree rows; add/remove events refresh the tree. Close add/remove file pairs with the same parent and extension are grouped as likely renames in the review list. In Git worktrees, `pathlens` also reads uncommitted working-tree status and can show a bounded side-by-side text diff from `HEAD` or another recent allowed commit base to the working tree. Git status can surface explicit renamed files in the changed-file list.

The sidebar avoids expanding every descendant in very large trees on first render and avoids mounting every visible row after a large folder is expanded. It auto-expands within a row budget, keeps selected and changed paths revealable by expanding their ancestors, keeps important rows rendered beyond the normal cap, and shows a small note when collapsed or omitted rows are hiding additional entries.

## Adding a Viewer

Viewer selection starts in `src/domain/viewer-kind.ts`. Add or adjust an extension there, then implement a browser-only component under `src/ui/viewers/` and dispatch it from `src/ui/components/FileViewer.tsx`. Keep filesystem reads in `src/infra`, keep viewer logic read-only, add at least one focused test, and update eval fixtures when the viewer changes product coverage.

## Known Limitations

- Mermaid preview intentionally supports only simple flowchart arrows; source mode or the inline Markdown source disclosure remains the fallback.
- Git integration is read-only and limited to uncommitted working-tree status plus small side-by-side text diffs from recent commit bases; it does not stage, commit, or browse full history.
- Large files are capped by the preview size limit; text-like files show a bounded partial preview, while non-text previews stop with a safe explanation.
- Smooth full tree virtualization and arbitrary commit comparison beyond recent allowed bases are deferred.

## Handing this repository to a coding agent

Instruct the agent to read `AGENTS.md`, `GOALS.md`, `docs/09-codex-runbook.md`, `docs/13-test-and-eval-strategy.md`, and `docs/14-architecture.md`. The agent should implement autonomously, drive behavior with tests and evals, run `task check`, and summarize product behavior, remaining gaps, and contract changes.

## UI mockups and product reference

Static HTML mockups are included under `docs/ui-mocks/` so coding agents can understand the intended product shape without relying on external context.

The preferred direction is:

```text
docs/ui-mocks/06-classic-reader-commandk.html
```

It combines a classic explorer sidebar, open-file tabs, a central viewer, a right Markdown outline/inspector, and a modal search palette for quick open and text search.

Relevant docs:

- `docs/17-ui-product-decisions.md`
- `docs/18-ux-acceptance-criteria.md`
- `docs/ui-mocks/README.md`
