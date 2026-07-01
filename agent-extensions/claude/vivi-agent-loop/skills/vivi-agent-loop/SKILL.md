---
description: Coordinate live Vivi browser comments while implementing code in Claude Code. Use when the user asks to converse through Vivi, watch `vivi inbox`, reply to browser feedback, manage multiple Vivi comment threads, or keep browser conversation and coding work moving together.
allowed-tools: Bash Read Grep Glob
---

# Vivi Agent Loop

Run Vivi as the live conversation surface while continuing the implementation.

## Attach

1. Use the Vivi URL from the browser, user prompt, or server-ready JSON.
2. If no URL exists, launch Vivi with `vivi <root> --ready-json` or the repo's local command and use the emitted URL.
3. If `vivi` is not on PATH inside a repo checkout, try `npm exec -- vivi`.
4. Run `vivi inbox <url>` once for the current backlog when joining an existing session.
5. Run `vivi inbox <url> --watch` for live operation. This should emit line-delimited JSON for comments observed after the listener starts.
6. Add `--initial` only when startup backlog should also stream through the watcher.
7. Add `--read-as claude` only when visible browser read receipts are useful.

## Reply

Prefer `--body-file -` so Markdown, quotes, `$`, and backticks survive the shell.

```bash
vivi reply <url> <thread-id> --actor claude --body-file - <<'EOF'
message
EOF
```

Use `--resolve` only after the browser thread is handled.

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
vivi claim <url> <thread-id> --actor claude

# Release ownership when handing off or pausing.
vivi release <url> <thread-id> --actor claude --body-file - <<'EOF'
handoff note
EOF

# Reply and close a handled thread.
vivi reply <url> <thread-id> --actor claude --resolve --body-file - <<'EOF'
done
EOF
```

If `timeout` is unavailable, start the watcher as a managed process, wait for the bounded interval or one useful event, then interrupt it before finalizing. If the URL is invalid or the server exits, run `vivi inbox <url>` once to confirm connectivity, then restart Vivi from the intended root.

## Keep tempo

- Acknowledge new browser comments before long edits or test runs.
- If a comment changes direction, follow the newest comment.
- Keep watcher output summarized; do not paste raw JSON unless asked.
- Drain the watcher before finalizing.

## Delegate

For noisy or parallel sessions, invoke `/vivi-agent-loop:vivi-listen <url>` or use the `vivi-inbox-listener` subagent for a bounded watch pass. Keep this skill inline when you are actively editing; use the listener skill/subagent to preserve the main context.

## Multiple threads

Use `claim` before acting on a thread that another agent might handle, and `release` when handing off. For independent user requests, keep each browser thread's reply close to its own thread.
