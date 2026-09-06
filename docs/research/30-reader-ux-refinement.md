# Reader UX refinement

Status: Quiet Reader A, filename/H1 concept B, and sidebar structure mock 49 B
are approved, wired and verified. Earlier verification sections record each
historical stage.

Date: 2026-09-06.

Review artifact: [three concepts and state comparisons](../ui-mocks/47-reader-ux-refinement.html).

## Product promise

Optimize the path from reading a local document to giving an agent precise,
anchored feedback. Keep the real directory tree, document tabs, normal rendered
reading, Review Queue / Document inspector tabs, explicit draft publication,
and observation-based attention window. Do not introduce an agent inbox,
a completion workflow, or a new task-management surface.

References: product thesis and brief, ADR 17, UX acceptance criteria 18,
living-document direction 29, and mockups 40–46. Earlier generic-viewer and
resolved/reviewed explorations are historical, not new requirements.

## Walkthrough evidence

Built the current UI with `npm run build`, then ran the current Go CLI through
`go run ./cli . --port 4329 --ready-json`. Inspected the app at 1280 × 720.
Opened README through the tree, used quick open to find the product thesis,
opened a rendered paragraph composer by double-click, closed it with Escape,
and switched the inspector to Document. Existing workspace feedback was not
published, edited, or marked read. No test comment text was saved.

Observed friction:

1. The tab strip exposes five management actions continuously. With only one
   document open, its filename was already truncated to `REA…`. `OpenTabs.tsx`
   renders the action row beside the strip, and `OpenTabs.module.css` keeps the
   action group at `flex: 0 0 auto` while the strip can shrink.
2. The default sidebar and inspector consume 280 + 396 px, leaving 604 px for
   the entire center pane at 1280 px. The reader itself then has additional
   controls and padding. These defaults are in `state/workbench-layout.ts`.
3. With no active document, the main surface only says “Select a file from the
   tree.” The feedback gesture is explained inside the secondary Document
   inspector, below the outline. The primary, queue-first entry does not make
   the core double-click gesture easy to discover.
4. A new rendered comment leads with “Line 5 / Composing”. The user was reading
   a paragraph, so a short quote and section context would make the target
   more recognizable. `CodeCommentThread.tsx` owns the current line-first header.
5. The existing saved-draft/publication boundary is valuable. Improve its
   explanation rather than creating another state: writing is local, saved
   drafts are publishable, published feedback is agent-readable, and seen
   means observed, not implemented.

The above are observed layout/wording facts plus design judgments, not a user
study or a measured productivity improvement. HTML comments, persistence under
live edits, and actual publication were not exercised in this walkthrough.

An existing CSS-file feedback entry also appeared in the active queue despite
the document-only product direction. Investigate legacy-feedback projection
separately with fixtures before deciding its treatment; do not silently hide
stored feedback as visual polish. README's header image did not render in this
walkthrough; resource resolution also deserves a separate focused check.

## Concepts

- A — Quiet reader (recommended): consolidate tab management into a disclosure,
  retain visible filenames and the normal close button, compare 210 / 310 px
  initial side widths, make document search legible, and explain the core loop
  in the empty state. Tradeoff: bulk tab actions take another click. Existing
  user resize preferences must be respected.
- B — Contextual feedback: show section/quote context in the shared no-reflow
  composer, use “Save draft”, and clarify that Escape preserves input. Tradeoff:
  quotes consume space, especially in HTML; keep them bounded.
- C — Explicit handoff: clarify publication scope, saved-draft count, excluded
  unsaved input, and read receipts. Tradeoff: a persistent explanation makes the
  queue heavier. Show it when publication is actionable, avoiding duplicate
  primary actions in the final facade.

Recommendation: begin with A, then incorporate the feedback discovery from B
and publication clarity from C. The mock is a comparison, not a specification
that every proposed panel should be shown simultaneously.

## Next implementation slice

After concept selection, build a Storybook facade first. Test narrow and split
panes, one/many/duplicate/preview/changed tabs, keyboard disclosure opening,
Escape and focus return, long paths, empty startup, and light/dark contrast.
Keep tab operations' existing contracts. If a narrower default is selected,
revisit the current minimum sidebar width explicitly rather than bypassing its
clamp in CSS.

After facade approval, wire the selected changes in small slices with existing
use cases and ports. Add or update the closest Open Tabs, workspace, and comment
stories and the lab manifest. Required verification includes `task check`,
`task storybook:verify`, `task storybook:build`, and interaction tests for any
wired or facade controls.

## Concept validation

The static mock has no application or network wiring. Browser checks exercised
A/B/C selection, stale-input and disconnected wording, empty state, light/dark
selection, narrow comparison, and the tab-action disclosure. Visual inspection
covered the normal dark reader and the light narrow empty state. Actual
responsive-device behavior, pointer anchoring, and publication still require
the facade and wired-feature stages.

Verification completed for this concept pass:

- `npm run build`: passed; existing large-chunk advisory remains.
- `task storybook:verify`: passed (134 stories, 16 files, 10 surfaces).
- `task storybook:build`: passed.
- `task check`: first attempt stopped at Go dead-code analysis because the
  default Go cache was not writable in the sandbox. Re-ran with repository-local
  `GOCACHE` / `GOMODCACHE` and permission for the local test servers; the full
  check passed, including 63 existing visual baselines, 488 unit/integration
  tests, evals, frontend and Go builds, E2E, Storybook build, and Go tests.
- `node scripts/validate-scaffold.mjs`: passed separately.
- Prettier check for the new mock, this note, and mock README: passed.

These checks establish that the existing application remains healthy. They do
not establish that the proposed UX has been implemented or user-validated.

## Concept A facade (2026-09-06)

The user approved proceeding with concept A to an interactive Storybook facade.
The facade is in `ui/src/storybook/QuietReaderFacade.tsx`, with stories under
`Workspace/Quiet Reader`. Production components and application wiring remain
unchanged pending facade review.

The facade implements a compact tab menu with pointer and keyboard access,
Escape/focus return, preview promotion, existing bulk-close semantics, duplicate
basename context, fixture document search from the empty state, and a narrow
inspector disclosure. It reuses existing pure tab operations and the shared
document-reader fixture. Additional documents model duplicate and long names.
The real tree, search results, and open tabs use the same fixture paths.

Review states: single document, dense tabs, empty workspace, split documents,
800 px reader, 520 px reader, and light theme. Four interaction stories cover
tab menu keyboard access, first-document search and focus restoration, narrow
inspector opening/closing, and preserving changed tabs after promoting a preview.

The source/rendered/changes controls, comment creation, publication, watcher
updates, user resize persistence, and drag/drop between panes are outside this
facade slice. Document bodies reuse static shared content to review layout;
HTML is not connected to a real preview server. The second split pane is a
static comparison sample. Existing UI behavior remains the contract when wiring.

Facade verification:

- `task storybook:verify`: passed (145 stories, 17 files, 11 surfaces).
- `task storybook:test`: passed (75 tests; 2 existing skips). An initial search
  Escape/focus assertion failed and was fixed before the successful final run.
- `task storybook:build`: passed.
- `npm run storybook:snapshots:update`: added 11 new baselines; the existing
  63 baseline images and metadata remained byte-for-byte unchanged.
- `task check`, with repository-local Go caches: passed, including all 74
  snapshots, 488 regular tests, 69 E2E tests, evals, builds, and Go tests.
- Standalone typecheck and lint passed. An earlier standalone dead-code command
  reached the Go cache permission error; the full check above passed that gate
  with the correct cache environment.
- Prettier and `git diff --check`: passed.
- Visual QA covered normal/dense tabs, open menu, light theme, 520 px reader,
  empty workspace, and split layout. No application source was changed.

## Sidebar H1 decision — concept B

The user selected mock 48 B and asked to proceed. Keep real filenames as the
primary tree label; show the first H1 underneath. Preserve path identity,
filename order, nesting, selection, and ordinary preview/open gestures. The
Quiet Reader facade and `Workspace/Navigation Chrome/DocumentHeadings` preserve
this visual contract, including duplicate headings, long headings, no H1 and
unavailable metadata. The latter story exercises keyboard navigation and H1
replacement without moving or deselecting a file.

The canonical Go workspace now populates heading metadata only for file nodes
in the requested tree projection. Markdown is parsed with Goldmark, HTML with
the HTML tokenizer; scripts/styles/templates and HTML `<title>` do not provide
an H1. Reads are bounded to 64 KiB (or the configured smaller limit), cached
with a 1,024-entry cap, and invalidated before existing watcher notifications.
An empty heading means no H1; unavailable metadata remains distinguishable and
does not block navigation. The legacy TypeScript harness does not extract this
new optional metadata. Other Quiet Reader facade refinements remain a separate
slice from this sidebar feature.

### B implementation verification

- `task check`: passed after updating the old tooltip assertion and handling
  event-only server test instances without a workspace. Final run: 489 UI/unit
  tests, 70 E2E tests, 75 Storybook snapshots, scaffold/security/architecture/
  dead-code checks, builds, evals and all Go packages passed.
- `task storybook:verify`: 146 stories, 17 files, 11 surfaces.
- `task storybook:test`: 76 passed, 2 pre-existing skips.
- `task storybook:build`: passed.
- Browser verification: canonical Go app shows distinct H1 subtitles for root
  and nested README files; keyboard selection, long/duplicate/missing headings,
  safe text rendering and live H1 changes have durable test coverage.

## Quiet Reader A application wiring

The user asked to complete the adopted refinements. The application now uses
one tab-action disclosure, a document-search entry and first-open guidance,
210 px / 310 px initial sidebar / inspector widths, and a compact inspector
bar at widths up to 1040 px. Saved user resize preferences remain authoritative.
The actual rendered Markdown/HTML reader explains the double-click, save-draft,
and publish loop. Existing comment and publication use cases remain connected.

The tab menu preserves all five existing operations, disables unavailable
operations, closes on outside interaction, and supports arrow keys, Home/End,
Escape and focus return. Portal placement avoids clipping in the tab strip.
Tab keyboard focus is scoped to its split pane, including duplicate paths.
Narrow viewer grids and toolbar wrapping keep source/rendered/changes controls
and prose within their pane.

Evidence to audit before completion:

| Requirement                                                        | Implementation and durable verification                                                   |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| Compact tab actions, preview promotion, changed-tab preservation   | `OpenTabs.tsx`; `Navigation.stories.tsx` QuietTabActions; `test/e2e/quiet-reader.test.ts` |
| First document search and focus restoration                        | `ReaderGuidance.tsx`, `WorkbenchContainer.tsx`; ReaderFirstOpen story and real-server E2E |
| Initial widths and saved preferences                               | `workbench-layout.ts`; `test/ui-state.test.ts` and resize/reload E2E                      |
| 800 / 520 px inspector reachability, selected tab and Escape focus | `WorkbenchContainer.tsx`; compact-reader stories and real-server E2E                      |
| Narrow document and toolbar fit                                    | viewer CSS; NarrowMarkdownReader story and pane-overflow E2E                              |
| Split-pane tab operations and duplicate-path keyboard focus        | `OpenTabs.tsx`; drag-to-split E2E                                                         |
| Filename/H1 identity, fallbacks and live updates                   | DocumentHeadings story; `document-headings.test.ts`; Go heading extraction/cache tests    |
| Sidebar icons / hierarchy guides                                   | Mock 49 B; FolderIcon / TreeSidebar; SidebarStructure story and nested live-heading E2E   |

Mock 47 B/C remain alternative concepts; no approval to replace the contextual
composer or publication UI with those complete alternative layouts is implied.
The adopted A includes feedback discovery and explanation of the existing
explicit publication boundary.

### Current wired-feature verification

- `npm run test`: 490 tests passed.
- `npm run typecheck`, `npm run build`, and `npm run build:go`: passed.
- `task storybook:test`: 79 passed, 2 existing skips. The narrow-reader story
  returns to Rendered after verifying Source so the visual baseline captures
  the reading surface.
- Focused canonical Go E2E: all four Quiet Reader tests passed, including opening
  Cmd/Ctrl+K while the tab menu is open (the menu dismisses without blocking search).
- Actual browser inspection of the latest Go build confirms first-open guidance,
  full README tab labeling, H1 subtitles and the reading hint. Existing stored
  feedback was not modified or published.
- Mock 49 was inspected in the browser; width selection, theme switching and
  synchronized document selection work. It now uses only supported Markdown/HTML
  fixtures, including a heading-free document and a collapsed archive folder.
- `task check` with repository-local Go caches: passed. Final run verified all
  78 visual baselines, 490 regular tests, 74 E2E tests, evals, frontend/Go and
  Storybook builds, scaffold/security/architecture/dead-code gates and all Go
  packages. `git diff --check` also passed.
- Existing unrelated interaction snapshot fluctuations were not adopted as
  intentional changes. Their original baselines passed the final verifier.
  Among previously tracked baselines, only the intended toolbar search wording
  changed; the three wired Quiet Reader stories add new baselines.
- Subsequent decision: the user selected mock 49 B and asked to proceed.
  The final structure verification is recorded below.

## Sidebar structure — mock 49 B

The user explicitly selected folder-only icons with hierarchy guides. A shared
15 px currentColor SVG replaces folder emoji. Files retain filename, H1 and
existing attention metadata without a document icon. Thin decorative lines
follow each visible ancestor, preserving the existing bounded flat tree,
lazy loading, path identity, open/preview gestures and keyboard navigation.
Disclosure chevrons rotate with expanded state and respect reduced motion.
Tabs and search retain their existing format indicators; this decision concerns
the sidebar's structural language.

The Quiet Reader facade reflects the selected B direction. The production
SidebarStructure story exercises 210 px, three-level nesting, long H1, missing
H1, selected/changed/open files, collapse and keyboard re-expansion. The canonical
Go E2E verifies lazy-loaded nested directories, external H1 updates, and opening
the same file after collapse. Unit markup checks decorative semantics.

Final verification after mock 49 B:

- `task check`: passed with repository-local Go caches: 491 regular tests,
  75 E2E tests, 79 visual baselines, evals, typecheck, lint, architecture,
  dead-code, supply-chain policy, frontend/Go/Storybook builds and all Go packages.
- `task storybook:verify`: 150 stories across 17 files and 11 surfaces.
- `task storybook:test`: 80 passed, 2 pre-existing skips.
- `task storybook:build`: passed separately.
- Focused Quiet Reader E2E: 5 passed. The first structure-test attempt used
  a basename expectation for an existing path-based tab aria-label; corrected
  the test to preserve that public accessibility behavior, then reran successfully.
- Actual browser: inspected the 210 px three-level structure story, the light
  facade and the canonical Go application at port 4332. Folder loading, heading
  subtitles and selected file context are visibly intact. Existing feedback
  was not edited or published.
- `git diff --check`: passed. Build output retains the existing large-chunk
  advisory; no check failures remain.

Completion audit: all adopted mock 47 A, mock 48 B and mock 49 B requirements
in the table above have implementation and passing scoped evidence. No adopted
refinement remains in a facade-only state. Mock 47 B/C are unselected alternatives;
the earlier resource-image and legacy CSS-feedback observations remain separate
investigations and are not represented as solved by this UI refinement.
