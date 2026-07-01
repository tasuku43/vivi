# Test and eval strategy

## Test layers

### Domain unit tests

Validate deterministic logic:

- path normalization,
- root escape rejection policy,
- viewer classification,
- tree diff semantics,
- event shape transformation.

### App/use-case tests

Validate orchestration:

- read tree use case,
- read file use case,
- event handling,
- stale update behavior,
- API response shape construction.

### Infra adapter tests

Validate Node adapters with fixtures:

- filesystem scanning,
- ignore defaults,
- file reads,
- HTML preview reads,
- watcher event normalization when practical.

### E2E tests

Exercise the real CLI/server path:

- start server against fixture directory,
- execute the GraphQL `ViviTree` operation,
- execute the GraphQL `ViviFileContext` operation,
- verify invalid path rejection,
- verify preview endpoint behavior.

### Eval cases

Fixture-driven evals encode product acceptance scenarios. They should be human-readable JSON files under `evals/cases/`.

Current eval coverage includes the mixed sample workspace tree, default ignored directories, viewer kind dispatch, opening representative Markdown/HTML/code/text/image/JSON files through the filesystem adapter, and code line-reference formatting.

## Fixture addition process

1. Add or update files under `test/fixtures/`.
2. Add a matching eval case under `evals/cases/`.
3. Add tests for the smallest relevant layer.
4. Update docs if the behavior is contract-level.

## CI guarantees

CI should run the same command as local development:

```bash
task check
```

## Failure triage

A failure is a regression when:

- documented behavior changed unintentionally,
- safety checks are weaker,
- public API shapes changed without docs/tests,
- eval fixtures no longer pass.

For UI-heavy behavior that is not yet covered by a browser automation harness, prefer pure state/helper tests and render-to-static-markup tests. Add E2E server coverage for contracts such as SSE event delivery and HTML sandbox headers.

A failure may be an intentional contract change only when:

- docs are updated,
- tests/evals are updated,
- migration impact is summarized,
- the product boundary still holds.

## Coding-agent rule

Do not finish an implementation pass with only manual reasoning. A behavior is not complete until it is represented in tests, evals, or both.
