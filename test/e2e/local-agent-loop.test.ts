import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  AgentLoopStageError,
  loadLocalAgentLoopFixture,
  runLocalAgentLoop,
} from "../../harness/local-agent-loop.js";
import {
  createContractFixture,
  type ContractFixture,
} from "./support/fixture-workspace.js";
import { startViviServer, type StartedServer } from "./support/vivi-server.js";

let fixture: ContractFixture;
let server: StartedServer | null = null;

beforeEach(async () => {
  fixture = await createContractFixture();
  server = await startViviServer({
    rootDir: fixture.rootDir,
    extraEnv: {
      VIVI_DATA_DIR: path.join(fixture.outsideDir, "agent-loop-data"),
    },
  });
});

afterEach(async () => {
  await server?.close();
  server = null;
  await fixture.cleanup();
});

it("runs the fixture-driven human-to-agent feedback loop", async () => {
  const loopFixture = await loadLocalAgentLoopFixture(
    path.resolve("test/fixtures/agent-loop/basic.json"),
  );

  const report = await runLocalAgentLoop({
    baseUrl: server!.url,
    fixture: loopFixture,
  });

  expect(report.status).toBe("passed");
  expect(report.terminalStatus).toBe("resolved");
  expect(report.stages.map((stage) => stage.stage)).toEqual([
    "seed",
    "read",
    "receipt",
    "reply",
    "terminal",
    "verify",
  ]);
  expect(report.activities).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: "thread_read",
        actor: expect.objectContaining({ id: "codex:fake-agent-loop" }),
        clientEventId: "agent-loop-read-basic-v1",
      }),
      expect.objectContaining({
        type: "comment_added",
        actor: expect.objectContaining({ id: "codex:fake-agent-loop" }),
      }),
      expect.objectContaining({
        type: "thread_status_changed",
        actor: expect.objectContaining({ id: "codex:fake-agent-loop" }),
        previousStatus: "open",
        status: "resolved",
      }),
    ]),
  );
});

it("reports the exact failed stage", async () => {
  const loopFixture = await loadLocalAgentLoopFixture(
    path.resolve("test/fixtures/agent-loop/basic.json"),
  );
  loopFixture.human.path = "missing.md";

  await expect(
    runLocalAgentLoop({ baseUrl: server!.url, fixture: loopFixture }),
  ).rejects.toMatchObject<Partial<AgentLoopStageError>>({
    name: "AgentLoopStageError",
    stage: "seed",
    completedStages: [],
  });
});
