import { spawn, spawnSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

import { isTransientBrowserWorkspaceError } from "./perf-harness-browser.mjs";
import {
  aggregateProcessSummaries,
  summarizeProcessSamples,
  summarizeProcessSamplesSince,
} from "./perf-harness-metrics.mjs";
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
  scenarios.push(await runScenario("idle_watch", async ({ baseURL, serverSampler }) => {
    const idleMs = numberEnv("VIVI_PERF_IDLE_MS", 3500);
    const readyStarted = Date.now();
    await waitForEventsReady(baseURL);
    const readyMs = Date.now() - readyStarted;
    const steadySinceMs = Date.now();
    await delay(idleMs);
    return {
      idleMs,
      readyMs,
      steadyServer: serverSampler.summarySince("server_steady_idle", steadySinceMs),
    };
  }));

  scenarios.push(await runScenario("front_workspace", async ({ baseURL }) => {
    return runBrowserWorkspaceScenario(baseURL, workspace);
  }));

  scenarios.push(await runScenario("cli_review_queue", async ({ baseURL }) => {
    return runCliReviewQueueScenario(baseURL);
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

  scenarios.push(await runScenario("change_burst", async ({ baseURL }) => {
    const changeCount = numberEnv("VIVI_PERF_BURST_CHANGES", 30);
    const burstDirName = `.vivi-perf-burst-${process.pid}-${Date.now()}`;
    const burstDir = path.join(workspaceRoot, burstDirName);
    try {
      mkdirSync(burstDir, { recursive: true });
      const observed = await waitForWorkspaceEventsConcurrently(
        baseURL,
        new Set(Array.from({ length: changeCount }, (_, index) => `${burstDirName}/probe-${String(index).padStart(3, "0")}.md`)),
        async () => {
          for (let index = 0; index < changeCount; index++) {
            const file = path.join(burstDir, `probe-${String(index).padStart(3, "0")}.md`);
            writeFileSync(file, `# Burst ${index}\ninitial\n`, "utf8");
            if (index % 5 === 0) {
              appendFileSync(file, `update ${Date.now()}\n`, "utf8");
            }
            await delay(numberEnv("VIVI_PERF_BURST_DELAY_MS", 20));
          }
        },
      );
      await delay(numberEnv("VIVI_PERF_POST_BURST_MS", 1200));
      return observed;
    } finally {
      rmSync(burstDir, { recursive: true, force: true });
    }
  }));

  scenarios.push(await runScenario("coding_agent_storm", async ({ baseURL, serverSampler }) => {
    const operations = numberEnv("VIVI_PERF_AGENT_STORM_OPS", 300);
    const fileCount = numberEnv("VIVI_PERF_AGENT_STORM_FILES", 60);
    const delayMs = numberEnvAllowZero("VIVI_PERF_AGENT_STORM_DELAY_MS", 0);
    const stormDirName = `.vivi-perf-agent-storm-${process.pid}-${Date.now()}`;
    const stormDir = path.join(workspaceRoot, stormDirName);
    const expectedPaths = new Set(
      Array.from({ length: fileCount }, (_, index) => `${stormDirName}/agent-${String(index).padStart(3, "0")}.md`),
    );
    try {
      const observed = await waitForWorkspaceActivityConcurrently(
        baseURL,
        expectedPaths,
        async () => {
          mkdirSync(stormDir, { recursive: true });
          for (let index = 0; index < operations; index++) {
            const fileIndex = index % fileCount;
            const file = path.join(stormDir, `agent-${String(fileIndex).padStart(3, "0")}.md`);
            if (index % 37 === 0) {
              const tmp = `${file}.tmp-${index}`;
              writeFileSync(tmp, `# Agent file ${fileIndex}\noperation=${index}\natomic=true\n`, "utf8");
              renameSync(tmp, file);
            } else {
              writeFileSync(file, `# Agent file ${fileIndex}\noperation=${index}\n`, "utf8");
            }
            if (index % 11 === 0) {
              appendFileSync(file, `append=${Date.now()}\n`, "utf8");
            }
            if (delayMs > 0) {
              await delay(delayMs);
            }
          }
        },
        {
          quietMs: numberEnv("VIVI_PERF_AGENT_STORM_QUIET_MS", 750),
          timeoutMs: numberEnv("VIVI_PERF_AGENT_STORM_TIMEOUT_MS", 20_000),
        },
      );
      await delay(numberEnv("VIVI_PERF_POST_AGENT_STORM_MS", 1200));
      return {
        operations,
        fileCount,
        delayMs,
        ...observed,
        stormServer: observed.actionStartedAtMs
          ? serverSampler.summarySince("server_agent_storm", observed.actionStartedAtMs)
          : null,
      };
    } finally {
      rmSync(stormDir, { recursive: true, force: true });
    }
  }));
} catch (error) {
  baselineError.push(error instanceof Error ? error.message : String(error));
}

const finishedAt = new Date();
const summary = {
  schemaVersion: 3,
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
  const serverSampler = startProcessSampler(child.pid, "server");
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
    result = await run({ baseURL, child, serverSampler });
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  } finally {
    serverSampler.stop();
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
      server: serverSampler.summary(),
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

async function waitForWorkspaceEvents(baseURL, expectedPaths, action) {
  const controller = new AbortController();
  const response = await fetch(`${baseURL}/events`, { signal: controller.signal });
  if (!response.ok || !response.body) {
    throw new Error(`events stream failed with ${response.status}`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const observed = new Map();
  let buffer = "";
  const started = Date.now();
  let connected = false;
  let firstLatencyMs = null;
  const timeoutMs = numberEnv("VIVI_PERF_BURST_TIMEOUT_MS", 20_000);

  try {
    while (Date.now() - started < timeoutMs) {
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
        if (!expectedPaths.has(event.path) || observed.has(event.path)) continue;
        const latencyMs = Date.now() - started;
        firstLatencyMs ??= latencyMs;
        observed.set(event.path, {
          path: event.path,
          eventType: event.type,
          eventVersion: event.version,
          latencyMs,
        });
        if (observed.size >= expectedPaths.size) {
          return {
            expectedCount: expectedPaths.size,
            observedCount: observed.size,
            firstLatencyMs,
            lastLatencyMs: latencyMs,
            sampleEvents: Array.from(observed.values()).slice(0, 5),
          };
        }
      }
    }
    return {
      expectedCount: expectedPaths.size,
      observedCount: observed.size,
      firstLatencyMs,
      lastLatencyMs: observed.size ? Math.max(...Array.from(observed.values(), (event) => event.latencyMs)) : null,
      missingCount: expectedPaths.size - observed.size,
      sampleEvents: Array.from(observed.values()).slice(0, 5),
    };
  } finally {
    controller.abort();
    await reader.cancel().catch(() => {});
  }
}

async function waitForWorkspaceEventsConcurrently(baseURL, expectedPaths, action) {
  const controller = new AbortController();
  const response = await fetch(`${baseURL}/events`, { signal: controller.signal });
  if (!response.ok || !response.body) {
    throw new Error(`events stream failed with ${response.status}`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const observed = new Map();
  let buffer = "";
  const streamStarted = Date.now();
  let actionStarted = null;
  let actionFinished = null;
  let actionPromise = null;
  let firstLatencyMs = null;
  const timeoutMs = numberEnv("VIVI_PERF_BURST_TIMEOUT_MS", 20_000);

  try {
    while (Date.now() - streamStarted < timeoutMs) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      if (actionPromise === null && buffer.includes(": connected")) {
        actionStarted = Date.now();
        actionPromise = Promise.resolve()
          .then(action)
          .finally(() => {
            actionFinished = Date.now();
          });
      }
      const chunks = buffer.split(/\n\n/);
      buffer = chunks.pop() ?? "";
      for (const chunk of chunks) {
        const data = chunk.split(/\r?\n/).find((line) => line.startsWith("data: "));
        if (!data) continue;
        const event = JSON.parse(data.slice("data: ".length));
        if (!expectedPaths.has(event.path) || observed.has(event.path)) continue;
        const eventAt = Date.now();
        const latencyMs = eventAt - (actionStarted ?? streamStarted);
        firstLatencyMs ??= latencyMs;
        observed.set(event.path, {
          path: event.path,
          eventType: event.type,
          eventVersion: event.version,
          latencyMs,
        });
        if (observed.size >= expectedPaths.size) {
          await actionPromise?.catch((error) => {
            throw error;
          });
          return {
            expectedCount: expectedPaths.size,
            observedCount: observed.size,
            firstLatencyMs,
            lastLatencyMs: latencyMs,
            actionDurationMs: actionFinished && actionStarted ? actionFinished - actionStarted : null,
            sampleEvents: Array.from(observed.values()).slice(0, 5),
          };
        }
      }
    }
    await actionPromise?.catch((error) => {
      throw error;
    });
    return {
      expectedCount: expectedPaths.size,
      observedCount: observed.size,
      firstLatencyMs,
      lastLatencyMs: observed.size ? Math.max(...Array.from(observed.values(), (event) => event.latencyMs)) : null,
      actionDurationMs: actionFinished && actionStarted ? actionFinished - actionStarted : null,
      missingCount: expectedPaths.size - observed.size,
      sampleEvents: Array.from(observed.values()).slice(0, 5),
    };
  } finally {
    controller.abort();
    await reader.cancel().catch(() => {});
  }
}

async function waitForWorkspaceActivityConcurrently(baseURL, expectedPaths, action, options = {}) {
  const controller = new AbortController();
  const response = await fetch(`${baseURL}/events`, { signal: controller.signal });
  if (!response.ok || !response.body) {
    throw new Error(`events stream failed with ${response.status}`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const observedByPath = new Map();
  const countsByType = {};
  let buffer = "";
  const streamStarted = Date.now();
  let actionStarted = null;
  let actionFinished = null;
  let actionPromise = null;
  let firstLatencyMs = null;
  let lastLatencyMs = null;
  let lastEventAt = null;
  let eventCount = 0;
  const timeoutMs = options.timeoutMs ?? 20_000;
  const quietMs = options.quietMs ?? 750;

  try {
    while (Date.now() - streamStarted < timeoutMs) {
      const read = await Promise.race([
        reader.read(),
        delay(25).then(() => ({ timeout: true })),
      ]);
      if (read.timeout) {
        if (actionFinished && lastEventAt && Date.now() - lastEventAt >= quietMs) break;
        continue;
      }
      const { value, done } = read;
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      if (actionPromise === null && buffer.includes(": connected")) {
        actionStarted = Date.now();
        actionPromise = Promise.resolve()
          .then(action)
          .finally(() => {
            actionFinished = Date.now();
          });
      }
      const chunks = buffer.split(/\n\n/);
      buffer = chunks.pop() ?? "";
      for (const chunk of chunks) {
        const data = chunk.split(/\r?\n/).find((line) => line.startsWith("data: "));
        if (!data) continue;
        const event = JSON.parse(data.slice("data: ".length));
        const eventAt = Date.now();
        const latencyMs = eventAt - (actionStarted ?? streamStarted);
        firstLatencyMs ??= latencyMs;
        lastLatencyMs = latencyMs;
        lastEventAt = eventAt;
        eventCount++;
        countsByType[event.type] = (countsByType[event.type] ?? 0) + 1;
        if (!observedByPath.has(event.path)) {
          observedByPath.set(event.path, {
            path: event.path,
            eventType: event.type,
            eventVersion: event.version,
            latencyMs,
          });
        }
      }
    }
    await actionPromise?.catch((error) => {
      throw error;
    });
    const observedExpected = Array.from(expectedPaths).filter((pathname) => observedByPath.has(pathname));
    return {
      expectedUniquePaths: expectedPaths.size,
      observedExpectedPaths: observedExpected.length,
      observedUniquePaths: observedByPath.size,
      eventCount,
      countsByType,
      firstLatencyMs,
      lastLatencyMs,
      actionStartedAtMs: actionStarted,
      actionFinishedAtMs: actionFinished,
      actionDurationMs: actionFinished && actionStarted ? actionFinished - actionStarted : null,
      missingCount: expectedPaths.size - observedExpected.length,
      missingSample: Array.from(expectedPaths).filter((pathname) => !observedByPath.has(pathname)).slice(0, 5),
      sampleEvents: Array.from(observedByPath.values()).slice(0, 5),
    };
  } finally {
    controller.abort();
    await reader.cancel().catch(() => {});
  }
}

async function waitForEventsReady(baseURL) {
  const controller = new AbortController();
  const response = await fetch(`${baseURL}/events`, { signal: controller.signal });
  if (!response.ok || !response.body) {
    throw new Error(`events stream failed with ${response.status}`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const started = Date.now();
  try {
    while (Date.now() - started < 20_000) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      if (buffer.includes(": connected")) return;
    }
    throw new Error("timed out waiting for workspace events readiness");
  } finally {
    controller.abort();
    await reader.cancel().catch(() => {});
  }
}

async function runBrowserWorkspaceScenario(baseURL, workspace) {
  const maxAttempts = numberEnv("VIVI_PERF_BROWSER_ATTEMPTS", 3);
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await runBrowserWorkspaceScenarioAttempt(baseURL, workspace);
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts || !isTransientBrowserWorkspaceError(error)) {
        throw error;
      }
      await delay(500 * attempt);
    }
  }
  throw lastError;
}

async function runBrowserWorkspaceScenarioAttempt(baseURL, workspace) {
  const openedPath = firstExistingRelativePath(workspace.absoluteRoot, [
    "README.md",
    "pending-review.md",
    "Makefile",
    "Kconfig",
    "dir-000/file-000.md",
    "init/main.c",
    "kernel/sched/core.c",
  ]);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const client = await context.newCDPSession(page);
  await client.send("Performance.enable");
  try {
    const url = openedPath ? `${baseURL}/?path=${encodeURIComponent(openedPath)}` : baseURL;
    const started = Date.now();
    const response = await page.goto(url, { waitUntil: "domcontentloaded" });
    if (response && !response.ok()) {
      throw new Error(`front workspace navigation failed with ${response.status()}`);
    }
    await waitForBrowserWorkspaceReady(page);
    await page.waitForTimeout(500);
    const afterLoad = await collectBrowserMetrics(page, client);
    const modifier = process.platform === "darwin" ? "Meta" : "Control";
    await page.keyboard.press(`${modifier}+K`);
    await page.waitForTimeout(150);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(150);
    const afterInteraction = await collectBrowserMetrics(page, client);
    return {
      openedPath,
      durationMs: Date.now() - started,
      bodyTextLength: await page.locator("body").innerText().then((text) => text.length),
      metrics: {
        afterLoad,
        afterInteraction,
      },
    };
  } finally {
    await browser.close();
  }
}

async function waitForBrowserWorkspaceReady(page) {
  await page
    .waitForFunction(
      () => {
        const bodyText = document.body?.innerText ?? "";
        return Boolean(
          document.querySelector('aside[aria-label="File explorer"]') ||
            document.querySelector('[aria-label^="Workspace status"]') ||
            bodyText.includes("Explorer") ||
            bodyText.includes("Workspace"),
        );
      },
      undefined,
      { timeout: 20_000 },
    )
    .catch((error) => {
      throw new Error(
        `timed out waiting for Vivi workspace chrome: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    });
}

async function collectBrowserMetrics(page, client) {
  const cdp = await client.send("Performance.getMetrics");
  const metrics = Object.fromEntries(cdp.metrics.map((metric) => [metric.name, metric.value]));
  const webMemory = await page.evaluate(() => {
    const memory = performance.memory;
    if (!memory) return null;
    return {
      jsHeapSizeLimit: memory.jsHeapSizeLimit,
      totalJSHeapSize: memory.totalJSHeapSize,
      usedJSHeapSize: memory.usedJSHeapSize,
    };
  });
  return {
    jsHeapUsedBytes: Math.round(metrics.JSHeapUsedSize ?? 0),
    jsHeapTotalBytes: Math.round(metrics.JSHeapTotalSize ?? 0),
    scriptDurationMs: Math.round((metrics.ScriptDuration ?? 0) * 1000),
    layoutDurationMs: Math.round((metrics.LayoutDuration ?? 0) * 1000),
    taskDurationMs: Math.round((metrics.TaskDuration ?? 0) * 1000),
    nodes: Math.round(metrics.Nodes ?? 0),
    documents: Math.round(metrics.Documents ?? 0),
    webMemory,
  };
}

async function runCliReviewQueueScenario(baseURL) {
  const iterations = numberEnv("VIVI_PERF_CLI_ITERATIONS", 5);
  const results = [];
  for (let index = 0; index < iterations; index++) {
    results.push(await runSampledCommand(binary, ["review", "queue", "--url", baseURL, "--json"], "cli"));
  }
  return {
    iterations,
    durationMs: results.reduce((sum, result) => sum + result.durationMs, 0),
    exitCodes: countBy(results, "exitCode"),
    process: aggregateProcessSummaries(results.map((result) => result.process)),
    sampleStdoutBytes: results[0]?.stdoutBytes ?? 0,
    stderr: results.map((result) => result.stderr).filter(Boolean).join("\n"),
  };
}

function runSampledCommand(command, args, label) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    const sampler = startProcessSampler(child.pid, label, 20);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.once("exit", (exitCode, signal) => {
      sampler.stop();
      resolve({
        durationMs: Date.now() - started,
        exitCode,
        signal,
        stdoutBytes: Buffer.byteLength(stdout),
        stderr: stderr.trim(),
        process: sampler.summary(),
      });
    });
  });
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
  if (existsSync(binary) && process.env.VIVI_PERF_SKIP_BUILD === "1") return;
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
    const value = item[key] ?? "unknown";
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

function firstExistingRelativePath(root, candidates) {
  for (const candidate of candidates) {
    if (existsSync(path.join(root, candidate))) return candidate;
  }
  return null;
}

function startProcessSampler(pid, label, intervalMs = numberEnv("VIVI_PERF_PROCESS_SAMPLE_MS", 250)) {
  const samples = [];
  const sample = () => {
    const value = sampleProcess(pid);
    if (value) {
      samples.push({ ...value, atMs: Date.now() });
    }
  };
  sample();
  const timer = setInterval(sample, intervalMs);
  timer.unref?.();
  return {
    stop() {
      clearInterval(timer);
      sample();
    },
    summary() {
      return summarizeProcessSamples(samples, label);
    },
    summarySince(sinceLabel, sinceMs) {
      return summarizeProcessSamplesSince(samples, sinceLabel, sinceMs);
    },
  };
}

function sampleProcess(pid) {
  if (!pid) return null;
  const result = spawnSync("ps", ["-p", String(pid), "-o", "rss=", "-o", "pcpu=", "-o", "time="], {
    encoding: "utf8",
  });
  if (result.status !== 0) return null;
  const text = result.stdout.trim();
  if (!text) return null;
  const parts = text.split(/\s+/);
  if (parts.length < 3) return null;
  return {
    rssBytes: Number.parseInt(parts[0], 10) * 1024,
    cpuPercent: Number.parseFloat(parts[1]),
    cpuTimeMs: parseProcessCpuTime(parts[2]),
  };
}

function parseProcessCpuTime(value) {
  const parts = value.split(":").map((part) => Number.parseFloat(part));
  if (parts.some((part) => !Number.isFinite(part))) return null;
  if (parts.length === 3) {
    return Math.round(((parts[0] * 60 + parts[1]) * 60 + parts[2]) * 1000);
  }
  if (parts.length === 2) {
    return Math.round((parts[0] * 60 + parts[1]) * 1000);
  }
  return Math.round(parts[0] * 1000);
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

function numberEnvAllowZero(name, fallback) {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}
