# Living Document Review direction

Status: direction approved; Storybook facade approved; first Markdown and HTML slice in progress.

Related mockups:

- `docs/ui-mocks/39-document-only-directions.html`
- `docs/ui-mocks/40-living-document-review-states.html`

## Decision

Develop Vivi toward a document-native review surface rather than a generic
local workspace viewer.

The selected direction is **Living Document Review**:

> Vivi is where humans review agent-written documents before they ship.

Vivi should organize the human interface around document identity, structure,
rendered versions, meaningful change stops, and anchored feedback. Files and
source lines remain canonical evidence, but they stop being the primary mental
model of the interface.

This direction preserves the strongest part of the existing thesis: humans read
in a browser, coding agents act through a structured CLI, and context-rich
feedback connects the two.

## Core product job

The primary job is not diff review. A human should be able to:

1. open a document as a readable rendered artifact,
2. read it without entering a review mode,
3. comment on any reader-visible block whether or not it changed,
4. preserve and publish that feedback without losing document context,
5. let an agent retrieve the feedback without translating it into file and line
   instructions manually, and
6. return to the same document location and conversation as the document evolves.

Diff is a secondary job. When useful, the human can turn on a change lens to see
which sections changed, compare versions, and accept or comment on those changes.
The presence of a diff must not alter the default document-reading experience.

## Product boundary

### First-class documents for the first slice

- Markdown: `.md`, `.markdown`, and `.mdown`.
- HTML documents: `.html` and `.htm`, retaining the existing sandbox and script
  opt-in defaults.

MDX is not in the first slice because Vivi does not currently define or safely
execute an MDX component environment. AsciiDoc and reStructuredText are plausible
later document adapters after the core model is proven.

### Supporting resources

CSS, images, SVG, fonts, and scripts may be loaded when required to render an
HTML document. They are dependencies of the reviewed document, not independent
destinations in the document library, search results, tabs, or review queue.

An asset failure should be reported against the document that depends on it.
The user should not have to review an asset merely because Git says it changed.

### Outside the primary product

- standalone source-code review,
- JSON, YAML, CSV, TSV, and log review,
- standalone image and diagram review,
- generic binary inspection,
- repository-wide change review,
- language symbols and code-scope navigation.

Source remains available as supporting evidence for a document and its change
stops. This is not a promise that every non-document file remains openable.

### Compatibility policy

Vivi currently has one known user, so the document-only transition does not need
to preserve generic-viewer compatibility. Do not add a legacy mode, format flag,
or parallel navigation model solely to keep old viewer behavior available.

The transition should still be staged for design verification and testability:
approve the document facade, wire one complete Markdown and HTML slice, then remove
non-document product paths and their obsolete tests, stories, and contracts in
the same intentional cutover. The staging protects product understanding, not
backward compatibility.

## Performance hypothesis

Narrowing the product boundary should reduce work in four places:

1. filesystem scans return only document destinations plus required rendering
   dependencies,
2. watcher aggregation publishes document-relevant events instead of every
   workspace mutation,
3. the browser stores and reconciles a much smaller navigation tree, and
4. parsing, hashing, search indexing, and diff projection run only for supported
   documents or an opened document's required resources.

Filtering only in React would not deliver most of this benefit. The wired slice
should apply the document predicate at the server scan and watcher boundary,
then preserve the same predicate through search and document APIs.

Treat the improvement as a hypothesis until measured. Add a stable large-tree
fixture that records scanned files, returned documents, watcher event volume,
and initial document-open latency before and after the cutover.

## Core domain model

### Document

A human-readable artifact with:

- a stable document identity,
- a source path,
- a display title,
- a document kind (`markdown` or `html` initially),
- a current version,
- an ordered section tree,
- rendered content,
- zero or more change stops, and
- zero or more feedback threads.

For the first slice, document identity can be the canonical workspace path. A
future adapter may provide explicit identity in frontmatter or metadata, but
the UI should not expose path as the document's main label when a title exists.

### Document version

A content-addressed snapshot used to prevent stale review decisions and stale
comment anchoring. The existing file hash and Git diff hash can provide the
initial evidence.

A review decision applies to one document version or one change fingerprint.
New evidence returns the affected document or change stop to attention.

### Section

A reader-visible structural unit. A section has:

- a stable-in-version identifier,
- a heading and hierarchy when available,
- an ordered set of rendered blocks,
- a canonical source range,
- a rendered anchor, and
- a content fingerprint.

Markdown sections begin at headings and include their following content until
the next heading at the same or higher level. Preamble content before the first
heading is a named synthetic section.

HTML sections initially derive from `article`, `section`, and heading structure.
When no useful structure exists, the document gets one synthetic body section.

### Rendered block

A paragraph, heading, list item, code block, table row, blockquote, figure, or
similar commentable reader unit. Existing rendered comment block identities and
canonical source ranges remain useful here.

Blocks are the precise comment anchors inside a section. They should not become
the top-level navigation model.

### Change stop

The smallest unit the review workflow asks the human to judge. A change stop
belongs to one document and usually one section. It records:

- change kind,
- before and after section/block evidence,
- canonical source hunks,
- rendered presentation,
- open feedback count,
- review decision for the current fingerprint, and
- stale status when the underlying version changes.

The user navigates change stops only while the optional change lens is active.
The implementation can still derive them from line diffs and rendered blocks.

Change stops are not required for normal document comments. A comment can anchor
to any rendered block in the current document version.

## Initial semantic change vocabulary

The first slice should deliberately use a small, trustworthy vocabulary.

### 1. Section added

A new heading section or a new synthetic body section exists in the current
version. Show the rendered section in document context and keep its source hunk
available on demand.

### 2. Section removed

A previous section no longer exists. Show a ghost-rendered before view at its
former structural location. The removed content remains commentable on the
`base` side even though replies and resolutions map to the current thread
lifecycle.

This requires an intentional extension of the current diff-comment contract,
which only accepts comments on the current side. It should not be implemented
by pretending the removed content still exists in the working document.

### 3. Section changed

A section exists in both versions but one or more rendered blocks changed. Show
the current rendered section in its document context, mark the changed blocks,
and offer a before/after comparison plus source hunk as supporting evidence.

The first matcher may pair sections by normalized heading path, then compare
ordered block fingerprints. Ambiguous moves or duplicate headings should fall
back to added plus removed rather than claiming a confident move.

### Deferred vocabulary

- section moved,
- heading renamed,
- link target changed,
- code example changed,
- table schema or cell change,
- image or alt-text change,
- formatting-only change,
- inferred meaning change.

Vivi should not claim semantic understanding it cannot explain deterministically.
`Changed section` is preferable to a speculative label such as `meaning changed`.

## Main interface

### Left: filtered directory tree

The left pane preserves the selected root's real nested directory structure.
It is a spatial map, not a semantic collection generated by Vivi:

- file and directory labels come from their real names,
- directories retain their real nesting,
- only supported document destinations appear,
- directories with no supported document descendants are absent, and
- feedback or change evidence may appear as restrained metadata on a document row.

Supporting assets and non-documents are absent from navigation. Documents must
not be regrouped under labels such as `Getting started`, `Guides`, or `Needs
review` unless those are actual directory names. Search may use document titles,
but the persistent sidebar remains the real filtered directory tree.

### Center: living document

The center is first a readable rendered document. Every commentable rendered
block uses the same restrained hover treatment whether or not it changed. A
comment composer opens only on a block double-click. Single click and pointer
drag remain ordinary text-selection gestures and must not open feedback UI. The
default view does not dim unchanged content or show change rails.

When the user explicitly enables the change lens, the active change stop is shown
in place with a restrained change rail. The user can open a focused before/after
comparison or source evidence when needed. Only in this mode may unchanged
document context visually recede.

### Right: document review map

The right pane describes the current document, not the whole repository. Its
default order is:

- section outline,
- open feedback and local drafts,
- source/path details behind disclosure.

When the change lens is active, an ordered change map may appear above the
outline. It should disappear again when the user returns to normal reading.

### Navigation

Primary navigation is:

- open document by title,
- search document content, and
- jump to open feedback.

Secondary change navigation is next/previous changed document and next/previous
change stop. It is available only when the user asks to inspect changes.

Repository-oriented file and review shortcuts should not remain as hidden
legacy concepts with document labels painted over them.

## Orthogonal interface state

The interface should not collapse reading, feedback, and diff into one review
state machine. Keep three independent axes:

- document surface: `rendered` or `source`,
- feedback interaction: `idle`, `input`, `draft`, or `thread`,
- change lens: `off` or `on`.

This allows, for example, a rendered document with an open comment composer and
no diff, or the same document with changes visible and an existing thread.

## Optional change-review state model

A change stop is one of:

- `needs-review`: current fingerprint has no review decision,
- `in-discussion`: it has an open published thread or saved pending draft,
- `reviewed`: its current fingerprint is accepted or all review conversation
  was resolved,
- `stale`: its evidence changed after review or while feedback input existed.

A document derives its attention state from its stops:

- any stale stop -> `updated`,
- otherwise any in-discussion stop -> `in-discussion`,
- otherwise any needs-review stop -> `needs-review`,
- otherwise -> `reviewed`.

`Reviewed` remains fingerprint-scoped, not a durable editorial approval or Git
operation.

## Feedback contract

Human-facing feedback should identify:

- document title,
- section heading path,
- rendered quote or block,
- document version,
- change kind and side when reviewing a diff, and
- canonical source path/range for the agent.

The CLI should continue to expose exact path and line evidence because agents
need deterministic targets. It may add document and section labels, but existing
thread identity and lifecycle should remain stable through the transition.

## First vertical slice

The first implementation slice must include both Markdown and HTML. The product
boundary is documents, not Markdown alone, and format parity is part of the
initial vertical slice.

1. Derive a document title and H1/H2 section tree for Markdown and HTML.
2. Filter the real directory tree to Markdown and HTML documents without changing the
   default rendered reading and commenting loop.
3. Preserve comment creation on any rendered block, source projection, drafts,
   publish, replies, and stale-anchor recovery.
4. Add an explicit change-lens toggle that is off by default.
5. Group the existing HEAD diff into `section-added`, `section-removed`, and
   `section-changed` stops only when that lens is active.
6. Preserve source hunk access and existing rendered/source comment anchors.
7. Record fingerprint-scoped review decisions per change stop without treating
   those decisions as a prerequisite for ordinary document reading.

Markdown and HTML ship as the two required document adapters. Once the approved
facade is wired end to end, remove generic viewers as a clean product cutover;
no compatibility layer or legacy mode is required.

## Evidence required before wiring

- Static concept states for added, removed, changed, reviewed, stale, and empty
  document review.
- A Storybook facade with document-shaped fixtures, comment-anywhere interaction,
  and an optional Changes lens.
- Domain tests for section extraction, deterministic matching, change-stop
  projection, document attention derivation, and stale fingerprints.
- Fixture-driven evals showing Markdown and HTML before/after pairs and expected
  change stops.
- An E2E path from changed document -> rendered stop -> feedback -> agent CLI.

## Open decisions

1. Whether a file with no heading is one synthetic document section or a stream
   of paragraph stops.
2. Whether accepting a whole document creates decisions for every current stop
   or one document-level decision.
3. Whether removed-side comments are required in the first slice or should be
   view-only until the comment contract is extended safely.
4. Whether HTML document identity should prefer `<title>`, first `<h1>`, or an
   explicit adapter rule.
5. Whether the public name remains Vivi or gains a clarifying descriptor such
   as “Vivi Docs.”
