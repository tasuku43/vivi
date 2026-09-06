import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  loadLocalAgentLoopFixture,
  runLocalAgentLoop,
} from "../../harness/local-agent-loop.js";
import {
  createContractFixture,
  type ContractFixture,
} from "./support/fixture-workspace.js";
import { startViviServer, type StartedServer } from "./support/vivi-server.js";

let fixture: ContractFixture;
let server: StartedServer;
beforeEach(async () => {
  fixture = await createContractFixture();
  vi.stubEnv("VIVI_E2E_SERVER_COMMAND", path.resolve("vivi"));
  vi.stubEnv(
    "VIVI_E2E_SERVER_ARGS",
    JSON.stringify(["{root}", "--host", "{host}", "--port", "{port}"]),
  );
  server = await startViviServer({
    rootDir: fixture.rootDir,
    useProductDefaults: true,
    extraEnv: { VIVI_DATA_DIR: path.join(fixture.outsideDir, "core-feedback") },
  });
});
afterEach(async () => {
  await server?.close();
  await fixture?.cleanup();
  vi.unstubAllEnvs();
});
it.each(["codex", "claude"] as const)(
  "hands published feedback to %s without task lifecycle management",
  async (readAs) => {
    const input = await loadLocalAgentLoopFixture(
      path.resolve("test/fixtures/agent-loop/basic.json"),
    );
    input.agent.readAs = readAs;
    const report = await runLocalAgentLoop({
      baseUrl: server.url,
      fixture: input,
    });
    expect(report.status).toBe("passed");
    expect(report.stages).toEqual([
      "draft-private",
      "publish",
      "passive-read",
      "read-receipt",
      "reread",
      "follow-up",
      "fresh-read-receipt",
    ]);
  },
);
