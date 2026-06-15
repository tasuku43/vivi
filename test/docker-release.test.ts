import { readFileSync } from "node:fs";

import { expect, it } from "vitest";

it("publishes release images for amd64 and arm64", () => {
  const workflow = readFileSync(".github/workflows/release.yml", "utf8");

  expect(workflow).toContain("docker/setup-buildx-action@v3");
  expect(workflow).toContain("docker/build-push-action@v6");
  expect(workflow).toContain("platforms: linux/amd64,linux/arm64");
  expect(workflow).toContain("cache-from: type=gha");
  expect(workflow).toContain("cache-to: type=gha,mode=max");
});

it("documents a local buildx task with configurable platforms", () => {
  const taskfile = readFileSync("Taskfile.yml", "utf8");
  const readme = readFileSync("README.md", "utf8");

  expect(taskfile).toContain('PLATFORMS: \'{{.PLATFORMS | default "linux/amd64,linux/arm64"}}\'');
  expect(taskfile).toContain("docker buildx build --platform {{.PLATFORMS}}");
  expect(readme).toContain("task docker:buildx IMAGE=ghcr.io/tasuku43/pathlens TAG=dev");
  expect(readme).toContain("Release images are multi-architecture manifests");
});
