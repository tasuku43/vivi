# Product brief

## Product

`vivi` is a CLI-launched local SPA for reviewing agent-written documents.
It gives humans a browser-based review surface and gives coding agents a
CLI-readable feedback loop.

For the deeper product thesis, see [`00-product-thesis.md`](00-product-thesis.md).

## Problem

Developers and coding-agent users often generate or edit long-form Markdown and
HTML documents. Existing approaches make it awkward to read the document and
leave precise feedback in one place:

- `file://` opens a single HTML file but provides no tree, live multi-file UI, or review queue.
- Generic static servers serve bytes but do not attach feedback to rendered blocks.
- Diff tools make changed lines primary even when the user needs to read the whole document.
- IDEs are heavy when the user only wants a browser-based read-only review view.
- Diff tools focus on changed lines, not the full generated artifact and the human feedback loop around it.

## Target users

- Documentation authors reviewing local Markdown and HTML documents.
- Coding-agent users who want to read generated documents and send precise feedback back to the agent.

## Core promise

Run one CLI command, open one local browser app, navigate the real filtered
directory tree, read a document, double-click any rendered block to leave
feedback, and let a coding agent retrieve it through a CLI contract.

## Differentiation

The differentiator is not simply serving files. The differentiator is the
combination of:

- live sidebar tree,
- Markdown rendering,
- sandboxed HTML preview with script execution disabled by default,
- a document-only real directory tree,
- commenting on any rendered block independent of Git changes,
- an optional Changes lens that is off by default,
- comment threads attached to review context,
- a feedback queue that agents can read from the CLI,
- no full-page refresh for file changes,
- local-first safety defaults.
