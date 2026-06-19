# Vivi

Vivi is a read-only visual workspace viewer for agent-written local files.

Coding agents write. Humans read, understand the workspace, and give the next
instruction. Vivi exists for that reading loop: it opens a local directory in a
rich browser UI with a live file tree, open-file tabs, rendered Markdown, safe
HTML preview, code/text/image/JSON/CSV/Mermaid viewers, comments, and a Review
Queue for working-tree changes.

Vivi is not a diff-only viewer. It is a local file viewer for reading the whole
workspace and the surrounding context with low cognitive load.

## Install

Homebrew is the primary macOS install route:

```bash
brew tap tasuku43/tap
brew install vivi
```

With mise, install the GitHub Release binary:

```bash
mise use -g github:tasuku43/vivi
```

To pin a version:

```bash
mise use -g github:tasuku43/vivi@v0.1.0
```

You can also download a prebuilt archive from GitHub Releases. The release
artifacts are named for the target platform, for example:

```text
vivi_Darwin_arm64.tar.gz
vivi_Darwin_x86_64.tar.gz
vivi_Linux_arm64.tar.gz
vivi_Linux_x86_64.tar.gz
```

Each archive contains a single `vivi` binary. Check `checksums.txt` before
running a downloaded binary.

## Usage

```bash
vivi .
vivi ./docs
vivi ./dist --open
vivi . --include md,html,ts,tsx,json,css,png,jpg
vivi . --max-file-size 2097152
vivi . --allow-html-scripts
```

Defaults:

- binds to `127.0.0.1`,
- serves only the selected workspace,
- ignores `.git`, `node_modules`, and common build caches,
- renders HTML in a sandboxed iframe,
- keeps HTML scripts disabled unless `--allow-html-scripts` is passed,
- stores browser UI state in `localStorage`,
- does not store file contents in `localStorage`,
- sends no telemetry.

## What Vivi Shows

- A stable sidebar file tree for the selected workspace.
- Open-file tabs and split panes for reading several files together.
- Markdown, HTML, code, text/log, image/SVG, JSON, CSV/TSV, and Mermaid viewers.
- A right inspector with Markdown/HTML H1/H2 outline, metadata, comments, and
  Review Queue.
- A modal command palette on `Cmd/Ctrl+K`.
- Live file refresh from watcher events.
- Working-tree Review Queue entries for added, modified, deleted, and renamed
  files when Git is available.

## Product Boundary

Vivi is a local read-only viewer. It is not an IDE, editor, Git staging tool,
Git history browser, remote file browser, cloud sync service, hosted service,
or LLM product.

Vivi reads files under the workspace you choose. It does not intentionally write
to that workspace. Local comments, when enabled, are Vivi metadata stored
outside the viewed workspace by default.

## Security Model

Vivi is local-first, but it is not magic safety dust.

- The default bind address is `127.0.0.1`.
- Binding to `0.0.0.0` exposes the local server to other machines that can reach
  the host network. Only do this intentionally.
- File APIs accept normalized relative paths and reject root escapes.
- Symlinks that resolve outside the workspace are rejected.
- Files such as `.env`, private keys, and credentials can be displayed if they
  are inside the workspace and you open them.
- HTML preview scripts are disabled by default with iframe sandboxing and CSP.
- `--allow-html-scripts` should only be used for trusted local artifacts.
- File contents are not sent to an external service.
- No telemetry is collected.

See [docs/15-security-model.md](docs/15-security-model.md) for the longer
security notes.

## Development

The distributed `vivi` binary does not require Node.js, npm, or Docker at
runtime. This repository still uses Node.js for frontend development, Vite
builds, React tests, and TypeScript checks.

Install [Task](https://taskfile.dev/) and Node.js 20 or newer for development:

```bash
npm ci
task check
task build
```

Useful commands:

```bash
npm run dev
npm run e2e
npm run verify:comment-ui
node scripts/validate-scaffold.mjs
```

The Go backend is the distribution target. The TypeScript server remains useful
while the migration is in progress because the same API contract tests can be
run against both implementations.

## Docker

Docker is not a general install option for Vivi. It can still be useful for
development or verification, but large repositories mounted through Docker bind
mounts on macOS can make Git and broad filesystem scans very slow. Prefer the
native binary for normal local workspace reading.

## Repository Layout

```text
cmd/vivi/      Go CLI entrypoint
internal/      Go server, filesystem, Git, and API implementation
src/ui/        React SPA, sidebar tree, tabs, inspector, and viewers
src/domain/    Shared TypeScript UI/domain helpers during migration
test/          unit, integration, contract, and E2E tests
evals/         fixture-driven product evaluations
docs/          product, architecture, release, and security notes
```

## Release Status

Release workflow, Homebrew formula, and mise instructions are prepared as
drafts in this repository. Publishing steps are intentionally manual:

- repository rename,
- tag push,
- GitHub Release creation,
- Homebrew tap push,
- mise registry registration.

Those actions should only happen after an explicit human release decision.
