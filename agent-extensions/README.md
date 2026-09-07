# Vivi Agent Extensions

One Vivi plugin for each coding host, with two focused skills:

| Goal                                   | Codex             | Claude Code            |
| -------------------------------------- | ----------------- | ---------------------- |
| Open a local artifact for human review | `$open`           | `/vivi:open`           |
| Apply published feedback               | `$apply-feedback` | `/vivi:apply-feedback` |

Natural language such as “open this design in Vivi” or “apply my published Vivi
feedback” can select the corresponding workflow.

## Requirements

Install the Vivi CLI using the [repository installation guide](../README.md).
The plugin does not bundle or install the binary. Check `vivi open --help`:
older binaries without this command need updating. For development, build the
current repository with `task build` and use its `./vivi` binary.

## Codex

Add the repository marketplace:

```bash
codex plugin marketplace add tasuku43/vivi
codex plugin add vivi@vivi-agent-extensions
```

For local development, add the repository root with
`codex plugin marketplace add .`. See [Codex notes](codex/README.md).

## Claude Code

```text
/plugin marketplace add tasuku43/vivi
/plugin install vivi@vivi-agent-extensions
/reload-plugins
```

For local development:

```bash
claude --plugin-dir ./agent-extensions/claude/vivi
```

See [Claude Code notes](claude/README.md).

## The review journey

`open` discovers or reuses the appropriate server, starts one only when needed,
and uses `vivi open <url> [path]` to validate and open the artifact. Paths are
relative to the server root. Host browsers use `--print` and open the returned
URL. The explicitly selected server stays the same throughout the review.

The human reads, comments, saves drafts, and publishes. Publish makes feedback
available; it does not wake an agent. On an apply request, `apply-feedback`
uses `vivi inbox <url> --read-as codex|claude --unseen` to retrieve unseen
anchored conversations, records Seen for the host actor, checks
current files for already-satisfied requests, implements and verifies changes,
and refreshes once before reporting in the coding conversation. It returns
validated artifact links for human re-review. Inspection-only requests remain
passive and do not edit files. New human feedback returns a thread to the next
unseen fetch. To resume previously retrieved work, retain its snapshot or omit
`--unseen` to retrieve all open threads.

Seen means observed, not implemented or approved. The plugin adds no listener,
automatic resolution, task ownership, or parallel response inbox.
