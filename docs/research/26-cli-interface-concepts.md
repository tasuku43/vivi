# Vivi CLI interface concepts

Product promise: one local command opens a safe browser review surface; the
agent-facing CLI turns human comments into structured, actionable work.

This note is an exploration artifact, not an implementation contract. The
question being tested is how small the agent CLI can become if its only near
term job is:

> Decision update (2026-07): Vivi selected the on-demand form of the comment
> pipe. `vivi inbox <url>` returns the current published snapshot and exits;
> Publish never waits for an agent. The resident concepts below remain as the
> historical comparison that led to that decision, not the current default UX.

1. notice that a human comment arrived,
2. read the comment with enough workspace context,
3. decide whether to ask, act, finish, or hand back,
4. post a reply into the same thread,
5. stop when the reply is a question or the work is intentionally handed back.

## Product promise to optimize

Vivi is not an agent runner. It is the local review adapter between a human
browser review surface and a coding agent. The CLI should therefore feel less
like a second product UI and more like a narrow, reliable feedback pipe.

## Current observed surface

Representative commands run during the exploration:

```text
$ go run ./cli --help
$ go run ./cli comments --help
$ go run ./cli comments work --help
$ go run ./cli comments doctor --actor codex --json
```

Observed shape:

- Top-level help already separates Human, Agent, Changed-file context, and
  Debug/recovery lanes.
- `comments work --help` is focused on the compact resident loop.
- `comments doctor --json` can recommend `comments work --loop` when a server is
  reachable.
- The ready/doctor suggested command is machine-complete but visually long
  because it carries actor kind, URL, client event id, JSON mode, and history
  limits.
- README and the CLI contract now present the top-level `inbox`/`reply` facade
  first, with `comments work --loop` kept as the compact resident adapter loop.
- `comments`, `watch`, `follow`, `claim`, `mine`, `check`, `protocol`,
  `schema`, receipt verification, and guarded writes are all available. Many
  are useful protocol primitives, but the first-time agent experience still has
  to decide which layer is the real one.
- If the default browser port is already taken, the launch experience should
  mechanically increment to the next available local port instead of asking the
  user to choose a port on the happy path.
- Server launch should not bind the browser UI to a future agent identity. The
  server hosts the review surface; actor identity belongs to mutating commands
  such as `reply`, or to an explicit read-receipt mode if the UI should show
  that a named agent has read a thread.
- Actor values should be a small fixed set for the simple agent facade. Unknown
  values should fail fast instead of being silently accepted as a new actor
  kind.

## Current state model

```text
server absent
  -> start server
  -> ready JSON
  -> resident work loop

idle queue
  -> claimable thread
  -> owned work
  -> triage/release/done/dismiss

owned stale or restarted
  -> mine/check
  -> renew/follow or release

changed files only
  -> review queue/diff
  -> comments work when human feedback appears
```

## Friction to remove

- The agent currently has more commands than it has jobs.
- The first loop still requires a two-command mental model: start server, then
  start `comments work`.
- Suggested commands are precise but noisy when read by a human or an LLM.
- Recovery primitives are visible before the user has chosen whether they even
  need recovery.
- `review queue` is useful context, but it competes with comments as an entry
  point when the actual goal is human feedback intake.
- The server process is already long-lived, so a separate resident watcher can
  feel conceptually redundant.

## Concept A: Server Stdout Inbox

Thesis: when the user starts Vivi for an agent session, the server itself is the
resident agent pipe. No second `watch` or `work` command is needed.

Mock transcript:

```text
$ vivi .
Vivi serving /work/project
Browser: http://127.0.0.1:4317
Agent inbox: vivi inbox http://127.0.0.1:4317

{"event":"comment","threadId":"ct_123","path":"README.md","body":"This section is unclear.","suggestedAction":"reply_or_fix"}
```

Reply path:

```text
$ vivi reply http://127.0.0.1:4317 ct_123 --actor codex --body "Thanks. I need one clarification before changing it: should this target new users or maintainers?"
{"event":"reply_posted","threadId":"ct_123","status":"open"}
```

What it makes visible:

- comment arrival,
- thread id,
- path and human message,
- whether the agent needs to act or ask.

Best for:

- the smallest human mental model,
- local demos,
- an agent runtime that can attach to the server process stdout.

Tradeoff:

- server stdout becomes both human startup output and machine event stream,
- restart recovery and receipt ledgers need a secondary story,
- agents launched after the server starts still need an attach command.

## Concept B: One Resident Command

Thesis: keep the server and agent loop separate, but make the agent learn only
one command: `comments work`.

Mock transcript:

```text
$ vivi . --port 0 --ready-json --actor codex
{
  "event": "vivi_server_ready",
  "url": "http://127.0.0.1:52038",
  "primaryCommand": "vivi comments work --actor codex --loop --url http://127.0.0.1:52038 --json"
}

$ vivi comments work --actor codex --loop --url http://127.0.0.1:52038 --json
# silent until a human publishes feedback
{"event":"comment_work_claimed","threadId":"ct_123","path":"README.md","comment":"This section is unclear.","recommendedAction":"start_work"}
{"event":"comment_activity_batch","threadId":"ct_123","recommendedAction":"reconsider_work","comment":"Actually, focus on the install docs."}
```

Reply path:

```text
$ printf '%s\n' '{"summary":"Updated the install docs and verified the preview.","status":"done"}' | vivi comments done ct_123 --actor codex --result-file - --require-claim --json
```

What it makes visible:

- the current open work item,
- ownership/claim state,
- follow-up human activity,
- exact suggested write command.

Best for:

- production agent adapters,
- restart-safe loops,
- keeping server logs separate from machine events.

Tradeoff:

- still a two-process model,
- exact suggested argv can look long,
- primitives remain present unless help/docs aggressively demote them.

## Concept C: Comment Pipe Contract

Thesis: expose only one conceptual command family to agents: `vivi inbox`.
Internally it can use `comments work`, claims, receipts, and GraphQL, but the
public interface describes a comment pipe rather than a protocol toolkit.
The inbox must still receive an explicit server URL, because multiple Vivi
servers may be running at the same time.
Plain inbox reads are passive polling queries and do not require an actor. The
actor is supplied on `reply`, or on an explicit read-receipt option if the GUI
should show that a named agent has read the thread. The simple facade should
accept a fixed actor enum such as `codex` and `claude`, mapping `claude` to the
existing `claude_code` protocol kind internally. Any unsupported actor should be
a CLI usage error. `reply` always requires `--actor`; omitting it should be a
CLI usage error because every posted comment, resolve, or archive action needs
clear authorship. `reply` is non-interactive only: it requires either `--body`
or `--body-file <path|->` and must never prompt for terminal input.

Mock transcript:

```text
$ vivi .
Vivi serving /work/project
Browser: http://127.0.0.1:4318
Agent inbox: vivi inbox http://127.0.0.1:4318

$ vivi inbox http://127.0.0.1:4318
{"type":"comment","id":"ct_123","file":"README.md","body":"This section is unclear.","action":"reply"}
{"type":"followup","id":"ct_123","body":"Actually, focus on the install docs.","action":"reply"}

$ vivi inbox http://127.0.0.1:4318 --read-as codex
{"type":"comment","id":"ct_123","file":"README.md","body":"This section is unclear.","action":"reply","readBy":"codex"}
```

Reply path:

```text
$ vivi reply http://127.0.0.1:4318 ct_123 --actor codex --body "Should the install docs optimize for Homebrew or mise first?"
{"type":"reply","id":"ct_123","actor":"codex","status":"open"}

$ vivi reply http://127.0.0.1:4318 ct_123 --actor codex --resolve --body-file /tmp/vivi-reply.md
{"type":"reply","id":"ct_123","actor":"codex","status":"resolved"}

$ printf '%s\n' 'This does not apply to the selected workspace because the file is generated from another source.' | vivi reply http://127.0.0.1:4318 ct_123 --actor codex --archive --body-file -
{"type":"reply","id":"ct_123","actor":"codex","status":"archived"}

$ vivi reply http://127.0.0.1:4318 ct_123 --actor cursor
error: unsupported actor "cursor"; expected one of: codex, claude

$ vivi reply http://127.0.0.1:4318 ct_123 --body "Fixed."
error: missing required --actor; expected one of: codex, claude

$ vivi reply http://127.0.0.1:4318 ct_123 --actor codex
error: missing reply body; pass --body <text> or --body-file <path|->
```

What it makes visible:

- the product-level concept: inbox and reply,
- which supported agent authored the reply,
- whether an inbox read was passive or explicitly marked as read by an agent,
- whether the thread remains open, resolves, or archives,
- a smaller vocabulary than work/claim/follow/triage/release/dismiss.
- replies are non-interactive only: short replies use `--body`, structured or
  multi-line replies use `--body-file <path>`, and pre-piped stdin is accepted
  only when explicitly requested with `--body-file -`.

Best for:

- maximizing conceptual simplicity,
- giving future agent integrations a stable, friendly front door.

Tradeoff:

- adds a facade over existing commands,
- risks hiding useful protocol detail from advanced adapters,
- requires careful mapping so `reply --resolve` and `reply --archive` preserve
  existing guarded write and receipt safety.
- needs an explicit policy for actor aliases, for example `claude` as the
  facade name for the existing `claude_code` protocol kind.
- if passive inbox reads do not claim work, concurrent agents can see the same
  comment; claiming stays in the advanced `comments work` surface or becomes an
  explicit future option.

## Concept D: No Agent CLI Until Comment Arrives

Thesis: do not ask the agent to start a watcher at all. The browser/server
records comments, and the agent asks for the next comment only when it is
ready to work.

Mock transcript:

```text
$ vivi . --open
Vivi serving /work/project
Browser: http://127.0.0.1:4317

$ vivi next-comment --actor codex --json
{"threadId":"ct_123","path":"README.md","body":"This section is unclear.","recommendedAction":"reply_or_fix"}
```

Reply path:

```text
$ vivi reply ct_123 --actor codex --body "Fixed the unclear paragraph and verified README.md."
{"threadId":"ct_123","status":"resolved"}
```

What it makes visible:

- only demand-driven work,
- no idle resident process,
- no stream semantics.

Best for:

- one-shot coding sessions,
- agents that are invoked after the human is done reviewing.

Tradeoff:

- not live,
- human follow-up while work is in progress needs polling or an explicit
  re-check,
- weaker fit for the "comment arrived, wake the agent" use case.

## Comparison

| Concept                               | Commands the agent must understand                                 | Live arrival | Best fit                     | Main cost                            |
| ------------------------------------- | ------------------------------------------------------------------ | ------------ | ---------------------------- | ------------------------------------ |
| A. Server Stdout Inbox                | start server, reply                                                | yes          | maximum first-run simplicity | mixes server stdout and event stream |
| B. One Resident Command               | start server, `comments work`, suggested writes                    | yes          | robust current architecture  | still exposes protocol vocabulary    |
| C. Comment Pipe Contract              | `inbox <url>`, `reply <url> <thread-id> --actor <actor> [--resolve | --archive]`  | yes                          | product-level simplicity             | facade must map to existing safety |
| D. No Agent CLI Until Comment Arrives | `next-comment`, `reply`                                            | no           | one-shot agents              | misses wake-on-comment behavior      |

## Recommendation to explore next

The strongest near-term direction is B with the language of C:

- keep `comments work` as the implemented resident loop,
- make the first visible story "comment inbox" rather than "protocol",
- require the inbox URL explicitly, because concurrent Vivi servers are a
  normal local workflow,
- remove agent identity from server launch; actor identity belongs to `reply`,
  and to explicit read receipts such as `inbox --read-as <actor>`,
- validate simple facade actor values against a fixed set, initially `codex`
  and `claude`,
- make `reply` the only write verb in the simple facade, with optional
  `--resolve` or `--archive` side effects that match GUI lifecycle language,
- reduce startup JSON to a short `primaryCommand` summary while preserving full
  `suggestedCommands` for machines,
- keep README and the CLI contract centered on the top-level `inbox`/`reply`
  facade while preserving `comments work --loop` for adapter authors,
- keep `watch`, `follow`, `claim`, `protocol`, `schema`, and receipts as
  advanced adapter tools, not first-screen concepts.

The more radical direction is A:

- add an opt-in server mode where comment events are emitted on stdout,
- reserve normal server logs for stderr,
- treat `vivi . --agent codex` as the entire live loop starter.

That path should be chosen only if the product wants the server process to be
the agent's inbox, not merely the browser host.

## Review decision

Choose one direction before implementation:

- refine B/C into the next small product slice,
- prototype A as a transcript and contract first,
- keep D as a one-shot fallback but not the primary live UX.
