# Vivi Storybook Lab

Storybook is the fast UI regression lab for Vivi's human review surface. Use it
before changing product UI and keep it close to `docs/17-ui-product-decisions.md`
and `docs/18-ux-acceptance-criteria.md`.

## Three-Stage GUI Review

New visible GUI surfaces and meaningful layout changes should move through the
three-stage review path unless the user explicitly asks to skip it:

1. **HTML Concept Mock**: use `docs/ui-mocks/` to compare layout, density,
   information hierarchy, and product direction before React implementation.
2. **Storybook Facade**: create React components and stories with props,
   simplified callbacks, and domain-shaped fixtures. This is the design review
   surface before real application, server, filesystem, SSE, route, or preview
   behavior is wired.
3. **Wired Feature**: after explicit approval, connect the approved facade to
   application use cases, infrastructure, and server behavior while preserving
   useful facade stories as the visual contract.

## Facade Stories

A facade story is allowed to be a visual contract rather than a fully wired
feature. It may use static props, fixture data, and simplified callbacks. It
should make approved UI states reviewable before application, server, or
filesystem behavior is connected.

Facade stories should still be product-shaped:

- use fixtures from `ui/src/storybook/fixtures/review-lab.ts` when they apply,
- show the user states that matter for design review, such as empty, dense,
  loading, error, selected, stale, and open/closed states,
- name Storybook sections and stories after the user state under review, not the
  component implementation name,
- include lightweight `play` interactions for reviewable UI gestures like
  open/close, selection, keyboard focus, filtering, and text input,
- avoid mocking filesystem watchers, GraphQL transport, HTTP routes, SSE, or
  real HTML preview server behavior.

## Agent Workflow

When a change touches visible UI:

1. Confirm whether the change is in the HTML Concept, Storybook Facade, or Wired
   Feature stage.
2. Find the closest existing story in `ui/src/**/*.stories.tsx`.
3. Add or update a story for the state the user can now see.
4. Reuse fixtures from `ui/src/storybook/fixtures/review-lab.ts` instead of
   inventing one-off props.
5. Add a `play` function when the change affects pointer, keyboard, focus,
   text input, filters, or close/open behavior.
6. If the change creates a new product-facing surface or changes the review
   focus, update `storybook-lab.manifest.json`.
7. Run `task storybook:verify` and `task storybook:test` for interaction
   changes.
8. Run `task storybook:build`.

Run `task check` before handing off a coding pass.

## What Belongs Here

Use Storybook for stable, domain-shaped UI states:

- workspace states, file tree, tabs, topbar, statusbar
- Review Queue states, review thread inbox states, agent activity, draft review states
- inline comment states and rendered/source comment affordances
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
