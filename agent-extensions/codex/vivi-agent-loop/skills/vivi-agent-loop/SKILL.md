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
4. When developing Vivi itself, prefer an explicit local binary or repo-local command over a global or Homebrew-installed `vivi`; this is a development-context ambiguity, not a normal user workflow concern.
5. On attach, run `vivi inbox <url>` once if you need the current open backlog.
6. For the live loop, run `vivi inbox <url> --watch`; it should emit line-delimited JSON for comments observed after the listener starts.
7. Add `--initial` only when the user explicitly wants the current backlog emitted through the watcher.
8. Add `--read-as codex` only when read receipts should be visible in the browser.

## Reply safely

Use stdin or a file for reply bodies. Avoid shell-interpreted inline bodies when the text contains backticks, angle brackets, `$`, quotes, or multiline content.

```bash
vivi reply <url> <thread-id> --actor codex --body-file - <<'EOF'
message
EOF
```

Use `--resolve` when the thread is genuinely handled and `--archive` only when the user wants it hidden.

## Thread lifecycle

Treat Vivi threads as lightweight, browser-anchored work surfaces rather than a full project manager.

- Keep screen-specific feedback, user-visible decisions, and final confirmations in Vivi threads.
- Keep detailed implementation plans, test tracking, and commit grouping in the main Codex/local workflow, then summarize the relevant result back into Vivi.
- Use `claim` when ownership matters, especially with multiple open threads or multiple agents.
- Use `--resolve` when the agent-side work is handled.
- Do not use `--archive` unless the user explicitly asks for the thread to be hidden. The user usually archives after reading the final reply.

Before resolving a thread, re-check that thread for newer user comments. If a newer comment exists, treat it as the latest request and continue the loop. If there are no newer comments, leave a short completion reply and resolve.

Completion replies should be brief and should include the useful parts of:

- what changed,
- how it was verified,
- relevant Vivi or Storybook URLs,
- commit hash when a commit was created.

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

## Operating modes

Prefer a lightweight operating framework over a rigid agent architecture. Start simple, then escalate only when the session needs more coordination.

### Mode 1: Solo Loop

Use this by default for one thread or short feedback loops.

- The main agent reads the inbox once.
- The main agent may run a short bounded watcher if useful.
- The main agent owns requirement interpretation, implementation, verification, reply, and resolve.
- Before resolving, the main agent re-checks the target thread for newer comments.

### Mode 2: Watched Loop

Use this when the user is actively commenting while the agent is working, when a build/test/implementation pass will take more than about 30 seconds, or when inbox watching would distract the main agent.

- Main agent: owns requirements, edits, tests, commits, replies, and resolving.
- Listener subagent: watches `vivi inbox <url> --watch` for a bounded interval and returns only new thread IDs, concise body summaries, and urgency.
- The listener does not make implementation decisions and does not resolve or archive threads.
- Stop the listener at the end of the bounded interval, after one useful event, or before the final response unless the user explicitly wants it left running.

### Mode 3: Coordinated Loop

Use this for multiple open threads, multiple agents, or parallel work.

- Claim a thread before acting on it.
- Release a thread when handing it off or pausing.
- Keep separate claims for independent browser threads.
- Summarize decisions and outcomes back into the relevant Vivi thread so the browser remains useful.

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

- Start in Solo Loop unless the situation clearly calls for Watched Loop or Coordinated Loop.
- Prefer `--watch` without `--initial` for live operation.
- Prefer plain `inbox` for snapshots.
- Prefer `--body-file -` for replies.
- Prefer claim/release over informal ownership when several agents may respond.
- Re-check the target thread before resolving it.
- Prefer `--resolve` without `--archive` unless the user explicitly wants the thread hidden.
- Stop temporary watcher processes before final response unless the user explicitly wants the listener to remain alive.
