import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const cwd = process.cwd();
const artifactsDir = path.join(cwd, "artifacts", "perf");
const defaultWorkspace = path.join(artifactsDir, "synthetic-workspace");
const workspaceRoot = process.env.VIVI_PERF_WORKSPACE
  ? path.resolve(process.env.VIVI_PERF_WORKSPACE)
  : defaultWorkspace;
const binary = path.join(cwd, process.platform === "win32" ? "vivi-otel.exe" : "vivi-otel");
const otelFile = path.join(artifactsDir, "otel.jsonl");
const summaryFile = path.join(artifactsDir, "summary.json");

mkdirSync(artifactsDir, { recursive: true });
ensureBinary();
const workspace = prepareWorkspace(workspaceRoot);

const startedAt = new Date();
const child = spawn(binary, [workspaceRoot, "--host", "127.0.0.1", "--port", "0", "--git-review-timeout", "1s"], {
  cwd,
  env: {
    ...process.env,
    VIVI_OTEL_EXPORTER_OTLP_ENDPOINT:
      process.env.VIVI_OTEL_EXPORTER_OTLP_ENDPOINT ?? "localhost:4317",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let stdout = "";
let stderr = "";
const urlPromise = new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error("timed out waiting for Vivi URL")), 10_000);
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
    const match = stdout.match(/http:\/\/127\.0\.0\.1:\d+/);
    if (match) {
      clearTimeout(timeout);
      resolve(match[0]);
    }
  });
});
child.stderr.on("data", (chunk) => {
  stderr += chunk.toString();
});

let summary;
try {
  const baseURL = await urlPromise;
  const operations = {};

  operations.fileSearch = await graphql(baseURL, `query PerfFileSearch($query: String!, $limit: Int) {
    fileSearch(query: $query, limit: $limit) {
      results { path }
      stats { durationMs scannedDirectories scannedFiles readFiles skippedFiles }
    }
  }`, { query: "file-00", limit: 25 });

  operations.textSearch = await graphql(baseURL, `query PerfTextSearch($query: String!, $limit: Int) {
    textSearch(query: $query, limit: $limit) {
      results { path lineNumber }
      stats { durationMs scannedDirectories scannedFiles readFiles skippedFiles }
    }
  }`, { query: "needle", limit: 40 });

  operations.reviewQueue = await graphql(baseURL, `query PerfReviewQueue {
    reviewQueue {
      available
      reason
      changes { path status kind }
    }
  }`, {});

  const syntheticProbe = path.join(workspaceRoot, "dir-000", "file-000.md");
  if (existsSync(syntheticProbe)) {
    writeFileSync(syntheticProbe, "# file 000\nneedle changed\n", "utf8");
  }
  writeFileSync(path.join(workspaceRoot, "watch-created.md"), "# Watch\nneedle new\n", "utf8");
  await delay(1_500);

  stopServer(child);
  await waitForExit(child);
  await delay(1_000);

  summary = buildSummary({
    startedAt,
    workspace,
    operations,
    stdout,
    stderr,
    exitCode: child.exitCode,
  });
} catch (error) {
  stopServer(child);
  await waitForExit(child).catch(() => {});
  summary = buildSummary({
    startedAt,
    workspace,
    operations: {},
    stdout,
    stderr,
    exitCode: child.exitCode,
    error: error instanceof Error ? error.message : String(error),
  });
  writeFileSync(summaryFile, `${JSON.stringify(summary, null, 2)}\n`);
  throw error;
}

writeFileSync(summaryFile, `${JSON.stringify(summary, null, 2)}\n`);
console.log(`perf summary written to ${path.relative(cwd, summaryFile)}`);

function ensureBinary() {
  if (existsSync(binary)) return;
  const result = spawnSync("npm", ["run", "build:go:otel"], {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function prepareWorkspace(root) {
  const provided = Boolean(process.env.VIVI_PERF_WORKSPACE);
  if (!provided) {
    rmSync(root, { recursive: true, force: true });
    const dirs = Number.parseInt(process.env.VIVI_PERF_DIRS ?? "24", 10);
    const filesPerDir = Number.parseInt(process.env.VIVI_PERF_FILES_PER_DIR ?? "40", 10);
    for (let dirIndex = 0; dirIndex < dirs; dirIndex++) {
      const dirName = `dir-${String(dirIndex).padStart(3, "0")}`;
      const dir = path.join(root, dirName);
      mkdirSync(dir, { recursive: true });
      for (let fileIndex = 0; fileIndex < filesPerDir; fileIndex++) {
        const fileName = `file-${String(fileIndex).padStart(3, "0")}.md`;
        const marker = fileIndex % 7 === 0 ? "needle" : "haystack";
        writeFileSync(
          path.join(dir, fileName),
          `# ${dirName}/${fileName}\n${marker} ${dirIndex} ${fileIndex}\n`,
          "utf8",
        );
      }
    }
  }

  const git = initializeGit(root, provided);
  writeFileSync(path.join(root, "pending-review.md"), "# Pending review\nneedle pending\n", "utf8");
  const counts = countWorkspace(root);
  return {
    root: path.relative(cwd, root) || ".",
    provided,
    synthetic: !provided,
    directories: counts.directories,
    files: counts.files,
    git,
  };
}

function initializeGit(root, provided) {
  if (spawnSync("git", ["--version"], { stdio: "ignore" }).status !== 0) {
    return { initialized: false, reason: "git unavailable" };
  }
  if (provided && !existsSync(path.join(root, ".git"))) {
    return { initialized: false, reason: "provided workspace is not a git repository" };
  }
  if (!existsSync(path.join(root, ".git"))) {
    spawnSync("git", ["init"], { cwd: root, stdio: "ignore" });
    spawnSync("git", ["config", "user.email", "vivi-perf@example.invalid"], { cwd: root, stdio: "ignore" });
    spawnSync("git", ["config", "user.name", "Vivi Perf"], { cwd: root, stdio: "ignore" });
    spawnSync("git", ["add", "."], { cwd: root, stdio: "ignore" });
    spawnSync("git", ["commit", "-m", "baseline"], { cwd: root, stdio: "ignore" });
  }
  return { initialized: existsSync(path.join(root, ".git")) };
}

async function graphql(baseURL, query, variables) {
  const response = await fetch(`${baseURL}/graphql`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const body = await response.json();
  if (!response.ok || body.errors) {
    throw new Error(JSON.stringify(body.errors ?? body));
  }
  return body.data;
}

function stopServer(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGINT");
}

function waitForExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => child.once("exit", resolve));
}

function buildSummary({ startedAt, workspace, operations, stdout, stderr, exitCode, error }) {
  const finishedAt = new Date();
  const textSearch = operations.textSearch?.textSearch;
  const fileSearch = operations.fileSearch?.fileSearch;
  const reviewQueue = operations.reviewQueue?.reviewQueue;
  return {
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    binary: path.basename(binary),
    workspace,
    operations: {
      fileSearch: summarizeSearch(fileSearch),
      contentSearch: summarizeSearch(textSearch),
      gitReviewStatusRefresh: reviewQueue
        ? {
            available: reviewQueue.available,
            resultCount: reviewQueue.changes.length,
            reason: reviewQueue.reason ?? null,
          }
        : null,
      watchLoop: {
        triggeredMutations: 2,
        waitMs: 1500,
      },
    },
    artifacts: {
      otelJsonl: path.relative(cwd, otelFile),
      summaryJson: path.relative(cwd, summaryFile),
      otelJsonlRecords: countJSONLLines(otelFile),
    },
    process: {
      exitCode,
      telemetryWarning: stderr.includes("OpenTelemetry enabled, but collector"),
    },
    error: error ?? null,
  };
}

function summarizeSearch(response) {
  if (!response) return null;
  return {
    resultCount: response.results.length,
    stats: response.stats,
  };
}

function countJSONLLines(file) {
  if (!existsSync(file)) return 0;
  return readFileSync(file, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "").length;
}

function countWorkspace(root) {
  const counts = { directories: 0, files: 0 };
  visit(root);
  return counts;

  function visit(dir) {
    counts.directories++;
    for (const entry of readdirSafe(dir)) {
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(full);
      } else if (entry.isFile()) {
        counts.files++;
      }
    }
  }
}

function readdirSafe(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}
