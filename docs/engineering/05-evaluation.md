# Evaluation

The evaluation system answers: does the current implementation satisfy the intended product behavior?

## Correctness

Minimum acceptable behavior:

- The initial tree includes expected supported files.
- Ignored directories are omitted by default.
- Global-config and CLI-supplied exclude globs remove matching paths from tree,
  preview, watch, search, and Git review surfaces even when the extension is
  included; both exclusion sources combine additively.
- File API rejects root escape attempts.
- Markdown files are classified as Markdown.
- HTML files are classified as HTML.
- Code files are classified as code.
- Open file content updates after a change event.

## Reliability

- Save storms are debounced or handled idempotently.
- Missing files produce clear 404 responses.
- Watcher errors are surfaced and do not crash unrelated requests.
- Tree updates do not discard selected file state unnecessarily.

## Agent usability

- A coding agent can run one validation command.
- Evals are fixture-driven and easy to extend.
- Docs explain whether a failure indicates a product regression or a contract change.

## Output contract stability

- API response shapes are covered by tests.
- E2E tests exercise real CLI/server paths where possible.
- Golden fixtures are used when response shapes become stable.

## Performance

MVP thresholds:

- Startup remains usable for small and medium directories.
- `node_modules` and `.git` are ignored by default.
- The UI does not mount a component for every hidden/collapsed descendant.

Future thresholds:

- Virtualized tree for large directories.
- Partial content loading for very large files.
- Incremental tree updates rather than full refetches.

## Human usability

- The first screen clearly shows the tree and a neutral empty viewer.
- File type handling is predictable.
- Security-sensitive behavior is visible and configurable.

## Stretch goals

- HTML iframe preview with relative asset resolution.
- Scroll-position preservation after open-file refresh.
- Syntax-highlighted source using Shiki.
- Safe lightweight Mermaid rendering in Markdown fences.
