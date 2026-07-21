# Vivi Agent Extensions

Reusable agent-loop packages for operating Vivi browser comments while coding.

## Codex

Codex uses a plugin as the distribution unit and a focused skill as the workflow.

From the public repository:

```bash
codex plugin marketplace add <owner>/<repo>
```

Then install `vivi-agent-loop` from the `vivi-agent-extensions` marketplace.

For local development:

```bash
codex plugin marketplace add .
```

See [codex/README.md](codex/README.md) for structure and design notes.

## Claude Code

From the public repository, add the Claude marketplace and install the plugin:

```text
/plugin marketplace add <owner>/<repo>
/plugin install vivi-agent-loop@vivi-agent-extensions
/reload-plugins
```

For local development:

```bash
claude --plugin-dir ./agent-extensions/claude/vivi-agent-loop
```

The Claude package includes `/vivi-agent-loop:vivi-agent-loop` for fetching
published feedback on demand and replying while coding.

See [claude/README.md](claude/README.md) for structure and design notes.
