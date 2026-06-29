# CLI and API contract

## CLI contract

The canonical `vivi` command is the Go CLI/backend, whether invoked from a
release binary, Homebrew/mise install, `go run ./cli`, or the repository-local
`npm exec -- vivi <args>` shim. The preserved TypeScript server harness is
available only through explicit development commands such as
`npm run dev:server:typescript`; it is not an agent-facing CLI and does not
implement the `review` or `comments` contract.

```bash
vivi [root]
vivi [root] --port 4317
vivi [root] --host 127.0.0.1
vivi [root] --open
vivi [root] --port 0 --ready-json
vivi [root] --include md,html,ts,tsx,json
vivi [root] --max-file-size 1048576
vivi [root] --allow-html-scripts
vivi inbox http://127.0.0.1:4317
vivi inbox http://127.0.0.1:4317 --watch
vivi inbox http://127.0.0.1:4317 --read-as codex
vivi claim http://127.0.0.1:4317 <thread-id> --actor codex
vivi release http://127.0.0.1:4317 <thread-id> --actor codex
vivi release http://127.0.0.1:4317 <thread-id> --actor codex --body-file /tmp/vivi-handoff.md
vivi reply http://127.0.0.1:4317 <thread-id> --actor codex --body "Implemented"
vivi reply http://127.0.0.1:4317 <thread-id> --actor codex --resolve --body-file /tmp/vivi-reply.md
vivi reply http://127.0.0.1:4317 <thread-id> --actor codex --archive --body-file -
vivi comments work --actor codex --loop --json
vivi comments work --once --actor codex --full --json
vivi comments mine --actor codex --json
vivi comments check <thread-id> --actor codex --full --json
vivi comments triage <thread-id> --actor codex --triage-file - --require-claim --json
vivi comments release <thread-id> --actor codex --triage-file - --require-claim --json
vivi comments done <thread-id> --actor codex --result-file - --require-claim --json
vivi comments dismiss <thread-id> --actor codex --result-file - --require-claim --json
vivi comments doctor --actor codex --client-event-id doctor-start-1 --json
vivi comments doctor --actor codex --receipt-log /tmp/vivi-agent-receipts.jsonl --json
vivi review queue --actor codex --json
vivi review bases --json
vivi review diff README.md --base HEAD --json

# Advanced adapter/debug/recovery surfaces:
vivi comments protocol --json
vivi comments protocol --receipt-log /tmp/vivi-agent-receipts.jsonl --json
vivi comments schema list --json
vivi comments verify-receipts --receipt-log /tmp/vivi-agent-receipts.jsonl --json
vivi comments active --actor claude-code --json
vivi comments active --actor claude-code --full --json
vivi comments active --actor claude-code --review-batch review-batch-... --full --json
vivi comments next --actor codex --json
vivi comments next --actor codex --with-context --json
vivi comments next --actor codex --full --json
vivi comments claim --actor codex --review-batch review-batch-... --full --json
vivi comments claim <thread-id> --actor codex --lease 10m --json
vivi comments claim --wait --actor codex --full --json
vivi comments renew <thread-id> --actor codex --lease 10m --json
vivi comments hold <thread-id> --actor codex --interval 2m --lease 10m --json
vivi comments inbox --actor codex --json
vivi comments batch review-batch-... --actor codex --full --json
vivi comments schema commentProtocolManifest --json
vivi comments schema commentDoctorOutput --json
vivi comments schema commentTriageFileInput --json
vivi comments schema commentResultFileInput --json
vivi comments schema commentInboxOutput --json
vivi comments schema commentBatchOutput --json
vivi comments schema commentSuggestedCommand --json
vivi comments schema commentWriteReceipt --json
vivi comments schema commentWriteReceiptVerification --json
vivi comments schema commentActivityBatchEvent --json
vivi comments schema commentWorkClaimedEvent --json
vivi comments schema commentWorkIdleEvent --json
vivi comments schema commentOpenWorklistEvent --json
vivi comments watch --actor claude-code --json
vivi comments follow <thread-id> --no-initial --json
vivi comments context <thread-id> --full --context-lines 6 --json
vivi comments check <thread-id> --actor codex --json
vivi comments verify-receipt --receipt-file /tmp/vivi-receipt.json --json
vivi comments verify-receipts --receipt-log /tmp/vivi-agent-receipts.jsonl --json
vivi comments reply <thread-id> --body "Implemented" --actor codex --json
vivi comments reply <thread-id> --body-file - --actor codex --receipt-log /tmp/vivi-agent-receipts.jsonl --json
vivi comments reply <thread-id> --body-file /tmp/vivi-reply.md --actor codex --json
vivi comments triage <thread-id> --actor codex --decision accepted --summary "Investigating" --json
vivi comments triage <thread-id> --actor codex --triage-file /tmp/vivi-triage.json --json
vivi comments schema triage --json
vivi comments schema result --json
vivi comments done <thread-id> --body "Implemented" --actor codex --json
vivi comments done <thread-id> --body-file /tmp/vivi-reply.md --actor codex --json
vivi comments done <thread-id> --result-file - --actor codex --json
vivi comments dismiss <thread-id> --body "Not applicable" --actor codex --json
vivi comments dismiss <thread-id> --body-file - --actor codex --json
vivi comments resolve <thread-id> --actor codex --json
```

Default root: `.`

Default host: `127.0.0.1`

Default port: `4317`. When that default port is unavailable and the user did
not pass `--port`, the launcher increments mechanically to the next available
local port, such as `4318` or `4319`. Explicit `--port` values still fail if
that port cannot be bound.

Default security posture: local-only, sandboxed HTML preview, local CSS enabled for practical artifact inspection, and HTML script execution disabled. Use `--allow-html-scripts` only when intentionally reviewing generated HTML that needs script execution.

Default rich preview limit: `1048576` bytes. Use `--max-file-size <bytes>` to change it for the current local run.

Pass `--ready-json` when a launcher or coding agent needs a stable startup
handoff. After the local server is listening, Vivi emits one JSON object on
stdout with `event: "vivi_server_ready"`, the selected root, the resolved server
URL, and `suggestedCommands` that already include that resolved URL. Server
launch does not choose an agent identity. The primary startup suggestion is the
top-level `inbox <url> --watch` command, which emits the current open inbox and
then emits only new open threads or newer human comments for that specific Vivi
server. `review queue` remains available as optional changed-file context, and
`comments doctor` remains the online readiness and recovery check.
The top-level `vivi --help` output presents the CLI as human launch, agent
loop, changed-file context, and debug/recovery lanes, so a CLI user can choose
the right surface before opening the deeper `comments work`, `review`, or
`comments` help screens.

### Top-level agent comment pipe

The first user-facing agent surface is intentionally small:

```bash
vivi inbox <url>
vivi inbox <url> --watch
vivi inbox <url> --read-as codex
vivi claim <url> <thread-id> --actor codex
vivi release <url> <thread-id> --actor codex [--body <text>|--body-file <path|->]
vivi reply <url> <thread-id> --actor codex (--body <text>|--body-file <path|->) [--resolve|--archive]
```

`inbox` requires an explicit URL because multiple Vivi servers may run at the
same time. Plain `inbox <url>` is passive and does not send actor headers or
create read receipts. `inbox <url> --watch` is the resident agent intake mode:
the first emission is the current open inbox; subsequent polls emit only
threads that are newly open or whose latest human comment changed since the
last emission. Agent replies do not cause another inbox emission by themselves.
Use `--read-as codex` or `--read-as claude` only when the browser should show
that a named agent read the thread.

`reply` is the write surface. It always requires `--actor`, and the accepted
facade actors are `codex` and `claude`; `claude` maps internally to the existing
`claude_code` actor kind. Unsupported actors are CLI usage errors. `reply` is
non-interactive: pass `--body <text>` or `--body-file <path|->`; it never waits
for terminal input unless stdin is explicitly requested with `--body-file -`.
Without a lifecycle flag the thread remains open. `--resolve` posts the reply
and resolves the thread. `--archive` posts the reply and archives the thread.

`claim` and `release` are the small ownership primitives for multi-agent work.
They can be used directly when several sub-agents may pick up the same thread.
`release` may include a handoff body before releasing the claim.

### Agent comments CLI

`vivi comments` remains the stable JSON-first lower-level CLI surface for
adapter authors and recovery workflows that need the full comment protocol. It
talks to a running Vivi server through GraphQL and does not edit comment storage
directly. The server URL is
resolved from `--url`, then `VIVI_URL`, then `http://127.0.0.1:4317`.
When that server is not reachable, the JSON error envelope includes structured
`suggestedCommands` for loading the offline protocol, starting `vivi` for the
current directory with `--ready-json`, and retrying `comments doctor` with the
same actor, URL, and receipt-log context where available.
`vivi comments --help` is part of that agent contract: its first screen keeps
the common path centered on `comments work`, then lists recovery and adapter
discovery commands separately. `vivi comments work --help` is the focused help
screen for the compact resident loop, including idle behavior, event states,
and token-sensitive defaults. `protocol`, `schema`, `watch`, `follow`, and raw
`claim` are still supported, but they are advanced/debug surfaces rather than
the first workflow a coding agent needs to learn. When an adapter opts into
restart-safe receipt recovery, help tells it to keep the selected
`--receipt-log` on startup, resident loops, and suggested writes. Adapters can
orient from help text before relying on hard-coded command recipes.

For a durable advanced adapter loop, use:

```bash
vivi . --port 0 --ready-json --actor codex
vivi comments work --actor codex --loop --receipt-log /tmp/vivi-agent-receipts.jsonl --json
```

`comments work` is the preferred integrated intake loop: it claims owned work,
follows the claimed thread, renews the claim lease, and can keep looping for the
next feedback item. `comments mine` and `comments check` are recovery helpers
for owned or stale work. `comments watch`, `comments follow`, and
`comments claim --wait` are lower-level adapter/debug primitives: they remain
available for specialized integrations, but new agent workflows should start
from `comments work` unless they have a specific reason to compose the
primitives themselves.

The v1 commands are:

```bash
vivi comments active --actor claude-code --client-event-id fetch-open-1 --json
vivi comments active --actor claude-code --client-event-id fetch-open-1 --full --json
vivi comments active --actor claude-code --client-event-id fetch-open-1 --review-batch review-batch-... --full --json
vivi comments next --actor codex --client-event-id next-open-1 --json
vivi comments next --actor codex --with-context --context-lines 6 --json
vivi comments next --actor codex --full --diff-base HEAD --json
vivi comments claim --actor codex --client-event-id claim-open-1 --review-batch review-batch-... --full --json
vivi comments claim <thread-id> --actor codex --lease 10m --json
vivi comments claim --wait --actor codex --client-event-id claim-wait-1 --full --json
vivi comments work --wait --actor codex --client-event-id work-open-1 --json
vivi comments work --loop --actor codex --client-event-id work-loop-1 --json
vivi comments renew <thread-id> --actor codex --client-event-id renew-open-1 --lease 10m --json
vivi comments hold <thread-id> --actor codex --client-event-id hold-open-1 --interval 2m --lease 10m --json
vivi comments inbox --actor codex --json
vivi comments batch review-batch-... --actor codex --full --json
vivi comments mine --actor codex --json
vivi comments release <thread-id> --actor codex --client-event-id release-open-1 --json
vivi comments release <thread-id> --actor codex --body-file /tmp/vivi-handoff.md --client-event-id release-open-1 --json
vivi comments release <thread-id> --actor codex --triage-file - --require-claim --client-event-id release-open-1 --json
vivi comments done <thread-id> --actor codex --body-file /tmp/vivi-reply.md --require-claim --json
vivi comments done <thread-id> --actor codex --result-file /tmp/vivi-result.json --require-claim --json
vivi comments protocol --json
vivi comments protocol --url http://127.0.0.1:4317 --json
vivi comments protocol --receipt-log /tmp/vivi-agent-receipts.jsonl --json
vivi comments schema list --json
vivi comments schema list --url http://127.0.0.1:4317 --json
vivi comments schema all --json
vivi comments doctor --actor codex --client-event-id doctor-start-1 --json
vivi comments watch --actor claude-code --json
vivi comments follow <thread-id> --no-initial --json
vivi comments list --status open --json
vivi comments list --status resolved --json
vivi comments show <thread-id> --json
vivi comments check <thread-id> --actor codex --json
vivi comments context <thread-id> --full --context-lines 6 --json
vivi comments reply <thread-id> --body "Fixed in this branch" --actor codex --json
vivi comments reply <thread-id> --body-file /tmp/vivi-reply.md --actor codex --json
vivi comments triage <thread-id> --actor codex --decision accepted --summary "Actionable feedback" --next-action "Patch and verify" --json
vivi comments triage <thread-id> --actor codex --triage-file - --require-claim --json
vivi comments schema commentProtocolManifest --json
vivi comments schema commentDoctorOutput --json
vivi comments schema commentTriageFileInput --json
vivi comments schema commentResultFileInput --json
vivi comments schema commentInboxOutput --json
vivi comments schema commentBatchOutput --json
vivi comments schema commentSuggestedCommand --json
vivi comments schema commentWriteReceipt --json
vivi comments schema commentWriteReceiptVerification --json
vivi comments schema commentWriteReceiptLedgerVerification --json
vivi comments schema commentActivityBatchEvent --json
vivi comments schema commentWorkClaimedEvent --json
vivi comments schema commentWorkIdleEvent --json
vivi comments schema commentOpenWorklistEvent --json
vivi comments done <thread-id> --body "Fixed in this branch" --actor codex --json
vivi comments done <thread-id> --body-file /tmp/vivi-reply.md --actor codex --json
vivi comments done <thread-id> --result-file - --actor codex --json
vivi comments dismiss <thread-id> --body "Not applicable to this workspace" --actor codex --json
vivi comments dismiss <thread-id> --body-file - --actor codex --json
vivi comments resolve <thread-id> --actor codex --json
vivi comments archive <thread-id> --actor codex --json
vivi comments reopen <thread-id> --actor codex --json
```

`active`, `list`, and `show` are read queries. When `--actor` is provided,
those reads include `X-Vivi-Actor-Id`, inferred or explicit
`X-Vivi-Actor-Kind`, optional `X-Vivi-Actor-Name`, and optional
`X-Vivi-Client-Event-Id`, so the existing read-side observer records
`thread_read` activity. There is no public read-receipt mutation. `reply`,
`resolve`, `archive`, and `reopen` use the GraphQL comment lifecycle mutations
and include an actor input when `--actor` is set.

All `vivi comments` commands currently emit JSON. List-like commands return:

```json
{
  "threads": [],
  "count": 0
}
```

Pass `--full` to `active` or `list` to add an `items` array aligned with the
returned threads. This is the one-shot rich worklist path for agents that start
after a GUI feedback publish and want every currently matching thread without
staying attached to `watch`:

```json
{
  "threads": [],
  "count": 0,
  "items": [
    {
      "thread": {},
      "brief": {
        "threadId": "comment-thread-...",
        "path": "README.md",
        "recommendedAction": "inspect_thread",
        "suggestedCommandIntents": ["inspect_thread"]
      },
      "file": {},
      "source": {},
      "diff": {},
      "activities": []
    }
  ]
}
```

Pass `--review-batch <id>` to `active`, `list`, `next`, `claim`, or `watch` to limit
the worklist to threads created by one published GUI review batch. The filter
is applied by the server query, so actor-attributed read receipts are recorded
only for the matching batch threads.

`vivi review` is the read-only Git working-tree review CLI for coding agents
that need changed-file context before or alongside human GUI feedback.
`review queue --actor <actor> --json` returns the cheap changed-file list,
ordered for the same review workflow as the GUI: files with open comment
threads first, then changed files with recent comment history, then the Git
change order. It also returns available diff bases and
`summary.reviewUrl`, a browser deep link that opens the first queued file in
HEAD diff mode, plus `summary.suggestedCommands` for both the first
`review diff` command and an executable compact resident
`comments work --actor <actor> --loop --json` feedback loop. Without
`--actor`, the queue points agents at
`comments doctor --json` so the next payload can return the `configure_actor`
branch, instead of emitting a `comments work` recipe that cannot run. That
doctor branch includes both `comments protocol --json` and a
`comments doctor --actor <actor> --actor-kind codex --json` retry recipe that
keeps the selected `--url` and `--receipt-log` flags. It does not claim comment
threads and does not load
every diff in large repositories. Use `review bases --json` to list recent
allowed diff bases, and `review diff <path> --base HEAD --json` to fetch one
`TextDiff` payload for a changed file. Use the `comments` commands when the
agent needs human feedback threads, ownership, or terminal replies.
When a `review` command fails with JSON enabled, it returns a structured
`error` envelope with a stable `code`, original argv, recoverability, and
suggested retry/help commands.

Minimal `review queue --json` shape:

```json
{
  "schemaVersion": 1,
  "available": true,
  "count": 1,
  "changes": [{ "path": "README.md", "status": "modified", "kind": "file" }],
  "diffBases": {
    "available": true,
    "options": [{ "ref": "HEAD", "label": "HEAD" }]
  },
  "summary": {
    "recommendedAction": "review_changed_files",
    "changedFileCount": 1,
    "reviewUrl": "http://127.0.0.1:4317/?diff=1&path=README.md",
    "suggestedCommands": [
      {
        "intent": "inspect_first_changed_file_diff",
        "command": "review diff",
        "args": [
          "review",
          "diff",
          "README.md",
          "--base",
          "HEAD",
          "--url",
          "http://127.0.0.1:4317",
          "--json"
        ],
        "displayCommand": "vivi review diff README.md --base HEAD --url http://127.0.0.1:4317 --json"
      }
    ]
  }
}
```

The browser workspace accepts `?path=<relative-path>` to open a file as a
temporary preview tab. Adding `&diff=1` opens that file in HEAD diff mode when
the viewer supports diffs. The server still refuses paths outside the selected
root when the UI resolves the deep link.

`next` is the shortest read-only coding-agent intake command. It queries the current
open worklist, records the same actor-aware read receipts as other read
commands, orders threads by oldest `createdAt` with stable tie-breakers, and
returns one thread plus worklist metadata:

```json
{
  "thread": null,
  "cursor": "open:...",
  "count": 0,
  "remaining": 0
}
```

When work exists, `thread` is the selected `CommentThread` and `remaining` is
the number of other open threads left after that selection. `next` does not
claim an exclusive lease, mark work in progress, or change thread status; an
agent should use `claim` when multiple background agents may be watching the
same GUI feedback queue.

For long-lived threads, add `--activity-limit <count>` and
`--comment-limit <count>` to `comments work`, `watch`, `inbox`, `mine`, `batch`,
`next`, or `claim` when using `--full` or `--with-activities`. Summary counts
still describe the complete thread state, but emitted `activities` and rich
`thread.comments` histories are trimmed to the most recent entries so resident
agent logs stay readable. Vivi's startup and doctor suggested commands include
`--activity-limit 20 --comment-limit 10` by default.

`claim` is the preferred intake command for background coding agents that will
act on GUI feedback. With no thread id, it reads the current open worklist
without recording read receipts, tries the oldest matching thread first, skips
threads that have a non-expired claim by another actor, appends one
`thread_claimed` activity to the selected thread, and returns the claimed work
item:

```json
{
  "thread": {},
  "claim": {
    "type": "thread_claimed",
    "actor": { "id": "codex", "kind": "codex" },
    "clientEventId": "claim-open-1",
    "leaseExpiresAt": "2026-06-21T00:10:00Z"
  },
  "cursor": "open:...",
  "count": 2,
  "remaining": 1
}
```

With a thread id, `claim <thread-id>` attempts to claim exactly that thread and
returns an error if another actor already holds a live lease. `--lease`
controls the lease duration and defaults to `10m`. `--client-event-id` makes a
claim retry idempotent for the same actor and thread. Claims are activity
events, not lifecycle statuses: the thread remains `open`, the GUI can show
who is currently working, and an abandoned claim naturally becomes stale after
`leaseExpiresAt`. Pass `--full` for the same source, diff, and activity shape
as `next --full`; the returned activity history includes the claim. The output
is described by `commentClaimOutput` and, on a successful claim, includes
`brief` before the heavier `diff`/`source` fields for terminal logs,
`summary.recommendedAction: "start_work"` plus suggested structured
`triage`, `release`, `done`, and `dismiss` commands for the newly owned thread.
`brief` is intentionally compact: it repeats the thread path, latest comment
excerpt, latest human-authored intent, recommended action, source availability,
source freshness state, anchor line range when available, current claim state,
and suggested commands plus their intents so a coding agent operator can act
before reading large source or diff payloads. When the referenced source path is
unavailable, `brief.latestUserIntent`, `brief.sourceAvailable: false`,
`brief.sourceReason`, and the thread comments preserve the user's request even
though `source.lines` cannot be loaded. `summary.suggestedCommands` remains the
canonical batch summary, while `brief.suggestedCommands` is the early, terminal
friendly copy for `--full` output.
When no thread can be claimed, the payload still includes `summary` with
routing counts and a next action. In particular,
`summary.recommendedAction: "wait_for_claim_release"` means open threads exist
but are currently leased by other actors; use the suggested resident
`comments work --loop` command or `comments inbox` snapshot instead of
immediately retrying the same claim.

`claim --wait` is the lower-level blocking claim primitive underneath resident
agent intake. It polls the open worklist using `--interval`, skips threads
currently claimed by another live actor, and returns only after it successfully
appends a `thread_claimed` activity. The payload is the same as `claim --full`
when `--full` is set. New agent workflows should prefer `comments work --wait
--loop`, which keeps the claim lease warm and follows the claimed thread in one
stream without emitting idle heartbeats. Use `claim --wait` only when an adapter intentionally
composes claim, renew, and follow itself.

`work` is the integrated work-session intake command for coding-agent adapters
that want one process to claim work, keep the lease warm, and listen for human
follow-up on that same thread. It accepts the same selection flags as `claim`,
including `--wait`, `--review-batch`, `--lease`, and `--full`. When it claims
a thread it emits one newline-delimited JSON event:

```json
{
  "type": "comment_work_claimed",
  "schemaVersion": 1,
  "eventSchema": "commentWorkClaimedEvent",
  "eventSchemaCommand": [
    "comments",
    "schema",
    "commentWorkClaimedEvent",
    "--json"
  ],
  "sessionId": "comments-work-...",
  "sequence": 1,
  "thread": {},
  "claim": { "id": "activity-id", "type": "thread_claimed" },
  "summary": {
    "kinds": ["claimed_work", "human_comment", "own_claim"],
    "requiresAttention": true,
    "attentionReasons": ["claimed_open_thread"],
    "recommendedAction": "start_work",
    "suggestedCommands": [
      {
        "intent": "acknowledge_initial_feedback",
        "command": "comments triage",
        "args": [
          "comments",
          "triage",
          "comment-thread-...",
          "--actor",
          "codex",
          "--triage-file",
          "-",
          "--require-claim",
          "--client-event-id",
          "activity:comment-thread-...:triage:activity-id",
          "--json"
        ],
        "clientEventId": "activity:comment-thread-...:triage:activity-id",
        "stdinSchema": "commentTriageFileInput",
        "reason": "Post a structured acknowledgement that the agent has started the claimed work."
      },
      {
        "intent": "complete_after_verification",
        "command": "comments done",
        "args": [
          "comments",
          "done",
          "comment-thread-...",
          "--actor",
          "codex",
          "--result-file",
          "-",
          "--require-claim",
          "--client-event-id",
          "activity:comment-thread-...:done:activity-id",
          "--json"
        ],
        "clientEventId": "activity:comment-thread-...:done:activity-id",
        "stdinSchema": "commentResultFileInput",
        "reason": "Resolve the thread with structured verification after the fix is complete."
      },
      {
        "intent": "archive_after_decision",
        "command": "comments dismiss",
        "args": [
          "comments",
          "dismiss",
          "comment-thread-...",
          "--actor",
          "codex",
          "--result-file",
          "-",
          "--require-claim",
          "--client-event-id",
          "activity:comment-thread-...:dismiss:activity-id",
          "--json"
        ],
        "clientEventId": "activity:comment-thread-...:dismiss:activity-id",
        "stdinSchema": "commentResultFileInput",
        "reason": "Archive the thread with a structured explanation when the feedback is intentionally not fixed."
      }
    ]
  },
  "cursor": "open:...",
  "remaining": 0
}
```

`summary.recommendedAction` is `start_work` on the claimed event, so adapters
can acknowledge the initial GUI feedback with the suggested structured triage
command and later close it with the suggested structured done or dismiss
command. The command
then resumes from the claim activity id and emits normal
`comment_thread_activity_batch` events for later human comments, lifecycle
activity, and the session's own lease renewals. Renewal uses
`--renew-interval`, defaulting to `min(lease/2, 2m)`, and appends fresh
`thread_claimed` activities with `--client-event-id` suffixed as
`:renew:<n>`. `--max-events` counts the claimed event plus activity batches, so
`--max-events 1` claims and exits while `--max-events 2` claims and waits for
one later batch. If no claimable work exists and `--wait` is not set, it emits
`{ "type": "comment_work_idle", "eventSchema": "commentWorkIdleEvent",
"reason": "no_claimable_work" }` and exits. Pass `--idle-events` with
`--wait` or `--loop` to keep that same schema-bearing idle event in the stream
while the agent is waiting; this is an explicit high-output observability mode,
not the default agent-safe resident loop. Without `--idle-events`, `work --wait`
and `work --loop` stay silent until a claimable thread, followed activity, or
terminal status appears. The idle summary uses
`recommendedAction: "wait_for_gui_feedback"` when the queue is empty and
`recommendedAction: "wait_for_claim_release"` when open threads exist but are
currently claimed by other actors. Empty-queue idle events suggest the
resident `comments work --loop` command, while claim-release waits
suggest keeping that primary work loop open and using `comments inbox` only for
diagnostic routing.
When `--idle-events` is enabled, repeated identical waiting states are
suppressed; the stream emits the first waiting idle event, then stays quiet
until the idle cursor changes or claimable work appears.
When a later activity batch contains `thread_status_changed` to `resolved` or
`archived`, `work` emits that batch and exits successfully, giving adapters a
natural stop signal after `done` or `dismiss`.

The `work`/`follow` stream events emit protocol metadata on each NDJSON line:
`schemaVersion` is the numeric stream schema version, `eventSchema` names the
runtime JSON Schema for that event type, `eventSchemaCommand` is the exact argv
that returns that schema, `sessionId` is stable for one CLI process, and
`sequence` starts at `1` and increments for each event emitted by that process.
`work --loop` keeps the same `sessionId` while moving across
threads, so adapters can persist `(sessionId, sequence, cursor)` for durable
logs, duplicate suppression, and crash diagnostics.

Every `comment_thread_activity_batch` event includes a `summary` object so
adapters can branch before inspecting the full activity list:

```json
{
  "type": "comment_thread_activity_batch",
  "schemaVersion": 1,
  "eventSchema": "commentActivityBatchEvent",
  "eventSchemaCommand": [
    "comments",
    "schema",
    "commentActivityBatchEvent",
    "--json"
  ],
  "sessionId": "comments-work-...",
  "sequence": 2,
  "summary": {
    "kinds": ["human_comment", "terminal_status"],
    "requiresAttention": true,
    "attentionReasons": ["external_human_comment", "terminal_status"],
    "recommendedAction": "reconsider_work",
    "suggestedCommands": [
      {
        "intent": "acknowledge_follow_up",
        "command": "comments triage",
        "args": [
          "comments",
          "triage",
          "comment-thread-...",
          "--actor",
          "codex",
          "--triage-file",
          "-",
          "--require-claim",
          "--json"
        ],
        "stdinSchema": "commentTriageFileInput",
        "stdinSchemaCommand": [
          "comments",
          "schema",
          "commentTriageFileInput",
          "--json"
        ],
        "stdinExample": {
          "decision": "fixing",
          "summary": "The feedback is actionable and reproducible.",
          "nextAction": "Patch the file and run task check.",
          "details": "- Source anchor confirmed\n- No clarification needed"
        },
        "reason": "Post a structured non-terminal acknowledgement before continuing work."
      },
      {
        "intent": "complete_after_verification",
        "command": "comments done",
        "args": [
          "comments",
          "done",
          "comment-thread-...",
          "--actor",
          "codex",
          "--result-file",
          "-",
          "--require-claim",
          "--json"
        ],
        "stdinSchema": "commentResultFileInput",
        "stdinSchemaCommand": [
          "comments",
          "schema",
          "commentResultFileInput",
          "--json"
        ],
        "stdinExample": {
          "summary": "Implemented the requested behavior.",
          "verification": ["go test ./cli passed", "task check passed"],
          "details": "- Completion reply is retry-safe"
        },
        "reason": "Resolve the thread with structured verification after the fix is complete."
      },
      {
        "intent": "archive_after_decision",
        "command": "comments dismiss",
        "args": [
          "comments",
          "dismiss",
          "comment-thread-...",
          "--actor",
          "codex",
          "--result-file",
          "-",
          "--require-claim",
          "--json"
        ],
        "stdinSchema": "commentResultFileInput",
        "stdinSchemaCommand": [
          "comments",
          "schema",
          "commentResultFileInput",
          "--json"
        ],
        "stdinExample": {
          "summary": "The feedback is intentionally not applicable to this workspace.",
          "verification": [
            "Reviewed the source anchor and current requirements."
          ],
          "details": "- No code change was needed"
        },
        "reason": "Archive the thread with a structured explanation when the feedback is intentionally not fixed."
      }
    ],
    "ownActivityCount": 0,
    "externalActivityCount": 2,
    "humanCommentCount": 1,
    "agentCommentCount": 0,
    "triageCommentCount": 0,
    "ownCommentCount": 0,
    "externalCommentCount": 1,
    "externalAgentCommentCount": 0,
    "ownTriageCommentCount": 0,
    "externalTriageCommentCount": 0,
    "commentUpdateCount": 0,
    "claimCount": 0,
    "ownClaimCount": 0,
    "externalClaimCount": 0,
    "releaseCount": 0,
    "ownReleaseCount": 0,
    "externalReleaseCount": 0,
    "statusChangeCount": 1,
    "ownStatusChangeCount": 0,
    "externalStatusChangeCount": 1,
    "readCount": 0,
    "threadCreatedCount": 0,
    "terminalStatus": "resolved"
  },
  "activities": [],
  "comments": [
    {
      "id": "comment-...",
      "threadId": "comment-thread-...",
      "body": "One more note from the human while the agent is working.",
      "createdBy": { "id": "human:tasuku", "kind": "human" },
      "anchor": {}
    }
  ],
  "source": {
    "path": "README.md",
    "available": true,
    "anchorStartLine": 1,
    "anchorEndLine": 1,
    "lines": [{ "number": 1, "text": "# Title", "anchor": true }]
  },
  "diff": { "path": "README.md", "status": "available" }
}
```

`kinds` is sorted and can contain `human_comment`, `agent_comment`,
`triage_comment`, `own_comment`, `own_triage_comment`, `comment_update`,
`claim`, `own_claim`, `claim_release`, `own_claim_release`, `status_change`,
`terminal_status`, `read`, `thread_created`, or `other`. `triage_comment` is
set when a comment body was generated by `comments triage`, which lets
adapters distinguish a structured agent acknowledgement from free-form agent
discussion. When the stream has `--actor`, the `own*` counts refer to that
actor id and `external*` counts refer to every other actor; when no actor is
supplied, activities are treated as external.
When a delivered batch contains `comment_added` or `comment_updated`,
`comments` contains the matching comment snapshots in activity order. This
lets a resident agent read the human follow-up body, actor, and anchor directly
from the stream without immediately calling `comments show`. Batches that only
contain claims, releases, reads, or lifecycle changes omit `comments`.
When `follow` or `work` is run with `--with-context` or `--full`, comment
batches also include the same `file`, `source`, and optional `diff` shape used
by claimed work items. This keeps the human follow-up body and the relevant
source lines in one NDJSON event for agent triage.

`recommendedAction` is the first field an adapter should branch on:
`start_work` means this stream has claimed an open GUI feedback item and should
acknowledge it before editing, `reconsider_work` means new external feedback
should be folded into the active
task, `ignore_own_heartbeat` means the batch only reflects this agent's lease
renewal, `ignore_own_activity` means the batch only reflects this agent's own
non-heartbeat activity such as its own triage reply, `inspect_external_activity`
means another actor changed claim/lifecycle state or posted a structured triage
reply, `finish_current_work` means a terminal status was observed, and
`observe` means no stronger recommendation applies.
`suggestedCommands` is the command-level companion for adapters. It returns
subcommand argv in `args` that can be prefixed with the adapter's own Vivi
launcher, plus `displayCommand` as a shell-quoted command string using the Vivi
executable that emitted the suggestion. Use `args` for structured execution and
`displayCommand` for logs, transcripts, and operator-facing guidance.
Suggestions also include `clientEventId` when the suggested action has a stable
retry/correlation id, and `stdinSchema`, `stdinSchemaCommand`, and
`stdinExample` when the command expects structured JSON on stdin. Runtime write
suggestions include the same `clientEventId` in both the top-level field and the argv's
`--client-event-id`; execute the argv as-is and reuse that id for retries of
that logical write. The reusable recipe object is available as
`comments schema commentSuggestedCommand --json` and is also exposed through
the startup protocol's `componentSchemas.commentSuggestedCommand`. Agent write
and runtime-routing suggestions carry the resolved `--url` when the emitting
command targeted a non-default Vivi server, and preserve `--actor-kind` when
the emitting command supplied one, so adapters can execute suggested argv
as-is without accidentally returning to `http://127.0.0.1:4317` or losing
actor-relative classification.
Agent write
commands return a `receipt` object described by
`comments schema commentWriteReceipt --json`; the receipt links the command,
thread, actor, `clientEventId`, returned comment, terminal status when present,
and activity effects such as `comment_added`, `thread_claim_released`, or
`thread_status_changed`. Each receipt also carries `receiptSchema`,
`receiptSchemaCommand`, `verificationCommand`, `verificationSchema`, and
`verificationSchemaCommand`, so adapters can validate and later re-check the
receipt without hard-coded schema names or command recipes. Use
`comments verify-receipt --receipt-file <path|-> --json` after an adapter
restart or long-running work segment to verify that a saved receipt still
matches the server's thread, comment, status, and activity history. Agents can
execute the receipt's own `verificationCommand` directly; it carries the same
resolved `--url` used by the write so verification returns to the same Vivi
server even when the adapter is not using the default port.
Agents can also pass `--receipt-log <path>` to `reply`, `triage`, `release`, `done`, or
`dismiss`; the CLI appends each successful write receipt as one JSONL line so a
resident adapter has a restart ledger independent of stdout handling. Use
`comments verify-receipts --receipt-log <path|-> --json` to validate every
saved JSONL receipt before resuming a loop; its output summarizes total,
verified, and failed entries and includes the individual receipt verification
payloads. Failed receipt and ledger verification responses also keep the same
`--url` in their recovery `suggestedCommands`. For `start_work`,
`reconsider_work`, and source-unavailable handoff branches, stream suggestions
are live-claim aware when the CLI has the current activity history. If the
actor still owns the live claim, the batch suggests the guarded write commands.
If the claim is missing, expired, or owned by someone else, the batch falls
back to the same preflight-safe claim, show, or follow suggestions returned by
`comments check` instead of emitting a write that will immediately fail
`--require-claim`. For `reconsider_work` with an owned live claim, agents
should usually acknowledge the human update with the suggested
`comments triage --triage-file -` command, hand off blocked or needs-info work
with the suggested `comments release --triage-file -` command, then later
finish with the suggested `comments done --result-file -` command or
intentionally archive with the suggested `comments dismiss --result-file -`
command. For
`inspect_external_activity`, the suggestion is
`comments show <thread-id> --actor <actor> --json`. Actions such as
`ignore_own_heartbeat` and `ignore_own_activity` intentionally have no
suggested command. `finish_current_work` intentionally has no suggested write
command, but it does suggest `comments check <thread-id> --full --json` so a
resident agent can confirm the terminal state and branch on
`write.suggestedCommands` if the thread needs reopening or another safe
follow-up action.
Use `comments protocol --receipt-log <path> --json` at durable adapter startup
to discover the preferred resident loop (`comments work --loop
--actor <actor> --receipt-log <path> --json`),
restart recovery commands (`comments mine --actor <actor> --receipt-log
<path> --json`),
passive intake alternatives, single-thread companion commands, structured write
recipes, schema lookup commands, and the JSON error policy. The protocol
manifest is server-independent; it tells the adapter how to drive the CLI,
while runtime events and `comments check` can still return more specific
`suggestedCommands` for the current thread. `protocol` and `schema` accept
`--url` even though they do not contact the server; when a URL is supplied, the
protocol carries that selected server through its runtime command recipes.
The manifest is self-describing: `manifestSchema` is
`commentProtocolManifest`, and `manifestSchemaCommand` is the exact argv for
fetching the JSON Schema that validates `comments protocol --json`.
Command recipes in the manifest and runtime `suggestedCommands` carry both
`args` and `displayCommand`; GUI surfaces should display or copy those values
instead of assembling shell strings themselves. Recipes that affect resident
output may also include `outputMode` and `idlePolicy`, so a UI can label the
default loop as agent-safe and the heartbeat loop as high-output opt-in.
For short, disposable probes, `comments protocol --json` remains valid and
returns the same contract with `receiptLedger.enabled` set to false.
Pass `--receipt-log <path>` to personalize the offline manifest for a durable
agent restart ledger. The manifest's `receiptLedger` field then records the
path plus `comments verify-receipts --receipt-log <path> --json`, and its
startup, preferred loop, intake, companion, and structured write recipes carry
the same `--receipt-log` flag where those commands can propagate or append
receipts. Without `--receipt-log`, `receiptLedger.enabled` is false and the
verification command contains a `<receipt-log-path>` placeholder.
After caching the server-independent protocol and schemas, use
`comments doctor --actor <actor> --client-event-id <id> --json` as the online
readiness check for the selected Vivi server. It reads the open worklist cursor
and count without recording read receipts, claims, or comments, then returns
`recommendedAction` and startup `suggestedCommands` such as
the primary `comments work --loop --json` resident loop,
plus recovery helpers such as `comments mine --json` and routing snapshots such
as `comments inbox --json`. The protocol manifest also includes a
`passive_rich_open_worklist` intake alternative using `comments watch --full`
for adapters that split monitoring from per-thread worker execution.
If `--actor` is omitted, doctor returns `recommendedAction: "configure_actor"`
with an actor-selection retry command that preserves the same server URL and
receipt ledger path.
When startup was called with `--receipt-log <path>`, those suggestions include
the same receipt ledger flag.
This gives a resident adapter a safe first server touch and an explicit
restart-resume probe before it starts a long-running work loop. Pass
`--receipt-log <path>` to include `receiptLedger` verification in the same
startup payload; if any saved receipt no longer matches server state,
`recommendedAction` becomes `reconcile_receipt_ledger` and the first suggested
command is `comments verify-receipts --receipt-log <path> --json`. A missing
ledger file is treated as an empty successful ledger for first startup. When a
readiness, routing, watch, work, follow, or preflight command receives
`--url <server>`, its runtime `suggestedCommands` carry the same resolved URL;
when it receives `--receipt-log <path>`, write-oriented suggestions also carry
the same ledger argument so adapters can execute suggested `triage`, `release`,
`done`, `dismiss`, or `reply` commands as-is and still persist receipts. The protocol
manifest exposes
`startupSchemas.commentDoctorOutput`, and
`comments schema commentDoctorOutput --json` validates the readiness payload.
Protocol commands that start a durable read/claim loop and the generic
structured write recipes include a `<client-event-id>` placeholder. Replace it
with a stable id for one logical attempt and reuse that id only for retries of
that attempt.
The same retry key is honored by agent write commands: `reply`, `triage`,
`done`, and `dismiss` send `--client-event-id` as an idempotency header, and
the server stores it on the resulting `comment_added` and
`thread_status_changed` activities. Replaying the same write with the same
actor, thread, and client event id returns the existing comment or lifecycle
effect instead of appending a second agent reply.
Use `comments schema <name> --json` to fetch machine-readable JSON Schema,
accepted command flags, and a minimal example for adapter-facing contracts.
Use `comments schema list --json` first when an agent only needs a compact
index of available schema names, accepted commands, and exact per-schema fetch
commands.
Use `comments schema <name> --summary --json` when an agent needs the compact
field map before deciding whether to fetch the full JSON Schema. Summary output
includes the schema metadata, accepted commands, required top-level fields, the
full-schema command, and selected JSON paths such as
`summary.recommendedAction`, `summary.suggestedCommands[].displayCommand`, and
`unclaimed.threads[].comments[].body`; rich worklist summaries also keep
`items[].brief.recommendedAction`, `items[].brief.sourceState`, and
`items[].brief.suggestedCommandIntents` so monitor agents can discover
per-item handoff signals without fetching the full schema first. The compact
summary is intentionally not a validator.
`commentProtocolManifest` validates the startup manifest itself, and
`commentDoctorOutput` validates the online startup readiness check. For
suggested stdin payloads, adapters can run the exact `stdinSchemaCommand` from the
suggestion instead of constructing it themselves. `stdinRequired: true` marks
recipes whose argv expects JSON on stdin, usually because it contains
`--triage-file -` or `--result-file -`. `stdinExample` is intentionally small
and is a shape hint, not a response template; it is tuned to the suggestion
intent, so initial acknowledgements say the feedback has been claimed, human
follow-up acknowledgements say the new note is being incorporated, release
handoffs use a blocked triage example, completions use verification-oriented
result JSON, and dismissals use an archival result example. The stable stdin schema names are `commentTriageFileInput` and
`commentResultFileInput`; aliases `triage`, `triage-file`, `result`, and
`result-file` are accepted for shell convenience.
Snapshot adapters can fetch output schemas with
`comments schema commentClaimOutput --json`,
`comments schema commentInboxOutput --json`,
`comments schema commentMineOutput --json`,
`comments schema commentBatchOutput --json`, and
`comments schema commentCheckOutput --json`. Structured acknowledgement output
is described by `comments schema commentTriageOutput --json`, blocked or
needs-info handoff releases are described by
`comments schema commentReleaseOutput --json`, and terminal completion and
archival replies are described by `comments schema commentResultOutput --json`.
Aliases `claim`, `inbox`, `mine`, `batch`, and `check` are accepted for the
corresponding snapshot and preflight schemas; use the full
`commentTriageOutput`, `commentReleaseOutput`, and `commentResultOutput` names
for write outputs so `schema triage` and `schema result` can keep meaning the
stdin file contracts. The
reusable suggested command recipe schema is
`comments schema commentSuggestedCommand --json`, with aliases
`suggestedCommand` and `suggested-command`. The reusable write command receipt
schema is `comments schema commentWriteReceipt --json`, with aliases
`writeReceipt` and `write-receipt`. Receipt verification output is described by
`comments schema commentWriteReceiptVerification --json`, with aliases
`receiptVerification` and `write-receipt-verification`. Receipt ledger
verification output is described by
`comments schema commentWriteReceiptLedgerVerification --json`, with aliases
`receiptLedgerVerification` and `write-receipt-ledger-verification`. Stream adapters can
fetch event output schemas with
`comments schema commentActivityBatchEvent --json`,
`comments schema commentWorkClaimedEvent --json`, and
`comments schema commentWorkIdleEvent --json`, and
`comments schema commentOpenWorklistEvent --json`. The aliases
`activityBatch`, `workClaimed`, `workIdle`, and `openWorklist` are accepted
for the common event schemas.
Non-zero JSON exits use `comments schema commentErrorEvent --json`; aliases
`error`, `commentError`, and `commentErrorEvent` are accepted.
The protocol manifest also includes `errorPolicy`, which tells adapters that
non-zero JSON exits are written to stdout, identifies `commentErrorEvent` as
the validation schema, and enumerates stable `error.code` values with
recoverability guidance. Branch on `error.suggestedCommands` first when it is
present; the policy is the fallback decision table for stale claims, other
owners, stale thread ids, server reachability, argument bugs, and retryable
upstream failures. Recovery `suggestedCommands` preserve an explicit `--url`
or `VIVI_URL`-resolved server where available, keep the failed command's
`--actor-kind` alongside `--actor`, and carry `--receipt-log` into commands
such as `doctor`, `check`, `follow`, and `inbox` that may emit the next
write-oriented suggestions.
`comments schema list --json` returns the compact schema index for adapter
startup caching and does not contact the Vivi server. `comments schema all
--json` still returns the protocol manifest, doctor readiness, snapshot output
schemas, stdin schemas, reusable component schemas, stream event schemas,
receipt verification schemas, and error envelope schema in one large payload
for adapters that intentionally cache the full offline contract.
Prefer `comments schema all --json` only for deliberate offline cache
refreshes; use `comments schema list --json` or `<name> --summary --json` for
ordinary agent context.

When `vivi comments ... --json` fails through the CLI entrypoint, it exits
non-zero and writes a machine-readable error envelope instead of plain text:

```json
{
  "error": {
    "schemaVersion": 1,
    "code": "no_live_claim",
    "message": "comment thread \"...\" has no live claim for actor \"codex:worker\"; renew or claim it before writing",
    "command": "comments done",
    "args": [
      "comments",
      "done",
      "...",
      "--actor",
      "codex:worker",
      "--actor-kind",
      "codex",
      "--require-claim",
      "--url",
      "http://127.0.0.1:4317",
      "--json"
    ],
    "recoverable": true,
    "suggestedCommands": [
      {
        "intent": "claim_thread_before_retrying",
        "command": "comments claim",
        "args": [
          "comments",
          "claim",
          "...",
          "--actor",
          "codex:worker",
          "--actor-kind",
          "codex",
          "--full",
          "--client-event-id",
          "error:...:claim",
          "--url",
          "http://127.0.0.1:4317",
          "--json"
        ],
        "clientEventId": "error:...:claim",
        "reason": "Claim this thread before retrying the failed guarded write."
      },
      {
        "intent": "check_thread_before_retrying",
        "command": "comments check",
        "args": [
          "comments",
          "check",
          "...",
          "--actor",
          "codex:worker",
          "--actor-kind",
          "codex",
          "--full",
          "--url",
          "http://127.0.0.1:4317",
          "--json"
        ],
        "reason": "Inspect live claim ownership and use write.suggestedCommands for the next safe write."
      }
    ],
    "schemaCommand": ["comments", "schema", "commentErrorEvent", "--json"]
  }
}
```

Known `error.code` values include `server_unreachable`, `invalid_arguments`,
`no_live_claim`, `claimed_by_other_actor`, `not_found`,
`upstream_graphql_error`, and `comments_command_failed`. Adapters should branch on `code` and
`suggestedCommands` before falling back to the human-readable `message`.
When a failed command was pointed at a non-default server, execute those
suggested argv as-is so recovery stays attached to the same GUI feedback
session.
Adapters can validate this envelope with
`comments schema commentErrorEvent --json`, or cache it from
`comments schema list --json` at startup and fetch `commentErrorEvent` on
demand.
Passing `--json=false` keeps legacy plain-text stderr behavior.
`requiresAttention` is true for external comments, updates, claims, releases,
or status changes; terminal status is still reported in `attentionReasons` and
`terminalStatus`, but it is handled by the work-session stop/loop contract.

Pass `--loop` to keep `work` resident as a queue worker. After a terminal
status batch for the current thread, the same process returns to the claim
loop and emits the next `comment_work_claimed` event when another matching
thread is available. `--loop` is for queue selection, so it cannot be combined
with an explicit thread id or `--once`; use `--max-events` to bound a loop in
harnesses. This lets a coding-agent adapter consume one NDJSON stream for the
whole GUI feedback queue instead of supervising an outer shell loop around
`work --wait`. The agent-safe loop stays quiet between claims. Add
`--idle-events` only when an adapter needs observable waiting state; each idle
event has the same `sessionId`/`sequence` metadata as claimed and activity
events. Repeated identical waiting states are suppressed automatically.

`renew <thread-id>` is the explicit heartbeat command for long-running agent
work. It appends another `thread_claimed` activity for the same actor and
returns it as `renewal`:

```json
{
  "thread": {},
  "renewal": {
    "type": "thread_claimed",
    "actor": { "id": "codex", "kind": "codex" },
    "clientEventId": "renew-open-1",
    "leaseExpiresAt": "2026-06-21T00:20:00Z"
  }
}
```

Use `renew` while an agent is still triaging, editing, or waiting on tests so
the GUI can keep showing a live owner. The command returns an error if another
actor already holds the live lease. If the previous lease expired or was
released before another actor claimed it, `renew` reacquires the open thread.
Use `--client-event-id` for idempotent heartbeat retries.

`hold <thread-id>` is the long-running lease keeper for coding-agent work that
may outlive one lease window, such as implementation plus `task check`. It
renews immediately, then renews again every `--interval` until interrupted, and
emits newline-delimited JSON renewal events:

```json
{
  "type": "comment_claim_renewed",
  "sequence": 1,
  "emittedAt": "2026-06-21T00:00:00Z",
  "thread": {},
  "renewal": {
    "type": "thread_claimed",
    "clientEventId": "hold-open-1:1",
    "leaseExpiresAt": "2026-06-21T00:10:00Z"
  }
}
```

Use `--max-events <count>` for bounded harnesses or tests, and `--once` for a
single streamed renewal. When `--client-event-id` is supplied, `hold` appends a
sequence suffix so every heartbeat extends the lease instead of reusing one
idempotent claim event.

`inbox` is the startup snapshot for background agents. It reads the open
worklist without creating read receipts, classifies threads by their latest live
claim, and returns routed groups plus the first recommended work target:

```json
{
  "schemaVersion": 1,
  "schemaCommand": ["comments", "schema", "commentInboxOutput", "--json"],
  "actor": { "id": "codex", "kind": "codex" },
  "cursor": "open:...",
  "count": 3,
  "summary": {
    "requiresAttention": true,
    "attentionReasons": ["owned_live_claims"],
    "recommendedAction": "resume_owned_work",
    "totalOpenThreadCount": 3,
    "openThreadCount": 3,
    "sourceUnavailableCount": 0,
    "mineCount": 1,
    "unclaimedCount": 1,
    "claimedByOthersCount": 1,
    "suggestedCommands": []
  },
  "next": {
    "group": "mine",
    "recommendedAction": "resume_owned_work",
    "threadId": "comment-thread-1",
    "path": "README.md",
    "status": "open",
    "brief": {
      "threadId": "comment-thread-1",
      "path": "README.md",
      "status": "open",
      "recommendedAction": "resume_owned_work",
      "attentionReasons": ["owned_live_claims"],
      "latestComment": "Already claimed by this agent",
      "latestCommentAuthor": "human:reviewer",
      "suggestedCommandIntents": ["renew_owned_claim"]
    }
  },
  "mine": { "threads": [], "claims": [], "count": 1 },
  "unclaimed": { "threads": [], "count": 1 },
  "claimedByOthers": { "threads": [], "claims": [], "count": 1 },
  "sourceUnavailable": { "threads": [], "claims": [], "count": 0 }
}
```

Use `mine` first when the agent only wants its resumable work. Use `inbox` when
the agent needs the whole routing picture: work it already owns, work it may
claim next, and work another live actor is handling. `summary.recommendedAction`
is the adapter branch: `resume_owned_work` when live claims already belong to
the actor, `claim_open_work` when unclaimed GUI feedback is ready,
`wait_for_claim_release` when all open work is owned by other actors, and
`wait_for_gui_feedback` when the queue is empty. `summary.openThreadCount` is
the actionable routed count, while `summary.totalOpenThreadCount` includes open
threads skipped because their source is unavailable; those skipped threads are
reported in `summary.sourceUnavailableCount`. `summary.suggestedCommands`
contains the next safe CLI recipes, such as renewing and following recovered
owned work or starting `comments work` for claimable feedback. Those recipes
preserve the selected `--url`, plus `--receipt-log` where relevant, so a
resident agent can continue against the same GUI/server session. `next` mirrors
the summary branch and points to the first thread the adapter should inspect or
resume; it is `null` when there is no owned, unclaimed, or other-claimed open
work to act on. Pass `--full`
to add rich `items` inside each group. Each item includes a compact `brief`
with the thread id, path, latest comment excerpt, source state when context is
requested, and item-specific suggested command intents. This lets a resident
monitor hand one `items[]` entry directly to a worker agent without copying the
group-level routing summary. `sourceUnavailable.items[]` is included as well:
its briefs use `handle_source_unavailable` and either suggest claiming the
specific thread for guarded handoff/archive guidance or following the existing
claim owner until the missing-source work is released.

`batch <review-batch-id>` is the publish-batch snapshot for agents that are
responding to one human GUI review action. It reads all threads in the batch
without creating read receipts, summarizes terminal progress, and classifies
the still-open subset with the same claim routing used by `inbox`:

```json
{
  "reviewBatchId": "review-batch-...",
  "actor": { "id": "codex", "kind": "codex" },
  "cursor": "batch:...",
  "count": 2,
  "summary": {
    "total": 2,
    "open": 1,
    "resolved": 1,
    "archived": 0,
    "complete": false
  },
  "threads": [],
  "open": {
    "count": 1,
    "summary": {
      "requiresAttention": true,
      "attentionReasons": ["owned_live_claims"],
      "recommendedAction": "resume_owned_work",
      "totalOpenThreadCount": 1,
      "openThreadCount": 1,
      "sourceUnavailableCount": 0,
      "mineCount": 1,
      "unclaimedCount": 0,
      "claimedByOthersCount": 0,
      "suggestedCommands": []
    },
    "mine": { "threads": [], "claims": [], "count": 1 },
    "unclaimed": { "threads": [], "count": 0 },
    "claimedByOthers": { "threads": [], "claims": [], "count": 0 }
  }
}
```

Pass `--full` to add rich `items` for every batch thread and for each open
routing group. This keeps the human's publish action as a coherent unit while
still letting a background agent pick the next claimable thread. The
`open.summary` shape matches `inbox.summary`, so a batch-oriented adapter can
use the same `resume_owned_work`, `claim_open_work`,
`wait_for_claim_release`, and `wait_for_gui_feedback` branches while preserving
the human's review batch as the reporting unit. The source-unavailable routing
group also receives item briefs so a monitor can hand missing-anchor feedback to
a worker without losing the file path or suggested recovery command.

`mine` is the restart/resume command for agents. It returns open threads whose
latest live `thread_claimed` activity belongs to `--actor`, plus the matching
claim activities:

```json
{
  "threads": [],
  "claims": [],
  "count": 0,
  "cursor": "open:..."
}
```

Pass `--full` to include `items` for those claimed threads. `mine` does not
create read receipts or extend leases. Each item brief recommends
`resume_owned_work` and carries owned-thread command intents such as
`renew_current_claim`, so a restarted agent can branch before reading the full
source or activity payload. Use `renew <thread-id>` with a new
`--client-event-id` to keep long-running work live.

`release <thread-id>` is the non-terminal handoff command. It appends a
`thread_claim_released` activity for the current actor, leaves the thread
`open`, and makes the thread claimable by another agent immediately instead of
waiting for `leaseExpiresAt`. Use it when an agent claimed work but decides not
to handle it in this run. `release` requires the latest live claim to belong to
the releasing actor and supports `--client-event-id` for idempotent retries.
Pass `--body` or `--body-file` to add a handoff reply before releasing the
claim. Body-backed release first verifies the live claim, so a stale agent does
not leave a stray comment when another actor has already taken over. The
response includes `comment` only when a handoff reply was created.
For resident adapters, prefer `--triage-file <path|-> --require-claim` when
the handoff reason is structured as `needs-info` or `blocked`: the command
renders the same triage Markdown body, posts it, and releases the live claim in
one guarded operation so another agent can pick up the open thread.

```json
{
  "thread": {},
  "triage": {},
  "comment": {},
  "release": { "type": "thread_claim_released" }
}
```

Pass `--full` for the background-agent triage shape: source context, current
per-file diff, and activity history in one response. It is shorthand for
`--with-context --with-diff --with-activities` and is the preferred intake mode
when a coding agent is responding to GUI feedback.

Pass `--with-context` to include the same `file` and `source` payload returned
by `context` on the selected thread. If no open thread exists, `thread`,
`file`, and `source` are `null` while `count` and `remaining` are `0`. This is
the shortest polling intake path for agents that want one actionable item and
its local source context in a single JSON response.

Pass `--with-diff` to include the current Git diff for the selected thread path
as `diff`. `--diff-base <ref>` selects one of the server-allowed recent diff
bases; the default is `HEAD`. When no open thread exists, `diff` is `null`.

Pass `--with-activities` to include the selected thread's activity history as
`activities`. For actor-attributed `next` calls this includes the read receipt
created by that delivery, so an agent can triage with the human thread, source,
diff, and observation history in one response.

`context` is the focused source-reading command for coding agents. It resolves
the selected thread, loads the referenced file through GraphQL, extracts the
line range from the thread anchor, and returns the thread, file metadata, and a
bounded source snippet:

```json
{
  "thread": {},
  "file": {
    "path": "README.md",
    "viewerKind": "markdown",
    "encoding": "utf8",
    "etag": "sha256:...",
    "size": 42,
    "mtimeMs": 1710000000000
  },
  "source": {
    "path": "README.md",
    "viewerKind": "markdown",
    "encoding": "utf8",
    "available": true,
    "sourceState": "current",
    "sourceChanged": false,
    "fileHash": "sha256:current-file",
    "anchorFileHash": "sha256:comment-anchor",
    "startLine": 1,
    "endLine": 3,
    "anchorStartLine": 2,
    "anchorEndLine": 2,
    "lines": [
      { "number": 1, "text": "# Title", "anchor": false },
      { "number": 2, "text": "Needs work", "anchor": true }
    ]
  }
}
```

`--context-lines <count>` controls the number of source lines before and after
the anchor. Non-UTF-8 or missing-anchor cases return `source.available: false`
with a machine-readable `reason` instead of guessing at a snippet.
`source.sourceState` is `current`, `changed`, `unknown`, or `unavailable`.
`changed` means the comment anchor carries a file hash that no longer matches
the currently loaded file hash; agents should treat it like the GUI's Source
changed indicator and verify the anchor before editing.

Pass `--full` to `context` for the same rich triage shape on a known thread id.
Pass `--with-diff` to add only the `TextDiff` payload for the thread path, and
`--with-activities` to add only the thread activity history. This lets a
background agent triage a human comment with the human's anchor, current
source, current working-tree diff, and conversation history in one response.

`check <thread-id>` is the machine-readable write preflight for agents that are
about to use `--require-claim`. It reads the thread and activity history
without creating read receipts, reports the latest live claim, and returns a
stable reason code:

```json
{
  "thread": {},
  "liveClaim": null,
  "write": {
    "actor": { "id": "codex", "kind": "codex" },
    "canWrite": false,
    "reason": "no_live_claim",
    "recommendedAction": "claim_before_writing",
    "suggestedCommands": [
      {
        "intent": "claim_thread_before_writing",
        "command": "comments claim",
        "args": [
          "comments",
          "claim",
          "<thread-id>",
          "--actor",
          "codex",
          "--full",
          "--json"
        ],
        "reason": "Claim this open thread and receive source, diff, and activity context before writing."
      }
    ]
  }
}
```

`write.reason` is `owned_live_claim`, `no_live_claim`,
`claimed_by_other_actor`, or `thread_not_open`. Use it immediately before a
terminal reply when an agent wants to decide whether to proceed, renew, release,
or refetch the work item. `write.recommendedAction` and
`write.suggestedCommands` are the higher-level adapter path: no-claim checks
suggest `comments claim <thread-id> --full`, owned-claim checks suggest
`renew`, guarded `reply`, structured `triage`, `done`, and `dismiss`,
other-owner checks suggest `show` plus `follow`, and terminal threads suggest
`show` plus `reopen`. Suggestions preserve the check command's resolved
`--url`, and write suggestions also preserve `--receipt-log`. The output is
described by `commentCheckOutput`, including the nested write preflight reason,
recommended action, and suggested command recipes. Pass `--full` to include the same source, diff, and
activity payloads as `context --full`.

`watch` emits newline-delimited JSON events. It is an open worklist watcher,
not a claim operation. It polls `commentThreads(status: open)`,
emits the current open worklist on startup by default, and then emits another
full open-worklist snapshot whenever the cursor changes. Pass
`--no-initial` to wait for future changes only, or `--cursor <cursor>` with a
cursor from a previous event to suppress duplicate delivery after restart. Each
event is shaped as:

```json
{
  "type": "comments_open_worklist",
  "schemaVersion": 1,
  "eventSchema": "commentOpenWorklistEvent",
  "eventSchemaCommand": [
    "comments",
    "schema",
    "commentOpenWorklistEvent",
    "--json"
  ],
  "reason": "initial",
  "changes": ["open_thread_added"],
  "cursor": "open:...",
  "emittedAt": "2026-06-21T00:00:00Z",
  "count": 1,
  "summary": {
    "requiresAttention": true,
    "attentionReasons": ["open_threads_available"],
    "recommendedAction": "claim_open_work",
    "openThreadCount": 1,
    "suggestedCommands": [
      {
        "intent": "claim_next_open_thread",
        "command": "comments work",
        "args": [
          "comments",
          "work",
          "--actor",
          "codex:agent",
          "--once",
          "--full",
          "--json"
        ],
        "reason": "Claim the next open thread, emit one self-describing work event, and exit."
      }
    ]
  },
  "threads": []
}
```

`reason` is `initial`, `resumed`, or `open_worklist_changed`; `changes`
contains coarse causes such as `open_thread_added`, `open_thread_updated`, and
`open_thread_removed`. The cursor is a stable hash of the delivered open
worklist and is safe to reuse for idempotent resume. `--once` performs one
watch iteration and exits, `--max-events <count>` exits after that many
delivered snapshots, `--interval <duration>` controls the polling cadence, and
`--no-initial` records the current cursor as the baseline before waiting for a
future open-worklist change. If delivery can be duplicated across process
restarts, agents should key their own work by `cursor` and thread ids.
When open threads are available, `summary.recommendedAction` is
`claim_open_work` and `summary.suggestedCommands` includes
`comments work --actor <actor> --once --full --json` so an agent can claim the
next thread and return control to its own coding loop without hard-coding the
handoff. That suggestion includes a cursor-derived `clientEventId` and matching
`--client-event-id` argv for retry-safe claim correlation. It also preserves the
watch command's resolved `--url` and receipt ledger flag when present. When the
worklist is empty the recommended action is `wait_for_open_work`.

Pass `--full` to add the complete `items` array to each delivered watch event.
Pass `--with-context` and/or `--with-diff` for narrower item payloads. When
`--with-activities` is also set, each item includes activity history. The item
shape is:

```json
{
  "items": [
    {
      "thread": {},
      "brief": {
        "threadId": "comment-thread-...",
        "path": "README.md",
        "recommendedAction": "claim_open_work",
        "suggestedCommandIntents": ["claim_open_thread"]
      },
      "file": {},
      "source": {},
      "diff": {},
      "activities": []
    }
  ]
}
```

Each item is aligned with one open thread and is intended as the background
agent's triage unit: a compact `brief` for routing or sub-agent handoff, the
human comment thread, the anchored source snippet when requested, the current
per-file diff when requested, and the thread activity history when requested.
The event-level summary still describes the whole open worklist, so an event
can recommend `claim_open_work` while a specific item brief recommends
`handle_source_unavailable` because that item's source path is missing.
For actor-attributed watch deliveries, the activity list includes the delivered
read receipt keyed by the event cursor. The legacy `threads` array remains
present for clients that only need the worklist snapshot.

When `--actor` is set, watch records read receipts only for delivered
snapshots. The client event id is derived from `--client-event-id` when
supplied, otherwise `comments-watch`, plus the delivered cursor, so reconnecting
with the same cursor does not create duplicate read receipts. A transient
server disconnect or network failure does not produce a worklist event; a
long-running watch retries on the next interval, while `--once` surfaces the
request failure as a non-zero command error.

`follow <thread-id>` emits newline-delimited JSON activity batches for one
thread. It is for an agent that already claimed work and wants to notice human
follow-up comments, claim releases, terminal status changes, or other activity
while editing:

```json
{
  "type": "comment_thread_activity_batch",
  "reason": "activity_changed",
  "threadId": "comment-thread-...",
  "cursor": "activity-id",
  "emittedAt": "2026-06-21T00:00:00Z",
  "count": 1,
  "activities": []
}
```

On startup, `follow` emits the current activity history unless `--no-initial`
is set. Pass `--cursor <activity-id>` to resume after the last delivered
activity; the next event uses reason `resumed` when new activity exists. Use
`--once` for a single poll and `--max-events <count>` for bounded harnesses.
The robust agent pattern is to read the current thread activity cursor after
`claim` or `renew`, start `follow --cursor <activity-id>`, and then keep that
stream beside long edits so human GUI follow-up is not lost.

Single-thread lifecycle commands return `{ "thread": ... }`; `reply` returns
`{ "comment": ... }`; `triage` returns
`{ "triage": ..., "comment": ..., "thread": ... }`; `done` and `dismiss` return
`{ "comment": ..., "thread": ... }`, plus `{ "result": ... }` when
`--result-file` is used;
`show` returns `{ "thread": ..., "activities": [...] }`. Published review
batches add `reviewBatchId` to returned threads and comments as auxiliary
metadata. Draft review comments are not returned by `active`, `next`, `watch`,
`list`, or `show`; after publish, the resulting `open` threads appear as
ordinary open worklist items.

`claim --review-batch <id> --full` is the safest default intake for background
agents that are responding to one published GUI review batch. It returns one
claimed thread, a `thread_claimed` activity with `leaseExpiresAt`, and the same
source, diff, and activity payloads used by rich work items. The thread remains
`open` until the agent replies with `done` or `dismiss`, and its
`commentClaimOutput.summary` carries the same initial structured write
suggestions as the integrated `work` claimed event.
Use `claim --wait --full` for a resident agent that should block until one
claimable feedback item exists.
Use `work --loop` when an adapter wants a compact resident stream that
claims work, renews the lease, and follows human updates without embedding the
full diff in every work event or spending context on unchanged idle periods.
Add `--idle-events` only when the adapter needs explicit waiting-state events.
Add `--full` only when the adapter needs rich source, diff,
and activity payloads inline instead of fetching them on demand.
Use `batch <review-batch-id> --full` when the agent is responding to one
published GUI review batch and needs progress plus routing in one payload.
Use `mine --json` after an agent restart to recover compact live-claim routing
before claiming more work; add `--full` only when the recovery snapshot itself
needs source, diff, and activity payloads. `mine` includes a `summary` with
`recommendedAction` and `suggestedCommands`; when owned work exists the
suggested path is renew the claim, follow the thread, then run a guarded
`check` before writing.
Use `renew <thread-id>` as a heartbeat while triage, edits, or verification are
still in flight.
Use `hold <thread-id>` while running long edits or checks so the GUI keeps
showing a live owner and `--require-claim` terminal writes do not fail after
the lease expires.
Use `check <thread-id>` right before a guarded write when the agent wants a
JSON preflight instead of discovering stale ownership from a terminal error.
Use `inbox --json` for a compact snapshot of owned, unclaimed, and
other-claimed routing before deciding its next command. Read `summary` for the
branch decision and `next` for the first concrete thread target; add `--full`
only when the snapshot itself needs source, diff, and activity payloads.
Use `release <thread-id> --triage-file <path|-> --require-claim` to explain a
blocked or needs-info handoff with structured JSON and release the claim
without resolving or archiving it. Use `release <thread-id> --body-file <path>`
for a free-form handoff.

`reply`, `done`, and `dismiss` accept exactly one of `--body <text>` or
`--body-file <path|->`. `--body-file` is the general Markdown path for coding
agents when the reply contains verification output or multi-line detail,
because it avoids shell quoting and sends the file or stdin content through
the normal comment body validation. For terminal agent adapters, prefer
`done`/`dismiss --result-file <path|->` so completion data stays structured
until the CLI renders the human-readable comment body.

`triage <thread-id>` is the non-terminal acknowledgement path for resident
agents. It posts a structured agent comment and leaves the thread `open`, so a
human can see that feedback was received before the final `done` or `dismiss`.
The command requires `--actor` and a decision; supported decisions are
`accepted`, `fixing`, `needs-info`, `blocked`, and `not-applicable`. For shell
use it accepts `--decision`, `--summary`, `--next-action`, and optional `--body`
or `--body-file` details, then renders a human-readable Markdown comment:

```json
{
  "triage": {
    "decision": "accepted",
    "summary": "The feedback is actionable.",
    "nextAction": "Patch the copy and run task check.",
    "body": "Triage: accepted\n\nSummary: ..."
  },
  "comment": {},
  "thread": { "status": "open" }
}
```

For adapters, prefer `--triage-file <path|->` with JSON so the model can emit
one structured artifact without shell quoting. The same payload is accepted by
`triage` to keep ownership and by `release` to post the explanation and hand
the still-open thread back to the queue. Suggested triage commands include an
intent-specific `stdinExample`, so a resident adapter can distinguish initial
claim acknowledgement, human follow-up acknowledgement, generic acknowledgement,
needs-info, and blocked handoff without inventing its own wording table:

```json
{
  "decision": "accepted",
  "summary": "The feedback is actionable.",
  "nextAction": "Patch the copy and run task check.",
  "details": "- Source anchor confirmed\n- No clarification needed"
}
```

`--triage-file` is mutually exclusive with `--decision`, `--summary`,
`--next-action`, `--body`, and `--body-file`; pass `--triage-file -` to read
that JSON from stdin. The output is described by `commentTriageOutput`: it
contains the rendered `triage` object, the created or reused agent `comment`,
the still-open `thread`, and the write `receipt`.

For retry safety, if the same actor has already posted the same generated
triage body on that thread, `triage` returns the existing comment instead of
creating a duplicate. Pass `--require-claim` in background-agent loops so a
stale process cannot acknowledge feedback after another actor has taken over.

For terminal replies, `done` and `dismiss` also accept `--result-file
<path|->` with JSON fields `summary`, `verification`, and `details`:

```json
{
  "summary": "Fixed the requested behavior.",
  "verification": ["go test ./cli passed", "task check passed"],
  "details": "- Source anchor confirmed\n- Completion reply is retry-safe"
}
```

The terminal reply output is described by `commentResultOutput`. It always
contains the created or reused agent `comment`, the terminal `thread`, and the
write `receipt`; when `--result-file` is used it also includes the rendered
`result` object with `outcome`, `summary`, `verification`, `details`, and
`body`.

The CLI renders that into a Markdown comment beginning with `Result: resolved`
for `done` or `Result: archived` for `dismiss`, and returns a `result` object
alongside `comment` and `thread`:

```json
{
  "result": {
    "outcome": "resolved",
    "summary": "Fixed the requested behavior.",
    "verification": ["go test ./cli passed"],
    "body": "Result: resolved\n\nSummary: ..."
  },
  "comment": {},
  "thread": { "status": "resolved" }
}
```

`--result-file` is mutually exclusive with `--body`, `--body-file`, and
`--triage-file`; pass `--result-file -` to read the JSON from stdin. At least
one of `summary`, `verification`, or `details` must be non-empty.

Pass `--require-claim` to `reply`, `triage`, `done`, `dismiss`, `resolve`, or `archive`
when the command is part of a background-agent loop that previously used
`claim`. The CLI fetches the latest activity history without creating a read
receipt and refuses to write unless the current `--actor` owns the latest live
`thread_claimed` lease. This guards against stale agent processes replying or
closing feedback after another actor has claimed the same thread. Use `renew`
before the terminal command if a long edit or test run may have let the lease
expire.

`done` is the shortest terminal path for coding agents. It adds the supplied
reply to an open thread and then resolves that thread, using the same actor
input as `reply` and `resolve`. If the same actor has already posted the same
completion reply and the thread is already resolved, `done` returns the
existing comment and resolved thread instead of adding a duplicate reply.
When `--client-event-id` is supplied, the underlying reply and resolve
activities also become retry-safe for that logical attempt.

`dismiss` is the archived counterpart for triage decisions where the agent is
intentionally not making a code change. It adds the supplied explanation to an
open thread and then archives that thread. If the same actor has already posted
the same explanation and the thread is already archived, `dismiss` returns the
existing comment and archived thread instead of adding a duplicate reply.
When `--client-event-id` is supplied, the underlying explanation and archive
activities also become retry-safe for that logical attempt.

## GraphQL data API

`POST /graphql` is Vivi's canonical, schema-first API and the only normal SPA
data path. Requests use JSON GraphQL
envelopes with `query`, `operationName`, and optional `variables`; responses use
GraphQL-style `{ "data": ... }` or `{ "errors": [...] }` bodies.

The schema lives at `server/graphql/schema.graphqls`, with Go server code
generated by `gqlgen`. Run `task generate` after schema or UI operation changes;
it regenerates both Go bindings and TypeScript operation types. UI operations
live in `ui/src/infrastructure/vivi-api/graphql/operations` and generated types
remain private to the adjacent `generated` directory. The schema models Vivi concepts
directly: workspace config, tree snapshots, file payloads, file context, Git
review queue, diffs, file/text search, comments, and first-class
`CommentThread` objects. `FileContext` includes both the compatibility
`comments` list and `commentThreads`, so callers can move from flat comments to
the file -> thread -> comment graph without changing the file loading flow.
Comment storage remains compatible with existing comment records; GraphQL groups
comments into threads with an explicit `threadId` when present and otherwise
treats each existing comment as its own thread. New comments receive a
`threadId` matching their first comment id unless a caller supplies an existing
thread id. `updateCommentThread` updates the status of every comment currently
in that thread and returns the updated `CommentThread`.
`comments(path, status, reviewBatchId)` and
`commentThreads(path, status, reviewBatchId)` support filtering by the
published review batch id, which is the same server-side filter used by
`vivi comments --review-batch`.

Draft review comments are a separate pre-publish resource, not a
`CommentStatus`. `draftReviewComments(path)` lists unpublished draft comments
for the UI. `createDraftReviewComment`, `updateDraftReviewComment`, and
`deleteDraftReviewComment` manage that draft set. `publishDraftReviewComments`
converts all drafts, or the supplied `draftIds`, into `open` `CommentThread`
objects in one review batch and returns `{ reviewBatchId, publishedAt,
threads }`. Drafts with no `threadId` are grouped by path and anchor during
publish, so multiple drafts on the same anchor become comments in one new review
thread. A draft with an explicit `threadId` is published as a reply to that open
thread. Before publish, drafts are
intentionally absent from `comments`, `commentThreads(status: open)`, and the
agent comments CLI.

`commentExport` exposes the comment export data path through GraphQL. The
current supported format is `jsonl`, returned as `CommentExport.content` with
`contentType: "application/x-ndjson; charset=utf-8"`. The REST export route
stays available as a compatibility wrapper.

Comment activity is read-only in the GraphQL schema. `commentThreadActivities`
returns bounded history and `commentThreadActivity` streams new events. Thread
read events are appended as an observed side effect of `comments`,
`commentThreads`, or `fileContext(includeComments: true)` when the request
includes `X-Vivi-Actor-Id`. `X-Vivi-Actor-Kind`, `X-Vivi-Actor-Name`, and
`X-Vivi-Client-Event-Id` are optional attribution and idempotency headers.

Preview routes remain HTTP rendering transports. GraphQL exposes preview
resource metadata and URLs, while `/preview/html` and `/preview/raw/*` continue
to serve sandboxed iframe/raw bytes with the existing security headers and
script opt-in behavior.

The REST routes below remain available as compatibility wrappers during the
GraphQL migration.

## Removed legacy REST data API

The former `/api/*` and `/api/v1/*` data endpoints are not served by the Go
runtime. They are documented below only as migration history for older clients;
new code and tests must use the GraphQL operations above. Preview, static asset,
and event-stream transports remain HTTP because they carry resources rather
than workspace data.

### `GET /api/tree`

Returns the current filesystem tree under the selected root.

By default this returns the full tree for compatibility. The SPA may request a
bounded lazy tree with `depth=1`, and may request one directory's children with
`path=<relative-directory>&depth=1`. Lazy directory nodes include
`childrenLoaded: false` until their children have been requested.

```json
{
  "root": ".",
  "version": 1,
  "path": "",
  "depth": 1,
  "nodes": [
    {
      "id": "README.md",
      "path": "README.md",
      "name": "README.md",
      "kind": "file",
      "viewerKind": "markdown",
      "parentPath": ""
    }
  ],
  "stats": {
    "durationMs": 3,
    "scannedDirectories": 1,
    "scannedFiles": 4,
    "returnedNodes": 6
  }
}
```

### `GET /api/files?q=<query>&limit=<count>`

Returns bounded file-path matches from backend filesystem traversal. This is
used by Quick open so the browser does not need to hold the full tree for large
workspaces. The Go backend may build an in-memory filename index on the first
query and reuse it for later queries in the same process; watcher-observed
workspace add/change/unlink events invalidate the index before later searches.
`stats.cached` is `true` only when a response reused that index without another
recursive filesystem walk.

```json
{
  "query": "guide",
  "results": [
    {
      "path": "docs/guide.md",
      "name": "guide.md",
      "viewerKind": "markdown",
      "size": 1200,
      "mtimeMs": 1710000000000,
      "score": 97
    }
  ],
  "stats": {
    "durationMs": 8,
    "scannedDirectories": 12,
    "scannedFiles": 240,
    "readFiles": 0,
    "skippedFiles": 0,
    "cached": false
  }
}
```

### `GET /api/file?path=<relative-path>`

Returns file content and metadata for a relative path under the root.

```json
{
  "path": "README.md",
  "viewerKind": "markdown",
  "encoding": "utf8",
  "content": "# Example",
  "etag": "sha256:...",
  "size": 10,
  "mtimeMs": 1710000000000,
  "mimeType": "text/markdown; charset=utf-8",
  "truncated": false,
  "maxSizeBytes": 1048576
}
```

Image payloads use `encoding: "base64"` and include a MIME type suitable for browser display. Unknown files are sniffed from a bounded leading byte sample: safe UTF-8 text falls back to `viewerKind: "text"`, while NUL bytes, invalid UTF-8, or a high control-character ratio fall back to `viewerKind: "binary"` with `encoding: "none"` and empty `content`. Files larger than the configured preview limit use `truncated: true`. Text-like large files may include a bounded leading UTF-8 `content` chunk with `previewBytes`; HTML, image, binary, and other non-text large files use `encoding: "none"` and empty `content`.

### `GET /api/search?q=<query>&limit=<count>`

Returns bounded, read-only full-text matches across text-previewable files under the selected root. Search is best-effort and skips binary, unsupported, ignored, excluded, and truncated files. Results are line-oriented and intended for opening the matching file in the SPA.

```json
{
  "query": "local",
  "results": [
    {
      "path": "README.md",
      "viewerKind": "markdown",
      "lineNumber": 3,
      "lineText": "Open a local workspace",
      "matchStart": 7,
      "matchLength": 5
    }
  ],
  "stats": {
    "durationMs": 24,
    "scannedDirectories": 18,
    "scannedFiles": 320,
    "readFiles": 46,
    "skippedFiles": 7
  }
}
```

### `GET /api/config`

Returns viewer configuration needed by the SPA.

```json
{
  "root": "/absolute/served/root",
  "allowHtmlScripts": false,
  "maxFileSizeBytes": 1048576
}
```

### `GET /api/v1/meta`

Returns versioned API metadata for comment clients.

```json
{
  "version": "v1",
  "comments": {
    "statuses": ["open", "resolved", "archived"],
    "surfaces": ["source", "rendered", "diff"],
    "exportFormats": ["jsonl"]
  }
}
```

### `GET /api/v1/comments?path=<relative-path>&status=open`

Returns persisted comments. `path` and `status` filters are optional. Status is
one of `open`, `resolved`, or `archived`.

Each comment has one shared identity and body across source, rendered, and diff
views. The canonical source anchor is the primary location. Rendered and diff
anchors are auxiliary view anchors that map back to that source anchor when
available.
Code and Markdown source views share one source-comment interaction: gutter
clicks, gutter drags, and partial text selections resolve to a canonical line or
line range and open an inline thread. A comment created on either source or
rendered Markdown is projected into the other view through that canonical
range; the persisted comment format and identity do not change.
Rendered Markdown and HTML comments target a readable rendered block rather than
an arbitrary text range. `rendered.blockId` is Vivi's per-render block identity
for paragraphs, headings, list items, code blocks, table rows, and similar
reader-visible units; `selector` and `textQuote` remain as fallback anchors.
In rendered mode, the same block owns the click-to-add interaction, drafting
highlight, persisted highlight, and active-comment highlight. A saved Markdown
block also shows a compact comment marker whose badge reports the number of
messages mapped to that block; both the marker and highlighted block open the
same replyable inline thread. A rendered Markdown selection may span multiple
blocks; Vivi normalizes that selection to one canonical source line range,
highlights every intersecting rendered block, and places the inline thread and
count marker at the final selected block, matching source range comments. Because the thread
remains in document flow, it stays at the commented location while the reader
scrolls. Sandboxed HTML previews keep the
same block anchor and highlight model, while the HTML iframe receives only
anchor summaries and never comment bodies. Markdown source ranges come from
lexer tokens. HTML source ranges are computed by the parent/server from the
original file and injected as reserved `data-vivi-*` attributes; page-authored
values for those attributes are not trusted. The existing iframe sandbox and
script opt-in policy remain in force.

New clients use explicit thread ids for conversations. Anchor grouping is a
legacy UI fallback only. See `docs/22-comment-thread-lifecycle.md`.

### `POST /api/v1/comments`

Creates a comment. The request must be JSON and is intended for local-server use.
The server validates Host/Origin headers where practical. Diff comments are only
accepted for `side: "current"` and `changeKind: "context"` or `"added"`.

```json
{
  "path": "README.md",
  "viewerKind": "markdown",
  "body": "Clarify this paragraph.",
  "anchor": {
    "surface": "rendered",
    "canonical": {
      "path": "README.md",
      "lineStart": 12,
      "lineEnd": 12,
      "quote": "Rendered selected text",
      "fileHash": "sha256:..."
    },
    "rendered": {
      "kind": "markdown",
      "blockId": "vivi-block-4",
      "selector": "p:nth-of-type(3)",
      "textQuote": "Rendered selected text",
      "sourceLineStart": 12,
      "sourceLineEnd": 12
    }
  }
}
```

### `PATCH /api/v1/comments/:id`

Updates a comment body or status.

```json
{
  "status": "resolved"
}
```

### `GET /api/v1/comments/export?status=open&format=jsonl`

Exports thread-aware JSONL for coding agents. `format=jsonl` is required. Each
line is a schema v2 `commentThread` record containing thread status, anchor,
lifecycle timestamps, and ordered messages. Filters apply to threads.

### `GET /api/changes`

Returns read-only Git working-tree review status when the selected root is inside a Git repository. This is a viewer aid, not a staging or history API. If Git is unavailable or the root is not a worktree, the endpoint returns `available: false` with a reason.

```json
{
  "available": true,
  "changes": [
    { "path": "README.md", "status": "modified", "kind": "file" },
    { "path": "reports/new.csv", "status": "added", "kind": "file" },
    {
      "path": "vendor/charts",
      "status": "added",
      "kind": "embedded-repo"
    },
    {
      "path": "docs/new-name.md",
      "status": "renamed",
      "kind": "file",
      "originalPath": "docs/old-name.md"
    }
  ]
}
```

Statuses are `added`, `modified`, `deleted`, or `renamed`.
Kinds are `file`, `directory`, or `embedded-repo`. Git-backed review changes
normally report file entries; untracked embedded Git repositories are surfaced as
single `embedded-repo` entries and are not expanded.

Untracked directories are expanded to file-level `added` entries. Directory
paths are not review queue items unless the adapter cannot enumerate them; in
that case they are marked as `kind: "directory"` and treated as not diffable.

### `GET /api/diff-bases`

Returns recent read-only Git commit bases that the UI may use for diff comparison. The server only accepts bases from this allow-list.

```json
{
  "available": true,
  "options": [
    { "ref": "HEAD", "label": "HEAD", "subject": "current commit" },
    { "ref": "abc123...", "label": "HEAD~1", "subject": "previous commit" }
  ]
}
```

### `GET /api/diff?path=<relative-path>&base=<ref>`

Returns a bounded read-only text diff for a changed file. The comparison is the selected allowed base ref to the current working tree. If `base` is omitted, `HEAD` is used. Large and binary diffs are not returned; the response explains why.

```json
{
  "path": "README.md",
  "status": "available",
  "baseLabel": "HEAD",
  "compareLabel": "working tree",
  "content": "diff --git a/README.md b/README.md\n..."
}
```

Diff statuses are `available`, `too-large`, `binary`, or `unavailable`.
An `unavailable` response may include `kind: "directory"` or
`kind: "embedded-repo"` when the path is a valid review entry but cannot produce
a blob diff. These cases are returned as `200` with a reason rather than as
handler failures.

If a route throws a filesystem error before producing its normal response, the
server returns a diagnostic JSON body with `error`, `reason`, and `status`
fields. Known filesystem errors are mapped to request-level statuses such as
`400`, `403`, or `404`; unexpected errors remain `500` and are logged by the
server.

### `GET /preview/html?path=<relative-path>`

Returns HTML for iframe preview. The server must validate the path and send conservative headers.

### `GET /events`

SSE stream of filesystem events.

```json
{"type":"change","path":"README.md","version":2}
{"type":"add","path":"docs/new.md","kind":"file","version":3}
{"type":"unlink","path":"old.html","kind":"file","version":4}
```

## Contract stability rules

- Changes to API response shapes require tests and documentation updates.
- Additive fields are acceptable when documented.
- Removing fields or changing meanings requires an explicit contract-change note.
