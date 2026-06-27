#!/usr/bin/env node
import { existsSync } from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const localBinary = path.join(
  root,
  process.platform === "win32" ? "vivi.exe" : "vivi",
);
const useLocalBinary =
  process.env.VIVI_GO_CLI_FORCE_GO_RUN !== "1" && existsSync(localBinary);

const command = useLocalBinary
  ? localBinary
  : process.platform === "win32"
    ? "go.exe"
    : "go";
const args = useLocalBinary
  ? process.argv.slice(2)
  : ["run", "./cli", ...process.argv.slice(2)];

if (!useLocalBinary) {
  const prepare = spawnSync(
    process.execPath,
    ["scripts/prepare-go-workspace.mjs"],
    {
      cwd: root,
      stdio: "inherit",
    },
  );
  if (prepare.status !== 0) {
    process.exit(prepare.status ?? 1);
  }
}

const child = spawn(command, args, {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    GOCACHE: process.env.GOCACHE ?? path.join(root, ".tmp-go-build-cache"),
    GOMODCACHE: process.env.GOMODCACHE ?? path.join(root, ".tmp-go-mod-cache"),
  },
});

child.on("error", (error) => {
  if (error.code === "ENOENT") {
    console.error(
      "vivi: the npm bin delegates to the canonical Go CLI, but Go is not available. Install Go or use a prebuilt Vivi release binary.",
    );
    process.exit(127);
  }
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
