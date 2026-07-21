---
name: vivi-agent-loop
description: Fetch published Vivi browser review comments on demand while coding with Codex, reply to them, and re-fetch when the user asks or before resolving a thread. Use when the user asks Codex to get Vivi feedback, reply through Vivi, or refine the Vivi agent workflow.
---

# Vivi Review Pull

Use Vivi as an on-demand browser review surface. The human drafts and publishes
feedback in the GUI; the agent decides when to fetch it. Do not keep a resident
inbox watcher running.

## Attach and fetch

1. Prefer an existing Vivi URL from the user, browser, or server-ready JSON.
2. If no server is running, start one with `vivi <root> --ready-json` or the
   repository's local equivalent.
3. If `vivi` is not on PATH inside a repository checkout, try
   `npm exec -- vivi`.
4. When the user asks to get feedback, or when a refresh is useful, run
   `vivi inbox <url>` once. It emits the currently published open comments and
   then exits.
5. Add `--read-as codex` only when a visible browser read receipt is useful.

Do not poll, watch, or delegate a listener by default. A later fetch is another
explicit one-shot command.

## Reply safely

Use stdin or a file for reply bodies so Markdown and shell-sensitive characters
survive unchanged.

```bash
vivi reply <url> <thread-id> --actor codex --body-file - <<'EOF'
message
EOF
```

Use `--resolve` only after the thread is genuinely handled. Use `--archive`
only when the user explicitly wants the thread hidden.

Before resolving, fetch once more and check whether the same thread has a newer
human comment. If it does, treat the newest comment as the current request.

## Command recipes

```bash
# Start Vivi from the intended workspace root.
vivi . --ready-json

# Fetch all currently published open feedback once.
vivi inbox <url>

# Fetch once and show read state in the browser.
vivi inbox <url> --read-as codex

# Reply without closing the thread.
vivi reply <url> <thread-id> --actor codex --body-file - <<'EOF'
message
EOF

# Reply and resolve a handled thread.
vivi reply <url> <thread-id> --actor codex --resolve --body-file - <<'EOF'
done
EOF
```

## Product boundary

- Publish is the human's boundary between local drafting and agent-visible
  feedback.
- Fetch timing belongs to the agent workflow, not to the Publish interaction.
- Vivi threads are lightweight, file-anchored review surfaces, not a project
  manager or a resident task queue.
- Keep implementation plans and test tracking in the main coding workflow;
  summarize only relevant results back into the Vivi thread.
- Claims, leases, and resident loops are compatibility or advanced coordination
  tools, not the default experience.

Completion replies should be brief and include what changed, how it was
verified, and a useful Vivi or Storybook URL when available.
