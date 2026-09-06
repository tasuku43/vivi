# Workspace detail refinement

The user asked for app-wide UX refinement, using sidebar selection as an example.
Concept 50 A was explicitly accepted; the subsequent request to finish the
improvements authorized wiring the recommended document-centered direction from
concept 51. The HTML concepts and sidebar facade remain the design record.

## Result and evidence

| Surface            | Wired behavior                                                                                                                                                                                                                                                                   | Durable evidence                                                                                                      |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Sidebar            | One selected-row fill, quiet expanded ancestors, a small location cue when the selected descendant is collapsed; filename/H1 retained, no OPEN label or open-tab metadata line. Normal collapse is not a rendering-limit warning.                                                | `Navigation/SidebarStructure`, selection A facade, tree unit tests and real navigation E2E                            |
| Comment input      | The primary action says Save draft. Publish remains separate; keyboard save, stale anchors and resumable input remain intact.                                                                                                                                                    | `Inline Comment States/NewLineComment`, ResumableInput, StaleInputRequiresDecision; resumable-comment E2E             |
| Statusbar          | Live plus unpublished drafts/unavailable files; details open on demand. Escape restores focus, outside pointer/focus dismisses, and disconnection remains visible at compact widths.                                                                                             | `Navigation/Statusbar`, compact status E2E, workspace status unit tests                                               |
| Review Queue       | One total in the inspector tab, no duplicate total in heading/All, and one Unseen badge rather than a second dot. Draft and Changed signals remain independent.                                                                                                                  | WiredInspectorFilterInteraction, review queue unit/E2E checks                                                         |
| Reader             | No outer Markdown card/background/shadow. A dismissible first-visit tip recedes for returning readers. One native view selector keeps rendered/source navigation compact. Medium/narrow panes stack location and actions before they overlap.                                    | ReadingTipFirstVisit, NarrowMarkdownReader, CompactHtmlToolbar, source/preview/diff and input-retention E2E           |
| Search             | Basename and parent directory, full path in accessible name/tooltip; Active/Recent is not duplicated. Key hints are below results.                                                                                                                                               | QuickOpen and Actions interactions, palette unit tests and search E2E                                                 |
| Tabs               | Removed file glyph and duplicate preview badge; italic preview state, accessible description, promotion and close actions remain.                                                                                                                                                | QuietTabActions, quiet-reader E2E                                                                                     |
| Document inspector | Concise empty states; loading and unavailable change information do not claim that the document has no changes. Outline/feedback remain usable.                                                                                                                                  | QuietEmptyDocument, LoadingEmptyDocument, UnavailableChanges, DocumentNavigationInteraction                           |
| Rendered feedback  | Passive comments keep a marker without a block fill. The open/input target has a light solid wash and thin rail; range gaps paint only for that target. Markdown paragraph/list markers sit in the right margin. Both HTML adapters exclude markers from text-layer positioning. | RenderedMarkerPlacement, rendered/source/HTML thread stories, CSS contract and Go preview tests, rendered comment E2E |

## Runtime review

Inspected the real Go app at port 4332, including Markdown, HTML, the live tree,
preview tabs, search, Review Queue, both themes, and actual published feedback.
Opening and closing a paragraph thread demonstrates that only its target receives
a wash and that closing it restores normal reading. HTML review also exposed the
medium-width toolbar overlap; the resulting 600px story checks the location row,
view selector, focus, and non-overlap.

No real feedback was created, edited, deleted, published, or marked read by an
agent during verification. Theme preference was restored to System after review.
Comment creation/publication tests use isolated fixtures.

## Remaining before completion

The runtime review additionally found two reader/feedback edge cases that need
repair before closing the improvement goal:

- README's raw HTML relative image reference does not render.
- Its image-only projected comment marker does not open a thread. Text-only
  extraction returns an empty target even though the block has an image and a
  known source range.

These were repaired in the image edge-case completion below. Text-paragraph and HTML feedback flows
were verified directly, including both themes. The next pass should repair these
bounded image/anchor cases, add regression coverage, and restart the app with the
final checked binary.

## Verification of the wired refinement pass

`task check` completed successfully; the full log is
`/tmp/vivi-details-verified-check.log`.

- Storybook manifest: 157 stories across 17 files and 12 product surfaces.
- Storybook interaction tests: 87 passed, 2 pre-existing skips.
- Canonical screenshot update and verification: 87 images.
- Unit/application/adapter tests: 490 passed.
- E2E: 66 passed.
- Go tests, Storybook build, typecheck, architecture/security checks, dead-code
  checks, scaffold validation and fixture evals passed.
- `git diff --check` passed.

Earlier failures were investigated rather than suppressed: old permanent-tip,
status-group, opaque-reader and filled-passive-comment expectations were replaced
with tests for the accepted behavior. Focus checks await the component's scheduled
focus update. The unchanged public CLI tests were rerun sequentially after a
concurrent clean/build interfered with their Go shim preparation.

## Snapshot provenance

The original 81 approved baselines were backed up to
`/tmp/vivi-detail-goldens-before-wiring-20260906` before any full update in this
implementation pass. Canonical full updates added the new state coverage and
captured only the current manifest, with matching locale/timezone. The final
comparison includes facade, integrated and interaction states.

During the earlier concept-only pass, a temporary filtered snapshot wrapper
inherited the capture script's full-directory cleanup and removed existing
baselines. They were restored from tracked originals and unchanged captured
artifacts; that pass subsequently verified all 81 images. The wrapper was removed.
This implementation used a full backup and canonical updates to avoid repeating
that mistake.

### Image edge-case completion

Image-only targets now use the image's alt text (or Image) in Markdown and both
HTML bridges. Rendered Markdown resolves local image sources through the existing
raw preview transport. External/data images are unchanged.

Go and TypeScript preview resource reads permit image dependencies omitted by
the document include filter, retaining root, symlink, explicit exclusion, ignored
directory and size guards. Ordinary file reads and the tree retain their include
filter. Raw SVG responses carry a sandbox CSP with scripts disabled.

Coverage includes URL resolution, both filesystem adapters, the ImageOnlyFeedback
Storybook interaction, and Markdown/HTML E2E cases that load a local SVG, save and
publish a draft, and reopen the published feedback. All seven quiet-reader E2E
cases pass. The initial failures exposed the document include filter; after that
repair, a strict text locator was scoped to the thread because the queue also
contains the same comment. No behavior assertion was removed.

The app on port 4332 was restarted with the repaired binary. Direct browser
inspection confirmed the real README SVG is visible and its existing image-only
comment opens as a published thread; closing it returns to reading. The System
theme preference was preserved. No feedback was created, changed or published in
the real workspace during this smoke test.

### Final verification

The final `task check` completed successfully (exit 0), recorded in
`/tmp/vivi-image-complete-check.log`: 492 unit/application/adapter tests,
68 E2E tests, 88 verified screenshots, all Go tests, typecheck, lint,
architecture, dead-code, security, scaffold and eval checks, plus UI, Go and
Storybook builds. The final manifest contains 158 stories across 17 files and
12 product surfaces. Storybook interactions passed 88 cases with 2 existing
skips (`/tmp/vivi-image-fix-plays.log`). The image-only story was also inspected
in the browser. `git diff --check` passed.

The eight workspace refinements and comment highlight/image repairs in this
review are complete. Further design directions remain separate product work.
