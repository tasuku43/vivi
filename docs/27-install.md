# Install Vivi

Vivi is distributed as a prebuilt single binary. Normal users do not need
Node.js or npm at runtime.

## Homebrew

```bash
brew tap tasuku43/tap
brew install vivi
vivi .
```

## mise

Install the GitHub Release binary:

```bash
mise use -g github:tasuku43/vivi
vivi .
```

Pin a version:

```bash
mise use -g github:tasuku43/vivi@v0.1.0
vivi --version
```

Registry registration is not required for the first release. If a registry
entry is added later, keep it pointed at GitHub Releases prebuilt binaries.

## Direct Download

Download the archive for your platform from GitHub Releases, extract it, and
place the `vivi` binary on your `PATH`.

Expected archive names:

```text
vivi_Darwin_arm64.tar.gz
vivi_Darwin_x86_64.tar.gz
vivi_Linux_arm64.tar.gz
vivi_Linux_x86_64.tar.gz
```

Verify `checksums.txt` before running the binary.

## Local Development

Inside this repository, `npm exec -- vivi <args>` delegates to the same
canonical Go CLI used by the release binary:

```bash
npm exec -- vivi --help
npm exec -- vivi . --port 0 --ready-json --actor codex
npm exec -- vivi comments work --actor codex --loop --json
```

This npm path is for repository development and requires Go. npm is not a
distribution channel for Vivi releases. The explicit
`npm run dev:server:typescript` harness remains for TypeScript server contract
work only; it is not the public `vivi` CLI.
