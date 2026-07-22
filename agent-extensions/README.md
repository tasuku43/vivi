# Vivi Agent Extensions

Reusable on-demand packages for applying published Vivi browser feedback
while coding.

## Codex

Codex uses a plugin as the distribution unit and a focused skill as the workflow.

From the public repository:

```bash
codex plugin marketplace add <owner>/<repo>
```

Then install `vivi` from the `vivi-agent-extensions` marketplace. Its focused
workflow is the `Apply Vivi Feedback` skill, invoked as `$apply-feedback`.

For local development:

```bash
codex plugin marketplace add .
```

See [codex/README.md](codex/README.md) for structure and design notes.

## Claude Code

From the public repository, add the Claude marketplace and install the plugin:

```text
/plugin marketplace add <owner>/<repo>
/plugin install vivi@vivi-agent-extensions
/reload-plugins
```

For local development:

```bash
claude --plugin-dir ./agent-extensions/claude/vivi
```

The Claude package includes `/vivi:apply-feedback` (`Apply Vivi Feedback`) for
fetching and applying published feedback on demand.

See [claude/README.md](claude/README.md) for structure and design notes.
