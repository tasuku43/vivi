import { spawn } from "node:child_process";
import path from "node:path";

const cwd = process.cwd();
const command = process.platform === "win32" ? "go.exe" : "go";
const packages = process.argv.slice(2);
const child = spawn(
  command,
  ["test", ...(packages.length ? packages : ["./..."])],
  {
    cwd,
    env: {
      ...process.env,
      GOCACHE: process.env.GOCACHE ?? path.join(cwd, ".tmp-go-build-cache"),
      GOMODCACHE: process.env.GOMODCACHE ?? path.join(cwd, ".tmp-go-mod-cache"),
    },
    stdio: "inherit",
  },
);

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`go test exited with signal ${signal}`);
    process.exit(1);
  }
  process.exit(code ?? 0);
});
