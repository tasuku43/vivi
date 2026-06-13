# Agent evaluation loop

This project intentionally uses tests and evals as an evaluation function for autonomous implementation.

## Ideal-state predicate

The implementation approaches the ideal state when a user can run `pathlens .`, open the local SPA, browse a live tree, preview common file types, and see updates without refreshing the page.

## Evaluation dimensions

1. Product behavior: does it do what a local live viewer should do?
2. Contract correctness: do CLI and HTTP contracts match the docs?
3. Safety: are paths constrained to the selected root?
4. React state behavior: do tree selection and expansion survive updates?
5. Performance: does the implementation avoid obvious O(N) work on every file change?
6. Maintainability: are boundaries preserved?
7. Agent usability: are failures actionable?

## Loop

For each implementation slice:

1. Choose one observable behavior.
2. Encode it in a test, fixture, eval case, or golden output.
3. Implement the behavior.
4. Run the narrow check.
5. Run `task check`.
6. Fix failures.
7. Stop only when the repository is closer to the documented ideal state.

## Anti-patterns

- Implementing UI without API contract tests.
- Adding watchers inside React tree nodes.
- Recomputing full recursive content hashes on every save.
- Discarding tree UI state after every event.
- Treating docs as optional after contract changes.
