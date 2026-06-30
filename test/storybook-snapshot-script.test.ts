import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import {
  isTransientStorybookCaptureError,
  parseSnapshotMismatchRetries,
  parseSnapshotSettleMs,
  shouldWaitForSnapshotReady,
} from "../scripts/capture-storybook-snapshots.mjs";

describe("Storybook snapshot capture script", () => {
  it("recaptures a mismatched snapshot once by default", () => {
    expect(parseSnapshotMismatchRetries(undefined)).toBe(1);
    expect(parseSnapshotMismatchRetries("0")).toBe(0);
    expect(parseSnapshotMismatchRetries("2")).toBe(2);
  });

  it("rejects invalid mismatch retry counts", () => {
    expect(() => parseSnapshotMismatchRetries("-1")).toThrow(
      /Invalid snapshot mismatch retry count/,
    );
    expect(() => parseSnapshotMismatchRetries("1.5")).toThrow(
      /Invalid snapshot mismatch retry count/,
    );
    expect(() => parseSnapshotMismatchRetries("abc")).toThrow(
      /Invalid snapshot mismatch retry count/,
    );
  });

  it("waits for interaction stories to settle before capture", () => {
    expect(parseSnapshotSettleMs(undefined)).toBe(750);
    expect(parseSnapshotSettleMs("0")).toBe(0);
    expect(parseSnapshotSettleMs("1000")).toBe(1000);
    expect(() => parseSnapshotSettleMs("-1")).toThrow(
      /Invalid snapshot settle duration/,
    );
    expect(() => parseSnapshotSettleMs("1.5")).toThrow(
      /Invalid snapshot settle duration/,
    );
  });

  it("allows interaction stories to opt into an explicit snapshot-ready gate", () => {
    expect(shouldWaitForSnapshotReady(["interaction", "snapshot-ready"])).toBe(
      true,
    );
    expect(shouldWaitForSnapshotReady(["interaction"])).toBe(false);
  });

  it("retries snapshot-ready timeouts without treating every timeout as transient", () => {
    expect(
      isTransientStorybookCaptureError(
        new Error(
          "Snapshot ready timed out for Files/Markdown Review States/RenderedMarkerPlacement: page.waitForFunction: Timeout 10000ms exceeded.",
        ),
      ),
    ).toBe(true);
    expect(
      isTransientStorybookCaptureError(
        new Error("page.waitForFunction: Timeout 10000ms exceeded."),
      ),
    ).toBe(false);
  });

  it("keeps CI snapshot artifacts available when the check job fails", async () => {
    const workflow = await readFile(".github/workflows/ci.yml", "utf8");

    expect(workflow).toContain("runs-on: macos-15");
    expect(workflow).toContain('TZ: "Asia/Tokyo"');
    expect(workflow).toContain('VIVI_STORYBOOK_SNAPSHOT_LOCALE: "en-US"');
    expect(workflow).toContain(
      'VIVI_STORYBOOK_SNAPSHOT_TIMEZONE: "Asia/Tokyo"',
    );
    expect(workflow).toContain("VIVI_STORYBOOK_SNAPSHOT_SETTLE_MS");
    expect(workflow).toContain("VIVI_STORYBOOK_SNAPSHOT_MISMATCH_RETRIES");
    expect(workflow).toContain(
      "files-viewer-coverage-states--code-with-local-outline",
    );
    expect(workflow).toContain("actions/upload-artifact@");
    expect(workflow).toContain("path: artifacts/storybook-snapshots");
    expect(workflow).toContain("if-no-files-found: ignore");
  });
});
