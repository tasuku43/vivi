import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, expect, it } from "vitest";
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

beforeAll(async () => {
  await warmGoCommentsCli();
});

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
    watch: goCliWatchOptions({ intervalMs: 25 }),
    terminalTransport: "cli",
    cli: goCliCommentsOptions(),
  });

  expect(report.status).toBe("passed");
  expect(report.intake).toBe("watch");
  expect(report.terminalTransport).toBe("cli");
  expect(report.watchEvent).toEqual(
    expect.objectContaining({
      schemaVersion: 1,
      eventSchema: "commentOpenWorklistEvent",
      eventSchemaCommand: expect.arrayContaining([
        "comments",
        "schema",
        "commentOpenWorklistEvent",
      ]),
      reason: "open_worklist_changed",
      count: 1,
      threadIds: [report.threadId],
      recommendedAction: "claim_open_work",
      suggestedCommandIntents: expect.arrayContaining([
        "claim_next_open_thread",
      ]),
      itemCount: 1,
      sourceAvailable: true,
      diffStatus: "available",
      activityCount: expect.any(Number),
    }),
  );
  expect(report.watchEvent?.changes).toContain("open_thread_added");
  expect(report.stages.map((stage) => stage.stage)).toEqual([
    "watch",
    "seed",
    "read",
    "receipt",
    "claim",
    "renew",
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
        type: "thread_claimed",
        actor: expect.objectContaining({ id: "codex:fake-agent-loop" }),
        clientEventId: `${loopFixture.agent.clientEventId}:claim`,
        leaseExpiresAt: expect.any(String),
      }),
      expect.objectContaining({
        type: "thread_claimed",
        actor: expect.objectContaining({ id: "codex:fake-agent-loop" }),
        clientEventId: `${loopFixture.agent.clientEventId}:renew`,
        leaseExpiresAt: expect.any(String),
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
}, 30_000);

it("relays human follow-up through comments follow while the fake agent works", async () => {
  const loopFixture = await loadLocalAgentLoopFixture(
    path.resolve("test/fixtures/agent-loop/follow-up.json"),
  );
  await server?.close();
  server = await startGoViviServer({
    rootDir: fixture.rootDir,
    dataDir: path.join(fixture.outsideDir, "agent-loop-follow-data"),
  });

  const report = await runLocalAgentLoop({
    baseUrl: server!.url,
    fixture: loopFixture,
    intake: "watch",
    watch: goCliWatchOptions({ intervalMs: 25 }),
    terminalTransport: "cli",
    cli: goCliCommentsOptions({ intervalMs: 25 }),
  });

  expect(report.status).toBe("passed");
  expect(report.followEvent).toEqual(
    expect.objectContaining({
      threadId: report.threadId,
      reason: "resumed",
      eventSchema: "commentActivityBatchEvent",
      eventSchemaCommand: expect.arrayContaining([
        "comments",
        "schema",
        "commentActivityBatchEvent",
      ]),
      count: expect.any(Number),
      activityTypes: expect.arrayContaining(["comment_added"]),
      summaryKinds: expect.arrayContaining(["human_comment"]),
      externalActivityCount: 1,
      ownActivityCount: 0,
      requiresAttention: true,
      attentionReasons: expect.arrayContaining(["external_human_comment"]),
      recommendedAction: "reconsider_work",
      suggestedCommandIntents: expect.arrayContaining([
        "acknowledge_follow_up",
        "handoff_after_blocked_or_needs_info",
        "complete_after_verification",
        "archive_after_decision",
      ]),
      suggestedCommandSchemas: expect.arrayContaining([
        "commentTriageFileInput",
        "commentResultFileInput",
      ]),
      suggestedSchemaCommands: expect.arrayContaining([
        expect.arrayContaining([
          "comments",
          "schema",
          "commentTriageFileInput",
        ]),
        expect.arrayContaining([
          "comments",
          "schema",
          "commentResultFileInput",
        ]),
      ]),
      commentBodies: [loopFixture.human.followUp?.body],
      sourceAvailable: true,
    }),
  );
  expect(report.triage).toEqual(
    expect.objectContaining({
      decision: "accepted",
      summary: loopFixture.agent.triage?.summary,
      nextAction: loopFixture.agent.triage?.nextAction,
      commentId: expect.any(String),
      body: expect.stringContaining("Triage: accepted"),
    }),
  );
  expect(report.terminalResult).toEqual(
    expect.objectContaining({
      outcome: "resolved",
      summary: loopFixture.agent.result?.summary,
      verification: loopFixture.agent.result?.verification,
      body: expect.stringContaining("Result: resolved"),
    }),
  );
  expect(report.stages.map((stage) => stage.stage)).toEqual([
    "watch",
    "seed",
    "read",
    "receipt",
    "claim",
    "renew",
    "follow",
    "triage",
    "reply",
    "terminal",
    "verify",
  ]);
  expect(report.activities).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: "comment_added",
        actor: expect.objectContaining({ id: "human:fixture" }),
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
}, 30_000);

it("runs the fake agent loop through blocking comments claim intake", async () => {
  const loopFixture = await loadLocalAgentLoopFixture(
    path.resolve("test/fixtures/agent-loop/basic.json"),
  );
  await server?.close();
  server = await startGoViviServer({
    rootDir: fixture.rootDir,
    dataDir: path.join(fixture.outsideDir, "agent-loop-claim-wait-data"),
  });

  const report = await runLocalAgentLoop({
    baseUrl: server!.url,
    fixture: loopFixture,
    intake: "claim-wait",
    terminalTransport: "cli",
    cli: { ...goCliCommentsOptions(), intervalMs: 25 },
  });

  expect(report.status).toBe("passed");
  expect(report.intake).toBe("claim-wait");
  expect(report.terminalTransport).toBe("cli");
  expect(report.claimWait).toEqual(
    expect.objectContaining({
      threadId: report.threadId,
      clientEventId: `${loopFixture.agent.clientEventId}:claim-wait`,
      leaseExpiresAt: expect.any(String),
      sourceAvailable: true,
      diffStatus: "available",
      activityCount: expect.any(Number),
    }),
  );
  expect(report.stages.map((stage) => stage.stage)).toEqual([
    "wait",
    "seed",
    "read",
    "renew",
    "reply",
    "terminal",
    "verify",
  ]);
  expect(report.activities).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: "thread_claimed",
        actor: expect.objectContaining({ id: "codex:fake-agent-loop" }),
        clientEventId: `${loopFixture.agent.clientEventId}:claim-wait`,
        leaseExpiresAt: expect.any(String),
      }),
      expect.objectContaining({
        type: "thread_claimed",
        actor: expect.objectContaining({ id: "codex:fake-agent-loop" }),
        clientEventId: `${loopFixture.agent.clientEventId}:renew`,
        leaseExpiresAt: expect.any(String),
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
  expect(report.activities).not.toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: "thread_read",
        actor: expect.objectContaining({ id: "codex:fake-agent-loop" }),
      }),
    ]),
  );
}, 30_000);

it("runs the fake agent loop through integrated comments work intake", async () => {
  const loopFixture = await loadLocalAgentLoopFixture(
    path.resolve("test/fixtures/agent-loop/follow-up.json"),
  );
  await server?.close();
  server = await startGoViviServer({
    rootDir: fixture.rootDir,
    dataDir: path.join(fixture.outsideDir, "agent-loop-work-data"),
  });

  const report = await runLocalAgentLoop({
    baseUrl: server!.url,
    fixture: loopFixture,
    intake: "work",
    terminalTransport: "cli",
    cli: goCliCommentsOptions({ intervalMs: 25 }),
  });

  expect(report.status).toBe("passed");
  expect(report.intake).toBe("work");
  expect(report.terminalTransport).toBe("cli");
  expect(report.work).toEqual(
    expect.objectContaining({
      threadId: report.threadId,
      schemaVersion: 1,
      eventSchema: "commentWorkClaimedEvent",
      eventSchemaCommand: expect.arrayContaining([
        "comments",
        "schema",
        "commentWorkClaimedEvent",
      ]),
      sessionId: expect.stringMatching(/^comments-work-/),
      sequence: 1,
      clientEventId: `${loopFixture.agent.clientEventId}:work`,
      leaseExpiresAt: expect.any(String),
      sourceAvailable: true,
      diffStatus: "available",
      activityCount: expect.any(Number),
      recommendedAction: "start_work",
      suggestedCommandIntents: expect.arrayContaining([
        "acknowledge_initial_feedback",
        "complete_after_verification",
        "archive_after_decision",
      ]),
      terminalObserved: true,
    }),
  );
  expect(report.followEvent).toEqual(
    expect.objectContaining({
      threadId: report.threadId,
      schemaVersion: 1,
      eventSchema: "commentActivityBatchEvent",
      eventSchemaCommand: expect.arrayContaining([
        "comments",
        "schema",
        "commentActivityBatchEvent",
      ]),
      sessionId: report.work?.sessionId,
      sequence: 2,
      reason: "activity_changed",
      count: expect.any(Number),
      activityTypes: expect.arrayContaining(["comment_added"]),
      summaryKinds: expect.arrayContaining(["human_comment"]),
      externalActivityCount: 1,
      ownActivityCount: 0,
      requiresAttention: true,
      attentionReasons: expect.arrayContaining(["external_human_comment"]),
      recommendedAction: "reconsider_work",
      suggestedCommandIntents: expect.arrayContaining([
        "acknowledge_follow_up",
        "handoff_after_blocked_or_needs_info",
        "complete_after_verification",
        "archive_after_decision",
      ]),
      suggestedCommandSchemas: expect.arrayContaining([
        "commentTriageFileInput",
        "commentResultFileInput",
      ]),
      suggestedSchemaCommands: expect.arrayContaining([
        expect.arrayContaining([
          "comments",
          "schema",
          "commentTriageFileInput",
        ]),
        expect.arrayContaining([
          "comments",
          "schema",
          "commentResultFileInput",
        ]),
      ]),
      commentBodies: [loopFixture.human.followUp?.body],
      sourceAvailable: true,
      diffStatus: "available",
    }),
  );
  expect(report.triage).toEqual(
    expect.objectContaining({
      decision: "accepted",
      summary: loopFixture.agent.triage?.summary,
      nextAction: loopFixture.agent.triage?.nextAction,
      commentId: expect.any(String),
      body: expect.stringContaining("Triage: accepted"),
    }),
  );
  expect(report.triageEvent).toEqual(
    expect.objectContaining({
      threadId: report.threadId,
      activityTypes: expect.arrayContaining(["comment_added"]),
      summaryKinds: expect.arrayContaining([
        "triage_comment",
        "own_triage_comment",
      ]),
      ownTriageCommentCount: 1,
      externalTriageCommentCount: 0,
      requiresAttention: false,
      recommendedAction: "ignore_own_activity",
      suggestedCommandIntents: [],
      commentBodies: [expect.stringContaining("Triage: accepted")],
    }),
  );
  expect(report.terminalResult).toEqual(
    expect.objectContaining({
      outcome: "resolved",
      summary: loopFixture.agent.result?.summary,
      verification: loopFixture.agent.result?.verification,
      body: expect.stringContaining("Result: resolved"),
    }),
  );
  expect(report.stages.map((stage) => stage.stage)).toEqual([
    "wait",
    "seed",
    "read",
    "follow",
    "triage",
    "reply",
    "terminal",
    "work",
    "verify",
  ]);
  expect(report.activities).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: "thread_claimed",
        actor: expect.objectContaining({ id: "codex:fake-agent-loop" }),
        clientEventId: `${loopFixture.agent.clientEventId}:work`,
        leaseExpiresAt: expect.any(String),
      }),
      expect.objectContaining({
        type: "comment_added",
        actor: expect.objectContaining({ id: "human:fixture" }),
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
  expect(report.activities).not.toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: "thread_claimed",
        clientEventId: `${loopFixture.agent.clientEventId}:renew`,
      }),
    ]),
  );
}, 30_000);

it("runs the fake agent loop through comments dismiss for archive outcomes", async () => {
  const loopFixture = await loadLocalAgentLoopFixture(
    path.resolve("test/fixtures/agent-loop/archive.json"),
  );
  await server?.close();
  server = await startGoViviServer({
    rootDir: fixture.rootDir,
    dataDir: path.join(fixture.outsideDir, "agent-loop-dismiss-data"),
  });

  const report = await runLocalAgentLoop({
    baseUrl: server!.url,
    fixture: loopFixture,
    intake: "watch",
    watch: goCliWatchOptions({ intervalMs: 25 }),
    terminalTransport: "cli",
    cli: goCliCommentsOptions(),
  });

  expect(report.status).toBe("passed");
  expect(report.terminalTransport).toBe("cli");
  expect(report.terminalStatus).toBe("archived");
  expect(report.terminalResult).toEqual(
    expect.objectContaining({
      outcome: "archived",
      summary: loopFixture.agent.result?.summary,
      verification: loopFixture.agent.result?.verification,
      body: expect.stringContaining("Result: archived"),
    }),
  );
  expect(report.watchEvent).toEqual(
    expect.objectContaining({
      itemCount: 1,
      sourceAvailable: true,
      diffStatus: "available",
      activityCount: expect.any(Number),
    }),
  );
  expect(report.activities).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: "thread_claimed",
        actor: expect.objectContaining({ id: "codex:fake-agent-loop" }),
        clientEventId: `${loopFixture.agent.clientEventId}:claim`,
        leaseExpiresAt: expect.any(String),
      }),
      expect.objectContaining({
        type: "thread_claimed",
        actor: expect.objectContaining({ id: "codex:fake-agent-loop" }),
        clientEventId: `${loopFixture.agent.clientEventId}:renew`,
        leaseExpiresAt: expect.any(String),
      }),
      expect.objectContaining({
        type: "comment_added",
        actor: expect.objectContaining({ id: "codex:fake-agent-loop" }),
      }),
      expect.objectContaining({
        type: "thread_status_changed",
        actor: expect.objectContaining({ id: "codex:fake-agent-loop" }),
        previousStatus: "open",
        status: "archived",
      }),
    ]),
  );
}, 30_000);

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
  const invocation = goCliInvocation([
    input.rootDir,
    "--host",
    "127.0.0.1",
    "--port",
    "0",
  ]);
  const child = spawn(invocation.command, invocation.args, {
    cwd: process.cwd(),
    env: goEnv({ VIVI_DATA_DIR: input.dataDir }),
  });
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

function goCliWatchOptions(input: { intervalMs: number }): {
  intervalMs: number;
  command?: string;
  args?: string[];
} {
  const invocation = goCliInvocation(["comments", "watch"]);
  return {
    intervalMs: input.intervalMs,
    command: invocation.command,
    args: invocation.args,
  };
}

function goCliCommentsOptions(input: { intervalMs?: number } = {}): {
  command?: string;
  args?: string[];
  intervalMs?: number;
} {
  const invocation = goCliInvocation(["comments"]);
  return {
    command: invocation.command,
    args: invocation.args,
    intervalMs: input.intervalMs,
  };
}

function goCliInvocation(args: string[]): { command: string; args: string[] } {
  if (process.env.VIVI_GO_CLI) {
    return { command: process.env.VIVI_GO_CLI, args };
  }
  return { command: "go", args: ["run", "./cli", ...args] };
}

async function warmGoCommentsCli(): Promise<void> {
  const invocation = goCliInvocation(["comments", "--help"]);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(invocation.command, invocation.args, {
      cwd: process.cwd(),
      env: goEnv(),
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(
        new Error(
          `timed out warming Go comments CLI\nstderr:\n${stderr}`,
        ),
      );
    }, 60_000);
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `Go comments CLI warmup failed: code=${code ?? "null"} signal=${signal ?? "null"}\nstderr:\n${stderr}`,
        ),
      );
    });
  });
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
