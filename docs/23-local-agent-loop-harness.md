# Local agent loop harness

The local agent loop harness verifies Vivi's shortest comment feedback loop
without Claude Code, Codex, a vendor CLI, or an external AI service.

## Covered loop

The v1 fake agent performs these explicit stages:

1. `seed`: create a thread with a human comment from the fixture.
2. `read`: query open threads with `X-Vivi-Actor-*` headers.
3. `receipt`: verify one idempotent `thread_read` activity.
4. `reply`: add an actor-attributed agent comment.
5. `terminal`: call `resolveThread` or `archiveThread`.
6. `verify`: reload the terminal thread and verify activity order and actors.

Failures use the form `[agent-loop:<stage>] ...` and include the stages already
completed. This keeps CI failures attributable to the broken part of the loop
instead of reporting one opaque end-to-end mismatch.

## Fixture

The default fixture is
`test/fixtures/agent-loop/basic.json`. It contains only deterministic inputs:
the human actor and comment, the fake agent actor, a read idempotency key, the
reply body, and the terminal action. Generated thread, comment, activity ids,
and timestamps are outputs and are not golden values.

Additional fixtures should keep one behavior difference per file, for example
an archive outcome or a different actor kind. Do not encode timing or depend on
an external process completing work.

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

The runner is a GraphQL client, matching the boundary used by real agent
adapters. A future Claude Code or Codex adapter can replace the fake decision
step while retaining the fixture, stage reporting, and terminal verification.

## CI

`test/e2e/local-agent-loop.test.ts` starts the normal E2E server with isolated
workspace and comment data directories. It verifies the passing loop and the
stage-specific failure contract. `npm run e2e` and therefore `task check`
include this test; no network access, model credentials, sleeps, or vendor
executables are required.

The existing Go CLI test continues to cover `vivi comments active`, `reply`,
and lifecycle commands against the canonical GraphQL handler. Together, the
tests protect the reusable GraphQL harness and the agent-facing CLI wrapper.
