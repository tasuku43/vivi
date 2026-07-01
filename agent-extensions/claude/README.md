# Vivi Agent Loop for Claude Code

Claude Code plugins can bundle skills and subagents. This package uses that richer shape: one inline coordination skill, one forked listener skill, and one read-only listener subagent.

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
    inline coordination workflow for active coding sessions
  skills/vivi-listen/SKILL.md
    forked bounded-listening workflow using context: fork
  agents/vivi-inbox-listener.md
    read-only Bash subagent for watching `vivi inbox --watch`
```

## Design

Claude Code can run skills in forked subagent context, so listening is modeled as a first-class delegated workflow. The coordinator skill stays lightweight and read-oriented, while `/vivi-agent-loop:vivi-listen <url> [seconds]` handles noisy inbox watching without filling the main conversation.
