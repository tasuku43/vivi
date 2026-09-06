import { writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { expect, it, vi } from "vitest";
import { createContractFixture } from "./support/fixture-workspace.js";
import { startViviServer } from "./support/vivi-server.js";

it("shows and live-refreshes H1 in the canonical Go workspace without renaming tree rows", async () => {
  const fixture = await createContractFixture();
  vi.stubEnv("VIVI_E2E_SERVER_COMMAND", path.resolve("vivi"));
  vi.stubEnv(
    "VIVI_E2E_SERVER_ARGS",
    JSON.stringify(["{root}", "--host", "{host}", "--port", "{port}"]),
  );
  const server = await startViviServer({
    rootDir: fixture.rootDir,
    useProductDefaults: true,
    extraEnv: { VIVI_DATA_DIR: path.join(fixture.outsideDir, "heading-data") },
  });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(server.url);
    const row = page.locator('[role="treeitem"][data-tree-path="README.md"]');
    await row.waitFor();
    await expect.poll(() => row.textContent()).toContain("Vivi Fixture");
    await row.click();
    await expect.poll(() => row.getAttribute("aria-selected")).toBe("true");
    const paths = () =>
      page
        .locator('[role="treeitem"]')
        .evaluateAll((rows) =>
          rows.map((row) => row.getAttribute("data-tree-path")),
        );
    const before = await paths();
    await writeFile(
      path.join(fixture.rootDir, "README.md"),
      "# A renamed document heading\n\nThe path stays the same.\n",
    );
    await expect
      .poll(() => row.textContent(), { timeout: 10_000 })
      .toContain("A renamed document heading");
    expect(await row.getAttribute("aria-selected")).toBe("true");
    expect(await row.textContent()).toContain("README.md");
    expect(await paths()).toEqual(before);
    await writeFile(
      path.join(fixture.rootDir, "README.md"),
      "## No first-level heading\n",
    );
    await expect
      .poll(() => row.textContent(), { timeout: 10_000 })
      .toContain("No H1");
    const html = page.locator('[role="treeitem"][data-tree-path="index.html"]');
    await expect.poll(() => html.textContent()).toContain("HTML Fixture");
  } finally {
    await browser.close();
    await server.close();
    await fixture.cleanup();
    vi.unstubAllEnvs();
  }
}, 30_000);
