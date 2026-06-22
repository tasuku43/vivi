import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
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

it("runs the fake agent loop through comments watch intake", async () => {
  const loopFixture = await loadLocalAgentLoopFixture(
    path.resolve("test/fixtures/agent-loop/basic.json"),
  );
  await server?.close();
  server = await startGoViviServer({
    rootDir: fixture.rootDir,
    dataDir: path.join(fixture.outsideDir, "agent-loop-watch-data"),
  });

  const report = await runLocalAgentLoop({
    baseUrl: server!.url,
    fixture: loopFixture,
    intake: "watch",
    watch: { intervalMs: 25 },
  });

  expect(report.status).toBe("passed");
  expect(report.intake).toBe("watch");
  expect(report.watchEvent).toEqual(
    expect.objectContaining({
      reason: "open_worklist_changed",
      count: 1,
      threadIds: [report.threadId],
    }),
  );
  expect(report.watchEvent?.changes).toContain("open_thread_added");
  expect(report.stages.map((stage) => stage.stage)).toEqual([
    "watch",
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
        clientEventId: `${loopFixture.agent.clientEventId}:${report.watchEvent?.cursor}`,
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
}, 15_000);

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

async function startGoViviServer(input: {
  rootDir: string;
  dataDir: string;
}): Promise<StartedServer> {
  const child = spawn(
    "go",
    ["run", "./cli", input.rootDir, "--host", "127.0.0.1", "--port", "0"],
    { cwd: process.cwd(), env: goEnv({ VIVI_DATA_DIR: input.dataDir }) },
  );
  const { url } = await waitForServerUrl(child);
  return {
    url,
    close: () => closeChild(child),
  };
}

function waitForServerUrl(
  child: ChildProcessWithoutNullStreams,
): Promise<{ url: string }> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      reject(
        new Error(
          `timed out waiting for Go Vivi server URL\nstdout:\n${stdout}\nstderr:\n${stderr}`,
        ),
      );
    }, 20_000);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      const url = /https?:\/\/[^\s]+/.exec(stdout)?.[0];
      if (!url) return;
      clearTimeout(timer);
      resolve({ url });
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      reject(
        new Error(
          `Go Vivi server exited before startup: code=${code ?? "null"} signal=${signal ?? "null"}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
        ),
      );
    });
  });
}

async function closeChild(
  child: ChildProcessWithoutNullStreams,
): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const closed = new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
  });
  child.kill("SIGTERM");
  await Promise.race([
    closed,
    new Promise<void>((resolve) => {
      setTimeout(() => {
        child.kill("SIGKILL");
        resolve();
      }, 2_000);
    }),
  ]);
}

function goEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...extra,
    GOCACHE:
      process.env.GOCACHE ?? path.join(process.cwd(), ".tmp-go-build-cache"),
    GOMODCACHE:
      process.env.GOMODCACHE ?? path.join(process.cwd(), ".tmp-go-mod-cache"),
  };
}
