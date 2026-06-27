# Vivi CLI interface concepts

Product promise: one local command opens a safe browser review surface; agent-facing CLI commands turn human feedback into structured, actionable work.

## Current state model

```text
server absent -> start server -> ready JSON -> resident work loop
idle queue -> claimable thread -> owned work -> triage/release/done/dismiss
owned stale/restart -> mine/check -> renew/follow or release
changed files only -> review queue/diff -> comments work when human feedback appears
```

## Friction observed

- `comments work --help` shows the whole `comments` help, so the primary loop has no focused transcript.
- `ready-json` is strong, but the display command can be long and visually noisy.
- README still mentions older `--wait --idle-events --idle-on-change` guidance while help/tests prefer compact `--loop`.
- `comments` and `review` both explain the relationship, but each screen repeats enough that the hierarchy is harder to scan.

## Concept A: Compact Agent Loop

Thesis: make `comments work` the smallest possible happy path and keep advanced protocol commands out of the first screen.

Mock transcript:

```text
$ vivi . --port 0 --ready-json --actor codex
{ "event": "vivi_server_ready", "url": "http://127.0.0.1:52038", "primary": "comments work" }

$ vivi comments work --actor codex --loop --url http://127.0.0.1:52038 --json
# silent until claimable feedback or thread activity
```

Best for: token-efficient agents and first-time adapter authors.
Tradeoff: advanced recovery is one help level deeper.

## Concept B: State-Aware Recovery

Thesis: make every failure answer "what state am I in and what exact command moves me forward?"

Mock transcript:

```text
$ vivi comments doctor --actor codex --json
{
  "error": { "code": "server_unreachable", "state": "server_absent" },
  "next": "vivi . --host 127.0.0.1 --port 4317 --ready-json --actor codex",
  "then": "vivi comments doctor --actor codex --json"
}
```

Best for: robust automation and restart recovery.
Tradeoff: adds a more opinionated summary layer over existing suggestedCommands.

## Concept C: Two-Lane Help

Thesis: top-level help should separate human launch, agent loop, and debug surfaces instead of listing all commands as peers.

Mock outline:

```text
vivi - local review adapter

Human:
  vivi [root] --open

Agent:
  vivi [root] --port 0 --ready-json --actor <actor>
  vivi comments work --actor <actor> --loop --url <url> --json

Changed-file context:
  vivi review queue --actor <actor> --json
  vivi review diff <path> --base HEAD --json

Debug/recovery:
  vivi comments doctor|mine|check|protocol|schema ...
```

Best for: users deciding which CLI surface they are using.
Tradeoff: less exhaustive on the first screen; exhaustive help moves down.

## Selected first slice

Combine A and C:

- add focused `comments work --help`,
- update top-level help to the two-lane outline,
- sync README to the compact `--loop` contract,
- preserve JSON contracts and existing suggestedCommands,
- cover with Go help/golden tests.
