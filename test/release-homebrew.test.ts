import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";

it("renders the Homebrew tap formula from release checksums", () => {
  const tapDir = mkdtempSync(path.join(tmpdir(), "vivi-homebrew-"));
  const checksumsPath = path.join(tapDir, "checksums.txt");
  const checksums = [
    "a".repeat(64) + "  vivi_Darwin_arm64.tar.gz",
    "b".repeat(64) + "  vivi_Darwin_x86_64.tar.gz",
    "c".repeat(64) + "  vivi_Linux_arm64.tar.gz",
    "d".repeat(64) + "  vivi_Linux_x86_64.tar.gz",
  ].join("\n");

  execFileSync("node", [
    "-e",
    `require('node:fs').writeFileSync(${JSON.stringify(checksumsPath)}, ${JSON.stringify(checksums)})`,
  ]);
  execFileSync(
    "bash",
    [
      path.resolve(".github/scripts/update-homebrew-formula.sh"),
      "v1.2.3",
      checksumsPath,
    ],
    { cwd: tapDir },
  );

  const formula = readFileSync(path.join(tapDir, "Formula/vivi.rb"), "utf8");

  expect(formula).toContain("class Vivi < Formula");
  expect(formula).toContain('homepage "https://github.com/tasuku43/vivi"');
  expect(formula).toContain('license "MIT"');
  expect(formula).toContain('version "1.2.3"');
  expect(formula).toContain(
    "https://github.com/tasuku43/vivi/releases/download/v1.2.3/vivi_Darwin_arm64.tar.gz",
  );
  expect(formula).toContain(`sha256 "${"a".repeat(64)}"`);
  expect(formula).toContain(`sha256 "${"b".repeat(64)}"`);
  expect(formula).toContain(`sha256 "${"c".repeat(64)}"`);
  expect(formula).toContain(`sha256 "${"d".repeat(64)}"`);
  expect(formula).toContain('bin.install "vivi"');
  expect(formula).toContain("vivi --version");
});
