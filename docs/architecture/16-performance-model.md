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
- Use platform watcher events as the default change signal, with recursive scans
  limited to startup reconciliation, focused new-directory reconciliation, and
  watcher-error recovery. Recursive polling is a degraded fallback only.
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
`emitted_events`, `result_count`, and `error`. When the `otel` build is active
and export is enabled, the same span also includes process resource deltas:
`cpu_user_ms`, `cpu_system_ms`, `cpu_total_ms`, `cpu_percent`,
`memory_heap_alloc_bytes`, `memory_heap_alloc_delta_bytes`,
`memory_rss_max_bytes`, `memory_rss_max_delta_bytes`,
`memory_total_alloc_delta_bytes`, `memory_mallocs_delta`,
`memory_frees_delta`, `memory_num_gc`, and `goroutines`.

`cpu_percent` is process CPU time divided by wall time, so 100 is roughly one
fully used logical core during that operation and values above 100 mean the
process used more than one core. `memory_rss_max_bytes` comes from process
resource usage and is a high-water mark, not a current RSS gauge.

Normal builds do not sample CPU or memory. `StartOperation` is a no-op unless
the `otel` build has initialized export, so the default CLI/server hot paths do
not pay `runtime.ReadMemStats` or `getrusage` costs.

Spans do not include raw file paths, query text, or user-specific absolute
workspace paths.

### Local Collector

Start the local OpenTelemetry Collector with:

```bash
mkdir -p artifacts/perf
docker compose -f docker-compose.otel.yml up
```

The collector receives OTLP on standard ports inside the container and maps
them to host ports `24317` (gRPC) and `24318` (HTTP) to avoid collisions with
local Vivi/dev-server ports. It writes protobuf JSON records to:

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
`artifacts/perf/synthetic-workspace`, starts `vivi-otel`, and measures idle
watching, one file-change probe, Git review refresh, filename search, and
content search as separate scenarios. It also launches a headless browser for a
front-end workspace smoke path, samples the server process RSS/CPU with `ps`,
runs the review CLI repeatedly against the local server, and can apply a burst
of temporary workspace changes. The idle scenario records both whole-process
startup cost and a separate `steadyServer` sample after `/events` reports
watcher readiness. Burst writes are measured concurrently with SSE reading so
first-event latency is not hidden behind the write loop. The
`coding_agent_storm` scenario simulates a coding agent rewriting files as fast
as the host filesystem accepts them: it creates a temporary directory, gives the
watcher a short `VIVI_PERF_AGENT_STORM_PRIME_MS` window to attach to that new
directory, performs many immediate writes/renames/appends, reads SSE
concurrently, and reports missing expected paths plus a `stormServer` CPU/RSS
window that starts when the write action starts. It writes:

```text
artifacts/perf/summary.json
artifacts/perf/otel.jsonl
```

Use these environment variables for larger or existing disposable workspaces:

```bash
VIVI_PERF_DIRS=80 VIVI_PERF_FILES_PER_DIR=80 npm run perf:otel
VIVI_PERF_WORKSPACE=/path/to/disposable-workspace npm run perf:otel
```

When `VIVI_PERF_WORKSPACE` is set, the harness does not initialize Git or add
review fixtures. The file-change scenario creates one temporary root-level
probe file and removes it before exiting, so real repositories can be measured
without leaving perf files behind.

Useful knobs:

```bash
VIVI_PERF_CLI_ITERATIONS=10 npm run perf:otel
VIVI_PERF_BURST_CHANGES=100 VIVI_PERF_BURST_DELAY_MS=10 npm run perf:otel
VIVI_PERF_AGENT_STORM_OPS=300 VIVI_PERF_AGENT_STORM_FILES=60 npm run perf:otel
VIVI_PERF_SKIP_BUILD=1 npm run perf:otel
```

Use `VIVI_PERF_RUN_NAME=<name>` to keep a named copy of the summary at:

```text
artifacts/perf/<name>.summary.json
```

### Current CLI measurement

The current harness uses schema version 4 and measures `cli_inbox` with
`vivi inbox <url>`. Its budget is configured by `VIVI_PERF_MAX_CLI_INBOX_MS`.
The synthetic workspace starts with an empty feedback inbox; published feedback
and read receipts are covered by the agent-loop and browser E2E tests.
Historical `cli_review_queue` measurements below belong to the removed command
and are not directly comparable to inbox latency.

### GitHub Actions performance gate

The `Performance` workflow runs the harness on GitHub Actions for pull requests
and pushes to `main`. It uses a small synthetic workspace profile so the job is
cheap enough for routine CI while still exercising the server watcher, browser
workspace smoke path, passive inbox CLI, search paths, burst writes, and coding-agent
storm scenario.

The CI job runs:

```bash
npm run perf:otel
npm run perf:verify
```

`npm run perf:verify` reads `artifacts/perf/summary.json` and fails the job if
the harness reports scenario errors, misses expected watcher events, exceeds the
configured latency/runtime budgets, or uses a non-synthetic workspace when
`VIVI_PERF_REQUIRE_SYNTHETIC=1` is set. The workflow always uploads
`artifacts/perf` as a run artifact so regressions can be inspected from the
summary and raw OTLP JSONL output.

The default Actions profile is intentionally a regression gate, not a production
benchmark. Use the manual `workflow_dispatch` `large` profile for a heavier
synthetic run, and continue to use local `VIVI_PERF_WORKSPACE=...` runs for
linux-scale repository measurements where GitHub-hosted runner noise would make
hard thresholds misleading.

### Reading Results

Codex should start with `artifacts/perf/summary.json` because it is stable and
compact. Compare `operations.*.stats.durationMs`, scan counts, result counts,
and `artifacts.otelJsonlRecords` across runs.

Use `artifacts/perf/otel.jsonl` for lower-level span inspection. Each line is a
collector-exported OTLP JSON batch; search for `vivi.operation` values such as
`workspace.content_search` or `server.watch_loop`, then compare the numeric
attributes listed above.

### Baseline: linux workspace on 2026-06-27

Baseline command:

```bash
docker compose -f docker-compose.otel.yml up -d
VIVI_PERF_RUN_NAME=linux-baseline-2026-06-27 \
  VIVI_PERF_WORKSPACE=/Users/tasuku/work/github.com/torvalds/linux \
  VIVI_PERF_IDLE_MS=3500 \
  VIVI_PERF_BURST_CHANGES=30 \
  VIVI_PERF_BURST_DELAY_MS=20 \
  VIVI_PERF_CLI_ITERATIONS=5 \
  npm run perf:otel
```

Artifacts:

- `artifacts/perf/linux-baseline-2026-06-27.summary.json`
- `artifacts/perf/summary.json`
- `artifacts/perf/otel.jsonl`

Workspace shape: `/Users/tasuku/work/github.com/torvalds/linux`, 6,142
directories and 93,609 files counted by the harness, with Git available. The
full run took 35.8s and reported no scenario errors.

Front-end baseline:

| Scenario | User path | JS heap used | JS heap total | Script | Layout | Task | DOM nodes |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `front_workspace` after load | `Makefile` | 40.2 MB | 90.5 MB | 583 ms | 57 ms | 694 ms | 14,744 |
| `front_workspace` after Cmd/Ctrl+K open/close | `Makefile` | 45.3 MB | 102.8 MB | 966 ms | 57 ms | 1,090 ms | 14,802 |

CLI baseline:

| Scenario | Iterations | Total wall time | Exit codes | CLI max RSS | CLI avg CPU sample | CLI CPU time |
| --- | ---: | ---: | --- | ---: | ---: | ---: |
| `cli_review_queue` | 5 | 1,703 ms | `0: 5` | 16.7 MB | 1.9% | 10 ms avg |

Server process baseline:

| Scenario | Max RSS | Max sampled CPU | Server CPU time delta |
| --- | ---: | ---: | ---: |
| `idle_watch` | 75.6 MB | 112.4% | 3,040 ms |
| `front_workspace` | 39.7 MB | 76.7% | 1,260 ms |
| `cli_review_queue` | 49.5 MB | 101.5% | 1,680 ms |
| `git_review` | 28.0 MB | 61.2% | 330 ms |
| `file_search` | 105.0 MB | 212.9% | 3,680 ms |
| `content_search` | 72.7 MB | 225.9% | 6,080 ms |
| `file_change` | 76.2 MB | 114.1% | 3,580 ms |
| `change_burst` | 76.8 MB | 112.7% | 3,610 ms |

Operation baseline from OTel spans:

| Scenario | Operation | Count | Avg duration | Max duration | Avg CPU time | Avg CPU% | Avg heap delta | Avg total alloc | Max RSS | Avg scanned files | Avg read files | Events |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `idle_watch` | `workspace.watch_entries` | 2 | 1,361.5 ms | 1,420 ms | 1,528.5 ms | 112.4% | 16.2 MB | 470.3 MB | 75.6 MB | 93,696 | 0 | 0 |
| `idle_watch` | `server.watch_loop` | 1 | 1,324 ms | 1,324 ms | 1,526 ms | 115.3% | 7.2 MB | 470.3 MB | 75.6 MB | 93,696 | 0 | 0 |
| `git_review` | `git.review_status_refresh` | 1 | 304 ms | 304 ms | 294 ms | 96.7% | 1.7 MB | 75.3 MB | 27.8 MB | 0 | 0 | 0 |
| `file_search` | `workspace.file_search` | 3 | 598.7 ms | 1,769 ms | 1,248.3 ms | 138.8% | 18.3 MB | 330.3 MB | 105.0 MB | 31,232 | 0 | 0 |
| `content_search` | `workspace.content_search` | 3 | 1,133.7 ms | 2,045 ms | 2,068.3 ms | 195.8% | 9.0 MB | 613.3 MB | 72.7 MB | 19,316 | 10,187 | 0 |
| `file_change` | `server.watch_loop` | 2 | 1,336 ms | 1,336 ms | 1,528 ms | 114.4% | 15.3 MB | 470.5 MB | 79.6 MB | 93,696.5 | 0 | 2 |
| `change_burst` | `server.watch_loop` | 2 | 1,517.5 ms | 1,694 ms | 1,599.5 ms | 106.3% | 11.4 MB | 470.6 MB | 79.4 MB | 93,726 | 0 | 31 |

Watcher event latency:

| Scenario | Changes | Observed | First event | Last event |
| --- | ---: | ---: | ---: | ---: |
| `file_change` | 1 | 1 | 3,545 ms | 3,545 ms |
| `change_burst` | 30 | 30 | 3,505 ms | 3,513 ms |

Baseline interpretation:

- Large linux watch scans are the dominant background cost: each scan visits
  about 93.7k files, allocates about 470 MB total, and takes 1.3-1.7s.
- Filename search is cheap after the first query because the in-process file
  index is cached; the first query still performs a full tree walk.
- Content search is CPU-bound and allocation-heavy because it reads thousands
  of text-like files per query.
- The current polling watcher explains the 3.5s observed event latency under
  linux-scale trees. The latency is bounded by scan duration plus backoff timing,
  not by SSE delivery after the scan completes.

### Platform watcher slice: linux workspace on 2026-06-27

Implementation slice:

- Added a Go server watcher adapter backed by platform filesystem events
  (`fsnotify`).
- Kept `workspace.FS` responsible for root containment, ignores, inclusion, and
  single-path watch metadata.
- Kept SSE and GraphQL workspace event contracts unchanged, but delayed the
  initial `connected` marker until startup reconciliation and directory watch
  registration complete.
- Replaced per-event recursive scans with single-path metadata checks. New
  directories use focused subtree reconciliation so files created before a watch
  is attached are still observed.
- Full recursive scans now run at startup and on watcher-error recovery; polling
  remains only as a degraded fallback if the platform watcher cannot start.

Measurement command:

```bash
docker compose -f docker-compose.otel.yml up -d
VIVI_PERF_RUN_NAME=linux-platform-watch-final2-2026-06-27 \
  VIVI_PERF_WORKSPACE=/Users/tasuku/work/github.com/torvalds/linux \
  VIVI_PERF_IDLE_MS=3500 \
  VIVI_PERF_BURST_CHANGES=30 \
  VIVI_PERF_BURST_DELAY_MS=20 \
  VIVI_PERF_CLI_ITERATIONS=5 \
  npm run perf:otel
```

Coding-agent storm measurement command:

```bash
VIVI_PERF_RUN_NAME=linux-agent-storm-final-2026-06-27 \
  VIVI_PERF_WORKSPACE=/Users/tasuku/work/github.com/torvalds/linux \
  VIVI_PERF_IDLE_MS=3500 \
  VIVI_PERF_BURST_CHANGES=30 \
  VIVI_PERF_BURST_DELAY_MS=20 \
  VIVI_PERF_AGENT_STORM_OPS=300 \
  VIVI_PERF_AGENT_STORM_FILES=60 \
  VIVI_PERF_AGENT_STORM_DELAY_MS=0 \
  VIVI_PERF_CLI_ITERATIONS=5 \
  npm run perf:otel
```

Artifacts:

- `artifacts/perf/linux-platform-watch-final2-2026-06-27.summary.json`
- `artifacts/perf/linux-agent-storm-final-2026-06-27.summary.json`
- `artifacts/perf/summary.json`
- `artifacts/perf/otel.jsonl`

Workspace shape remained 6,142 directories and 93,609 files. The full run took
39.4s for `linux-platform-watch-final2-2026-06-27`; the follow-up storm run
took 48.9s. Both reported no scenario errors.

Key deltas versus `linux-baseline-2026-06-27`:

| Scenario | Baseline | Platform watcher slice | Delta |
| --- | ---: | ---: | --- |
| `idle_watch` recursive watch scans | 2 `workspace.watch_entries` spans | 1 startup span | No recurring idle scan during the scenario. |
| `idle_watch` steady CPU time | Not separately measured | 0 ms over 3.3s | Steady idle window showed 0.0% CPU by process CPU time. |
| `file_change` observed latency | 3,545 ms | 1 ms | Event path is platform event + single-path stat. |
| `file_change` server watch-loop scans | 2 full scans | 1 startup scan | The file event did not trigger a full scan. |
| `file_change` `server.watch_event` avg duration | n/a | 27 ms | 2 events, 0 scanned files, 3.1 MB avg allocation. |
| `change_burst` observed files | 30 / 30 | 30 / 30 | No dropped events under the measured burst. |
| `change_burst` first / last observed latency | 3,505 / 3,513 ms | 1 / 636 ms | Concurrent SSE reading shows first event immediately and final event within the 1.5s target. |
| `change_burst` write action duration | Not separately measured | 657 ms | Last event tracked the actual 30-file write loop rather than a later polling scan. |
| `change_burst` `server.watch_event` avg duration | n/a | 1.8 ms | 33 platform events, 0 scanned files, 0.5 MB avg allocation. |
| `change_burst` server max RSS | 76.8 MB | 94.6 MB | Still under the 150 MB target; added directory watches and event state raise RSS. |
| `coding_agent_storm` expected paths | n/a | 60 / 60 | 300 immediate writes/renames/appends across 60 files observed without missing expected paths. |
| `coding_agent_storm` first / last observed latency | n/a | 17 / 104 ms | The event stream kept up with a 17 ms write action. |
| `coding_agent_storm` storm CPU time | n/a | 10 ms over 1.758s | Startup reconciliation excluded; process CPU time was 0.57% in the storm-and-settle window. |
| `coding_agent_storm` server RSS | n/a | 118.6 MB max | Still under the 150 MB target during rapid writes. |
| `cli_review_queue` total wall time | 1,703 ms | 1,500 ms | No regression on the CLI review path. |
| `file_search` server max RSS | 105.0 MB | 101.8 MB | No watcher-related regression observed. |

Operation-level comparison:

| Scenario | Operation | Baseline count / avg duration / avg scanned files | Platform watcher count / avg duration / avg scanned files |
| --- | --- | ---: | ---: |
| `idle_watch` | `workspace.watch_entries` | 2 / 1,361.5 ms / 93,696 | 1 / 1,565 ms / 93,696 |
| `file_change` | `server.watch_loop` | 2 / 1,336 ms / 93,696.5 | 1 / 1,309 ms / 93,696 |
| `file_change` | `server.watch_event` | n/a | 2 / 27 ms / 0 |
| `change_burst` | `server.watch_loop` | 2 / 1,517.5 ms / 93,726 | 2 / 680 ms / 46,848 |
| `change_burst` | `server.watch_event` | n/a | 33 / 1.8 ms / 0 |
| `coding_agent_storm` | `server.watch_loop` | n/a | 2 / 740 ms / 46,849.5 |
| `coding_agent_storm` | `server.watch_event` | n/a | 135 / 1.326 ms / 0 |

Interpretation:

- The largest user-visible gap moved: ordinary file-change latency dropped from
  polling-scale seconds to effectively immediate SSE delivery.
- Idle still pays one startup reconciliation per server process. The updated
  harness separates startup from steady idle: after watcher readiness, the
  3.3s steady idle window consumed 0 ms of process CPU time.
- Burst latency now meets the MVP target in the measured 30-file case: first
  event was observed in 1 ms and final event in 636 ms. The 636 ms final latency
  tracks the 657 ms write action rather than a later recursive polling scan.
- Coding-agent style rapid writes are now part of the measurement model. In the
  measured 300-operation storm, all 60 expected file paths were observed, first
  and last event latency were 17 ms and 104 ms, and the storm-and-settle CPU
  window consumed 10 ms of server CPU time over 1.758s. This answers the
  previous blind spot where only idle and slower burst writes were measured.
- The two `coding_agent_storm` `server.watch_loop` spans are startup
  reconciliation plus the focused new-directory reconciliation. The 135
  `server.watch_event` spans handled the rapid file events with 0 scanned
  files, so the storm did not degrade into per-file recursive scans.
- Watcher state updates must remain in-place. A previous draft cloned the
  100k-entry watch map per event and pushed burst RSS above the target; the
  measured slice keeps platform events near 0.5 MB average allocation.

### Review queue state UI check on 2026-06-27

After the review queue language and inspector simplification slice, the same
linux-scale harness was run with the coding-agent storm scenario enabled:

```bash
docker compose -f docker-compose.otel.yml up -d
VIVI_PERF_RUN_NAME=linux-review-queue-state-2026-06-27 \
  VIVI_PERF_WORKSPACE=/Users/tasuku/work/github.com/torvalds/linux \
  VIVI_PERF_IDLE_MS=3500 \
  VIVI_PERF_BURST_CHANGES=30 \
  VIVI_PERF_BURST_DELAY_MS=20 \
  VIVI_PERF_AGENT_STORM_OPS=300 \
  VIVI_PERF_AGENT_STORM_FILES=60 \
  VIVI_PERF_AGENT_STORM_DELAY_MS=0 \
  VIVI_PERF_CLI_ITERATIONS=5 \
  npm run perf:otel
```

Artifact:

- `artifacts/perf/linux-review-queue-state-2026-06-27.summary.json`

The measured workspace shape stayed at 6,142 directories and 93,609 files, and
the run reported no scenario errors.

Key values versus `linux-agent-storm-final-2026-06-27`:

| Metric | Previous final | Review-state slice | Target posture |
| --- | ---: | ---: | --- |
| `idle_watch` steady CPU time | 0 ms over 3.3s | 10 ms over 3.27s | 0.306% average, under 5% target. |
| `idle_watch` steady RSS max | 97.7 MB | 95.4 MB | Under 150 MB target. |
| `front_workspace` after-load JS heap | 31.6 MB | 30.7 MB | Under 80 MB target. |
| `front_workspace` after-load script / task | 575 ms / 683 ms | 485 ms / 588 ms | No regression observed. |
| `front_workspace` after-interaction JS heap | 17.7 MB | 21.0 MB | Under 120 MB target. |
| `front_workspace` after-interaction script / task | 947 ms / 1,068 ms | 1,078 ms / 1,190 ms | Slightly higher; still bounded for this slice. |
| `change_burst` observed paths | 30 / 30 | 30 / 30 | No dropped events. |
| `change_burst` first / last event | 1 ms / 618 ms | 1 ms / 639 ms | Under 1.5s final-event target. |
| `coding_agent_storm` observed paths | 60 / 60 | 60 / 60 | No missing expected paths. |
| `coding_agent_storm` first / last event | 17 ms / 104 ms | 20 ms / 109 ms | Under 1.5s final-event target. |
| `coding_agent_storm` storm CPU time | 10 ms over 1.758s | 20 ms over 1.763s | 1.134% average, under 5% target. |
| `coding_agent_storm` storm RSS max | 113.1 MB | 109.9 MB | Under 150 MB target. |

Interpretation: the review-state UI slice did not regress the watcher CPU
targets. Removing the hidden Threads and Map inspector DOM reduced the active
inspector render surface; the front-end after-load path was slightly lighter,
while the command-palette interaction window was modestly higher and should
continue to be watched in future UI-heavy slices.

### Chrome Render Helper regression check on 2026-07-01

Regression symptom: opening the linux workspace in Chrome or the in-app browser
could leave the renderer process near one full CPU core after the page appeared
idle.

Root cause: the Review Queue unread-path synchronization returned a fresh array
on every render even when the path list was unchanged. That changed the
`unreadReviewPathSet` dependency, rebuilt review items, and retriggered the
same effect, producing a React render loop without any visible animation.

Fix slice:

- extracted unread review path synchronization into a stable state helper,
- kept the previous array reference when synchronized paths are unchanged,
- added a UI state test that asserts unchanged review items preserve the same
  unread path array reference.

Manual Chrome check on `/Users/tasuku/work/github.com/torvalds/linux`:

| Check | Before fix | After fix |
| --- | ---: | ---: |
| Idle Chrome renderer after opening `Makefile` | 40-100% CPU after 20s | 0% after 20s, with brief 5-7% Git-poll blips |
| 300-operation manual write storm | not applicable | transient 74% renderer peak, then back to 0-10% within a few seconds |

Harness command:

```bash
VIVI_PERF_RUN_NAME=linux-render-helper-fix-2026-07-01 \
  VIVI_PERF_WORKSPACE=/Users/tasuku/work/github.com/torvalds/linux \
  VIVI_PERF_IDLE_MS=3500 \
  VIVI_PERF_BURST_CHANGES=30 \
  VIVI_PERF_BURST_DELAY_MS=20 \
  VIVI_PERF_AGENT_STORM_OPS=300 \
  VIVI_PERF_AGENT_STORM_FILES=60 \
  VIVI_PERF_AGENT_STORM_DELAY_MS=0 \
  VIVI_PERF_CLI_ITERATIONS=5 \
  npm run perf:otel
```

Artifact:

- `artifacts/perf/linux-render-helper-fix-2026-07-01.summary.json`

Key harness values:

| Scenario | Value |
| --- | ---: |
| `front_workspace` after-load JS heap / script / task | 7.0 MB / 41 ms / 126 ms |
| `front_workspace` after-interaction JS heap / script / task | 12.3 MB / 86 ms / 195 ms |
| `idle_watch` steady CPU time | 0 ms over 3.266s |
| `change_burst` observed / first / last event | 30 of 30 / 1 ms / 629 ms |
| `coding_agent_storm` observed / first / last event | 60 of 60 / 16 ms / 133 ms |
| `coding_agent_storm` storm CPU time | 30 ms over 1.750s |

### Workspace traversal optimization on 2026-09-27

The current linux-scale baseline and final run used the same workspace and
harness settings:

```bash
VIVI_PERF_WORKSPACE=/Users/tasuku/work/github.com/torvalds/linux \
  VIVI_PERF_IDLE_MS=3500 \
  VIVI_PERF_BURST_CHANGES=30 \
  VIVI_PERF_BURST_DELAY_MS=20 \
  VIVI_PERF_CLI_ITERATIONS=5 \
  npm run perf:otel
```

Artifacts:

- `artifacts/perf/optimization-before-20260927.summary.json`
- `artifacts/perf/optimization-before-20260927.otel.jsonl`
- `artifacts/perf/optimization-final-20260927.summary.json`
- `artifacts/perf/optimization-final-20260927.otel.jsonl`
- `artifacts/perf/optimization-repeat-20260927.summary.json`
- `artifacts/perf/optimization-repeat-20260927.otel.jsonl`

The harness reports 6,142 directories and 93,609 files in this workspace.
Each content-search query scanned 93,696 files and read 8 files under the
current default extension allow-list. The historical June content-search row
read 10,187 files, so its read count is not directly comparable to this run;
the before/after rows below are comparable with each other.
The workspace is the Torvalds Linux source tree; these measurements ran on
macOS arm64 with Go 1.26.7, not on a Linux host.

| Measurement | Before | Final | Change |
| --- | ---: | ---: | ---: |
| Startup `server.watch_loop` duration | 1,048 ms | 249 ms | -76% |
| Startup total allocation | 508.5 MB | 66.6 MB | -87% |
| Startup RSS high-water mark | 27.8 MB | 26.4 MB | -5% |
| Idle watcher-ready time | 2,656 ms | 1,842 ms | -31% |
| `workspace.content_search` duration per query | 1,355 ms | 300 ms | -78% |
| Content-search CPU time per query | 2,714 ms | 628 ms | -77% |
| Content-search CPU percent | 198.8% | 209.7% | +11 points |
| Content-search total allocation per query | 726.1 MB | 105.6 MB | -85% |
| Content-search heap delta per query | 9.57 MB | 5.12 MB | -46% |
| Content-search RSS high-water mark | 92.1 MB | 50.6 MB | -45% |
| Content-search files read / scanned | 8 / 93,696 | 8 / 93,696 | unchanged |
| `change_burst` paths observed | 30 / 30 | 30 / 30 | unchanged |
| Coding-agent storm paths observed | 48 / 60 | 47 / 60 | -1 path |
| Coding-agent storm last event | 189 ms | 185 ms | -2% |
| Coding-agent storm CPU / RSS max | 10 ms / 81.3 MB | 40 ms / 78.5 MB | within target |

A repeat of the final run observed 48/60 coding-agent storm paths, with a
183 ms last-event latency, 40 ms CPU over 1.766 s (2.27%), and 78.6 MB max
RSS. The one-path difference in the first final run did not repeat, but the
48/60 result still misses the 60/60 acceptance target.

The primary cost was path traversal, not disk parallelism: the previous walk
normalized and resolved every generated path, evaluated symlinks and statted
entries, sorted results that `os.ReadDir` already returns in name order, and
allocated segment slices while checking ignored and excluded paths. Search
then called `ReadFile` for each candidate, adding whole-file bytes, a hash,
UTF-8 validation/string conversion, split-line state, and lowercased copies.
The new walk uses directory-entry metadata, performs explicit containment
resolution for symlinks and search reads, avoids redundant sorting and path
normalization, and checks ignore/exclude patterns without per-path segment
arrays. Content search now reads sequentially through one reusable buffered
reader and avoids lowercased line copies for ASCII-only query/line pairs; it
retains only matching line strings.

The current default include list means these measured search queries read only
8 Markdown/HTML candidates, so this run primarily measures the traversal
improvement. The scanner's long-line, CRLF, UTF-8, BOM, and binary-file
semantics are covered by workspace tests. No persistent content index or
parallel disk reads were added.

A supplemental direct OTel run used an explicit code/document include list
(`c,h,cpp,hpp,rs,py,sh,yml,yaml,md,markdown,mdown,html,htm,json,jsonc,txt,log`)
with the same three queries and limit 20. It averaged 10,178 reads and 23,999
scanned files, close to the historical 10,187 reads. Against the June historical
row, duration was 620 ms versus 1,134 ms, CPU was 543 ms versus 2,068 ms,
total allocation was 71.0 MB versus 613.3 MB, and heap delta was 0.61 MB versus
9.0 MB. CPU percent was 92.3% versus 195.8%. The broad include also made the
watcher retain 72,831 file entries, and process RSS high-water reached 145 MB
versus the historical 72.7 MB; that RSS comparison includes the larger watcher
map and remains close to Vivi's 150 MB ceiling. Raw spans are in
`artifacts/perf/optimization-final-broad-include-20260927.otel.jsonl`.

### Reusing an existing filename metadata index on 2026-09-27

Cold text search still spends about 300 ms walking the 6,142 directories and
93,696 visible files even though only 8 files match the default include list.
The normal harness intentionally starts each scenario in a separate server,
so its filename-search cache cannot warm the content-search scenario. The
harness now has an opt-in focused mode to measure the real warm-cache case:

```bash
VIVI_PERF_WORKSPACE=/Users/tasuku/work/github.com/torvalds/linux \
  VIVI_PERF_ONLY_SCENARIO=content_search \
  VIVI_PERF_PRIME_CONTENT_SEARCH_INDEX=1 \
  npm run perf:otel
```

Both runs first called the existing `fileSearch` operation in the same server
to build its metadata cache (327 ms before, 334 ms after; one scan of 93,696
files per run). The
before build forced `SearchText` to keep walking despite that cache; the after
build reused its immutable path/metadata slice and still opened and scanned
the current contents of matching files. The index is only reused when another
existing feature has already created it; cold text search does not create or
retain an index.

| Warm content search metric, average per query | Before reuse | After reuse |
| --- | ---: | ---: |
| Duration | 302 ms | <1 ms (0 ms at harness precision) |
| CPU time / CPU percent | 630 ms / 208.7% | 1 ms / 0% (rounded) |
| Total allocation | 90.2 MB | 0.112 MB |
| Heap delta | 9.47 MB | 0.112 MB |
| RSS high-water mark | 57.2 MB | 29.7 MB |
| Read / scanned files | 8 / 93,696 | 8 / 0 |
| Cached queries | 0 / 3 | 3 / 3 |

The file-search warmup itself still pays its existing 334 ms scan and about
130.6 MB total allocation. Reusing that already-built metadata removes the
repeated traversal from later text queries without adding another index or
caching file contents. The ordinary cold run after this change remained near
the previous final result: 311 ms/query, 651 ms CPU, 105.5 MB allocation,
5.62 MB heap delta, 50.1 MB RSS, 93,696 files scanned, and 8 files read.

An experiment that made the first text query build and retain the metadata
index was rejected. With the broad 10k-read include list it raised RSS
high-water to 166.4 MB, above the 150 MB target, compared with 145 MB for the
cold search. The retained implementation only uses an index that an existing
filename search has already created. A specialized walker prototype that
changed candidate path construction also failed to improve the three-query
cold measurement (926 ms before, 952 ms after) and was reverted.

The full harness was rerun after this change. Startup reconciliation measured
255 ms, 66.6 MB total allocation, and 27.1 MB RSS versus 249 ms, 66.6 MB, and
26.4 MB in the prior final run. The change burst remained 30/30. The
coding-agent storm remained 47/60 with 184 ms last-event latency, 40 ms CPU
over 1.767 s, and 78.2 MB maximum RSS; it still misses the 60/60 path target
and is not a new regression from this search-only change. Artifacts:

- `artifacts/perf/optimization-existing-index-before-20260927.summary.json`
- `artifacts/perf/optimization-existing-index-before-20260927.otel.jsonl`
- `artifacts/perf/optimization-existing-index-after-20260927.summary.json`
- `artifacts/perf/optimization-existing-index-after-20260927.otel.jsonl`
- `artifacts/perf/optimization-post-warm-reuse-20260927.summary.json`
- `artifacts/perf/optimization-post-warm-reuse-20260927.otel.jsonl`

The coding-agent storm hot event path was not changed. Across the two final
runs, path coverage was 47/60 and 48/60; the repeat matched the 48/60 before
result. Before, final, and repeat summaries all fail `npm run perf:verify` on
missing expected paths. Last-event latency remained below 200 ms, storm CPU
remained below 5%, and RSS stayed below the 150 MB ceiling. The storm
acceptance target remains open and should be remeasured on the target Linux
environment.

### Production-readiness performance targets

These targets define the line Vivi should reach before it is considered
comfortable for daily use on a large local repository such as linux-scale source
trees. They are intentionally framed around user-perceived behavior and resource
ceilings, not only implementation internals.

Large workspace target shape:

- 100k tracked workspace files, 6k-10k directories, Git repository present.
- Default ignores active for `.git`, `node_modules`, and common build caches.
- No telemetry overhead in normal builds; perf builds may pay sampling overhead.

MVP readiness targets:

| Area | Target |
| --- | --- |
| Initial UI usability | First bounded tree and shell visible within 2s on a warm machine. |
| Idle server cost | After startup reconciliation, steady idle CPU stays under 5% average and does not perform full recursive scans repeatedly. |
| Watch event latency | File add/change/unlink event p95 under 500 ms and p99 under 1s for ordinary edits. |
| Watch burst handling | 100 file changes observed without dropped events; first event under 500 ms, final event under 1.5s. |
| Coding-agent write storm | 300 immediate writes/renames/appends across at least 60 paths observed without missing expected paths; first event under 500 ms, final event under 1.5s, post-readiness server CPU under 5% average over the storm-and-settle window. |
| Server memory | Steady RSS under 150 MB while browsing and watching a linux-scale tree. |
| Front-end memory | JS heap used under 80 MB after opening a typical source/Markdown file; under 120 MB after command palette and tab interactions. |
| Filename search | Warm filename search p95 under 100 ms; cold index build under 1.5s and not repeated after every small edit. |
| Content search | First 20 results under 1.5s for common code tokens, with bounded total allocation under 250 MB per query. |
| Git review refresh | `reviewQueue` p95 under 750 ms and no repeated timeout churn in the browser. |
| CLI intake path | `vivi inbox <url>` p95 under 500 ms when the server is already running; CLI RSS under 25 MB. |

Stretch targets:

- Watch event p95 under 200 ms for ordinary edits.
- Warm filename search p95 under 50 ms.
- Content search streams or incrementally returns first results under 500 ms.
- Front-end JS heap remains under 100 MB after opening 10 files in tabs.

The platform watcher slice removed the recurring recursive polling loop from
the default path and added measurement separation for startup, steady idle,
burst latency, and coding-agent write storms. The September 27 local run shows
substantial startup and content-search traversal reductions without changing
the single-path watcher event hot path. It does not clear the coding-agent
storm's zero-missing-path target on this host, and its default document include
list does not measure a broad code-search workload. More aggressive watcher
targets remain realistic for steady-state writes; startup is now below one
second for the measured reconciliation, while broad content search still needs
a comparable large-include measurement.

## Future behavior

- Normalize tree state by path.
- Apply semantic tree events.
- Replace the bounded visible-row cap with smooth virtualization for very large trees.
- Add range controls for large-file partial loading when users need a later chunk.
- Add text diff patching only where profiling shows it matters.
- Re-run the broad explicit include workload on a Linux host with a paired
  before/after baseline; the supplemental 10k-read run above used the macOS
  host and an older historical comparison.
- Reduce cold content search's full-workspace traversal only with a separately
  designed shared metadata snapshot or bounded index; automatic retention from
  text search exceeded the RSS target on broad workspaces.
- Recheck coding-agent storm path coverage on the target Linux environment and
  fix any reproducible missing-path issue.
