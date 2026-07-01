---
description: Watch a Vivi inbox for a bounded interval and report only new browser comments. Use when Claude should delegate inbox listening or triage live Vivi comments without polluting the main conversation.
context: fork
agent: vivi-inbox-listener
disable-model-invocation: true
argument-hint: "<vivi-url> [seconds]"
allowed-tools: Bash
---

# Vivi Listener

Watch `$ARGUMENTS` for new Vivi comments and return a concise triage summary.

1. Parse the first argument as the Vivi URL.
2. Parse the optional second argument as seconds; default to 120.
3. Run `vivi inbox <url> --watch` for that bounded interval. Prefer:

```bash
timeout 120s vivi inbox <url> --watch
```

If `timeout` is unavailable, start the watcher, sleep for the requested duration, then interrupt the watcher.

4. Do not use `--initial` unless the prompt explicitly asks for backlog.
5. Treat watcher output as line-delimited JSON and summarize human comments only.
6. Stop the watcher before returning.
7. Return new thread IDs, body summaries, urgency, and any recommended next reply.
