# Vivi Review Pull for Claude Code

This package provides one focused skill for fetching published Vivi feedback on demand and replying safely.

## Remote Install

Claude Code expects a marketplace file at `.claude-plugin/marketplace.json` in the public repository.

Inside Claude Code:

```text
/plugin marketplace add <owner>/<repo>
/plugin install vivi-agent-loop@vivi-agent-extensions
/reload-plugins
```

For local development:

```bash
claude --plugin-dir ./agent-extensions/claude/vivi-agent-loop
```

## Architecture

```text
.claude-plugin/marketplace.json
  remote repository entrypoint for Claude Code

agent-extensions/claude/vivi-agent-loop/
  .claude-plugin/plugin.json
    plugin metadata
  skills/vivi-agent-loop/SKILL.md
    one-shot review fetch and reply workflow
```

## Design

Publish stays asynchronous. The skill fetches the current published snapshot only when the user asks or the agent chooses to refresh; it does not create a resident listener.
