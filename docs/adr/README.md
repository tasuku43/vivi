# Architecture Decision Records

ADRs capture durable decisions that should outlive an implementation slice.
They are different from exploratory notes: an ADR should say what direction is
accepted, what it replaces or constrains, and which contract or implementation
documents carry the current behavior.

Current ADRs:

- `17-ui-product-decisions.md`: accepted UI product direction for the classic
  local workspace, command palette, tabs, inspector, and review flow.

- [CLI core simplification — decision B](31-cli-core-simplification.md):
  accepted minimal human/agent handoff and removal of task management.

Use `research/` for ideas that are still being compared. Promote a research
note into `adr/` only after the decision is meant to guide future work.
