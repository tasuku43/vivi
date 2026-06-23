import { spawn } from "node:child_process";

const storybookUrl = "http://127.0.0.1:6006";
const server = spawn(
  "npm",
  ["--prefix", "ui", "run", "storybook", "--", "--ci", "--host", "127.0.0.1"],
  {
    cwd: new URL("../", import.meta.url),
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
  await waitForUrl(storybookUrl, 60_000);
  await run(
    "npx",
    [
      "test-storybook",
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
    { cwd: new URL("../", import.meta.url) },
  );
} finally {
  server.kill("SIGTERM");
}

async function waitForUrl(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(
        `Storybook exited before becoming ready.\n${serverOutput}`,
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
  throw new Error(`Timed out waiting for Storybook at ${url}\n${serverOutput}`);
}

async function run(command, args, options) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      ...options,
      stdio: "inherit",
    });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited with ${code}`));
    });
    child.on("error", reject);
  });
}
