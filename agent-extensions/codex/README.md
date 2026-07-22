# Vivi for Codex

Codex uses plugins as the installable distribution unit and skills as the reusable workflow unit. This package keeps the implementation small: one Codex plugin that contributes one focused skill.

## Remote Install

From a public GitHub repository, add the marketplace at the repository root:

```bash
codex plugin marketplace add <owner>/<repo>
```

Then install `vivi` from the `vivi-agent-extensions` marketplace in the Codex
plugin UI or CLI. Invoke its `Apply Vivi Feedback` skill as `$apply-feedback`.

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

agent-extensions/codex/vivi/
  .codex-plugin/plugin.json
    plugin metadata and skill path
  skills/apply-feedback/SKILL.md
    Codex workflow for fetching published comments on demand and replying
  skills/apply-feedback/agents/openai.yaml
    Codex app display metadata
```

## Design

The skill is invoked after the user publishes feedback. It fetches one current
snapshot, applies each thread's feedback, and uses shell-safe replies without
creating a resident background process.
