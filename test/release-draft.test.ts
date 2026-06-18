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
  expect(workflow).not.toContain("docker/build-push-action");
  expect(workflow).not.toMatch(
    /npm publish|NODE_AUTH_TOKEN|container registry/i,
  );
});

it("documents Docker only as a development or verification path", () => {
  const readme = readFileSync("README.md", "utf8");
  const dockerSection = section(readme, "## Docker", "## Repository Layout");

  expect(dockerSection).toContain("not a general install option");
  expect(dockerSection).toContain("development or verification");
  expect(dockerSection).toMatch(/bind\s+mounts/);
  expect(section(readme, "## Install", "## Usage")).not.toMatch(/docker/i);
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
