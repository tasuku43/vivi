import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const defaultSummaryPath = path.join(
  repoRoot,
  "artifacts",
  "perf",
  "summary.json",
);

const thresholdDefinitions = [
  ["maxRunDurationMs", "VIVI_PERF_MAX_RUN_DURATION_MS", 180_000],
  ["maxIdleReadyMs", "VIVI_PERF_MAX_IDLE_READY_MS", 20_000],
  [
    "maxIdleSteadyCpuPercentByTime",
    "VIVI_PERF_MAX_IDLE_STEADY_CPU_PERCENT",
    20,
  ],
  [
    "maxFrontAfterLoadScriptDurationMs",
    "VIVI_PERF_MAX_FRONT_LOAD_SCRIPT_MS",
    2_000,
  ],
  [
    "maxFrontAfterLoadTaskDurationMs",
    "VIVI_PERF_MAX_FRONT_LOAD_TASK_MS",
    3_000,
  ],
  [
    "maxFrontAfterInteractionScriptDurationMs",
    "VIVI_PERF_MAX_FRONT_INTERACTION_SCRIPT_MS",
    3_000,
  ],
  [
    "maxFrontAfterInteractionTaskDurationMs",
    "VIVI_PERF_MAX_FRONT_INTERACTION_TASK_MS",
    4_000,
  ],
  [
    "maxFrontAfterInteractionHeapUsedBytes",
    "VIVI_PERF_MAX_FRONT_INTERACTION_HEAP_BYTES",
    128 * 1024 * 1024,
  ],
  ["maxCliReviewQueueDurationMs", "VIVI_PERF_MAX_CLI_REVIEW_QUEUE_MS", 10_000],
  ["maxFileSearchDurationMs", "VIVI_PERF_MAX_FILE_SEARCH_MS", 10_000],
  ["maxContentSearchDurationMs", "VIVI_PERF_MAX_CONTENT_SEARCH_MS", 15_000],
  ["maxFileChangeLatencyMs", "VIVI_PERF_MAX_FILE_CHANGE_LATENCY_MS", 8_000],
  [
    "maxChangeBurstLastLatencyMs",
    "VIVI_PERF_MAX_CHANGE_BURST_LAST_LATENCY_MS",
    8_000,
  ],
  [
    "maxAgentStormLastLatencyMs",
    "VIVI_PERF_MAX_AGENT_STORM_LAST_LATENCY_MS",
    8_000,
  ],
];

const requiredScenarios = [
  "idle_watch",
  "front_workspace",
  "cli_review_queue",
  "git_review",
  "file_search",
  "content_search",
  "file_change",
  "change_burst",
  "coding_agent_storm",
];

if (isDirectRun()) {
  const summaryPath = path.resolve(
    process.argv[2] ?? process.env.VIVI_PERF_SUMMARY ?? defaultSummaryPath,
  );
  const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
  const result = verifyPerfSummary(summary, {
    requireSyntheticWorkspace: process.env.VIVI_PERF_REQUIRE_SYNTHETIC === "1",
    thresholds: parsePerfThresholds(process.env),
  });

  console.log(formatPerfVerification(result, summaryPath));
  if (!result.ok) process.exitCode = 1;
}

export function parsePerfThresholds(env = process.env) {
  const thresholds = {};
  for (const [key, envName, defaultValue] of thresholdDefinitions) {
    thresholds[key] = parseNonNegativeNumber(
      env[envName],
      envName,
      defaultValue,
    );
  }
  return thresholds;
}

export function verifyPerfSummary(summary, options = {}) {
  const thresholds = options.thresholds ?? parsePerfThresholds({});
  const failures = [];
  const metrics = [];

  if (summary.schemaVersion !== 3) {
    failures.push(
      `Expected perf summary schemaVersion 3, got ${summary.schemaVersion ?? "missing"}.`,
    );
  }
  checkMax(
    failures,
    metrics,
    "run.durationMs",
    summary.durationMs,
    thresholds.maxRunDurationMs,
  );
  if (!Array.isArray(summary.errors)) {
    failures.push("summary.errors is missing or not an array.");
  } else if (summary.errors.length > 0) {
    failures.push(`summary.errors is not empty: ${summary.errors.join("; ")}`);
  }
  if (
    options.requireSyntheticWorkspace &&
    summary.workspace?.synthetic !== true
  ) {
    failures.push(
      "Expected a synthetic workspace for CI performance verification.",
    );
  }
  if (
    !Number.isFinite(summary.workspace?.files) ||
    summary.workspace.files <= 0
  ) {
    failures.push("Expected workspace.files to be a positive number.");
  }

  const scenarios = new Map(
    (summary.scenarios ?? []).map((scenario) => [scenario.name, scenario]),
  );
  for (const name of requiredScenarios) {
    const scenario = scenarios.get(name);
    if (!scenario) {
      failures.push(`Missing required scenario: ${name}.`);
      continue;
    }
    if (scenario.error)
      failures.push(`${name} reported an error: ${scenario.error}`);
  }

  const idle = scenarios.get("idle_watch");
  checkMax(
    failures,
    metrics,
    "idle_watch.readyMs",
    idle?.result?.readyMs,
    thresholds.maxIdleReadyMs,
  );
  checkMax(
    failures,
    metrics,
    "idle_watch.steadyServer.cpuPercentByTime",
    idle?.result?.steadyServer?.cpuPercentByTime,
    thresholds.maxIdleSteadyCpuPercentByTime,
  );

  const front = scenarios.get("front_workspace");
  checkMax(
    failures,
    metrics,
    "front_workspace.afterLoad.scriptDurationMs",
    front?.result?.metrics?.afterLoad?.scriptDurationMs,
    thresholds.maxFrontAfterLoadScriptDurationMs,
  );
  checkMax(
    failures,
    metrics,
    "front_workspace.afterLoad.taskDurationMs",
    front?.result?.metrics?.afterLoad?.taskDurationMs,
    thresholds.maxFrontAfterLoadTaskDurationMs,
  );
  checkMax(
    failures,
    metrics,
    "front_workspace.afterInteraction.scriptDurationMs",
    front?.result?.metrics?.afterInteraction?.scriptDurationMs,
    thresholds.maxFrontAfterInteractionScriptDurationMs,
  );
  checkMax(
    failures,
    metrics,
    "front_workspace.afterInteraction.taskDurationMs",
    front?.result?.metrics?.afterInteraction?.taskDurationMs,
    thresholds.maxFrontAfterInteractionTaskDurationMs,
  );
  checkMax(
    failures,
    metrics,
    "front_workspace.afterInteraction.jsHeapUsedBytes",
    front?.result?.metrics?.afterInteraction?.jsHeapUsedBytes,
    thresholds.maxFrontAfterInteractionHeapUsedBytes,
  );

  const cli = scenarios.get("cli_review_queue");
  checkMax(
    failures,
    metrics,
    "cli_review_queue.durationMs",
    cli?.result?.durationMs,
    thresholds.maxCliReviewQueueDurationMs,
  );
  if (cli?.result) {
    const exitCodes = cli.result.exitCodes ?? {};
    const nonZeroExitCodes = Object.entries(exitCodes).filter(
      ([code, count]) => code !== "0" && count > 0,
    );
    if (nonZeroExitCodes.length > 0) {
      failures.push(
        `cli_review_queue reported non-zero exit codes: ${JSON.stringify(Object.fromEntries(nonZeroExitCodes))}`,
      );
    }
  }

  checkMax(
    failures,
    metrics,
    "file_search.aggregate.durationMs",
    scenarios.get("file_search")?.result?.aggregate?.durationMs,
    thresholds.maxFileSearchDurationMs,
  );
  checkMax(
    failures,
    metrics,
    "content_search.aggregate.durationMs",
    scenarios.get("content_search")?.result?.aggregate?.durationMs,
    thresholds.maxContentSearchDurationMs,
  );

  const fileChange = scenarios.get("file_change");
  checkMax(
    failures,
    metrics,
    "file_change.latencyMs",
    fileChange?.result?.latencyMs,
    thresholds.maxFileChangeLatencyMs,
  );

  const changeBurst = scenarios.get("change_burst");
  checkObservedCount(
    failures,
    metrics,
    "change_burst",
    changeBurst?.result?.expectedCount,
    changeBurst?.result?.observedCount,
  );
  checkMax(
    failures,
    metrics,
    "change_burst.lastLatencyMs",
    changeBurst?.result?.lastLatencyMs,
    thresholds.maxChangeBurstLastLatencyMs,
  );

  const agentStorm = scenarios.get("coding_agent_storm");
  checkObservedCount(
    failures,
    metrics,
    "coding_agent_storm",
    agentStorm?.result?.expectedUniquePaths,
    agentStorm?.result?.observedExpectedPaths,
  );
  checkMax(
    failures,
    metrics,
    "coding_agent_storm.missingCount",
    agentStorm?.result?.missingCount,
    0,
  );
  checkMax(
    failures,
    metrics,
    "coding_agent_storm.lastLatencyMs",
    agentStorm?.result?.lastLatencyMs,
    thresholds.maxAgentStormLastLatencyMs,
  );

  return { ok: failures.length === 0, failures, metrics };
}

export function formatPerfVerification(
  result,
  summaryPath = defaultSummaryPath,
) {
  const lines = [
    `${result.ok ? "Performance summary verified" : "Performance summary failed"}: ${path.relative(process.cwd(), summaryPath) || summaryPath}`,
  ];
  for (const metric of result.metrics) {
    const comparator = metric.comparator ?? "<=";
    lines.push(
      `- ${metric.label}: ${formatNumber(metric.value)} ${comparator} ${formatNumber(metric.limit)}`,
    );
  }
  if (result.failures.length > 0) {
    lines.push("Failures:");
    for (const failure of result.failures) lines.push(`- ${failure}`);
  }
  return lines.join("\n");
}

function checkObservedCount(failures, metrics, label, expected, observed) {
  if (!Number.isFinite(expected) || !Number.isFinite(observed)) {
    failures.push(`${label} observed count is missing.`);
    return;
  }
  metrics.push({
    label: `${label}.observed`,
    value: observed,
    limit: expected,
    comparator: "of",
  });
  if (observed !== expected) {
    failures.push(
      `${label} observed ${observed} of ${expected} expected paths.`,
    );
  }
}

function checkMax(failures, metrics, label, value, limit) {
  if (!Number.isFinite(value)) {
    failures.push(`${label} is missing.`);
    return;
  }
  metrics.push({ label, value, limit, comparator: "<=" });
  if (value > limit)
    failures.push(
      `${label} ${formatNumber(value)} exceeded ${formatNumber(limit)}.`,
    );
}

function parseNonNegativeNumber(value, name, defaultValue) {
  if (value === undefined || value === "") return defaultValue;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid ${name}: ${value}. Use a non-negative number.`);
  }
  return parsed;
}

function formatNumber(value) {
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(3).replace(/\.?0+$/, "");
}

function isDirectRun() {
  return (
    process.argv[1] &&
    path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  );
}
