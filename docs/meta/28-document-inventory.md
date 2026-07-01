# Document inventory

This inventory separates product truth, implementation contracts, exploration
notes, and historical plans so future edits can tell whether a document should
describe current behavior or product intent.

## Current implementation snapshot

- Distribution target: one Go `vivi` CLI/backend. The repository-local npm bin
  delegates to the Go CLI.
- Browser data path: `GraphqlViviClient` and `POST /graphql`.
- HTTP resource paths: `/preview/html`, `/preview/raw/*`, `/events`, GraphQL
  SSE over `GET /graphql`, static assets, and `/api/v1/review-ledger`.
- Removed REST data paths: legacy `/api/*` workspace/comment data routes return
  404 in the Go runtime and are kept only as migration history.
- TypeScript server harness: development-only contract and adapter support; it
  is not the product CLI or agent-facing command path.
- Product boundary: local-first, read-only workspace review; no hosted service,
  auth, cloud sync, agent runner, file editing, Git staging, or LLM product.

## Source-of-truth tiers

Use these documents first when behavior changes:

- `GOALS.md`: durable product goal and non-goal pointer.
- `README.md`: public orientation, install, usage, and repository map.
- `docs/README.md`: documentation category map.
- `docs/contracts/03-cli-or-api-contract.md`: CLI, GraphQL, HTTP resource, event, and
  removed REST migration contracts.
- `docs/architecture/14-architecture.md`: package boundaries and dependency direction.
- `docs/architecture/15-security-model.md`: local safety and preview security posture.
- `docs/adr/17-ui-product-decisions.md` and `docs/product/18-ux-acceptance-criteria.md`:
  current UI direction and acceptance criteria.
- `docs/contracts/22-comment-thread-lifecycle.md`: comment state, activity, claims, and
  agent workflow lifecycle.
- `docs/engineering/24-storybook-ui-regression-lab.md`: Storybook review workflow.
- `docs/architecture/25-runtime-architecture.md`: runtime watcher, events, and performance
  boundary.
- `docs/operations/27-install.md`: install surface.

## Supporting reference

- `docs/product/00-product-thesis.md` and `docs/product/01-product-brief.md`: product
  philosophy and positioning.
- `docs/product/02-requirements.md`, `docs/contracts/04-data-model.md`, `docs/engineering/05-evaluation.md`,
  `docs/contracts/08-provider-or-adapter-contracts.md`, `docs/engineering/13-test-and-eval-strategy.md`,
  `docs/architecture/16-performance-model.md`, `docs/engineering/19-viewer-extension-guide.md`,
  `docs/engineering/21-supply-chain-security.md`, and `docs/engineering/23-local-agent-loop-harness.md`:
  domain, quality, performance, and extension details.

## Historical or exploratory docs

- `docs/adr/`: accepted decisions that explain why a durable direction exists.
- `docs/engineering/06-implementation-plan.md`: historical phase plan. Keep it aligned
  enough to avoid false API claims, but prefer current contracts above it.
- `docs/product/12-full-product-backlog.md`: product backlog, not a promise of current
  implementation.
- `docs/architecture/20-go-backend-design.md`: Go backend design notes; keep current route
  and distribution facts accurate.
- `docs/research/26-cli-interface-concepts.md`: exploration artifact for agent CLI
  shape. It may contain rejected concepts, but its "current observed surface"
  should not contradict README, help output, or tests.
- `docs/ui-mocks/`: static product intent and visual explorations, not literal
  implementation requirements unless referenced by current UI decisions.

## Drift rules

- If a document says "current", "canonical", "normal", "default", or "only",
  verify it against implementation or tests before editing.
- If implementation changes a CLI, GraphQL field, route, security default, or
  UI workflow, update the contract doc and at least one verification surface in
  the same change.
- Keep exploration docs clearly labeled as concepts when they describe options
  that are not implemented.
- Keep historical REST examples under the removed REST section in
  `docs/contracts/03-cli-or-api-contract.md`; do not present them as current routes.
