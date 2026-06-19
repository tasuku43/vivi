import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("uses Vivi as the public package and CLI surface without a legacy alias", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
    name: string;
    private: boolean;
    bin: Record<string, string>;
  };

  expect(pkg.name).toBe("vivi");
  expect(pkg.private).toBe(true);
  expect(Object.keys(pkg.bin)).toEqual(["vivi"]);
});

it("keeps the public README on the Vivi binary distribution path", () => {
  const readme = readFileSync("README.md", "utf8");
  const installSection = section(readme, "## Install", "## Usage");
  const oldLowerName = ["path", "lens"].join("");
  const oldTitleName = ["Path", "lens"].join("");

  expect(readme).toMatch(/^# Vivi/m);
  expect(readme).not.toMatch(
    new RegExp(`\\b${oldTitleName}\\b|\\b${oldLowerName}\\b`),
  );
  expect(installSection).toContain("brew tap tasuku43/tap");
  expect(installSection).toContain("brew install vivi");
  expect(installSection).toContain("mise");
  expect(installSection).toContain("GitHub Releases");
  expect(installSection).not.toMatch(/\bnpx\b|npm install|docker run/i);
});

it("publishes Go binary release artifacts without npm or Docker publishing", () => {
  const workflow = readFileSync(".github/workflows/release.yml", "utf8");

  expect(workflow).toContain("vivi_Darwin_arm64.tar.gz");
  expect(workflow).toContain("vivi_Linux_x86_64.tar.gz");
  expect(workflow).toContain("checksums.txt");
  expect(workflow).toContain("draft: false");
  expect(workflow).not.toContain("docker/build-push-action");
  expect(workflow).not.toMatch(/npm publish|NODE_AUTH_TOKEN|npm provenance/i);
});

it("keeps Homebrew and mise install paths on the vivi command", () => {
  const formula = readFileSync("docs/release/homebrew/vivi.rb", "utf8");
  const install = readFileSync("docs/install.md", "utf8");
  const oldLowerName = ["path", "lens"].join("");

  expect(formula).toContain("class Vivi < Formula");
  expect(formula).toContain("vivi --version");
  expect(install).toContain("brew tap tasuku43/tap");
  expect(install).toContain("brew install vivi");
  expect(install).toContain("vivi .");
  expect(install).not.toMatch(
    new RegExp(`\\b${oldLowerName}\\b|npm install|npx`, "i"),
  );
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
