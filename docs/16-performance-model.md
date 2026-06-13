# Performance model

## Recommended strategy

Use watcher events as the primary signal. Use hashes and versions as validation data, not as the main detection mechanism.

## Avoid

- Full recursive content hashing on every save.
- Rendering every node in huge trees.
- Watchers per React component.
- Replacing all UI state on every event.

## MVP acceptable behavior

- Refetch the currently open file when it changes.
- Refetch the tree on add/remove events.
- Preserve selected and expanded state in the UI.
- Bound initial sidebar expansion so large trees do not mount every descendant on first render.
- Cap rendered visible sidebar rows after large folders are expanded, while keeping selected and changed paths plus their ancestors rendered.
- Keep ancestors of selected and changed files expanded so review targets remain reachable even when the rest of a large tree is collapsed or omitted from the current render window.
- For oversized text-like files, read only a bounded leading chunk and label it as a partial preview instead of loading the whole file.

## Future behavior

- Normalize tree state by path.
- Apply semantic tree events.
- Replace the bounded visible-row cap with smooth virtualization for very large trees.
- Add range controls for large-file partial loading when users need a later chunk.
- Add text diff patching only where profiling shows it matters.
