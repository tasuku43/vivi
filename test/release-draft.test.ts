import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("builds release archives for the Vivi single binary", () => {
  const workflow = readFileSync(".github/workflows/release.yml", "utf8");

  expect(workflow).toContain("darwin-arm64");
  expect(workflow).toContain("darwin-amd64");
  expect(workflow).toContain("linux-arm64");
  expect(workflow).toContain("linux-amd64");
  expect(workflow).toContain("vivi_Darwin_arm64.tar.gz");
  expect(workflow).toContain("vivi_Linux_x86_64.tar.gz");
  expect(workflow).toContain("checksums.txt");
  expect(workflow).toContain("actions/create-github-app-token");
  expect(workflow).toContain("homebrew-vivi");
  expect(workflow).toContain(".github/scripts/update-homebrew-formula.sh");
  expect(workflow).toContain("actions/checkout@v7");
  expect(workflow).toContain("actions/setup-node@v6");
  expect(workflow).toContain("actions/setup-go@v6");
  expect(workflow).toContain("actions/upload-artifact@v7");
  expect(workflow).toContain("actions/download-artifact@v8");
  expect(workflow).not.toContain("docker/build-push-action");
  expect(workflow).not.toMatch(
    /npm publish|NODE_AUTH_TOKEN|container registry/i,
  );
});

it("keeps release build setup free of hosted-runner warnings", () => {
  const workflow = readFileSync(".github/workflows/release.yml", "utf8");

  expect(workflow).toContain("node-version: 24");
  expect(workflow).toContain("go-version-file: go.mod");
  expect(workflow).toContain("cache: false");
  expect(workflow).not.toContain("node-version: 20");
  expect(workflow).not.toMatch(
    /actions\/(?:checkout|setup-node|setup-go|upload-artifact|download-artifact)@v[45]/,
  );
  expect(workflow).not.toMatch(/cache:\s*true/);
});

it("keeps CI setup aligned with release runner defaults", () => {
  const workflow = readFileSync(".github/workflows/ci.yml", "utf8");

  expect(workflow).toContain("node-version: 24");
  expect(workflow).toContain("go-version-file: go.mod");
  expect(workflow).toContain("cache: false");
  expect(workflow).not.toContain("node-version: 20");
  expect(workflow).not.toMatch(
    /actions\/(?:checkout|setup-node|setup-go)@v[45]/,
  );
  expect(workflow).not.toMatch(/cache:\s*true/);
});

it("enables Dependabot for package and workflow maintenance", () => {
  const config = readFileSync(".github/dependabot.yml", "utf8");

  expect(config).toContain("version: 2");
  expect(config).toContain("package-ecosystem: npm");
  expect(config).toContain("package-ecosystem: github-actions");
  expect(config).toContain("directory: /");
  expect(config).toContain("interval: weekly");
});

it("keeps the Go CLI entrypoint visible to git", () => {
  const gitignore = readFileSync(".gitignore", "utf8");

  expect(gitignore).toContain("/vivi");
  expect(gitignore).not.toMatch(/^vivi$/m);
});

it("documents Docker only as a development or verification path", () => {
  const readme = readFileSync("README.md", "utf8");
  const dockerSection = section(readme, "## Docker", "## Repository Layout");

  expect(dockerSection).toContain("not a general install option");
  expect(dockerSection).toContain("development or verification");
  expect(dockerSection).toMatch(/bind\s+mounts/);
  expect(section(readme, "## Install", "## Usage")).not.toMatch(/docker/i);
});

it("documents the tag-triggered release and Homebrew tap workflow", () => {
  const releaseDocs = readFileSync("docs/release/releasing.md", "utf8");

  expect(releaseDocs).toContain("push tag `vX.Y.Z`");
  expect(releaseDocs).toContain("tasuku43/homebrew-vivi");
  expect(releaseDocs).toContain("HOMEBREW_APP_ID");
  expect(releaseDocs).toContain("HOMEBREW_APP_KEY");
  expect(releaseDocs).toContain("vivi_Darwin_arm64.tar.gz");
  expect(releaseDocs).toContain("checksums.txt");
});

function section(
  text: string,
  startHeading: string,
  endHeading: string,
): string {
  const start = text.indexOf(startHeading);
  const end = text.indexOf(endHeading, start + startHeading.length);
  if (start < 0 || end < 0) return "";
  return text.slice(start, end);
}
