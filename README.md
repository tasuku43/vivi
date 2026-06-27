# Vivi

The canonical data contract is `server/graphql/schema.graphqls`. Run
`task generate` to regenerate the Go bindings and infrastructure-private
TypeScript operation types.

Vivi is a local review adapter between humans and coding agents.

Coding agents write. Humans read, understand the workspace, and give the next
instruction. Vivi exists for that reading loop: it opens a local directory in a
rich browser UI with a live file tree, open-file tabs, rendered Markdown, safe
HTML preview, code/text/image/JSON/CSV/Mermaid viewers, comments, and a Review
Queue for working-tree changes.

Vivi gives humans a browser-based review surface and gives coding agents a
CLI-readable feedback loop. It is not a diff-only viewer. It is a local file
viewer for reading the whole workspace and the surrounding context with low
cognitive load.

See [docs/00-product-thesis.md](docs/00-product-thesis.md) for the product
thesis behind this boundary.

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

The canonical `vivi` command is the Go CLI/backend. It is the only
agent-facing CLI path and includes the local server launcher plus
`review` and `comments` subcommands:

```bash
vivi .
vivi ./docs
vivi ./dist --open
vivi . --port 0 --ready-json --actor codex
vivi comments work --actor codex --wait --loop --idle-events --idle-on-change --json
vivi review queue --actor codex --json
vivi . --include md,html,ts,tsx,json,css,png,jpg
vivi . --max-file-size 2097152
vivi . --allow-html-scripts
```

Defaults:

- binds locally by default,
- serves only the selected workspace,
- ignores `.git`, `node_modules`, and common build caches,
- renders HTML in a sandboxed iframe,
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

## Feedback Loop

Vivi comments are review feedback attached to local workspace context. Humans
leave them in the browser while reading artifacts. Coding agents can read,
reply to, resolve, or archive those threads through the CLI and GraphQL API.

This keeps the human-facing UI visual and low-friction while keeping the
agent-facing interface structured and deterministic.

For coding agents, `comments work` is the primary feedback loop. Start Vivi
with `--ready-json --actor <actor>`, then run the primary suggested
`comments work --loop --url <url> --json` command from that ready payload.
`review queue` and `review diff` are changed-file context helpers; they are not
the human-feedback intake loop. `protocol`, `schema`, `watch`, `follow`, and
raw `claim` remain available for adapter authors, debugging, and recovery.

## Product Boundary

Vivi is a local read-only review adapter. It is not an IDE, editor, Git staging
tool, Git history browser, remote file browser, cloud sync service, hosted
service, task manager, agent runner, or LLM product.

Vivi reads files under the workspace you choose. It does not intentionally write
to that workspace. Local comments, when enabled, are Vivi metadata stored
outside the viewed workspace by default, scoped by the canonical workspace root
so feedback from one project does not appear in another.

## Security Model

Vivi is local-first, but local-first does not remove every risk. See
[docs/15-security-model.md](docs/15-security-model.md) for the longer security
notes and operational boundaries.

## Development

The distributed `vivi` binary does not require Node.js or npm at runtime. This
repository still uses Node.js for frontend development, Vite builds, React
tests, and TypeScript checks.

Install [Task](https://taskfile.dev/) and Node.js 20 or newer for development:

```bash
npm ci
task check
task build
task storybook
```

Useful commands:

```bash
npm exec -- vivi --help
npm run dev
npm run dev:server
npm run dev:server:typescript
npm run e2e
npm run verify:comment-ui
node scripts/validate-scaffold.mjs
```

`npm exec -- vivi ...` is a local-development shim that delegates to the
canonical Go CLI. `npm run dev:server:typescript` starts the preserved
TypeScript server harness explicitly for contract and adapter development; it
is not the product CLI and does not expose the agent `review` or `comments`
surface.

Optional performance instrumentation is build-tag gated and documented in
[`docs/16-performance-model.md`](docs/16-performance-model.md):

```bash
npm run build:go
npm run build:go:otel
docker compose -f docker-compose.otel.yml up
npm run perf:otel
```

The fixture-driven fake agent loop is documented in
[`docs/23-local-agent-loop-harness.md`](docs/23-local-agent-loop-harness.md).
Against a running Vivi server, run `npm run harness:agent-loop` to verify the
human comment, actor-aware read receipt, agent reply, and terminal lifecycle.
Use `--intake work --terminal cli` when validating the primary resident
agent-facing loop.

The Go backend is the distribution target. The TypeScript server remains useful
while the migration is in progress because selected API contract tests can be
run against both implementations, but default `vivi` invocations must land on
the Go CLI.

## Repository Layout

```text
cli/           Go CLI entrypoint plus an explicit TypeScript dev harness
server/        Go local HTTP/API server and TypeScript contract implementation
ui/            React SPA, layered client boundary, features, tests, and Storybook
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
