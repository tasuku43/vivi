# Security policy

## Supported versions

Vivi is pre-1.0 software. Security fixes are provided for the latest release on
the `main` branch only. Older releases may be asked to upgrade before a fix is
backported.

## Security defaults

- Vivi binds to `127.0.0.1` by default. Binding to `0.0.0.0` exposes the local
  server to reachable machines and must be intentional.
- File APIs reject absolute paths, traversal, and symlinks that resolve outside
  the selected workspace.
- HTML scripts are disabled by default with iframe sandboxing and Content
  Security Policy. Use `--allow-html-scripts` only for trusted local artifacts.
- Vivi does not send file contents to an external service and does not include
  telemetry. File contents are not stored in `localStorage`.

Sensitive files inside the selected root can still be displayed. Choose the
smallest workspace root containing the files you intend to inspect.

## Distribution

The supported public install path uses GitHub Release binaries, directly or
through Homebrew/mise. Releases include SHA-256 checksums and GitHub artifact
attestations. npm remains a development path, which keeps normal use free of a
runtime npm dependency tree. Docker packaging is not supported.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Use GitHub's private
vulnerability reporting feature on the repository **Security** tab. If that
feature is unavailable, contact the repository owner privately through the
contact method on their GitHub profile and ask for a secure reporting channel.

Include affected versions, impact, reproduction steps, and any suggested
mitigation. Do not include real secrets or data belonging to another person.

## Response expectations

The maintainer aims to acknowledge a complete report within 3 business days,
provide an initial assessment within 7 business days, and coordinate a fix and
disclosure timeline based on severity. These are targets rather than a service
level agreement. Reporters are asked to keep details private until a fix is
available or a mutually agreed disclosure date is reached.

## Scope

Relevant reports include path traversal, unsafe HTML execution, local server
exposure, dependency or release compromise, token/secret exposure, and bypasses
of read-only workspace boundaries. General support and non-security bugs belong
in the public issue tracker.
