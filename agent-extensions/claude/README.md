# Vivi for Claude Code

This package provides one focused skill for fetching published Vivi feedback on demand and replying safely.

## Remote Install

Claude Code expects a marketplace file at `.claude-plugin/marketplace.json` in the public repository.

Inside Claude Code:

```text
/plugin marketplace add <owner>/<repo>
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
    one-shot review fetch and reply workflow
```

## Design

Publish stays asynchronous. The user invokes `/vivi:apply-feedback` (`Apply
Vivi Feedback`) after publishing; it fetches the current snapshot once, applies
the feedback, and does not create a resident listener.
