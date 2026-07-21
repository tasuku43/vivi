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
codex plugin marketplace add <owner>/<repo> --sparse .agents/plugins
```

For local development:

```bash
codex plugin marketplace add .
```

## Architecture

```text
.agents/plugins/marketplace.json
  remote repository entrypoint for Codex

agent-extensions/codex/vivi-agent-loop/
  .codex-plugin/plugin.json
    plugin metadata and skill path
  skills/vivi-agent-loop/SKILL.md
    Codex workflow for fetching published comments on demand and replying
  skills/vivi-agent-loop/agents/openai.yaml
    Codex app display metadata
```

## Design

The skill keeps Publish asynchronous and leaves fetch timing to the agent. It emphasizes one-shot reads and shell-safe replies instead of a resident background process.
