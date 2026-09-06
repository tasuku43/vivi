# Vivi for Codex

Codex uses plugins as the installable distribution unit and skills as the reusable workflow unit. This package keeps the implementation small: one Codex plugin that contributes two focused skills.

## Remote Install

From a public GitHub repository, add the marketplace at the repository root:

```bash
codex plugin marketplace add tasuku43/vivi
```

Then install `vivi` from the `vivi-agent-extensions` marketplace in the Codex
plugin UI or CLI. Invoke its `Apply Vivi Feedback` skill as `$apply-feedback`.

For sparse marketplace setups, this directory also contains a local catalog:

```bash
codex plugin marketplace add tasuku43/vivi --sparse .agents/plugins
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
    Codex workflow for fetching published comments on demand and reporting in the coding conversation
  skills/apply-feedback/agents/openai.yaml
    Codex app display metadata
```

## Design

The skill is invoked after the user publishes feedback. It fetches one current
snapshot, applies each feedback item, and reports the result in the existing
coding conversation without creating a resident background process.

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
