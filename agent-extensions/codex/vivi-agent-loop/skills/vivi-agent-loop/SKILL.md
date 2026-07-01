---
name: vivi-agent-loop
description: Run a live local Vivi browser comment loop while coding with Codex. Use when the user wants Codex to converse through Vivi comments, watch `vivi inbox`, reply to browser feedback, coordinate multiple comment threads, delegate inbox listening to subagents, or refine Vivi agent workflows.
---

# Vivi Agent Loop

Use Vivi as a live browser comment bridge while continuing normal coding work.

## Start or attach

1. Prefer an existing Vivi URL from the user, the browser, or a server-ready JSON payload.
2. If no server is running, start one with `vivi <root> --ready-json` or the repo's local equivalent, then use the emitted URL.
3. If `vivi` is not on PATH inside a repo checkout, try `npm exec -- vivi`.
4. On attach, run `vivi inbox <url>` once if you need the current open backlog.
5. For the live loop, run `vivi inbox <url> --watch`; it should emit line-delimited JSON for comments observed after the listener starts.
6. Add `--initial` only when the user explicitly wants the current backlog emitted through the watcher.
7. Add `--read-as codex` only when read receipts should be visible in the browser.

## Reply safely

Use stdin or a file for reply bodies. Avoid shell-interpreted inline bodies when the text contains backticks, angle brackets, `$`, quotes, or multiline content.

```bash
vivi reply <url> <thread-id> --actor codex --body-file - <<'EOF'
message
EOF
```

Use `--resolve` when the thread is genuinely handled and `--archive` only when the user wants it hidden.

## Command recipes

Use these as exact starting points. Replace `vivi` with `npm exec -- vivi` when the binary is local to the repo.

```bash
# Start a server from the intended workspace root only.
vivi . --ready-json

# Read the current backlog once.
vivi inbox <url>

# Watch future comments for a bounded interval.
timeout 120s vivi inbox <url> --watch

# Include current backlog before future comments.
timeout 120s vivi inbox <url> --watch --initial

# Claim ownership before acting in a shared-agent session.
vivi claim <url> <thread-id> --actor codex

# Release ownership when handing off or pausing.
vivi release <url> <thread-id> --actor codex --body-file - <<'EOF'
handoff note
EOF

# Reply and close a handled thread.
vivi reply <url> <thread-id> --actor codex --resolve --body-file - <<'EOF'
done
EOF
```

If `timeout` is unavailable, start the watcher as a managed process, wait for the bounded interval or one useful event, then interrupt it before finalizing. If the URL is invalid or the server exits, run `vivi inbox <url>` once to confirm connectivity, then restart Vivi from the intended root.

## Keep conversation tempo

- Acknowledge browser comments quickly before deep work.
- Keep the main thread focused on decisions, implementation, and concise status.
- Treat watcher output as an event stream, not as transcript material to paste in full.
- If a comment changes priorities, let the newest browser comment steer the current work.
- Before finalizing, drain the watcher once so late comments are not missed.

## Coordinate multiple threads

1. For one active work item, reply directly.
2. For concurrent work, `claim` a thread before acting and `release` it when handing off or pausing.
3. Use separate claims for independent browser threads; avoid claiming a thread just to read it.
4. Summarize cross-thread decisions back into the relevant browser thread so the browser UI stays useful.

## Use Codex subagents

Use subagents when inbox listening, log reading, or exploratory checks would pollute the main context. A good split is:

- Main agent: owns requirements, edits, tests, and user-facing replies.
- Listener subagent: watches `vivi inbox <url> --watch` for a bounded interval and returns only new thread IDs, bodies, and urgency.
- Explorer subagent: inspects repo history, docs, or logs and returns a short finding list.

Ask a listener subagent to stop after a fixed time or after one useful event. Do not leave indefinite subagent loops running without a reason.

Give listener subagents a concrete stop rule. If a shell timeout command is unavailable, ask the subagent to start the watcher, sleep for the requested duration, then interrupt the watcher before returning.

```bash
timeout 120s vivi inbox <url> --watch
```

## Operational defaults

- Prefer `--watch` without `--initial` for live operation.
- Prefer plain `inbox` for snapshots.
- Prefer `--body-file -` for replies.
- Prefer claim/release over informal ownership when several agents may respond.
- Stop temporary watcher processes before final response unless the user explicitly wants the listener to remain alive.
