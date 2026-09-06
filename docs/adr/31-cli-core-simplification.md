# CLI core simplification — decision B

The accepted direction is to remove responsibilities that do not serve the
product thesis: humans read and publish anchored feedback; agents retrieve it
and optionally record that they saw it. Agent discussion and implementation
belong in the coding workbench.

```text
vivi
├── [root] [options]     launch the local reading surface
├── servers             discover the running workspace
└── inbox <url>         retrieve published feedback once
    └── --read-as codex|claude
```

This is a removal, not a help-menu rearrangement. The old `comments` and `review`
implementations, ownership leases, resident workers, lifecycle mutations, and
protocol/receipt-verification machinery are removed. Old command names fail
with a migration hint. There is no replacement task namespace.

The browser retains document reading, the structural sidebar, anchored drafts,
publication, observed read activity, and Git Changes. Launch configuration and
security defaults remain available. The compact inbox preserves full anchored
conversation; the existing `--json` projection remains available for callers
that already consume it.

Existing stored records remain readable, including historical actors and
resolved/archived events. Read compatibility does not require exposing mutation
commands. New reads do not complete feedback or remove it from later retrieval.
A published follow-up receives a new read receipt when explicitly fetched by
an identified agent.

Verification covers removed command and GraphQL entry points, historical
storage projection without rewriting, inbox context/escaping, passive reads,
and real Go CLI handoffs for both Codex and Claude. The fixture harness now
exercises draft privacy, publish, read, reread, and follow-up observation.
