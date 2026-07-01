# Product brief

## Product

`vivi` is a CLI-launched local SPA for reviewing agent-written local workspaces.
It gives humans a browser-based review surface and gives coding agents a
CLI-readable feedback loop.

For the deeper product thesis, see [`00-product-thesis.md`](00-product-thesis.md).

## Problem

Developers and coding-agent users often generate or edit a mixture of Markdown,
HTML, code, JSON, logs, screenshots, diagrams, and other local artifacts.
Existing approaches are fragmented:

- `file://` opens a single HTML file but provides no tree, live multi-file UI, or review queue.
- Generic static servers serve bytes but do not render Markdown, code, or structured files as review surfaces.
- Markdown previewers ignore HTML/code/assets as first-class artifacts.
- IDEs are heavy when the user only wants a browser-based read-only review view.
- Diff tools focus on changed lines, not the full generated artifact and the human feedback loop around it.

## Target users

- Developers inspecting generated artifacts.
- Documentation authors previewing mixed documentation directories.
- Tool builders reviewing output directories.
- Coding-agent users who want to inspect generated project files and send precise feedback back to the agent.

## Core promise

Run one CLI command, open one local browser app, inspect the current directory
live, leave feedback in the context where the issue appears, and let a coding
agent retrieve that feedback through a CLI contract.

## Differentiation

The differentiator is not simply serving files. The differentiator is the
combination of:

- live sidebar tree,
- mixed media file viewers,
- Markdown rendering,
- sandboxed HTML rendering,
- source code highlighting,
- comment threads attached to review context,
- a feedback queue that agents can read from the CLI,
- no full-page refresh for file changes,
- local-first safety defaults.
