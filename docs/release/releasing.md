# Releasing Vivi

Vivi binaries are distributed through GitHub Releases. Stable releases also
open a Homebrew formula update PR against `tasuku43/homebrew-tap`.

## Release pipeline

- Trigger: push tag `vX.Y.Z`
- Manual dry run: workflow dispatch with `release_tag` set to `vX.Y.Z`
- Workflow: `.github/workflows/release.yml`
- Artifacts:
  - `vivi_Darwin_arm64.tar.gz`
  - `vivi_Darwin_x86_64.tar.gz`
  - `vivi_Linux_arm64.tar.gz`
  - `vivi_Linux_x86_64.tar.gz`
  - `checksums.txt`
- Homebrew:
  - stable tag pushes create a PR in `tasuku43/homebrew-tap`
  - requires GitHub Actions secrets `HOMEBREW_APP_ID` and `HOMEBREW_APP_KEY`
  - the GitHub App needs access to the tap repository and permission to create
    pull requests

## Operator checklist

1. Confirm CI is green on `main`.
2. Create a tag locally, for example `git tag v0.1.0`.
3. Push the tag with `git push origin v0.1.0`.
4. Confirm the `Release` workflow succeeds.
5. Confirm the published GitHub Release contains the four platform archives and
   `checksums.txt`, and that asset URLs use `/download/vX.Y.Z/`.
6. Download one archive and run `vivi --version`.
7. Verify its provenance with
   `gh attestation verify <archive> --repo tasuku43/vivi` and verify all files
   with `sha256sum --check checksums.txt` from the download directory.
8. Confirm a PR was created in `tasuku43/homebrew-tap` updating
   `Formula/vivi.rb`.

The workflow pins every Action to a commit SHA, grants write permissions only to
the checksums/release job, and uses a GitHub App token scoped only to the Homebrew
tap. See `docs/engineering/21-supply-chain-security.md` for the dependency and release
integrity policy.
