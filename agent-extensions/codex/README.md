# Vivi Agent Loop for Codex

Codex uses plugins as the installable distribution unit and skills as the reusable workflow unit. This package keeps the implementation small: one Codex plugin that contributes one focused skill.

## Remote Install

From a public GitHub repository, add the marketplace at the repository root:

```bash
codex plugin marketplace add <owner>/<repo>
```

Then install `vivi-agent-loop` from the `vivi-agent-extensions` marketplace in the Codex plugin UI or CLI.

For sparse marketplace setups, this directory also contains a local catalog:

```bash
codex plugin marketplace add <owner>/<repo> --sparse agent-extensions/codex
```

For local development:

```bash
codex plugin marketplace add ./agent-extensions/codex
```

## Architecture

```text
.agents/plugins/marketplace.json
  remote repository entrypoint for Codex

agent-extensions/codex/marketplace.json
  local or sparse marketplace entrypoint

agent-extensions/codex/vivi-agent-loop/
  .codex-plugin/plugin.json
    plugin metadata and skill path
  skills/vivi-agent-loop/SKILL.md
    Codex workflow for attaching to Vivi, watching comments, replying,
    claiming/releasing threads, and delegating bounded inbox listening
  skills/vivi-agent-loop/agents/openai.yaml
    Codex app display metadata
```

## Design

Codex keeps the live implementation in the main agent and uses subagents selectively for bounded listening or noisy exploration. The skill therefore emphasizes exact command recipes, shell-safe replies, and stop rules rather than shipping a resident background process.
