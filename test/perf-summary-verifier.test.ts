import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import {
  parsePerfThresholds,
  verifyPerfSummary,
} from "../scripts/verify-perf-summary.mjs";

describe("perf summary verifier", () => {
  it("accepts a complete synthetic harness summary inside thresholds", () => {
    const result = verifyPerfSummary(perfSummary(), {
      requireSyntheticWorkspace: true,
      thresholds: parsePerfThresholds({}),
    });

    expect(result.ok).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it("fails when required scenarios report errors or miss watcher events", () => {
    const summary = perfSummary({
      scenarios: [
        scenario("change_burst", {
          expectedCount: 15,
          observedCount: 14,
          lastLatencyMs: 100,
        }),
        scenario("coding_agent_storm", {
          expectedUniquePaths: 30,
          observedExpectedPaths: 29,
          missingCount: 1,
          lastLatencyMs: 100,
        }),
        { ...scenario("git_review", { durationMs: 10 }), error: "boom" },
      ],
    });

    const result = verifyPerfSummary(summary, {
      requireSyntheticWorkspace: true,
      thresholds: parsePerfThresholds({}),
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual(
      expect.arrayContaining([
        "change_burst observed 14 of 15 expected paths.",
        "coding_agent_storm observed 29 of 30 expected paths.",
        "coding_agent_storm.missingCount 1 exceeded 0.",
        "git_review reported an error: boom",
      ]),
    );
  });

  it("fails when front-end script time exceeds the configured budget", () => {
    const result = verifyPerfSummary(perfSummary(), {
      thresholds: parsePerfThresholds({
        VIVI_PERF_MAX_FRONT_INTERACTION_SCRIPT_MS: "10",
      }),
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toContain(
      "front_workspace.afterInteraction.scriptDurationMs 90 exceeded 10.",
    );
  });

  it("keeps the GitHub Actions performance workflow wired to the harness", async () => {
    const workflow = await readFile(
      ".github/workflows/performance.yml",
      "utf8",
    );
    const packageJson = JSON.parse(await readFile("package.json", "utf8"));

    expect(workflow).toContain("name: Performance");
    expect(workflow).toContain("pull_request:");
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("runs-on: macos-15");
    expect(workflow).toContain("npm run perf:otel");
    expect(workflow).toContain("npm run perf:verify");
    expect(workflow).toContain("VIVI_PERF_REQUIRE_SYNTHETIC");
    expect(workflow).toContain("VIVI_PERF_AGENT_STORM_DELAY_MS=2");
    expect(workflow).toContain("actions/upload-artifact@");
    expect(workflow).toContain("path: artifacts/perf");
    expect(packageJson.scripts["build:go:otel"]).toContain(
      "npm --prefix ui run build",
    );
    expect(packageJson.scripts["build:go:otel"]).toContain(
      "go build -tags otel",
    );
  });
});

function perfSummary(overrides: Partial<Record<string, unknown>> = {}) {
  const scenarios = new Map(
    [
      scenario("idle_watch", {
        readyMs: 500,
        steadyServer: { cpuPercentByTime: 0 },
      }),
      scenario("front_workspace", {
        metrics: {
          afterLoad: {
            scriptDurationMs: 80,
            taskDurationMs: 120,
          },
          afterInteraction: {
            scriptDurationMs: 90,
            taskDurationMs: 160,
            jsHeapUsedBytes: 8_000_000,
          },
        },
      }),
      scenario("cli_review_queue", {
        durationMs: 300,
        exitCodes: { "0": 3 },
      }),
      scenario("git_review", { durationMs: 10 }),
      scenario("file_search", { aggregate: { durationMs: 200 } }),
      scenario("content_search", { aggregate: { durationMs: 300 } }),
      scenario("file_change", { latencyMs: 120 }),
      scenario("change_burst", {
        expectedCount: 15,
        observedCount: 15,
        lastLatencyMs: 180,
      }),
      scenario("coding_agent_storm", {
        expectedUniquePaths: 30,
        observedExpectedPaths: 30,
        missingCount: 0,
        lastLatencyMs: 220,
      }),
    ].map((entry) => [entry.name, entry]),
  );

  for (const replacement of (overrides.scenarios as
    Array<{ name: string }> | undefined) ?? []) {
    scenarios.set(replacement.name, replacement);
  }

  return {
    schemaVersion: 3,
    runName: "test",
    durationMs: 5_000,
    workspace: {
      synthetic: true,
      files: 540,
    },
    errors: [],
    scenarios: [...scenarios.values()],
    ...overrides,
  };
}

function scenario(name: string, result: unknown) {
  return {
    name,
    durationMs: 100,
    result,
    error: null,
  };
}
