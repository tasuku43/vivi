# Storybook UI regression lab

Storybook is Vivi's lightweight review UI regression lab. It is meant to catch
review-surface regressions before full browser/server E2E tests run.

## Scope

Storybook stories cover stable browser UI states that can be represented with
domain-shaped fixtures:

- workbench-level review screens under `Screens/Workbench`
- comment thread lifecycle states under `Review/Comments`
- draft review tray and publish CTA states under `Review/Drafts`
- review queue summaries under `Review/Review Queue`
- diff, Markdown, and HTML review affordances under `Review/Diff` and `Viewers/*`
- navigation overlays under `Navigation/*`
- loading, error, disconnected, and activity states under `System/States`

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

The full repository gate still runs:

```bash
task check
```

Representative stories opt into `@storybook/addon-a11y` with
`parameters.a11y.test = "error"`. Interaction smoke checks live in Storybook
`play` functions on selected representative stories and are tagged with
`interaction` so `task storybook:test` stays focused. They should cover the
gesture or keyboard contract without emulating filesystem, HTTP, GraphQL, SSE, or
server-backed iframe behavior.
