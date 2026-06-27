import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const goCliHelpTimeoutMs = 30_000;

it("uses Vivi as the public package and CLI surface without a legacy alias", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
    name: string;
    private: boolean;
    bin: Record<string, string>;
  };

  expect(pkg.name).toBe("vivi");
  expect(pkg.private).toBe(true);
  expect(Object.keys(pkg.bin)).toEqual(["vivi"]);
  expect(pkg.bin.vivi).toBe("scripts/vivi-go-cli.mjs");
  expect(pkg.bin.vivi).not.toContain("typescript");
});

it(
  "routes the repository npm bin to the canonical Go CLI help surface",
  () => {
    const result = spawnSync(
      process.execPath,
      ["scripts/vivi-go-cli.mjs", "--help"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          GOCACHE:
            process.env.GOCACHE ?? `${process.cwd()}/.tmp-go-build-cache`,
          GOMODCACHE:
            process.env.GOMODCACHE ?? `${process.cwd()}/.tmp-go-mod-cache`,
          VIVI_GO_CLI_FORCE_GO_RUN: "1",
        },
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("vivi review <queue|bases|diff>");
    expect(result.stdout).toContain(
      "vivi comments <work|doctor|mine|check|triage|release|done|dismiss>",
    );
    expect(result.stdout).toContain(
      "vivi comments <protocol|schema|inbox|watch",
    );
    expect(result.stdout).toContain("Human:");
    expect(result.stdout).toContain("Agent:");
    expect(result.stdout).toContain(
      "vivi comments work --actor <actor> --loop --url <url> --json",
    );
    expect(result.stdout).toContain("Changed-file context:");
    expect(result.stdout).toContain("Debug/recovery:");
    expect(result.stdout).toContain("--ready-json");
    expect(result.stdout).not.toMatch(/^vivi \[root\].*Options:/s);
  },
  goCliHelpTimeoutMs,
);

it("keeps review and comments help reachable through the default bin", () => {
  for (const args of [
    ["review", "--help"],
    ["comments", "--help"],
    ["comments", "work", "--help"],
  ]) {
    const result = spawnSync(
      process.execPath,
      ["scripts/vivi-go-cli.mjs", ...args],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          GOCACHE:
            process.env.GOCACHE ?? `${process.cwd()}/.tmp-go-build-cache`,
          GOMODCACHE:
            process.env.GOMODCACHE ?? `${process.cwd()}/.tmp-go-mod-cache`,
          VIVI_GO_CLI_FORCE_GO_RUN: "1",
        },
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      args[0] === "review"
        ? "vivi review - agent-oriented Git review CLI"
        : args[1] === "work"
          ? "vivi comments work - compact resident feedback loop"
          : "vivi comments - agent-oriented comment thread CLI",
    );
  }
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

it("documents npm as a local Go CLI delegate, not a TypeScript CLI path", () => {
  const readme = readFileSync("README.md", "utf8");
  const install = readFileSync("docs/27-install.md", "utf8");
  const cliContract = readFileSync("docs/03-cli-or-api-contract.md", "utf8");

  for (const text of [readme, install]) {
    expect(text).toContain("canonical Go CLI");
    expect(text).toContain("comments work");
  }
  expect(cliContract).toContain("Go CLI/backend");
  expect(cliContract).toContain("comments work");
  expect(readme).toContain("npm exec -- vivi --help");
  expect(cliContract).toContain("comments watch");
  expect(cliContract).toContain("comments follow");
  expect(cliContract).not.toContain("dist/typescript/cli/typescript/main.js");
});

it("publishes Go binary release artifacts without npm or Docker publishing", () => {
  const workflow = readFileSync(".github/workflows/release.yml", "utf8");

  expect(workflow).toContain("vivi_Darwin_arm64.tar.gz");
  expect(workflow).toContain("vivi_Linux_x86_64.tar.gz");
  expect(workflow).toContain("checksums.txt");
  expect(workflow).toContain("gh release create");
  expect(workflow).not.toContain("docker/build-push-action");
  expect(workflow).not.toMatch(/npm publish|NODE_AUTH_TOKEN|npm provenance/i);
});

it("keeps Homebrew and mise install paths on the vivi command", () => {
  const formula = readFileSync("docs/release/homebrew/vivi.rb", "utf8");
  const install = readFileSync("docs/27-install.md", "utf8");
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
