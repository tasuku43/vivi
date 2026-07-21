---
description: Fetch published Vivi browser review comments on demand while implementing code in Claude Code, reply to them, and re-fetch before resolving. Use when the user asks Claude to get Vivi feedback, reply through Vivi, or refine the Vivi agent workflow.
allowed-tools: Bash Read Grep Glob
---

# Vivi Review Pull

Use Vivi as an on-demand browser review surface. Do not keep a resident inbox
watcher running.

## Attach and fetch

1. Use the Vivi URL from the browser, user prompt, or server-ready JSON.
2. If no URL exists, launch Vivi with `vivi <root> --ready-json` or the
   repository's local command.
3. If `vivi` is not on PATH, try `npm exec -- vivi`.
4. When the user asks for feedback, run `vivi inbox <url>` once. It emits the
   currently published open comments and exits.
5. Add `--read-as claude` only when visible browser read state is useful.

Fetch again when the user asks, when a refresh is useful, or immediately before
resolving a thread. Do not poll or delegate a listener by default.

## Reply

```bash
vivi reply <url> <thread-id> --actor claude --body-file - <<'EOF'
message
EOF
```

Use `--resolve` only after the thread is handled, and `--archive` only when the
user explicitly wants it hidden. Before resolving, fetch once more and continue
if the thread has a newer human comment.

## Product boundary

- Publish makes the human's draft agent-visible; it does not block on an agent.
- Fetch timing belongs to the agent workflow.
- Claims and resident loops are advanced compatibility tools, not the default.
- Keep detailed implementation state outside Vivi and reply with the concise,
  user-visible result.
