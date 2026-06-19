# Install Vivi

Vivi is distributed as a prebuilt single binary. Normal users do not need
Node.js, npm, or Docker at runtime.

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

## Development-Only Docker Note

Docker is not a normal install route. It may be useful for development or
verification, but large repositories mounted into Docker on macOS can make Git
and broad file scans very slow. Use the native binary for ordinary local
workspace reading.
