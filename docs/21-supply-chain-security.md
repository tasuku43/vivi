# Supply-chain security

## Policy

The lockfiles (`package-lock.json` and `go.sum`) are committed and CI uses
`npm ci`. Direct npm requirements use explicit versions; version movement is
handled by reviewed Dependabot PRs. Go modules use Minimal Version Selection and
checksums from `go.sum`.

Before adding a dependency, confirm all of the following:

- the functionality is in product scope and is not small enough to implement
  clearly with the language standard library;
- the package is actively maintained, has a credible publisher and release
  history, and has no unresolved high-severity advisory relevant to Vivi;
- its transitive dependency count, install scripts, network/build behavior, and
  generated-code behavior are understood;
- its license is compatible with MIT distribution and its source and release
  artifacts are traceable;
- a removal or replacement path exists if maintenance stops.

Prefer language/platform first-party packages, then widely used single-purpose
packages. Avoid packages for trivial parsing, file operations, hashing, process
launching, or GitHub API calls when Node, Go, Git, or the runner-provided `gh`
already provides the operation.

GitHub Actions follow a stricter rule: use a local script or runner tool first;
otherwise use a GitHub-owned Action. Every external Action, including official
Actions, must be pinned to a full 40-character commit SHA with its release tag
in a comment. A third-party Action requires documented ownership, maintenance,
license, permissions, input handling, and a reason a small local implementation
is not safer, followed by a narrow allowlist change in
`scripts/check-supply-chain.mjs`. `.github/workflows` must declare
`permissions: read-all` or `{}` at the top level and grant writes only on the job
that needs them.

`npm run security:policy` enforces these mechanically checkable rules without a
new parser dependency. Its Vitest suite contains intentional unpinned-Action,
unapproved-third-party, and `write-all` violations and proves all are rejected.
`task generate:check` regenerates GraphQL sources and fails on drift.

## Current inventory and classification

| Surface                                                          | Classification                     | Decision                                                                                                                                   |
| ---------------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| React, React DOM                                                 | widely trusted third-party         | Keep; core UI runtime.                                                                                                                     |
| Vite and `@vitejs/plugin-react`                                  | widely trusted build tooling       | Keep as development dependencies.                                                                                                          |
| Marked, Mermaid, Shiki                                           | widely trusted third-party         | Keep; they provide non-trivial Markdown, diagram, and syntax rendering. Rendered content remains within Vivi's viewer security boundaries. |
| Storybook packages                                               | widely trusted development tooling | Keep; component verification and accessibility workflow.                                                                                   |
| TypeScript, ESLint, typescript-eslint, Prettier, Vitest, tsx     | widely trusted development tooling | Keep; compiler, lint, formatting, test, and TS execution control system.                                                                   |
| gqlgen and gqlparser                                             | widely trusted Go third-party      | Keep; GraphQL transport/code generation is substantial and generated output is drift-checked.                                              |
| Go indirect modules                                              | transitive third-party             | Keep only while selected by gqlgen/runtime; review through `go mod why`, Dependabot, and govulncheck.                                      |
| `actions/*`, `github/codeql-action`                              | GitHub first-party                 | Keep, pinned to commit SHAs.                                                                                                               |
| `softprops/action-gh-release`, `peter-evans/create-pull-request` | replaceable third-party            | Removed; runner-provided `gh` and `git` cover these small release operations.                                                              |
| `arduino/setup-task`                                             | replaceable third-party            | Removed from CI; CI invokes the npm check contract directly. Task remains a local convenience.                                             |
| `actions/dependency-review-action`                               | GitHub-maintained first-party      | Keep, pinned; checks dependency changes on PRs.                                                                                            |
| `golang.org/x/vuln/cmd/govulncheck`                              | Go project first-party             | Run at an explicit version in scheduled/PR security CI.                                                                                    |
| `github.com/rhysd/actionlint`                                    | widely trusted third-party tooling | Keep as a version-pinned CI-only workflow linter; complements Vivi's stricter local policy checks.                                         |
| Docker packaging                                                 | unnecessary packaging path         | Removed; supported distribution is GitHub Releases consumed by Homebrew or mise.                                                           |

No direct runtime dependency was found to be unnecessary. Build-only Vite
packages were moved from runtime dependencies to development dependencies, and
all former npm `latest` selectors were replaced with the currently locked exact
versions.

## GitHub repository settings

Repository administrators should enable and periodically verify:

1. Dependency graph and Dependabot alerts.
2. Dependabot security updates. These are separate from the version-update
   schedules in `.github/dependabot.yml`; security PRs should not wait for the
   weekly schedule.
3. Private vulnerability reporting.
4. Secret scanning and push protection for contributors.
5. Code scanning with the committed CodeQL workflow.
6. Branch protection/rulesets on `main`: require CI, generated-code,
   dependency-review (for PRs), supply-chain security, and CodeQL checks; require
   review; dismiss stale approvals; block force-pushes and deletions.
7. Require approval for first-time external contributors' workflows and do not
   expose Actions secrets to fork pull requests.

Dependency review relies on the dependency graph being enabled. If a repository
plan does not support a feature, record that limitation rather than weakening
workflow permissions. Grouped weekly version updates cover npm, Go modules, and
GitHub Actions; security updates remain immediate and ungrouped by GitHub.

OpenSSF Scorecard is intentionally not installed yet: it would add another
third-party Action and token permissions. Reconsider it when the repository is
publicly released and its external posture score is useful. GitHub secret
scanning remains a repository setting because CI cannot inspect GitHub's full
secret corpus safely.

## CI and release integrity

The security workflow runs the local policy check, actionlint, `npm audit` at
high severity, and `govulncheck`. CodeQL analyzes Go and
JavaScript/TypeScript. Dependency review rejects newly introduced vulnerable
dependencies. GraphQL generation is performed from the version in `go.mod`, and
CI fails if committed generated files change.

`go.mod` declares the minimum language version and a patched Go toolchain. This
lets compatible Go installations select the security-fixed compiler and standard
library used by CI and release builds.

Release builds use locked npm and Go inputs, `go test`, `-trimpath`, SHA-256
checksums, and GitHub artifact attestations. The release job alone receives
`contents: write`, `id-token: write`, and `attestations: write`. The Homebrew App
token is scoped to the tap repository and is used only for the formula branch and
PR. Never grant that App access to the Vivi repository or unrelated repositories.

Verify a release with GitHub CLI and the checksum file:

```bash
gh attestation verify vivi_Linux_x86_64.tar.gz --repo tasuku43/vivi
sha256sum --check checksums.txt
```

Bit-for-bit archive reproducibility is not yet guaranteed because archive
timestamps are not fully normalized. Checksums and signed GitHub attestations
bind published artifacts to the workflow that produced them.
