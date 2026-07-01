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

### GitHub Actions performance gate

The `Performance` workflow runs the harness on GitHub Actions for pull requests
and pushes to `main`. It uses a small synthetic workspace profile so the job is
cheap enough for routine CI while still exercising the server watcher, browser
workspace smoke path, review CLI, search paths, burst writes, and coding-agent
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
| CLI review path | `vivi review queue --json` p95 under 500 ms when the server is already running; CLI RSS under 25 MB. |

Stretch targets:

- Watch event p95 under 200 ms for ordinary edits.
- Warm filename search p95 under 50 ms.
- Content search streams or incrementally returns first results under 500 ms.
- Front-end JS heap remains under 100 MB after opening 10 files in tabs.

The platform watcher slice removed the recurring recursive polling loop from
the default path and added measurement separation for startup, steady idle,
burst latency, and coding-agent write storms. The current evidence reaches the
MVP watcher targets and the new storm target on the measured linux workspace.
More aggressive watcher targets are realistic for steady-state writes because
the hot path is already platform event plus single-path stat; startup and search
targets require separate architectural work. The next performance slice should
tighten startup reconciliation cost and reduce content search allocation.

## Future behavior

- Normalize tree state by path.
- Apply semantic tree events.
- Replace the bounded visible-row cap with smooth virtualization for very large trees.
- Add range controls for large-file partial loading when users need a later chunk.
- Add text diff patching only where profiling shows it matters.
- Reduce startup reconciliation cost without delaying first UI usability.
- Reduce content search allocation and CPU for common code-token queries.
