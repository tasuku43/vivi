# CommentThread lifecycle

## Responsibilities

`CommentThread` is the review work item and conversation boundary. It owns the
stable id, file path, anchor, lifecycle status, lifecycle timestamps, and the
ordered collection of messages. Status changes always target a thread.

`Comment` is one immutable-identity message inside a thread. It owns the body,
actor, and message timestamps. `Comment.status`, `resolvedAt`, and `archivedAt`
remain readable for
v1 compatibility, but API responses project the owning thread lifecycle onto
those fields. New clients must not use message status as an independent review
state.

`CommentActor` is shared by comments and activity events. It has a stable
client-supplied `id`, a `kind` (`human`, `claude_code`, `codex`, or `unknown`),
and an optional display name. Missing actor data on legacy records is projected
as `unknown`. Actor identity is attribution, not authentication.

`DraftReviewComment` is outside the public thread lifecycle. It is a
pre-publish human review note with a path, body, actor, and anchor, but no
`open`, `resolved`, or `archived` status. Publishing drafts creates normal
`open` threads; it does not add `draft` to `CommentStatus`.

## Activity events

Activity is append-only observation history and never changes thread status.
For example, a coding agent can fetch open threads with actor request headers;
the server observes that read and appends `thread_read`, while the thread
remains `open`. The GUI can query the history and subscribe to live events to
show which actor has observed or changed the conversation.

The public event kinds are `thread_created`, `thread_read`, `comment_added`,
`comment_updated`, `thread_status_changed`, `thread_claimed`, and
`thread_claim_released`. Every event carries the same `CommentActor` shape, a
server id and timestamp, and relevant optional fields such as `commentId`,
`previousStatus`, `status`, and `leaseExpiresAt`.

Activity events are not public write resources in GraphQL. Reads are recorded
automatically when a request includes `X-Vivi-Actor-Id`; optional
`X-Vivi-Actor-Kind`, `X-Vivi-Actor-Name`, and `X-Vivi-Client-Event-Id` headers
provide attribution and idempotency. The client event id is scoped to the
thread, actor, and event type, so retrying a CLI request does not create
duplicate read receipts. `commentThreadActivities(threadId, after, first)`
provides bounded history; `commentThreadActivity(threadId)` streams new events
without replaying history.

## Status model

| Status     | UI                                                    | Active review | Default agent worklist              | Export                                  | Reopen       |
| ---------- | ----------------------------------------------------- | ------------- | ----------------------------------- | --------------------------------------- | ------------ |
| `open`     | Inline markers and the Open list                      | Included      | Included by querying `status: open` | Included in open/all exports            | Already open |
| `resolved` | Hidden inline; visible in the Resolved history filter | Excluded      | Excluded                            | Included when resolved/all is requested | Yes          |
| `archived` | Hidden inline; visible in the Archived history filter | Excluded      | Excluded                            | Included when archived/all is requested | Yes          |

Allowed transitions are `open -> resolved`, `open -> archived`,
`resolved -> open`, `resolved -> archived`, and `archived -> open`. Repeating
the current status is idempotent. `archived -> resolved` is rejected: reopen
first so the return to active review is explicit. A resolved or archived thread
must be reopened before another message can be added.

`acknowledged`, `in_progress`, and assignment are future workflow candidates.
Agent claims are modeled as activity events, not statuses: a `thread_claimed`
event records which actor has accepted the work and the `leaseExpiresAt` time
after which another agent may safely claim it. A `thread_claim_released` event
clears that live claim immediately. Clients can still reason about the
three-state lifecycle without guessing whether a transient agent state is
terminal.

Draft review comments are also deliberately not statuses. They are hidden from
`comments`, `commentThreads(status: open)`, and agent CLI worklists until the
user publishes the batch.

## Storage

Vivi keeps `comments.jsonl` under a workspace-scoped data directory such as
`$VIVI_DATA_DIR/workspaces/<workspace-fingerprint>/comments.jsonl`. The
fingerprint is derived from the canonical workspace root so unrelated projects
do not share comment inboxes. The historical one-message-per-line shape is
unchanged. New messages add `threadId`, `source`, optional `author`, and
optional `reviewBatchId`; old rows remain valid.

Unpublished review drafts are stored separately in
`comment-drafts.jsonl` in that same workspace-scoped data directory. Keeping
drafts out of `comments.jsonl` and the thread event log makes recovery, discard,
and publish behavior explicit: delete removes the draft row, while publish
creates public comments and clears the corresponding drafts.

Thread metadata is projected from messages and an append-only
`comment-threads.jsonl` event log:

```json
{"schemaVersion":1,"id":"...","type":"thread.created","threadId":"...","actor":{"id":"human:tasuku","kind":"human"},"at":"...","thread":{"id":"...","path":"README.md","anchor":{},"status":"open","createdAt":"...","updatedAt":"..."}}
{"schemaVersion":1,"id":"...","type":"comment.added","threadId":"...","commentId":"...","actor":{"id":"codex:run-2","kind":"codex"},"clientEventId":"triage-open-1","at":"..."}
{"schemaVersion":1,"id":"...","type":"thread.read","threadId":"...","actor":{"id":"claude-code:run-1","kind":"claude-code"},"clientEventId":"fetch-open-1","at":"..."}
{"schemaVersion":1,"id":"...","type":"thread.claimed","threadId":"...","actor":{"id":"codex:run-2","kind":"codex"},"clientEventId":"claim-open-1","leaseExpiresAt":"...","at":"..."}
{"schemaVersion":1,"id":"...","type":"thread.claim_released","threadId":"...","actor":{"id":"codex:run-2","kind":"codex"},"clientEventId":"release-open-1","at":"..."}
{"schemaVersion":1,"id":"...","type":"thread.status_changed","threadId":"...","actor":{"id":"codex:run-2","kind":"codex"},"previousStatus":"open","status":"resolved","clientEventId":"done-open-1","at":"..."}
```

Agent writes use `clientEventId` as the operation id for retry safety. For the
same actor and thread, replaying `reply`, `triage`, `done`, or `dismiss` with
the same `--client-event-id` reuses the matching `comment.added` event instead
of appending another agent message. Terminal shortcuts also store the same id
on the lifecycle event, so a retried `done` or `dismiss` can be correlated
across both the explanatory comment and the status change.

For a legacy row without `threadId`, the projection uses `comment.id` as the
thread id and its stored status as the initial thread status. Reading does not
rewrite or migrate `comments.jsonl`. This on-read projection is the migration.

An event log was chosen over separate active/archive files because moving
records between files makes one status change a multi-file transaction. The
log keeps lifecycle writes append-only while preserving the established
message file and read-only historical data. Compaction can later write an
equivalent checkpoint without changing the projection contract.

## GraphQL and agent workflow

New integrations use:

- `createThread(input)` to create the review item and first message.
- `addComment(threadId, input)` to reply to an open thread.
- `updateComment(id, input)` to edit a message body.
- `resolveThread(id)`, `archiveThread(id)`, and `reopenThread(id)` for lifecycle.
- `claimThread(id, input)` to append a non-terminal, actor-attributed
  `thread_claimed` activity with a lease.
- `releaseThreadClaim(id, input)` to append a non-terminal
  `thread_claim_released` activity and hand the open thread back.
- `draftReviewComments`, `createDraftReviewComment`,
  `updateDraftReviewComment`, `deleteDraftReviewComment`, and
  `publishDraftReviewComments` for the UI's pre-publish review batch.

`createComment`, status in `updateComment`, and `updateCommentThread` remain as
v1 compatibility operations. New coding-agent clients should query
`commentThreads(status: open)` with `X-Vivi-Actor-*` headers, preserve the
returned thread id while working, add their reply with an explicit origin, then
call a terminal lifecycle mutation. This makes retries and stale message ids
safer than updating each message independently.

`publishDraftReviewComments` returns a `PublishedReviewBatch` with one
`reviewBatchId`. Every resulting open thread and first comment carries that id,
allowing coding agents to group all threads from the same human publish action.

The CLI wrapper for that workflow is:

```bash
vivi comments active --actor claude-code --client-event-id fetch-open-1 --json
vivi comments active --actor claude-code --client-event-id fetch-open-1 --full --json
vivi comments active --actor claude-code --client-event-id fetch-open-1 --review-batch review-batch-... --full --json
vivi comments next --actor codex --client-event-id next-open-1 --json
vivi comments next --actor codex --with-context --context-lines 6 --json
vivi comments next --actor codex --full --json
vivi comments claim --actor codex --client-event-id claim-open-1 --review-batch review-batch-... --full --json
vivi comments claim <thread-id> --actor codex --lease 10m --json
vivi comments claim --wait --actor codex --client-event-id claim-wait-1 --full --json
vivi comments work --wait --actor codex --client-event-id work-open-1 --json
vivi comments work --loop --actor codex --client-event-id work-loop-1 --idle-events --json
vivi comments renew <thread-id> --actor codex --client-event-id renew-open-1 --lease 10m --json
vivi comments hold <thread-id> --actor codex --client-event-id hold-open-1 --interval 2m --lease 10m --json
vivi comments inbox --actor codex --json
vivi comments batch review-batch-... --actor codex --full --json
vivi comments mine --actor codex --json
vivi comments release <thread-id> --actor codex --client-event-id release-open-1 --json
vivi comments release <thread-id> --actor codex --body-file /tmp/vivi-handoff.md --client-event-id release-open-1 --json
vivi comments release <thread-id> --actor codex --triage-file - --require-claim --client-event-id release-open-1 --json
vivi comments done <thread-id> --actor codex --body-file /tmp/vivi-reply.md --require-claim --json
vivi comments protocol --json
vivi comments watch --actor claude-code --json
vivi comments follow <thread-id> --no-initial --json
vivi comments show <thread-id> --json
vivi comments check <thread-id> --actor codex --json
vivi comments context <thread-id> --full --context-lines 6 --json
vivi comments reply <thread-id> --body "Implemented in this branch" --actor codex --json
vivi comments reply <thread-id> --body-file /tmp/vivi-reply.md --actor codex --json
vivi comments triage <thread-id> --decision accepted --summary "Actionable feedback" --actor codex --json
vivi comments triage <thread-id> --triage-file /tmp/vivi-triage.json --actor codex --json
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
vivi comments done <thread-id> --body "Implemented in this branch" --actor codex --json
vivi comments done <thread-id> --body-file /tmp/vivi-reply.md --actor codex --json
vivi comments done <thread-id> --result-file - --actor codex --json
vivi comments dismiss <thread-id> --body "Not applicable to this workspace" --actor codex --json
vivi comments dismiss <thread-id> --body-file - --actor codex --json
vivi comments resolve <thread-id> --actor codex --json
```

`comments next` is the one-shot intake path for coding agents that want a
single work item instead of a whole worklist or long-running stream. It returns
the oldest open thread, the open-worklist cursor, total count, and remaining
open count. It is intentionally read-only: it records observation through the
normal read-receipt path but does not add `in_progress`, assignment, or a lease.
Use `--full` when the agent should receive the selected thread, its
anchor-centered source snippet, current per-file Git diff, and thread activity
history in the same response. It is shorthand for
`--with-context --with-diff --with-activities`; use the individual flags only
when an adapter needs a narrower payload.

`comments active --full` is the matching one-shot intake path for agents that
want every currently open GUI feedback thread in one response. It keeps the
compatible `threads` worklist and adds `items`, one rich triage unit per
thread. `comments list --status <status> --full` uses the same shape for
explicit filters.
Add `--review-batch <id>` when the agent should process exactly one human
publish action; the GraphQL query is filtered server-side, so read receipts do
not leak to unrelated open threads.

`comments claim` is the lease-aware intake path for background coding agents.
With no thread id it scans the ordered open worklist, skips threads already
claimed by another actor until their lease expires, appends a `thread_claimed`
activity to the selected thread, and returns the thread plus the claim
activity. With a thread id it claims exactly that thread. The command leaves
lifecycle status as `open`; the terminal workflow is still reply plus `done` or
`dismiss`. Use `--client-event-id` for idempotent retries and `--lease` to
control the lease duration. The payload is described by `commentClaimOutput`;
successful claims include `summary.recommendedAction: "start_work"` and
structured suggestions for the initial acknowledgement, handoff, completion, or
archive decision on the newly owned thread.
If no thread can be claimed, the command still returns a `summary` with routing
counts and `recommendedAction`; for example, `wait_for_claim_release` means open
threads exist but are currently leased by other actors, and the suggested
commands point the adapter toward `comments watch` or the resident work loop
instead of blindly retrying the same claim.
With `--wait`, it becomes the blocking resident-agent intake: the CLI polls
until a claimable open thread appears, then returns the normal claimed work
payload. Use this when an agent should sleep until GUI feedback is ready to
handle.

`comments work` is the integrated intake stream for coding-agent adapters that
want the CLI to do the session orchestration. It is the preferred resident loop
for terminal agents: with `--wait --loop --idle-events --json`, it waits for
GUI feedback, claims the next matching thread, emits a compact
`comment_work_claimed` NDJSON event, then follows that
thread from the claim activity cursor and emits later
`comment_thread_activity_batch` events. Pass `--full` only when the adapter
needs the same rich source, diff, and activity payload as `claim --full`
inline. It also renews the lease on `--renew-interval`, defaulting to
`min(lease/2, 2m)`, so the GUI keeps showing an active owner while the agent
edits. Use it when the agent should start from one stream instead of manually
running `claim`, extracting the activity cursor, starting `follow`, and running
`hold`. When the stream observes
`thread_status_changed` to `resolved` or `archived`, it emits that final
activity batch and exits successfully.
Adapters can discover that loop with `comments protocol --json`, which returns
the preferred `work --wait --loop --idle-events` command, passive `watch`, companion
`follow`/`check` commands, restart recovery commands, structured write recipes,
and schema lookup argv without contacting the Vivi server. Commands in that
manifest use
`<client-event-id>` placeholders for durable read/claim attempts and generic
structured writes; adapters should replace each placeholder with a stable id
for one logical attempt and reuse it only for retries of that same attempt.
The manifest identifies itself with `manifestSchema` set to
`commentProtocolManifest` and exposes `manifestSchemaCommand`, so adapters can
validate startup discovery before caching command recipes.
Adapters that keep a durable write ledger can instead start with
`comments protocol --receipt-log <path> --json`. That offline manifest exposes
`receiptLedger` with the ledger verification argv and threads the same
`--receipt-log` path into the preferred loop, passive intake, companion checks,
and structured write recipes that can propagate or append receipts.
After that offline discovery, `comments doctor --actor <actor> --json` is the
online readiness check: it reads the open worklist count and cursor without
recording read receipts or claims, and returns the first safe startup
suggestions for a resident agent, including compact `comments mine --json` for
recovering owned live claim routing before claiming new work. Its output is described by
`comments schema commentDoctorOutput --json`, which is also exposed through the
manifest's `startupSchemas`. When the adapter supplies
`--receipt-log <path>`, doctor also includes `receiptLedger`; failed ledger
verification changes `recommendedAction` to `reconcile_receipt_ledger` before
the agent enters the resident work loop.
If the adapter calls doctor before choosing an actor, the `configure_actor`
branch returns the protocol command plus a `comments doctor --actor <actor>
--actor-kind codex --json` retry command that carries the same `--url` and
`--receipt-log` flags.
Snapshot, intake, and structured acknowledgement payloads are described by
`commentClaimOutput`, `commentInboxOutput`, `commentMineOutput`,
`commentBatchOutput`, `commentCheckOutput`, `commentTriageOutput`,
`commentReleaseOutput`, and `commentResultOutput`, exposed through the protocol
manifest's `outputSchemas`, so adapters can validate `claim`, `inbox`, `mine`,
`batch`, guarded-write `check`, triage writes, handoff releases, and terminal
`done`/`dismiss` replies without relying on stream events. The reusable
`commentSuggestedCommand` component schema is
also exposed through `componentSchemas`, covering each `suggestedCommands`
entry embedded in startup, snapshot, stream, preflight, and error payloads.
The reusable `commentWriteReceipt` component schema is exposed in the same
`componentSchemas` map; it covers the `receipt` object returned by `reply`,
`triage`, `release`, `done`, and `dismiss` after an agent write. Those same
write commands accept `--receipt-log <path>` to append each successful receipt
as JSONL for adapter restart recovery.
Suggested commands that need JSON stdin set `stdinRequired: true` and carry an
intent-specific `stdinExample`, so initial and follow-up acknowledgements use
different triage JSON, release handoffs point at blocked triage JSON,
completions point at verification result JSON, and dismissals point at archival
result JSON.
Receipt verification output is described by `commentWriteReceiptVerification`,
exposed through `outputSchemas`, so a restarted adapter can validate a saved
receipt against current server state. `commentWriteReceiptLedgerVerification`
is exposed alongside it for `comments verify-receipts --receipt-log <path|->`,
letting an adapter validate every JSONL receipt in its restart ledger with one
command.
The same schema surface exposes `commentErrorEvent`, so non-zero
`vivi comments ... --json` exits can be validated and handled without scraping
stderr. The protocol manifest also includes `errorPolicy`, a startup decision
table for stable error codes such as stale claims, other live owners, stale
thread ids, server reachability, and retryable upstream failures.
Every `work` event carries `schemaVersion`, `eventSchema`,
`eventSchemaCommand`, a process-stable `sessionId`, and a monotonically
increasing `sequence`. `eventSchemaCommand` is the exact argv for fetching the
runtime JSON Schema for that event line, so adapters can validate or cache the
stream protocol without hard-coding a type-to-schema map. In `--loop` mode the
same session spans multiple claimed threads, which gives an adapter one durable
stream identity for logging, duplicate suppression, and crash diagnostics while
it waits for the next GUI feedback item.
The initial `comment_work_claimed` event also includes a `summary` with
`recommendedAction: "start_work"` and `suggestedCommands` for the immediate
`comments triage --triage-file - --require-claim` acknowledgement and the later
`comments release --triage-file - --require-claim` blocked or needs-info
handoff, plus the later
`comments done --result-file - --require-claim` or
`comments dismiss --result-file - --require-claim` terminal outcome. This keeps
initial GUI feedback and later follow-up feedback on the same agent decision
path.
Activity batches include a `summary` object with sorted `kinds`, own/external
activity counts relative to the supplied `--actor`, counts for human comments,
agent comments, triage comments, claims, releases, status changes, reads, and
thread creation, plus `terminalStatus` when a resolved or archived transition
is present. Agents can branch on that summary before inspecting the full
activity list, for example ignoring an own lease-renewal or own triage batch
while immediately reacting to an external human follow-up. `recommendedAction`
provides the shortest branch: `reconsider_work`, `ignore_own_heartbeat`,
`ignore_own_activity`, `inspect_external_activity`, `finish_current_work`, or
`observe`. For write-oriented branches such as `start_work` and
`reconsider_work`, the batch suggestions use the latest live claim from the
activity history: owned live claims get guarded write suggestions, while
expired or missing claims suggest claiming or inspecting first. Terminal
`finish_current_work` batches also include a read-only
`comments check <thread-id> --full --json` suggestion so an adapter can confirm
the lifecycle state instead of stopping on an empty command list.

Pass `--loop` when the adapter should stay attached to the GUI feedback queue
after finishing one thread. The command keeps the same NDJSON stream open,
returns to claim selection after each terminal status batch, and emits the
next `comment_work_claimed` event for the next claimable thread. This is the
resident coding-agent surface for "human publishes feedback, agent handles it,
then waits for the next GUI feedback" without an adapter-owned restart loop.

`comments renew` is the heartbeat path for work already in progress. It calls
the same lease mutation as `claim`, appends a fresh `thread_claimed` activity,
and returns it as `renewal`. Use it while the agent is still triaging, editing,
or verifying so humans can see the thread is actively owned. It fails if
another actor already holds the live lease; if the previous lease expired or
was released before anyone else claimed it, `renew` reacquires the open thread.

`comments hold` is the continuous heartbeat path for long-running work. It
renews immediately and then every `--interval`, emitting newline-delimited JSON
`comment_claim_renewed` events until interrupted or until `--max-events` is
reached. Use it beside long edits, builds, or `task check` runs so the thread
does not appear abandoned and terminal commands with `--require-claim` still
have a live lease.

`comments inbox` is the routing snapshot for agents that need to decide what to
do next. It reads open threads without read receipts and classifies them into
`mine`, `unclaimed`, and `claimedByOthers` using the latest live claim event.
Each group includes threads, count, and matching live claim activities where
claims exist. With `--full`, each group also includes rich work items so an
agent can triage owned and claimable feedback from one JSON response. The
top-level `summary` turns those groups into an adapter decision:
`resume_owned_work`, `claim_open_work`, `wait_for_claim_release`, or
`wait_for_gui_feedback`, with matching `suggestedCommands` so the agent can
renew/follow recovered owned work or claim the next GUI feedback without
hard-coding the route. Runtime routing suggestions preserve the selected
`--url`, and write-oriented suggestions preserve `--receipt-log` when the
adapter is keeping a durable ledger.

`comments batch <review-batch-id>` is the routing snapshot for one published
GUI review batch. It includes all threads in that publish action, summary
counts for `open`, `resolved`, and `archived`, and an `open` section grouped as
`mine`, `unclaimed`, and `claimedByOthers`. The `open.summary` branch contract
matches `comments inbox`, so a batch-oriented adapter can resume owned work,
claim the next open batch item, or wait for another actor without switching
protocol shapes. Use it when the agent should keep a human's batch of feedback
together while still claiming and closing individual threads. The command is a
snapshot and does not create read receipts.

`comments mine` is the recovery path for an agent session that already claimed
work. It is exposed by the startup protocol and doctor suggestions so a
restarted adapter can inspect owned live claims before entering a fresh work
loop. It returns open threads whose latest live `thread_claimed` activity
belongs to the requested actor, along with the claim activity and optional rich
work items. Its `commentMineOutput` payload includes `summary.recommendedAction`
and concrete `suggestedCommands`: non-empty output recommends
`resume_owned_work` with `comments renew`, `comments follow`, and `comments
check` for the first recovered thread, while empty output recommends
`wait_for_gui_feedback`. It does not extend the lease or change lifecycle
status.

`comments release` is the explicit handoff path. It requires the latest live
claim to belong to the releasing actor, appends `thread_claim_released`, leaves
the thread `open`, and lets another agent claim it immediately. With
`--body` or `--body-file`, it first adds an explanatory handoff reply and then
releases the claim. The CLI checks the live claim before adding that reply, so
a stale agent cannot leave an orphaned handoff comment after another actor has
claimed the thread.
With `--triage-file <path|-> --require-claim`, it renders the same structured
triage JSON used by `comments triage`, posts the blocked or needs-info handoff
comment, and releases the claim in one guarded operation.

`comments context` turns a thread id into the source payload an agent normally
needs next: the thread, file metadata, and anchor-centered source lines. This
keeps the human comment, file path, anchor line range, and local source text in
one JSON object without asking the agent to rediscover the browser state. With
`--full`, the same response includes the current diff for that thread's path
and the thread activity history. The individual `--with-diff` and
`--with-activities` flags remain available when an adapter already has source
context and wants only one extra dimension.

`comments check` is the preflight for guarded writes. It reads the thread and
activity history without recording a read receipt and returns `liveClaim` plus
`write.canWrite` and `write.reason`. Reason values are `owned_live_claim`,
`no_live_claim`, `claimed_by_other_actor`, and `thread_not_open`. Use it before
`done`, `dismiss`, `reply`, `resolve`, or `archive --require-claim` when the
agent wants to branch on ownership in JSON instead of relying on a terminal
error. The same `write` object also includes `recommendedAction` and
`suggestedCommands`: claim the thread when no live claim exists, renew or write
guarded replies when the actor owns the claim, inspect/follow when another
actor owns it, and reopen before writing to a terminal thread. The payload is
described by `commentCheckOutput`, including the nested write preflight schema
for `reason`, `recommendedAction`, and the guarded-write suggestions.

`comments follow` is the single-thread activity stream for work already in
progress. It emits newline-delimited JSON activity batches and supports
`--cursor`, `--no-initial`, `--once`, `--interval`, and `--max-events`. Run it
beside long edits when the agent should notice human follow-up comments or
other lifecycle activity before posting a final reply. For the least racy
loop, read the latest activity id after `claim` or `renew`, pass it as
`--cursor`, and then start editing while the follow stream watches for new GUI
feedback.

`comments done` is the matching terminal shortcut for coding agents after the
fix is complete. It posts the supplied agent reply and resolves the thread in
one CLI call, returning both the created or reused completion comment and the
resolved thread. It is a workflow shortcut over the existing `addComment` and
`resolveThread` GraphQL operations, not a new lifecycle status.
Use `--body-file` instead of `--body` when the agent reply is multi-line
Markdown or generated by a separate step; pass `--body-file -` to read the
reply from stdin. For adapter-driven terminal replies, prefer
`--result-file <path|->` with JSON fields `summary`, `verification`, and
`details`; the CLI renders that into a Markdown comment beginning with
`Result: resolved` for `done` and returns the structured `result` object
alongside `comment` and `thread`. `--result-file` is mutually exclusive with
`--body` and `--body-file`.

`comments triage` is the non-terminal acknowledgement for the target GUI
feedback loop. The agent can post a structured decision such as `accepted`,
`needs-info`, `blocked`, or `not-applicable`, plus a summary and next action,
while leaving the thread open for implementation and final verification. This
lets the human see that the background agent has understood the feedback even
before code changes are complete. The JSON response includes both the
machine-readable `triage` object and the created or reused comment, and is
described by `commentTriageOutput` together with the returned write receipt.
Follow and work streams summarize that generated comment as `triage_comment`; for the
same actor it becomes `own_triage_comment` with `ignore_own_activity`, so the
agent does not confuse its acknowledgement with new human feedback.
Those follow/work batches also include `comments` snapshots for delivered
`comment_added` and `comment_updated` activities, so the resident agent can
read the new human body and anchor directly from the stream before deciding
which triage JSON to emit. With `--with-context` or `--full`, the same batch
also includes source context around the thread anchor, avoiding an immediate
`comments context` or `comments show` call for the common follow-up path.
Adapters should prefer `--triage-file <path|->` with JSON fields `decision`,
`summary`, `nextAction`, and `details`; this avoids shell quoting for generated
triage and makes stdin handoff straightforward. Use
`comments schema commentTriageFileInput --json` when the adapter wants the
machine-readable schema and example at runtime.
When a follow/work stream sees new external human feedback, the activity
summary includes `suggestedCommands` with the matching
`comments triage --triage-file - --require-claim` acknowledgement command and a
`comments release --triage-file - --require-claim` blocked/needs-info handoff,
plus a
later `comments done --result-file - --require-claim` or
`comments dismiss --result-file - --require-claim` terminal command, so
resident adapters do not need to hard-code the safe write pattern. Structured
write suggestions also include a concrete `clientEventId` and matching
`--client-event-id` argv, plus `stdinSchema`, the exact `stdinSchemaCommand`,
and a compact `stdinExample`, so an adapter can discover the retry key and JSON
contract from the event and fetch the full runtime schema only when it needs
more detail. The example is tuned to the suggestion intent: starting work,
incorporating follow-up, handing off blocked work, resolving with verification,
and archiving intentionally each get distinct starter JSON.
Adapters that validate or record the stream protocol can also fetch
`commentActivityBatchEvent` and `commentWorkClaimedEvent` through
`comments schema`; `commentWorkIdleEvent` covers the no-work case when
`comments work` runs without `--wait`. These output schemas cover the
long-running `follow`/`work` NDJSON events that carry human feedback, claim
metadata, source context, and suggested next commands.
Background agents that claimed work should pass `--require-claim` to
`reply`, `triage`, `done`, `dismiss`, `resolve`, or `archive`. The CLI validates the
latest live `thread_claimed` activity before writing, so a stale process cannot
reply or close a thread after another actor has taken over. If verification ran
longer than the lease, call `comments renew` first or keep
`comments hold` running during the long work.
Agents should also reuse the suggested `clientEventId` for one logical write
attempt. That id is not just correlation metadata: it is the retry key for
comment creation and lifecycle status changes. Successful write commands return
a `receipt` object with the command, actor, thread, `clientEventId`, returned
comment id when present, terminal status when present, and activity effects that
were produced or replayed for that operation. The receipt is self-describing:
`receiptSchemaCommand` validates the receipt itself, while `verificationCommand`
and `verificationSchemaCommand` describe how to re-check it later. Use
`comments verify-receipt --receipt-file <path|-> --json` to check that saved
receipt against the current thread, comment, status, and activity history before
deciding whether to retry, continue, or trust the prior write. The emitted
`verificationCommand` includes the resolved Vivi `--url`, and failed receipt or
ledger verification suggestions keep that URL, so restart recovery does not
accidentally fall back to the default server. A resident agent
should pass `--receipt-log <path>` on write commands when it wants a durable
JSONL ledger of completed replies, triage notes, handoffs, and terminal results.
On startup, `comments verify-receipts --receipt-log <path|-> --json` checks the
whole ledger and returns per-receipt verification payloads plus total, verified,
and failed counts. `comments doctor --receipt-log <path> --json` runs that same
ledger check as part of online startup readiness and treats a missing ledger
file as an empty OK ledger. Commands that emit agent write suggestions, such as
`doctor`, `watch`, `work`, `follow`, `check`, `inbox`, and `batch`, propagate
their resolved `--url` into suggested argv, preserve `--actor-kind` alongside
`--actor`, and propagate `--receipt-log <path>` into suggested write argv, so
adapters can execute those recipes without reattaching server, actor, or ledger
flags by hand.
If a guarded write fails under `--json`, the CLI returns an `error` envelope
with a stable `code` such as `no_live_claim` or `claimed_by_other_actor` and
recovery `suggestedCommands`, so a resident adapter can claim, check, follow,
or inspect without scraping a human-readable stderr string. Those recovery
suggestions preserve the failed command's explicit or environment-resolved
server URL, preserve actor kind, and propagate `--receipt-log` into follow-up
commands that can produce the next write suggestions.

`comments dismiss` is the equivalent shortcut for intentional non-fixes. It
posts the supplied explanation and archives the thread in one CLI call,
returning both the created or reused explanation comment and the archived
thread. It is a shortcut over `addComment` plus `archiveThread`; it does not add
a separate dismissed status.
`dismiss --result-file <path|->` uses the same structured JSON handoff as
`done --result-file`, but renders `Result: archived` and archives the thread.
Use `comments schema commentResultFileInput --json` to fetch the matching
runtime stdin schema for either terminal shortcut. Use
`comments schema commentResultOutput --json` to validate the returned terminal
reply envelope, including the created or reused comment, terminal thread,
receipt, and rendered result when `--result-file` was used.
Use `comments release --triage-file` when the agent wants to explain a blocked
or needs-info handoff and hand the still-open work back to the queue. Use
`comments release --body-file` for free-form handoffs. Use
`comments schema commentReleaseOutput --json` to validate the returned handoff
envelope, including the release activity, receipt, and optional triage/comment
payload.

`comments watch` is intentionally a passive open worklist watcher. It emits
newline-delimited JSON snapshots of `commentThreads(status: open)` with a
resume cursor, starts by emitting the current open threads unless
`--no-initial` is set, and ignores unpublished draft review comments. If a
future Draft Review Batch UI publishes multiple comments at once, watch treats
the resulting `open` threads as normal worklist entries and only carries
`reviewBatchId` as optional metadata on those threads and comments.
Every watch event carries `schemaVersion`, `eventSchema:
"commentOpenWorklistEvent"`, and `eventSchemaCommand`, plus a `summary` that
recommends `claim_open_work` when open threads exist. With `--actor`, the
summary includes a `claim_next_open_thread` suggestion for
`comments work --actor <actor> --once --full --json`, giving adapters a
machine-readable one-shot handoff from passive GUI feedback intake to an owned
claim. The suggestion includes a cursor-derived `clientEventId` and matching
`--client-event-id` argv so the claim activity can be correlated and retried
without inventing a separate id, and it keeps the same resolved `--url` as the
watch stream that emitted it.

`comments follow` is the single-thread activity stream. Use it after an agent
already knows the thread id, such as after a claim, a release wait, or recovery
from `comments mine`; use `comments watch` to discover open work without
claiming it, and use `comments work` when the agent wants discovery, claim,
lease renewal, and follow-up activity in one loop.

For a background coding agent,
`comments watch --full` is the richest intake stream. Each delivered event
still includes the compatible `threads` worklist, and additionally includes
`items`: one item per open thread with the thread, anchored source context,
current diff, and activity history. That shape lets the agent start triage from
a single NDJSON event after a human publishes GUI feedback.

Use `dismiss` when intentionally closing work with an explanatory agent reply,
use raw `archive` only when no new reply is needed, and `reopen` before
replying to a resolved or archived thread. The CLI uses GraphQL queries and
mutations only; it does not write `$VIVI_DATA_DIR` files directly.

## Export and import

JSONL export is thread-aware. Each line is a self-contained schema v2
`commentThread` record with metadata and ordered `comments`. Status and path
filters operate on threads, not individual messages. Agent automation should
request `status: open`; an unfiltered export is a backup/history export.

Import is intentionally specified before it is exposed: accept schema v2
thread records, validate every path/anchor/status/origin, reject conflicting
thread or comment ids unless the records are byte-equivalent, append messages
before lifecycle events, and report per-record results. Legacy flat JSONL may
be imported through the same on-read projection. No import mutation or CLI flag
is shipped in this slice, so export remains one-way at the public API boundary.
