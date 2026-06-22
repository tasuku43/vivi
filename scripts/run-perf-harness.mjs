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

import { readOtelSpans, summarizeOperationSpans } from "./perf-otel-summary.mjs";

const cwd = process.cwd();
const artifactsDir = path.join(cwd, "artifacts", "perf");
const defaultWorkspace = path.join(artifactsDir, "synthetic-workspace");
const workspaceRoot = process.env.VIVI_PERF_WORKSPACE
  ? path.resolve(process.env.VIVI_PERF_WORKSPACE)
  : defaultWorkspace;
const binary = path.join(cwd, process.platform === "win32" ? "vivi-otel.exe" : "vivi-otel");
const otelFile = path.join(artifactsDir, "otel.jsonl");
const summaryFile = path.join(artifactsDir, "summary.json");
const runName = process.env.VIVI_PERF_RUN_NAME ?? new Date().toISOString().replace(/[:.]/g, "-");

mkdirSync(artifactsDir, { recursive: true });
ensureBinary();
const workspace = prepareWorkspace(workspaceRoot);

const startedAt = new Date();
const scenarios = [];
const baselineError = [];

try {
  scenarios.push(await runScenario("idle_watch", async () => {
    const idleMs = numberEnv("VIVI_PERF_IDLE_MS", 3500);
    await delay(idleMs);
    return { idleMs };
  }));

  scenarios.push(await runScenario("git_review", async ({ baseURL }) => {
    const started = Date.now();
    const response = await graphql(baseURL, `query PerfReviewQueue {
      reviewQueue {
        available
        reason
        changes { path status kind }
      }
    }`, {});
    const reviewQueue = response.reviewQueue;
    return {
      durationMs: Date.now() - started,
      available: reviewQueue.available,
      reason: reviewQueue.reason ?? null,
      resultCount: reviewQueue.changes.length,
      countsByStatus: countBy(reviewQueue.changes, "status"),
      countsByKind: countBy(reviewQueue.changes, "kind"),
    };
  }));

  scenarios.push(await runScenario("file_search", async ({ baseURL }) => {
    const queries = ["sched", "mm", "kconfig"];
    const results = [];
    for (const query of queries) {
      const response = await graphql(baseURL, `query PerfFileSearch($query: String!, $limit: Int) {
        fileSearch(query: $query, limit: $limit) {
          results { path }
          stats { durationMs scannedDirectories scannedFiles readFiles skippedFiles cached }
        }
      }`, { query, limit: 25 });
      results.push({
        query,
        resultCount: response.fileSearch.results.length,
        stats: response.fileSearch.stats,
      });
    }
    return { queries: results, aggregate: aggregateSearchStats(results) };
  }));

  scenarios.push(await runScenario("content_search", async ({ baseURL }) => {
    const queries = ["EXPORT_SYMBOL_GPL", "spin_lock", "CONFIG_SCHED"];
    const results = [];
    for (const query of queries) {
      const response = await graphql(baseURL, `query PerfTextSearch($query: String!, $limit: Int) {
        textSearch(query: $query, limit: $limit) {
          results { path lineNumber }
          stats { durationMs scannedDirectories scannedFiles readFiles skippedFiles cached }
        }
      }`, { query, limit: 20 });
      results.push({
        query,
        resultCount: response.textSearch.results.length,
        stats: response.textSearch.stats,
      });
    }
    return { queries: results, aggregate: aggregateSearchStats(results) };
  }));

  scenarios.push(await runScenario("file_change", async ({ baseURL }) => {
    const probe = path.join(workspaceRoot, `vivi-perf-watch-${process.pid}-${Date.now()}.md`);
    const relativeProbe = path.basename(probe);
    try {
      const observed = await waitForWorkspaceEvent(baseURL, relativeProbe, async () => {
        writeFileSync(probe, "# Vivi perf watch probe\n", "utf8");
      });
      await delay(numberEnv("VIVI_PERF_POST_CHANGE_MS", 1200));
      return observed;
    } finally {
      rmSync(probe, { force: true });
    }
  }));
} catch (error) {
  baselineError.push(error instanceof Error ? error.message : String(error));
}

const finishedAt = new Date();
const summary = {
  schemaVersion: 2,
  runName,
  startedAt: startedAt.toISOString(),
  finishedAt: finishedAt.toISOString(),
  durationMs: finishedAt.getTime() - startedAt.getTime(),
  binary: path.basename(binary),
  workspace,
  scenarios,
  artifacts: {
    otelJsonl: path.relative(cwd, otelFile),
    summaryJson: path.relative(cwd, summaryFile),
    namedSummaryJson: path.relative(cwd, namedSummaryFile(runName)),
  },
  errors: baselineError,
};

writeJSON(summaryFile, summary);
writeJSON(namedSummaryFile(runName), summary);
console.log(`perf summary written to ${path.relative(cwd, summaryFile)}`);
console.log(`named perf summary written to ${path.relative(cwd, namedSummaryFile(runName))}`);

if (baselineError.length > 0) {
  process.exitCode = 1;
}

async function runScenario(name, run) {
  const started = new Date();
  resetOtelFile();
  const child = startServer();
  let stdout = "";
  let stderr = "";
  const urlPromise = waitForServerURL(child, (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  let result = null;
  let error = null;
  try {
    const baseURL = await urlPromise;
    result = await run({ baseURL });
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  } finally {
    stopServer(child);
    await waitForExit(child).catch(() => {});
    await delay(1200);
  }

  const finished = new Date();
  const spans = readOtelSpans(otelFile);
  const telemetry = summarizeOperationSpans(spans, finished.getTime() - started.getTime());
  return {
    name,
    startedAt: started.toISOString(),
    finishedAt: finished.toISOString(),
    durationMs: finished.getTime() - started.getTime(),
    result,
    telemetry,
    process: {
      exitCode: child.exitCode,
      telemetryWarning: stderr.includes("OpenTelemetry enabled, but collector"),
    },
    stdout,
    stderr: stderr.trim(),
    error,
  };
}

function startServer() {
  return spawn(binary, [workspaceRoot, "--host", "127.0.0.1", "--port", "0", "--git-review-timeout", "3s"], {
    cwd,
    env: {
      ...process.env,
      VIVI_OTEL_EXPORTER_OTLP_ENDPOINT:
        process.env.VIVI_OTEL_EXPORTER_OTLP_ENDPOINT ?? "127.0.0.1:24317",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function waitForServerURL(child, onStdout) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("timed out waiting for Vivi URL")), 20_000);
    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      onStdout(text);
      const match = text.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) {
        clearTimeout(timeout);
        resolve(match[0]);
      }
    });
    child.once("exit", () => {
      clearTimeout(timeout);
      reject(new Error("Vivi exited before printing a URL"));
    });
  });
}

async function waitForWorkspaceEvent(baseURL, expectedPath, action) {
  const controller = new AbortController();
  const response = await fetch(`${baseURL}/events`, { signal: controller.signal });
  if (!response.ok || !response.body) {
    throw new Error(`events stream failed with ${response.status}`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const started = Date.now();
  let connected = false;

  const readerLoop = (async () => {
    while (Date.now() - started < 7000) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      if (!connected && buffer.includes(": connected")) {
        connected = true;
        await action();
      }
      const chunks = buffer.split(/\n\n/);
      buffer = chunks.pop() ?? "";
      for (const chunk of chunks) {
        const data = chunk.split(/\r?\n/).find((line) => line.startsWith("data: "));
        if (!data) continue;
        const event = JSON.parse(data.slice("data: ".length));
        if (event.path === expectedPath) {
          controller.abort();
          return {
            path: expectedPath,
            eventType: event.type,
            eventVersion: event.version,
            latencyMs: Date.now() - started,
          };
        }
      }
    }
    throw new Error(`timed out waiting for workspace event for ${expectedPath}`);
  })();

  try {
    return await readerLoop;
  } finally {
    controller.abort();
    await reader.cancel().catch(() => {});
  }
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
    const dirs = numberEnv("VIVI_PERF_DIRS", 24);
    const filesPerDir = numberEnv("VIVI_PERF_FILES_PER_DIR", 40);
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
    writeFileSync(path.join(root, "pending-review.md"), "# Pending review\nneedle pending\n", "utf8");
  }

  const git = initializeGit(root, provided);
  const counts = countWorkspace(root);
  return {
    root: path.relative(cwd, root) || ".",
    absoluteRoot: root,
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

function stopServer(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGINT");
}

function waitForExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => child.once("exit", resolve));
}

function aggregateSearchStats(items) {
  return items.reduce(
    (aggregate, item) => {
      aggregate.resultCount += item.resultCount;
      aggregate.durationMs += item.stats.durationMs;
      aggregate.scannedDirectories += item.stats.scannedDirectories;
      aggregate.scannedFiles += item.stats.scannedFiles;
      aggregate.readFiles += item.stats.readFiles;
      aggregate.skippedFiles += item.stats.skippedFiles;
      if (item.stats.cached) aggregate.cachedQueries++;
      return aggregate;
    },
    { resultCount: 0, durationMs: 0, scannedDirectories: 0, scannedFiles: 0, readFiles: 0, skippedFiles: 0, cachedQueries: 0 },
  );
}

function countBy(items, key) {
  const counts = {};
  for (const item of items) {
    const value = item[key] || "unknown";
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
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

function resetOtelFile() {
  writeFileSync(otelFile, "", "utf8");
}

function namedSummaryFile(name) {
  return path.join(artifactsDir, `${name}.summary.json`);
}

function writeJSON(file, value) {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function numberEnv(name, fallback) {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
