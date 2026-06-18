# Product brief

## Product

`vivi` is a CLI-launched local SPA for live viewing a directory tree and previewing files.

## Problem

Developers often generate or edit a mixture of Markdown, HTML, code, JSON, logs, and images. Existing approaches are fragmented:

- `file://` opens a single HTML file but provides no tree or live multi-file UI.
- Generic static servers serve bytes but do not render Markdown or code.
- Markdown previewers ignore HTML/code/assets as first-class artifacts.
- IDEs are heavy when the user only wants a browser-based read-only view.

## Target users

- Developers inspecting generated artifacts.
- Documentation authors previewing mixed documentation directories.
- Tool builders reviewing output directories.
- Coding-agent users who want to inspect generated project files quickly.

## Core promise

Run one CLI command, open one local browser app, and inspect the current directory live without manual page refreshes.

## Differentiation

The differentiator is not simply serving files. The differentiator is the combination of:

- live sidebar tree,
- mixed media file viewers,
- Markdown rendering,
- sandboxed HTML rendering,
- source code highlighting,
- no full-page refresh for file changes,
- local-first safety defaults.
