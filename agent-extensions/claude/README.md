# Vivi for Claude Code

This package provides two focused skills for fetching published Vivi feedback on demand and reporting results in the existing coding conversation.

## Remote Install

Claude Code expects a marketplace file at `.claude-plugin/marketplace.json` in the public repository.

Inside Claude Code:

```text
/plugin marketplace add tasuku43/vivi
/plugin install vivi@vivi-agent-extensions
/reload-plugins
```

For local development:

```bash
claude --plugin-dir ./agent-extensions/claude/vivi
```

## Architecture

```text
.claude-plugin/marketplace.json
  remote repository entrypoint for Claude Code

agent-extensions/claude/vivi/
  .claude-plugin/plugin.json
    plugin metadata
  skills/apply-feedback/SKILL.md
    one-shot review fetch and implementation workflow
```

## Design

Publish stays asynchronous. The user invokes `/vivi:apply-feedback` (`Apply
Vivi Feedback`) after publishing; it fetches the current snapshot once, applies
the feedback, and does not create a resident listener.

## Open and review

The Vivi plugin exposes two entry points: **Open in Vivi** (`open`) and
**Apply Vivi Feedback** (`apply-feedback`). Requires a Vivi binary with
`vivi open --help` support; plugin installation does not install the CLI.

| Goal                       | Codex             | Claude Code            |
| -------------------------- | ----------------- | ---------------------- |
| Open a document for review | `$open`           | `/vivi:open`           |
| Apply published feedback   | `$apply-feedback` | `/vivi:apply-feedback` |

Natural language such as “open this design in Vivi” or “apply my published Vivi
feedback” can select the corresponding workflow. An explicitly selected server
is reused across both. With multiple matching servers, selection must be
unambiguous; no listener or automatic wake-up is installed.

`open` uses `vivi open <url> [path]`, or `--print` followed by the host browser
tool. Paths are relative to the server root. Applying feedback records Seen,
checks already-satisfied requests, refreshes once, and returns re-review links
in the coding conversation. Inspecting feedback alone remains passive.
