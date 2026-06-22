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

## Optional performance instrumentation

Normal Vivi builds do not initialize telemetry:

```bash
npm run build:go
```

To profile large workspace CPU paths, build the opt-in binary with the `otel`
Go build tag:

```bash
npm run build:go:otel
```

The tagged binary instruments coarse operations only:

- server watch loop,
- workspace `WatchEntries`,
- Git review status refresh,
- file search,
- content search.

Each operation emits a trace span with low-cardinality attributes:
`duration_ms`, `scanned_directories`, `scanned_files`, `read_files`,
`emitted_events`, `result_count`, and `error`. Spans do not include raw file
paths, query text, or user-specific absolute workspace paths.

### Local Collector

Start the local OpenTelemetry Collector with:

```bash
mkdir -p artifacts/perf
docker compose -f docker-compose.otel.yml up
```

The collector receives OTLP on `4317` and `4318`, then writes protobuf JSON
records to:

```text
artifacts/perf/otel.jsonl
```

No Grafana, UI, or remote backend is part of the perf setup. If `vivi-otel`
starts while the collector is unavailable, it prints a warning and continues
without exporting telemetry.

### Perf Harness

Run the harness with:

```bash
npm run perf:otel
```

By default it creates a disposable synthetic workspace under
`artifacts/perf/synthetic-workspace`, starts `vivi-otel`, triggers file search,
content search, Git review refresh, and watch-loop mutations, then writes:

```text
artifacts/perf/summary.json
artifacts/perf/otel.jsonl
```

Use these environment variables for larger or existing disposable workspaces:

```bash
VIVI_PERF_DIRS=80 VIVI_PERF_FILES_PER_DIR=80 npm run perf:otel
VIVI_PERF_WORKSPACE=/path/to/disposable-workspace npm run perf:otel
```

When `VIVI_PERF_WORKSPACE` is set, the harness creates probe files in that
workspace. Use a disposable directory.

### Reading Results

Codex should start with `artifacts/perf/summary.json` because it is stable and
compact. Compare `operations.*.stats.durationMs`, scan counts, result counts,
and `artifacts.otelJsonlRecords` across runs.

Use `artifacts/perf/otel.jsonl` for lower-level span inspection. Each line is a
collector-exported OTLP JSON batch; search for `vivi.operation` values such as
`workspace.content_search` or `server.watch_loop`, then compare the numeric
attributes listed above.

## Future behavior

- Normalize tree state by path.
- Apply semantic tree events.
- Replace the bounded visible-row cap with smooth virtualization for very large trees.
- Add range controls for large-file partial loading when users need a later chunk.
- Add text diff patching only where profiling shows it matters.
