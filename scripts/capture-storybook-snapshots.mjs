import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
let storybookUrl = process.env.STORYBOOK_URL ?? null;
const manifestPath = path.join(
  repoRoot,
  "ui/src/storybook/storybook-lab.manifest.json",
);
const baselineRoot = path.join(repoRoot, "test/golden/storybook");
const artifactRoot = path.join(repoRoot, "artifacts/storybook-snapshots");
const mode = parseMode(process.argv[2]);
const includeInteractionStories =
  process.env.VIVI_STORYBOOK_SNAPSHOT_INTERACTIONS !== "0";
const viewports = parseViewports(process.env.VIVI_STORYBOOK_SNAPSHOT_VIEWPORTS);
const channelTolerance = Number.parseInt(
  process.env.VIVI_STORYBOOK_SNAPSHOT_CHANNEL_TOLERANCE ?? "2",
  10,
);
const maxDiffRatio = Number.parseFloat(
  process.env.VIVI_STORYBOOK_SNAPSHOT_MAX_DIFF_RATIO ?? "0.0005",
);
const maxDiffRatioOverrides = parseMaxDiffRatioOverrides(
  process.env.VIVI_STORYBOOK_SNAPSHOT_MAX_DIFF_RATIO_OVERRIDES,
);

if (isDirectRun()) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

async function main() {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const port = storybookUrl ? null : await findAvailablePort(6006);
  storybookUrl ??= `http://127.0.0.1:${port}`;
  const server = spawn(
    "npm",
    [
      "--prefix",
      "ui",
      "run",
      "storybook",
      "--",
      "--ci",
      "--host",
      "127.0.0.1",
      ...(port === null ? [] : ["--port", String(port)]),
    ],
    {
      cwd: repoRoot,
      env: { ...process.env, BROWSER: "none" },
      detached: process.platform !== "win32",
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
    const storyIndex = await fetchStoryIndex();
    const targets = snapshotTargets(manifest, storyIndex);
    if (targets.length === 0) {
      throw new Error("No Storybook snapshot targets were found.");
    }
    console.log(
      `Storybook snapshot targets: ${targets.length} ${includeInteractionStories ? "required+interaction" : "required"} story(s).`,
    );
    await captureTargets(targets).catch((error) => {
      throw new Error(
        [
          error instanceof Error ? error.message : String(error),
          "Storybook server output:",
          serverOutput,
        ].join("\n"),
      );
    });
  } finally {
    stopServer(server);
  }
}

function parseMode(value) {
  if (value === "--update") return "update";
  if (value === "--verify" || value === undefined) return "verify";
  throw new Error(
    `Unknown mode ${value}. Use --update to write baselines or --verify to compare them.`,
  );
}

function parseViewports(value) {
  const available = {
    desktop: { name: "desktop", width: 1440, height: 1000 },
    mobile: { name: "mobile", width: 390, height: 844 },
  };
  const names = (value ?? "desktop")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const resolved = names.map((name) => {
    const viewport = available[name];
    if (!viewport) {
      throw new Error(
        `Unknown viewport ${name}. Available viewports: ${Object.keys(available).join(", ")}`,
      );
    }
    return viewport;
  });
  return resolved.length ? resolved : [available.desktop];
}

function parseMaxDiffRatioOverrides(value) {
  const entries = new Map();
  if (!value) return entries;
  const parsed = JSON.parse(value);
  for (const [storyIdOrLabel, ratio] of Object.entries(parsed)) {
    const numericRatio = Number.parseFloat(String(ratio));
    if (!Number.isFinite(numericRatio) || numericRatio < 0) {
      throw new Error(
        `Invalid snapshot diff ratio override for ${storyIdOrLabel}: ${ratio}`,
      );
    }
    entries.set(storyIdOrLabel, numericRatio);
  }
  return entries;
}

function maxDiffRatioForTarget(target) {
  return (
    maxDiffRatioOverrides.get(target.id) ??
    maxDiffRatioOverrides.get(target.label) ??
    maxDiffRatio
  );
}

function snapshotTargets(manifest, storyIndex) {
  const storyIds = new Set();
  for (const surface of manifest.surfaces ?? []) {
    for (const storyId of surface.requiredStories ?? []) storyIds.add(storyId);
    if (includeInteractionStories) {
      for (const storyId of surface.interactionStories ?? [])
        storyIds.add(storyId);
    }
  }

  const targets = [];
  const missing = [];
  for (const storyId of [...storyIds].sort()) {
    const entry = storyIndex.get(storyId);
    if (!entry) {
      missing.push(storyId);
    } else if (
      !includeInteractionStories &&
      entry.tags.includes("interaction")
    ) {
      continue;
    } else {
      targets.push(entry);
    }
  }
  if (missing.length) {
    throw new Error(
      [
        "Storybook snapshot manifest references stories that are missing from the running Storybook index:",
        ...missing.map((storyId) => `- ${storyId}`),
        "Run npm run storybook:verify first to inspect the manifest contract.",
      ].join("\n"),
    );
  }
  return targets;
}

async function fetchStoryIndex() {
  const response = await fetch(`${storybookUrl}/index.json`);
  if (!response.ok) {
    throw new Error(`Failed to fetch Storybook index: ${response.status}`);
  }
  const index = await response.json();
  const stories = new Map();
  for (const entry of Object.values(index.entries ?? {})) {
    if (entry?.type !== "story") continue;
    stories.set(`${entry.title}/${entry.exportName}`, {
      id: entry.id,
      title: entry.title,
      exportName: entry.exportName,
      label: `${entry.title}/${entry.exportName}`,
      tags: entry.tags ?? [],
    });
  }
  return stories;
}

async function captureTargets(targets) {
  const browser = await chromium.launch({ args: ["--disable-gpu"] });
  const errors = [];
  let compared = 0;
  let written = 0;

  try {
    rmSync(artifactRoot, { recursive: true, force: true });
    for (const viewport of viewports) {
      if (mode === "update") {
        rmSync(path.join(baselineRoot, viewport.name), {
          recursive: true,
          force: true,
        });
      }
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: 1,
        reducedMotion: "reduce",
      });
      for (const target of targets) {
        const screenshot = await captureStoryWithRetry(context, target).catch(
          (error) => {
            throw new Error(
              `Failed to capture ${target.label} (${viewport.name}): ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
          },
        );
        const baselinePath = path.join(
          baselineRoot,
          viewport.name,
          `${safeName(target.id)}.png`,
        );
        const metaPath = baselinePath.replace(/\.png$/, ".json");
        const hash = sha256(screenshot);
        const metadata = {
          storyId: target.id,
          story: target.label,
          viewport: viewport.name,
          width: viewport.width,
          height: viewport.height,
          sha256: hash,
        };

        if (mode === "update") {
          mkdirSync(path.dirname(baselinePath), { recursive: true });
          writeFileSync(baselinePath, screenshot);
          writeFileSync(
            `${metaPath}`,
            `${JSON.stringify(metadata, null, 2)}\n`,
          );
          written += 1;
          continue;
        }

        if (!existsSync(baselinePath) || !existsSync(metaPath)) {
          errors.push(
            `Missing baseline for ${target.label} (${viewport.name}). Run npm run storybook:snapshots:update.`,
          );
          writeArtifact(viewport.name, target.id, "actual.png", screenshot);
          continue;
        }

        const expected = readFileSync(baselinePath);
        const expectedHash = sha256(expected);
        compared += 1;
        const comparison = await comparePngBuffers(
          browser,
          expected,
          screenshot,
        );
        const allowedDiffRatio = maxDiffRatioForTarget(target);
        if (comparison.changedRatio > allowedDiffRatio) {
          writeArtifact(viewport.name, target.id, "actual.png", screenshot);
          writeArtifact(viewport.name, target.id, "expected.png", expected);
          if (comparison.diffPngBase64) {
            writeArtifact(
              viewport.name,
              target.id,
              "diff.png",
              Buffer.from(comparison.diffPngBase64, "base64"),
            );
          }
          errors.push(
            [
              `Snapshot changed for ${target.label} (${viewport.name}).`,
              `  expected ${expectedHash}`,
              `  actual   ${hash}`,
              `  changed  ${comparison.changedPixels}/${comparison.totalPixels} pixels (${formatRatio(comparison.changedRatio)}, limit ${formatRatio(allowedDiffRatio)})`,
              `  artifact ${path.relative(repoRoot, artifactPath(viewport.name, target.id))}`,
            ].join("\n"),
          );
        }
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }

  if (errors.length) {
    console.error(
      `Storybook snapshot verification failed with ${errors.length} issue(s):`,
    );
    for (const error of errors) console.error(error);
    process.exitCode = 1;
    return;
  }

  if (mode === "update") {
    console.log(
      `Storybook snapshot baselines updated: ${written} image(s) across ${viewports.length} viewport(s).`,
    );
  } else {
    console.log(
      `Storybook snapshots verified: ${compared} image(s) across ${viewports.length} viewport(s).`,
    );
  }
}

async function stabilizePage(page) {
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-delay: 0s !important;
        animation-duration: 0s !important;
        caret-color: transparent !important;
        scroll-behavior: auto !important;
        transition-delay: 0s !important;
        transition-duration: 0s !important;
      }
    `,
  });
}

async function waitForSrOnlyStyles(page) {
  await page.waitForFunction(() => {
    const element = document.querySelector(".sr-only");
    if (!element) return true;
    const style = window.getComputedStyle(element);
    return (
      style.position === "absolute" &&
      style.width === "1px" &&
      style.height === "1px" &&
      style.overflow === "hidden"
    );
  });
}

async function captureStory(page, target) {
  const url = `${storybookUrl}/iframe.html?id=${encodeURIComponent(target.id)}&viewMode=story`;
  await page.addInitScript((storyId) => {
    window.__viviStorybookSnapshotStatus = "pending";
    const attach = () => {
      const channel = window.__STORYBOOK_ADDONS_CHANNEL__;
      if (!channel) {
        window.setTimeout(attach, 0);
        return;
      }
      channel.on("storyFinished", (event) => {
        if (event?.storyId === storyId) {
          window.__viviStorybookSnapshotStatus = event.status ?? "success";
        }
      });
      channel.on("storyErrored", (event) => {
        if (event?.storyId === storyId) {
          window.__viviStorybookSnapshotStatus = "error";
        }
      });
      channel.on("storyThrewException", (event) => {
        if (event?.storyId === storyId) {
          window.__viviStorybookSnapshotStatus = "error";
        }
      });
    };
    attach();
  }, target.id);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await stabilizePage(page);
  await page.evaluate(() => document.fonts?.ready.then(() => true) ?? true);
  await page.waitForFunction(() => {
    const root = document.querySelector("#storybook-root, #root");
    const docs = document.querySelector("#storybook-docs");
    return Boolean(
      root?.innerHTML.trim().length || docs?.innerHTML.trim().length,
    );
  });
  const storybookState = await page.evaluate(() => document.body.className);
  const errorDisplay = page.locator(".sb-errordisplay").first();
  if (
    storybookState.includes("sb-show-errordisplay") &&
    (await errorDisplay.count()) > 0
  ) {
    throw new Error(await errorDisplay.innerText());
  }
  await page
    .waitForFunction(
      () => window.__viviStorybookSnapshotStatus !== "pending",
      undefined,
      { timeout: 30_000 },
    )
    .catch(() => undefined);
  await page.evaluate(() => {
    for (const selector of ["#storybook-root", "#storybook-docs", "#root"]) {
      const element = document.querySelector(selector);
      if (element?.innerHTML.trim()) element.removeAttribute("hidden");
    }
  });
  await waitForSrOnlyStyles(page);
  await page.mouse.move(0, 0);
  await page.waitForTimeout(250);
  return page.screenshot({ fullPage: false, animations: "disabled" });
}

async function captureStoryWithRetry(context, target) {
  const maxAttempts = 3;
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const page = await context.newPage();
    try {
      const screenshot = await captureStory(page, target);
      await page.close();
      return screenshot;
    } catch (error) {
      lastError = error;
      await page.close().catch(() => undefined);
      if (attempt === maxAttempts || !isTransientStorybookCaptureError(error)) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
  }
  throw lastError;
}

function isTransientStorybookCaptureError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("Execution context was destroyed") ||
    message.includes("Target page, context or browser has been closed") ||
    message.includes("Navigation failed because page was closed")
  );
}

function writeArtifact(viewportName, storyId, filename, content) {
  const directory = artifactPath(viewportName, storyId);
  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, filename), content);
}

function artifactPath(viewportName, storyId) {
  return path.join(artifactRoot, viewportName, safeName(storyId));
}

function safeName(value) {
  return value
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

async function comparePngBuffers(browser, expected, actual) {
  if (expected.equals(actual)) {
    return {
      changedPixels: 0,
      totalPixels: 1,
      changedRatio: 0,
      diffPngBase64: "",
    };
  }

  const page = await browser.newPage({ viewport: { width: 1, height: 1 } });
  try {
    return await page.evaluate(
      async ({ expectedBase64, actualBase64, channelTolerance }) => {
        const expected = await loadImage(expectedBase64);
        const actual = await loadImage(actualBase64);
        const totalPixels = Math.max(
          expected.width * expected.height,
          actual.width * actual.height,
        );
        if (
          expected.width !== actual.width ||
          expected.height !== actual.height
        ) {
          return {
            changedPixels: totalPixels,
            totalPixels,
            changedRatio: 1,
            diffPngBase64: "",
          };
        }

        const canvas = document.createElement("canvas");
        canvas.width = expected.width;
        canvas.height = expected.height;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) throw new Error("Could not create 2D canvas context.");

        context.drawImage(expected, 0, 0);
        const expectedPixels = context.getImageData(
          0,
          0,
          expected.width,
          expected.height,
        );
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.drawImage(actual, 0, 0);
        const actualPixels = context.getImageData(
          0,
          0,
          actual.width,
          actual.height,
        );
        const diffPixels = context.createImageData(canvas.width, canvas.height);

        let changedPixels = 0;
        for (let index = 0; index < expectedPixels.data.length; index += 4) {
          const delta =
            Math.abs(expectedPixels.data[index] - actualPixels.data[index]) +
            Math.abs(
              expectedPixels.data[index + 1] - actualPixels.data[index + 1],
            ) +
            Math.abs(
              expectedPixels.data[index + 2] - actualPixels.data[index + 2],
            ) +
            Math.abs(
              expectedPixels.data[index + 3] - actualPixels.data[index + 3],
            );
          const changed = delta > channelTolerance;
          if (changed) changedPixels += 1;
          diffPixels.data[index] = changed ? 255 : actualPixels.data[index];
          diffPixels.data[index + 1] = changed
            ? 0
            : actualPixels.data[index + 1];
          diffPixels.data[index + 2] = changed
            ? 180
            : actualPixels.data[index + 2];
          diffPixels.data[index + 3] = changed ? 255 : 90;
        }

        context.putImageData(diffPixels, 0, 0);
        return {
          changedPixels,
          totalPixels: expected.width * expected.height,
          changedRatio: changedPixels / (expected.width * expected.height),
          diffPngBase64: canvas.toDataURL("image/png").split(",", 2)[1] ?? "",
        };

        function loadImage(base64) {
          return new Promise((resolve, reject) => {
            const image = new Image();
            image.onload = () => resolve(image);
            image.onerror = () => reject(new Error("Could not load PNG."));
            image.src = `data:image/png;base64,${base64}`;
          });
        }
      },
      {
        expectedBase64: expected.toString("base64"),
        actualBase64: actual.toString("base64"),
        channelTolerance,
      },
    );
  } finally {
    await page.close();
  }
}

function formatRatio(value) {
  return `${(value * 100).toFixed(4)}%`;
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
      // Keep waiting until Storybook is reachable.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    `Timed out waiting for Storybook at ${url}\n${readServerOutput()}`,
  );
}

async function findAvailablePort(start) {
  for (let port = start; port < start + 100; port += 1) {
    if (await canListen(port)) return port;
  }
  throw new Error(`Could not find an available Storybook port from ${start}.`);
}

function canListen(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

function stopServer(server) {
  if (server.exitCode !== null) return;
  if (process.platform === "win32" || server.pid === undefined) {
    server.kill("SIGTERM");
    return;
  }
  try {
    process.kill(-server.pid, "SIGTERM");
  } catch {
    server.kill("SIGTERM");
  }
}

function isDirectRun() {
  return process.argv[1] === fileURLToPath(import.meta.url);
}
