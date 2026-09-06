---
name: open
description: Open a local artifact or workspace in Vivi for human review. Use when the user asks to see a document in Vivi, open Vivi, or prepare local work for review. Reuses an explicit or matching server and returns a validated document link.
---

# Open in Vivi

Make the requested local artifact easy for the human to read and comment on.
Use the existing CLI; do not create a review task, resident listener, or MCP server.

## Select the workspace

1. Honor an explicit server URL or a previously confirmed URL for this workspace.
   Do not silently switch servers between opening and applying feedback.
2. Otherwise run `vivi servers`. Use the sole matching server. When several
   match, ask which server to use, showing their URLs. If only unrelated servers
   exist, do not use one just because it is running.
3. With an unambiguous requested root and no applicable server, launch
   `vivi <root> --ready-json` in the host's persistent process facility. Capture
   the ready event and keep the process alive. Do not assume port 4317 or
   launch a second server when a selected server is unreachable.
4. If the CLI is missing, explain how to install Vivi using the repository's
   documented installation route. A repository-local Vivi shim may be used when
   available. Do not download an unrelated npm package. Check `vivi open --help`;
   an older binary without this command needs updating, not a guessed API.

## Open the requested artifact

Use `vivi open <url> <path>` with a path relative to the selected server's
workspace root, not the agent's current directory. Resolve the root from
`vivi servers` or the server-ready event. Never strip an absolute path to its
basename or silently move the server root to make a file fit.
Omit the path only when the user wants the workspace itself.

Quote shell arguments safely. Keep the selected URL unchanged. The command
validates that the file is available under that server's root and prints its
browser URL. Missing, excluded, or outside-root files are errors: report the
specific failure rather than presenting a broken link as success.

When the host provides a browser-opening tool, first run
`vivi open <url> <path> --print`, then open the returned URL with that tool.
Otherwise use the normal command to launch the system browser. Do not both
launch the system browser and open a second host tab. Browser tab reuse is
host-dependent; this command does not steer all connected browser sessions.

## Hand the work to the human

Return a clickable link naming the artifact, with at most a sentence about
what to review. On the first review only, explain: comment in Vivi, Publish,
then ask the agent to apply the feedback. Publish alone does not wake an agent.
Opening a document does not fetch feedback or create a Seen receipt.
Do not poll or start implementing feedback as part of this skill.
