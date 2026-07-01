# Provider and adapter contracts

## Filesystem adapter

The filesystem adapter owns all real filesystem reads.

```ts
interface FileSystemAdapter {
  readTree(): Promise<TreeSnapshot>;
  readFile(relativePath: string): Promise<FilePayload>;
  readHtmlPreview(relativePath: string): Promise<string>;
}
```

Responsibilities:

- Resolve paths under the selected root.
- Reject root escapes.
- Apply ignore defaults.
- Return normalized relative paths.
- Attach metadata needed by the app layer.

## Watcher adapter

The watcher adapter converts platform-specific file watching into normalized events.

```ts
interface WatcherAdapter {
  start(onEvent: (event: FsEvent) => void): Promise<void>;
  stop(): Promise<void>;
}
```

Responsibilities:

- Normalize add/change/unlink events.
- Debounce event storms where appropriate.
- Avoid per-component watchers.
- Emit only paths under the root.

## Viewer classifier

The viewer classifier maps paths and metadata to UI viewer kinds.

```ts
function classifyViewer(path: string): ViewerKind;
```

This logic should be deterministic and unit tested.

## Event transport

SSE is preferred for MVP because the server only needs to push events to the SPA. WebSocket can be added later if two-way browser messages become necessary.
