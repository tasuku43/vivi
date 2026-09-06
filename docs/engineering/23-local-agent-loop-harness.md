# Local feedback harness

The deterministic harness exercises Vivi's core human/agent exchange through
the real Go CLI and GraphQL server. It does not run an LLM or manage tasks.

1. Create a human draft and verify the inbox cannot see it.
2. Publish the draft and retrieve the anchored feedback through `vivi inbox`.
3. Verify passive retrieval creates no read receipt.
4. Retrieve with `--read-as codex` or `--read-as claude` and verify attribution.
5. Retrieve again and verify feedback remains available, open, and unchanged.
6. Publish a follow-up; verify it is not automatically read and the next explicit
   agent read creates a fresh receipt.

The fixture is `test/fixtures/agent-loop/basic.json`. Its `human` object contains
path, body, anchor, and actor; `agent.readAs` selects `codex` or `claude`.
The E2E suite runs both identities against isolated temporary workspaces.
Historical work/claim/watch/follow, agent replies, and terminal lifecycle
fixtures have been removed with those product responsibilities.

## Running

Build with `npm run build && npm run build:go`, then start an isolated fixture
workspace with `./vivi <fixture-root> --port 0 --ready-json`. Pass its resolved URL:

```bash
npm run harness:agent-loop -- --url http://127.0.0.1:4317
npm run harness:agent-loop -- --url http://127.0.0.1:4317 --fixture test/fixtures/agent-loop/basic.json --cli ./vivi
```

Use a disposable workspace: this harness creates and publishes fixture feedback.
It reports the verified stages as JSON and exits nonzero on a failed assertion.
Run `npm run e2e -- test/e2e/local-agent-loop.test.ts` for automated coverage.
