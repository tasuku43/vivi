# Agent context

## Condensed product context

The desired tool is a simple CLI that serves a selected directory and connects the browser to a local SPA. The SPA shows a live file tree in the sidebar and a main viewer for Markdown, HTML, code, text, images, JSON, and unsupported files.

The key distinction from opening an HTML file through `file://` is that `vivi` provides a unified, live, multi-file browser interface. It should detect file changes and update content without a full page refresh. The tree should also update dynamically when files or directories are added, removed, or renamed.

## Architectural intuition

Treat the filesystem as an application model:

```text
filesystem events -> app events -> SPA state -> React render
```

React should not own filesystem watching. Server-side watcher events should update the model, and React should render the current model. Component-to-file correspondence is useful, but only for visible or expanded nodes. Do not mount a component for every file in a huge workspace.

## Performance guidance

Prefer event-first change detection:

```text
watcher event -> validate/version/hash -> update open content or tree state
```

Do not use recursive whole-directory hashing as the primary change detector. Hashes are useful as ETags, stale-update guards, and cache validation. If directory hashing is added later, use an incremental Merkle-style approach.

For MVP:

- Refetch open file content on change.
- Refetch the tree on add/remove if semantic diff is not implemented yet.
- Preserve selected path and expanded state in the client.

## Naming

The project and binary name are `vivi`.

Rationale:

- It avoids Markdown-specific naming.
- It covers directories, files, and paths.
- It expresses the concept of looking through a local lens.
- It remains valid if the viewer registry expands.

## Updated UI decision

The UI direction has been narrowed to a classic workspace with reader support and a modal search palette.

Use `docs/ui-mocks/06-classic-reader-commandk.html` as the visual target. It combines:

- classic explorer sidebar,
- open tabs,
- central rendered/source viewer,
- right H1/H2 outline and metadata inspector,
- Cmd/Ctrl + K quick open and Cmd/Ctrl + Shift + F text search overlay.

The right outline is important for Markdown reading. It should extract H1/H2 headings from the active Markdown document and provide navigable anchors in a later implementation pass.
