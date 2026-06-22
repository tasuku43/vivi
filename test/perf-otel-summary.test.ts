import { describe, expect, it } from "vitest";

import { summarizeOperationSpans } from "../scripts/perf-otel-summary.mjs";

describe("perf OpenTelemetry summary", () => {
  it("groups Vivi operation spans and calculates scan totals", () => {
    const spans = [
      span("server.watch_loop", {
        duration_ms: { intValue: "10" },
        scanned_directories: { intValue: "2" },
        scanned_files: { intValue: "5" },
        emitted_events: { intValue: "0" },
        result_count: { intValue: "7" },
        cached: { boolValue: false },
        error: { boolValue: false },
      }),
      span("server.watch_loop", {
        duration_ms: { intValue: "14" },
        scanned_directories: { intValue: "3" },
        scanned_files: { intValue: "8" },
        emitted_events: { intValue: "1" },
        result_count: { intValue: "11" },
        cached: { boolValue: true },
        error: { boolValue: false },
      }),
    ];

    const summary = summarizeOperationSpans(spans, 2000);

    expect(summary.operations["server.watch_loop"]).toMatchObject({
      count: 2,
      frequencyPerSecond: 1,
      durationMs: { min: 10, max: 14, sum: 24, avg: 12 },
      scannedFiles: { sum: 13 },
      emittedEvents: { sum: 1 },
      cached: 1,
    });
  });
});

function span(operation: string, attributes: Record<string, Record<string, unknown>>) {
  return {
    attributes: [
      { key: "vivi.operation", value: { stringValue: operation } },
      ...Object.entries(attributes).map(([key, value]) => ({ key, value })),
    ],
  };
}
