# Storybook UI regression lab

Storybook is Vivi's lightweight review UI regression lab. It is meant to catch
review-surface regressions before full browser/server E2E tests run.

## Place in the design flow

Vivi uses a three-stage GUI design path for new visible surfaces and meaningful
layout changes:

1. **HTML Concept Mock**: a static `docs/ui-mocks/` artifact for layout,
   density, information hierarchy, and product-direction review.
2. **Storybook Facade**: a React story backed by props, simplified callbacks,
   and domain-shaped fixtures. This is the visual contract for design approval
   before real application, server, filesystem, SSE, route, or preview behavior
   is wired.
3. **Wired Feature**: the approved facade is connected to real use cases,
   infrastructure, and server behavior, with behavior covered by the appropriate
   unit, use-case, adapter, E2E, eval, or snapshot tests.

Storybook therefore contains both facade stories and integrated regression
stories. Facade stories are intentionally allowed to be "cardboard" from a data
and backend perspective, but they should be honest about the product states a
human must review.

## Scope

Storybook stories cover stable browser UI states that can be represented with
domain-shaped fixtures. The left sidebar should group stories by the user state
under review rather than by component implementation names:

- workspace review screens under `Workspace/Workbench States`
- workspace chrome states under `Workspace/Navigation Chrome`
- comment thread lifecycle states under `Review/Inline Comment States`
- review queue summaries under `Review/Queue States`
- draft review and publish CTA states under `Workspace/Workbench States` and `Review/Queue States`
- diff review affordances under `Review/Diff States`
- Markdown, HTML, code, and file fallback states under `Files/* States`
- navigation overlays under `Navigation/Search and Command States`
- review activity states under `Review/Activity States`
- design workflow states under `Design Review/Workflow`

The shared fixtures live in `ui/src/storybook/fixtures/review-lab.ts` and stay
close to the public domain and GraphQL contract: `ViviComment`,
`DraftReviewComment`, `PublishedReviewBatch`, `reviewBatchId`, diff anchors, and
comment thread activity events.

The product coverage contract lives in
`ui/src/storybook/storybook-lab.manifest.json`. It maps each UI surface to the
stories that must keep representing it. Future UI work should update the
manifest whenever a new product-facing surface appears.

Agent-facing Storybook workflow lives in `ui/src/storybook/README.md`. Agents
should read that file before changing visible UI so the story, fixture, and
interaction-test conventions stay local to the product.

## Storybook vs E2E

Storybook should not emulate full filesystem, HTTP, GraphQL, SSE, or iframe
preview behavior. Those remain E2E responsibilities.

Use Storybook for:

- visual review of screen and component states
- checking comment, draft, batch, activity, and queue projections
- lightweight a11y checks on representative stories
- fast local inspection while changing UI layout or styling

Use E2E for:

- real server routing and `/preview/html` responses
- filesystem watcher behavior
- GraphQL mutation/subscription behavior
- CLI-readable comments watch behavior
- timing-sensitive integration flows

## Verification

Verify the coverage manifest and representative interaction hooks with:

```bash
task storybook:verify
```

Run representative Storybook `play` interactions with:

```bash
task storybook:test
```

Run the lightweight Storybook build with:

```bash
task storybook:build
```

Capture or verify Storybook visual baselines with:

```bash
npm run storybook:snapshots:update
npm run storybook:snapshots:verify
```

The snapshot target list comes from `ui/src/storybook/storybook-lab.manifest.json`:
`requiredStories` and `interactionStories` entries are captured through the
running Storybook `iframe.html` surface. This keeps post-interaction focus,
hover, click, and form states in the visual baseline. To run a smaller
required-only visual check locally, set `VIVI_STORYBOOK_SNAPSHOT_INTERACTIONS=0`.

Baselines live under `test/golden/storybook/`, while verification failures write
actual/expected/diff artifacts to `artifacts/storybook-snapshots/`.

The current verifier uses Playwright screenshots and a dependency-light Canvas
pixel comparison. It allows a tiny anti-aliasing tolerance by default while
still reporting visible style refactors. Tune local diagnostics with
`VIVI_STORYBOOK_SNAPSHOT_CHANNEL_TOLERANCE`,
`VIVI_STORYBOOK_SNAPSHOT_MAX_DIFF_RATIO`, and
`VIVI_STORYBOOK_SNAPSHOT_VIEWPORTS`.

The full repository gate still runs:

```bash
task check
```

## Styling Contract

New and migrated UI styles should use CSS Modules by default. `ui/src/styles.css`
is reserved for root theme tokens and document-level base rules. Shared chrome
utilities live in `ui/src/shared/styles/SharedUi.module.css` and should be
applied through imported module classes.

Stable global class names may remain in markup as Storybook, test, and product
inspection hooks, but the visual styling should live in a feature module or a
shared module. When moving a visible style, capture or verify the affected
Storybook snapshot set before treating the migration as complete.

Representative stories opt into `@storybook/addon-a11y` with
`parameters.a11y.test = "error"`. Interaction smoke checks live in Storybook
`play` functions on selected representative stories and are tagged with
`interaction` so `task storybook:test` stays focused. They should cover the
gesture or keyboard contract without emulating filesystem, HTTP, GraphQL, SSE, or
server-backed iframe behavior.
