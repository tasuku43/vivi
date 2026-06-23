import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const storybookUrl = "http://127.0.0.1:6006";
const repoRoot = fileURLToPath(new URL("../", import.meta.url));

if (isDirectRun()) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

async function main() {
  const testRunner = assertStorybookTestRunnerInstalled(repoRoot);
  const server = spawn(
    "npm",
    ["--prefix", "ui", "run", "storybook", "--", "--ci", "--host", "127.0.0.1"],
    {
      cwd: repoRoot,
      env: { ...process.env, BROWSER: "none" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  let serverOutput = "";
  server.stdout.on("data", (chunk) => {
    serverOutput += chunk.toString();
  });
  server.stderr.on("data", (chunk) => {
    serverOutput += chunk.toString();
  });

  try {
    await waitForUrl(storybookUrl, 60_000, server, () => serverOutput);
    await run(
      testRunner,
      [
        "--config-dir",
        "ui/.storybook",
        "--url",
        storybookUrl,
        "--includeTags",
        "interaction",
        "--maxWorkers",
        "2",
        "--testTimeout",
        "20000",
        "--disable-telemetry",
      ],
      { cwd: repoRoot },
    );
  } finally {
    server.kill("SIGTERM");
  }
}

export function assertStorybookTestRunnerInstalled(cwd = repoRoot) {
  const testRunner = findStorybookTestRunner(cwd);
  if (testRunner !== null) return testRunner;

  const binName = storybookTestRunnerBinName();
  throw new Error(
    [
      `Storybook interaction test runner is not installed at node_modules/.bin/${binName}.`,
      `Run npm install or npm ci from ${normalizeCwd(cwd)} to install @storybook/test-runner, then retry task storybook:test.`,
    ].join("\n"),
  );
}

export function findStorybookTestRunner(cwd = repoRoot) {
  const candidate = path.join(
    normalizeCwd(cwd),
    "node_modules",
    ".bin",
    storybookTestRunnerBinName(),
  );
  return existsSync(candidate) ? candidate : null;
}

function storybookTestRunnerBinName() {
  return process.platform === "win32" ? "test-storybook.cmd" : "test-storybook";
}

function normalizeCwd(cwd) {
  return cwd instanceof URL ? fileURLToPath(cwd) : cwd;
}

function isDirectRun() {
  return (
    process.argv[1] !== undefined &&
    import.meta.url === pathToFileURL(process.argv[1]).href
  );
}

async function waitForUrl(url, timeoutMs, server, readServerOutput) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(
        `Storybook exited before becoming ready.\n${readServerOutput()}`,
      );
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Keep waiting until the dev server is reachable.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    `Timed out waiting for Storybook at ${url}\n${readServerOutput()}`,
  );
}

async function run(command, args, options) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      ...options,
      stdio: "inherit",
    });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else
        reject(new Error(`${command} ${args.join(" ")} exited with ${code}`));
    });
    child.on("error", reject);
  });
}
