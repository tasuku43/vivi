# Local agent loop harness

The local agent loop harness verifies Vivi's shortest comment feedback loop
without Claude Code, Codex, a vendor CLI, or an external AI service.

## Covered loop

The v1 fake agent performs these explicit stages:

1. `seed`: create a thread with a human comment from the fixture.
2. `read`: query open threads with `X-Vivi-Actor-*` headers.
3. `receipt`: verify one idempotent `thread_read` activity.
4. `claim`: when the terminal transport is CLI, claim the thread with
   `vivi comments claim --full` and verify the returned lease, source context,
   and diff payload.
5. `renew`: when the terminal transport is CLI, refresh the lease with
   `vivi comments renew` before writing the terminal reply.
6. `follow`: when a fixture includes a human follow-up and the terminal
   transport is CLI, start `vivi comments follow` from the latest activity
   cursor, add the follow-up comment, and verify the agent receives it. With
   `work` intake, the harness verifies the same follow-up through the already
   running `vivi comments work` stream instead.
7. `reply`: add an actor-attributed agent comment, either through GraphQL or
   through the CLI terminal shortcut.
8. `terminal`: call `resolveThread` or `archiveThread`, or verify the status
   returned by `vivi comments done --require-claim` /
   `vivi comments dismiss --require-claim`.
9. `verify`: reload the terminal thread and verify activity order and actors.

The optional watch intake path starts
`vivi comments watch --full --json`
before the human stage, waits for the initial empty open-worklist snapshot,
creates the human thread, and then treats the next rich watch item as the fake
agent's worklist read. The rest of the loop is identical: the fake agent
claims the thread, renews the lease, replies, performs the configured terminal
action with `--require-claim`, and verifies activity history.
Watch reports include the delivered cursor, coarse change reasons, delivered
thread ids, rich item count, source availability, diff status, and activity
count so reconnect/resume and agent triage behavior can be inspected from the
JSON or HTML report.

The `claim-wait` intake path starts
`vivi comments claim --wait --full --json`
before the human stage. The fake agent blocks until the seeded GUI feedback
becomes claimable, receives the rich claimed work payload, and continues
directly to `renew` and the terminal shortcut. This is the resident background
agent path: it does not create a read receipt, because the intake event is the
lease itself. That payload is described by `commentClaimOutput` and carries the
same initial `summary.suggestedCommands` as the integrated work claimed event,
so adapters can acknowledge the GUI feedback immediately after the blocking
claim returns.

The `work` intake path starts
`vivi comments work --wait --full --json`
before the human stage. The fake agent receives a `comment_work_claimed` payload
with source, diff, activities, and a lease, keeps the same stream open for
human follow-up activity batches, writes through `comments done` or
`comments dismiss` with `--result-file - --require-claim`, and then verifies that `work`
observes the terminal status batch and exits successfully. This is the shortest
adapter-facing loop for the target GUI feedback experience: a resident coding
agent can claim, listen, reply, and finish without stitching together separate
CLI processes for each primitive.
Resident adapters that need an explicit readiness heartbeat can add
`--idle-events`: the same stream emits `comment_work_idle` while waiting, with
`summary.recommendedAction` set to `wait_for_gui_feedback` for an empty queue
or `wait_for_claim_release` when open threads are currently owned by other
actors.
The claimed payload also carries `summary.recommendedAction: "start_work"` and
structured `summary.suggestedCommands`, so the fake agent verifies the same
command-discovery path for initial feedback that it uses for follow-up
feedback, including both structured done and structured dismiss terminal paths.
Fixtures may also include `agent.triage`; the harness then posts
`comments triage --triage-file - --require-claim` after human follow-up and
verifies that the thread remains open with a structured agent acknowledgement
before the terminal reply. This covers the glue moment where GUI feedback
becomes a visible background-agent triage response using the same JSON stdin
handoff an adapter would use.
Fixtures may include `agent.result`; the harness sends that JSON through
`comments done --result-file -` or `comments dismiss --result-file -`. If it is
omitted, the legacy `agent.replyBody` becomes the result summary so older
fixtures still exercise the structured terminal handoff.
The harness asserts stream metadata too: the claim starts `schemaVersion: 1`
with `sequence: 1`, follow-up activity keeps the same `sessionId`, and terminal
activity advances the same sequence. That makes the eval cover the adapter
property we care about, not just the existence of individual events.
The activity batches also carry a `summary`, so adapter tests can assert common
branches such as human follow-up, lease renewal, and terminal status without
manually scanning the full activity list. The harness also verifies own vs
external counts so an adapter can distinguish its own terminal reply or lease
heartbeat from new human feedback, and verifies `recommendedAction` so the
fake agent can branch on `reconsider_work` for human follow-up and
`finish_current_work` for terminal batches. For human follow-up batches, it
verifies the matching `comments` snapshot too, so the fake agent can read the
new human body from the stream without a separate `comments show` call. It also
verifies source context on the same batch, so the fake agent has the human
follow-up and the relevant file lines in one event. It
also verifies `summary.suggestedCommands`: the stream suggests
`comments triage --triage-file - --require-claim` for the immediate
acknowledgement, `comments release --triage-file - --require-claim` for
blocked or needs-info handoff, `comments done --result-file - --require-claim`
for resolved terminal results, and
`comments dismiss --result-file - --require-claim` for intentional archive
outcomes.
Those write suggestions include concrete `clientEventId` values and matching
`--client-event-id` argv, so the fake agent can treat the suggestion as both
the command recipe and the retry key for the operation.
Adapters can resolve each `stdinSchema` in those suggestions with
the adjacent `stdinSchemaCommand`, which returns the JSON Schema and an example
without requiring a running server. The suggestion also carries a compact
`stdinExample`, so the fake agent can verify the whole handoff shape directly
from the stream. Suggestions that expect stdin also set `stdinRequired: true`;
the harness verifies that acknowledgement suggestions carry triage examples
for starting or incorporating work, release suggestions use a blocked triage
example, completion suggestions use verification result JSON, and dismiss
suggestions use an archival result example instead of a generic completion
payload. The same `comments schema` surface exposes
`commentClaimOutput`, `commentActivityBatchEvent`, `commentWorkClaimedEvent`,
and `commentWorkIdleEvent`, and exposes `commentCheckOutput` for guarded-write
preflight responses, `commentTriageOutput` for structured acknowledgements, and
`commentReleaseOutput` for blocked or needs-info handoff releases, and
`commentResultOutput` for terminal `done`/`dismiss` replies, so an adapter can
cache the intake, stream-event, preflight, triage write, handoff write, and
terminal write contracts alongside the stdin contracts during startup.
Write commands return a `receipt` object described by
`comments schema commentWriteReceipt --json`, letting the fake agent correlate
the suggested command's `clientEventId` with the returned comment and activity
effects without re-reading the whole thread first. Each receipt includes
`receiptSchemaCommand`, `verificationCommand`, and `verificationSchemaCommand`,
so the fake agent can validate and re-check it without hard-coded command
recipes. The `verificationCommand` includes the resolved Vivi `--url`, so a
fake or real adapter can retry against the same server even when the harness is
not using the default port. The companion
`comments verify-receipt --receipt-file <path|-> --json` output is described by
`comments schema commentWriteReceiptVerification --json`, so restart/resume
tests can verify a persisted receipt before deciding whether to retry work.
When the fake agent needs a durable restart ledger, it passes
`--receipt-log <path>` on write commands and treats each JSONL line as a
`commentWriteReceipt` that can be fed back into `verify-receipt`. It can also
run `comments verify-receipts --receipt-log <path|-> --json`, whose output is
described by `comments schema commentWriteReceiptLedgerVerification --json`, to
validate the whole ledger in one startup check; failed ledger suggestions carry
the same server URL. The fake agent may also call
`comments protocol --receipt-log <path> --json` at startup; that manifest's
`receiptLedger` and command recipes are already ledger-aware. When the intake
or preflight command itself receives `--receipt-log <path>`, the harness
expects downstream write suggestions to carry that same flag so a fake adapter
can execute the suggested argv as-is. Runtime suggestions also preserve the
resolved `--url`, so watch, work, follow, check, inbox, batch, and doctor
handoffs keep targeting the same Vivi server that produced the event.
The stream events also carry `eventSchema` and `eventSchemaCommand`, letting a
resident adapter validate each NDJSON line without carrying its own event-type
lookup table. `comments watch` now participates in that same protocol: each
open-worklist event identifies `commentOpenWorklistEvent` and suggests
`claim_next_open_thread` via `comments work --actor <actor> --full --json`,
so the fake agent can move from GUI-published feedback to a claimed work item
without hard-coded command recipes.
When a suggested command includes `clientEventId`, the harness treats that
value as the operation id for one logical attempt. Real adapters should do the
same for structured writes: reuse the id on retry so `comment_added` and
terminal lifecycle activities are correlated and not duplicated.

Failures use the form `[agent-loop:<stage>] ...` and include the stages already
completed. This keeps CI failures attributable to the broken part of the loop
instead of reporting one opaque end-to-end mismatch.
The underlying `vivi comments ... --json` commands also return structured
`error` envelopes on non-zero exits, so adapters can branch on stable error
codes and suggested recovery commands even when the harness itself reports a
stage-level failure for humans. `comments schema commentErrorEvent --json`
describes that envelope and is included in `comments schema all --json`; the
startup `comments protocol --json` manifest also exposes `errorPolicy` with the
stdout transport rule and recoverability guidance for each stable error code.
Recovery suggestions preserve the same server URL and receipt ledger context
where available, so a fake or real adapter can recover from stale claims and
other live owners without reconstructing command flags from outside the error
payload.
That same manifest exposes `manifestSchemaCommand`, pointing at
`comments schema commentProtocolManifest --json`, so adapters can validate the
startup protocol surface before entering a resident loop.
For online startup readiness, adapters can run
`comments doctor --actor <actor> --json` before the harness stages begin; it
checks server reachability and open-work count without mutating thread
activity and suggests `comments mine --full --json` before the resident work
loop so a restarted agent can recover owned live claims. `comments mine` is
described by `commentMineOutput` and returns `summary.suggestedCommands` for
renewing the recovered claim, following the thread, and running a guarded
check before writing. `comments schema commentDoctorOutput --json` describes
that readiness payload for adapters that validate startup JSON before entering
the loop. When the adapter already keeps a
receipt ledger, it can pass `--receipt-log <path>` to doctor and receive the
same ledger verification summary inline before starting `comments work`.
Doctor's startup suggestions preserve both the resolved server URL and receipt
ledger path where applicable.

## Fixture

The default fixture is
`test/fixtures/agent-loop/basic.json`. It contains only deterministic inputs:
the human actor and comment, the fake agent actor, a read idempotency key, the
reply body, and the terminal action. Generated thread, comment, activity ids,
and timestamps are outputs and are not golden values.

Additional fixtures should keep one behavior difference per file, for example
an archive outcome or a different actor kind. Do not encode timing or depend on
an external process completing work.

`test/fixtures/agent-loop/follow-up.json` adds a `human.followUp` comment. With
`--terminal cli`, the harness uses the latest activity id as a resume cursor,
starts `comments follow`, creates that extra human comment, and verifies the
follow stream delivers the new `comment_added` activity before the fake agent
replies.

## Run locally

Start Vivi with an isolated data directory:

```bash
VIVI_DATA_DIR=/tmp/vivi-agent-loop-data go run ./cli . --port 4317
```

In another terminal, run:

```bash
npm run harness:agent-loop
```

To target another server or write a browser-readable result:

```bash
npm run harness:agent-loop -- \
  --url http://127.0.0.1:4317 \
  --fixture test/fixtures/agent-loop/basic.json \
  --html /tmp/vivi-agent-loop-report.html
```

To exercise the agent-facing watch path, run:

```bash
npm run harness:agent-loop -- \
  --url http://127.0.0.1:4317 \
  --fixture test/fixtures/agent-loop/basic.json \
  --intake watch \
  --terminal cli \
  --html /tmp/vivi-agent-loop-watch-report.html
```

The watch intake uses
`go run ./cli comments watch --full` by default so the harness validates the
same JSON-first rich intake surface used by background coding agents.

To exercise the resident background-agent path, run:

```bash
npm run harness:agent-loop -- \
  --url http://127.0.0.1:4317 \
  --fixture test/fixtures/agent-loop/basic.json \
  --intake claim-wait \
  --terminal cli \
  --html /tmp/vivi-agent-loop-claim-wait-report.html
```

The claim-wait intake uses
`go run ./cli comments claim --wait --full` so the harness validates the
blocking work acquisition loop an agent would keep running behind the GUI.

To exercise the work-in-progress follow-up stream, run:

```bash
npm run harness:agent-loop -- \
  --url http://127.0.0.1:4317 \
  --fixture test/fixtures/agent-loop/follow-up.json \
  --intake watch \
  --terminal cli \
  --html /tmp/vivi-agent-loop-follow-report.html
```

That path validates the resident agent behavior where the GUI can add feedback
while the agent owns the thread, and the agent notices it through
`comments follow` before closing the thread.

To exercise the integrated agent work session, run:

```bash
npm run harness:agent-loop -- \
  --url http://127.0.0.1:4317 \
  --fixture test/fixtures/agent-loop/follow-up.json \
  --intake work \
  --terminal cli \
  --html /tmp/vivi-agent-loop-work-report.html
```

Agent adapters that do not need to inspect each primitive separately can use
this `work` intake as the shorter runtime entrypoint: the command emits the
claimed work item first, renews the lease during the session, continues with
follow-up activity batches for the claimed thread, and exits after observing a
terminal resolved or archived status batch.
For a resident queue worker, add `--loop --idle-events`: after that terminal
batch, the same NDJSON stream returns to claim selection and emits idle
heartbeat events while waiting for the next matching GUI feedback thread.

`--terminal cli` validates the matching terminal
shortcuts: `comments done` for resolved outcomes and `comments dismiss` for
archived outcomes, both through `--result-file -`. With watch intake, that CLI terminal path also validates
`comments claim --full`; with claim-wait intake, the claim is already the
intake event; with work intake, the claim and follow stream are already owned
by the integrated work session. Watch and claim-wait CLI terminal paths
validate `comments renew`; all CLI terminal paths validate the terminal
shortcut's `--require-claim` guard. Without `--terminal cli`, the
harness keeps the older GraphQL mutation terminal path.

The runner is a GraphQL client, matching the boundary used by real agent
adapters. A future Claude Code or Codex adapter can replace the fake decision
step while retaining the fixture, stage reporting, and terminal verification.

## CI

`test/e2e/local-agent-loop.test.ts` starts the normal E2E server with isolated
workspace and comment data directories. It verifies the passing loop, the rich
`comments watch` intake loop with `comments done`, the `comments follow`
work-in-progress human follow-up loop, the blocking `comments claim --wait`
intake loop, the integrated `comments work` loop, the archived outcome with
`comments dismiss`, and the stage-specific failure contract.
`npm run e2e` and therefore `task check` include this test; no network access,
model credentials, sleeps, or vendor executables are required.

The existing Go CLI test continues to cover `vivi comments active`, `reply`,
and lifecycle commands against the canonical GraphQL handler. Together, the
tests protect the reusable GraphQL harness and the agent-facing CLI wrapper.
