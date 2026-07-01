import { describe, expect, it } from "vitest";

import {
  aggregateProcessSummaries,
  summarizeProcessSamples,
  summarizeProcessSamplesSince,
} from "../scripts/perf-harness-metrics.mjs";
import { isTransientBrowserWorkspaceError } from "../scripts/perf-harness-browser.mjs";

describe("perf harness process metrics", () => {
  it("summarizes full process samples and steady-state windows separately", () => {
    const samples = [
      { atMs: 1000, rssBytes: 10_000, cpuPercent: 90, cpuTimeMs: 100 },
      { atMs: 1250, rssBytes: 20_000, cpuPercent: 20, cpuTimeMs: 160 },
      { atMs: 1500, rssBytes: 18_000, cpuPercent: 1, cpuTimeMs: 162 },
      { atMs: 1750, rssBytes: 19_000, cpuPercent: 0, cpuTimeMs: 162 },
    ];

    expect(summarizeProcessSamples(samples, "server")).toMatchObject({
      label: "server",
      sampleCount: 4,
      rssBytes: { max: 20_000 },
      cpuPercent: { max: 90 },
      cpuTimeMs: { first: 100, last: 162, delta: 62 },
      windowMs: 750,
      cpuPercentByTime: 8.267,
    });
    expect(summarizeProcessSamplesSince(samples, "server_steady_idle", 1500)).toMatchObject({
      label: "server_steady_idle",
      sampleCount: 2,
      rssBytes: { max: 19_000 },
      cpuPercent: { max: 1, avg: 0.5 },
      cpuTimeMs: { first: 162, last: 162, delta: 0 },
      windowMs: 250,
      cpuPercentByTime: 0,
    });
  });

  it("aggregates child process summaries without mixing per-sample and per-process maxima", () => {
    const summary = aggregateProcessSummaries([
      {
        sampleCount: 3,
        rssBytes: { count: 3, min: 10, max: 20, avg: 15 },
        cpuPercent: { count: 3, min: 0, max: 2, avg: 1 },
        cpuTimeMs: { first: 0, last: 10, delta: 10 },
      },
      {
        sampleCount: 4,
        rssBytes: { count: 4, min: 12, max: 30, avg: 18 },
        cpuPercent: { count: 4, min: 0, max: 4, avg: 1 },
        cpuTimeMs: { first: 0, last: 20, delta: 20 },
      },
    ]);

    expect(summary).toMatchObject({
      sampleCount: 7,
      rssBytes: { count: 2, min: 20, max: 30, avg: 25 },
      cpuPercent: { count: 2, min: 2, max: 4, avg: 3 },
      cpuTimeMs: { count: 2, min: 10, max: 20, avg: 15 },
    });
  });

  it("retries transient browser workspace readiness failures only", () => {
    expect(
      isTransientBrowserWorkspaceError(
        new Error(
          "timed out waiting for Vivi workspace chrome: page.waitForFunction: Timeout 20000ms exceeded.",
        ),
      ),
    ).toBe(true);
    expect(
      isTransientBrowserWorkspaceError(
        new Error("front workspace navigation failed with 500"),
      ),
    ).toBe(false);
  });
});
