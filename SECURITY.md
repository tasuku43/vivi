# Security Policy

Vivi is a local, read-only visual workspace viewer. It reads the workspace you
select so a human can inspect files written by a coding agent, but it does not
intentionally modify those files.

## Defaults

- Vivi binds to `127.0.0.1` by default.
- Binding to `0.0.0.0` exposes the local server to other machines that can
  reach your network; only do this intentionally.
- File APIs reject absolute paths and `..` path traversal outside the selected
  workspace.
- Symlinks that resolve outside the selected workspace are rejected.
- HTML preview scripts are disabled by default with iframe sandboxing and
  Content Security Policy.
- `--allow-html-scripts` should only be used for trusted local artifacts.
- Vivi does not send file contents to an external service and does not include
  telemetry.
- File contents are not stored in `localStorage`; browser UI preferences and
  session state may be.

## What Vivi Can Still Show

If sensitive files such as `.env`, private keys, tokens, or credentials are
inside the selected workspace, Vivi can display them when you open those files.
The safest habit is to choose the smallest workspace root that contains the
files you intend to inspect.

## Distribution

The public install path uses prebuilt `vivi` binaries from GitHub Releases, plus
Homebrew and mise instructions that fetch those binaries. Release archives are
published with `checksums.txt`; verify the checksum before running a manually
downloaded binary. Artifact attestation is planned in the release workflow where
GitHub supports it.

npm and Docker are not general user install paths. This keeps normal use free
from a runtime Node.js/npm dependency tree and avoids Docker bind mount
performance problems on large local repositories.

## Reporting Vulnerabilities

Before the public repository rename, use the issue tracker in the current
repository for security reports that do not need confidentiality. If a private
reporting channel is needed, ask the maintainer for one before sharing exploit
details or sensitive workspace contents.
