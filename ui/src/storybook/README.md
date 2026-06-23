# Vivi Storybook Lab

Storybook is the fast UI regression lab for Vivi's human review surface. Use it
before changing product UI and keep it close to `docs/17-ui-product-decisions.md`
and `docs/18-ux-acceptance-criteria.md`.

## Agent Workflow

When a change touches visible UI:

1. Find the closest existing story in `ui/src/**/*.stories.tsx`.
2. Add or update a story for the state the user can now see.
3. Reuse fixtures from `ui/src/storybook/fixtures/review-lab.ts` instead of
   inventing one-off props.
4. Add a `play` function when the change affects pointer, keyboard, focus,
   text input, filters, or close/open behavior.
5. If the change creates a new product-facing surface, add it to
   `storybook-lab.manifest.json`.
6. Run `task storybook:verify` and `task storybook:test` for interaction
   changes.
7. Run `task storybook:build`.

Run `task check` before handing off a coding pass.

## What Belongs Here

Use Storybook for stable, domain-shaped UI states:

- workbench shell, file tree, tabs, topbar, statusbar
- Review Queue, Comments inbox, agent activity, draft review tray
- inline comment threads and rendered/source comment affordances
- Markdown, HTML, code, structured/text, image, Mermaid, and binary viewer states
- source and rendered diff states
- loading, empty, error, disconnected, dense-list, and no-result states

Do not mock filesystem watchers, GraphQL transport, HTTP routes, SSE, or real
HTML preview server behavior here. Those stay in E2E and server tests.

## Coverage Contract

`storybook-lab.manifest.json` is the product coverage contract. It maps user
surfaces to required stories and representative interaction stories. The
verification script fails when:

- a listed story file or story export is missing,
- a new `.stories.tsx` file is not listed,
- a required product surface has no stories,
- an interaction story lacks a `play` function or `interaction` tag.

This makes Storybook discoverable for future agents: read this file, inspect the
manifest, then update stories before or alongside UI implementation.
