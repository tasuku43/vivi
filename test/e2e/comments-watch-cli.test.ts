import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  createContractFixture,
  type ContractFixture,
} from "./support/fixture-workspace.js";

interface WatchEvent {
  type: string;
  reason: string;
  changes: string[];
  cursor: string;
  count: number;
  threads: Array<{
    id: string;
    path: string;
    status: string;
    comments: Array<{ body: string }>;
  }>;
  items?: Array<{
    thread: { id: string; path: string; status: string };
    file?: { path: string; viewerKind: string; encoding: string };
    source?: {
      path: string;
      available: boolean;
      lines?: Array<{ number: number; text: string; anchor: boolean }>;
    };
    diff?: { path: string; status: string; content?: string };
    activities?: Array<{ type: string; clientEventId?: string }>;
  }>;
}

interface NextCommentPayload {
  thread: { id: string; path: string; status: string } | null;
  count: number;
  remaining: number;
  summary?: {
    recommendedAction: string;
    openThreadCount: number;
    unclaimedCount: number;
    claimedByOthersCount: number;
    suggestedCommands?: Array<{ command: string; args: string[] }>;
  };
  file?: { path: string; viewerKind: string; encoding: string } | null;
  source?: {
    path: string;
    available: boolean;
    reason?: string;
    lines?: Array<{ number: number; text: string; anchor: boolean }>;
  } | null;
  diff?: { path: string; status: string; reason?: string } | null;
}

interface ClaimCommentPayload {
  thread: { id: string; path: string; status: string } | null;
  claim: { type: string; actor: { id: string }; clientEventId?: string } | null;
  count: number;
  remaining: number;
  summary: {
    recommendedAction: string;
    openThreadCount: number;
    mineCount: number;
    unclaimedCount: number;
    claimedByOthersCount: number;
    suggestedCommands?: Array<{ command: string; args: string[] }>;
  };
}

interface InboxCommentPayload {
  count: number;
  summary: {
    recommendedAction: string;
    openThreadCount: number;
    unclaimedCount: number;
    suggestedCommands?: Array<{ command: string; args: string[] }>;
  };
  unclaimed: {
    count: number;
    threads: Array<{ id: string; path: string; status: string }>;
  };
  sourceUnavailable: {
    count: number;
    threads: Array<{ id: string; path: string; status: string }>;
  };
}

let fixture: ContractFixture;
let server: GoProcessServer | null = null;

beforeEach(async () => {
  fixture = await createContractFixture();
});

afterEach(async () => {
  await server?.close();
  server = null;
  await fixture.cleanup();
});

it("lets an agent watch the open comments worklist through the CLI", async () => {
  server = await startGoViviServer({
    rootDir: fixture.rootDir,
    dataDir: path.join(fixture.outsideDir, "watch-cli-data"),
  });
  const watch = startGoCommentsWatch(server.url);

  const initial = await watch.nextEvent();
  expect(initial).toMatchObject({
    type: "comments_open_worklist",
    reason: "initial",
    count: 0,
    threads: [],
  });

  const created = await graphql<{
    createThread: { id: string };
  }>(server.url, {
    operationName: "CreateThread",
    query: `mutation CreateThread($input: CommentInput!) {
        createThread(input: $input) { id }
      }`,
    variables: {
      input: {
        path: "README.md",
        body: "Please review the fixture intro",
        actor: {
          id: "human:tasuku",
          kind: "human",
          displayName: "Tasuku",
        },
        anchor: {
          surface: "source",
          canonical: {
            path: "README.md",
            lineStart: 1,
            lineEnd: 1,
            quote: "# Vivi Fixture",
          },
        },
      },
    },
  });

  const changed = await watch.nextEvent();
  expect(changed.count).toBe(1);
  expect(changed.changes).toContain("open_thread_added");
  expect(changed).toMatchObject({
    schemaVersion: 1,
    eventSchema: "commentOpenWorklistEvent",
    eventSchemaCommand: expect.arrayContaining([
      "comments",
      "schema",
      "commentOpenWorklistEvent",
    ]),
    summary: expect.objectContaining({
      recommendedAction: "claim_open_work",
      openThreadCount: 1,
      suggestedCommands: expect.arrayContaining([
        expect.objectContaining({
          intent: "claim_next_open_thread",
          command: "comments work",
          clientEventId: expect.stringContaining("watch:"),
          args: expect.arrayContaining([
            "comments",
            "work",
            "--client-event-id",
            "--full",
          ]),
        }),
      ]),
    }),
  });
  expect(changed.threads[0]).toMatchObject({
    id: created.createThread.id,
    path: "README.md",
    status: "open",
    comments: [
      expect.objectContaining({ body: "Please review the fixture intro" }),
    ],
  });
  expect(changed.items).toHaveLength(1);
  expect(changed.items?.[0]).toMatchObject({
    thread: {
      id: created.createThread.id,
      path: "README.md",
      status: "open",
    },
    file: {
      path: "README.md",
      viewerKind: "markdown",
      encoding: "utf8",
    },
    source: {
      path: "README.md",
      available: true,
    },
    diff: {
      path: "README.md",
      status: "available",
    },
  });
  expect(changed.items?.[0]?.source?.lines?.some((line) => line.anchor)).toBe(
    true,
  );
  expect(changed.items?.[0]?.diff?.content).toContain(
    "Contract workspace changed",
  );
  expect(changed.items?.[0]?.activities).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: "thread_read",
        clientEventId: `comments-watch:${changed.cursor}`,
      }),
    ]),
  );
  expect(changed.cursor).not.toBe(initial.cursor);

  await expect(watch.done).resolves.toBe(0);
}, 20_000);

it("skips stale threads whose files no longer exist when selecting next full work", async () => {
  server = await startGoViviServer({
    rootDir: fixture.rootDir,
    dataDir: path.join(fixture.outsideDir, "next-cli-data"),
  });
  const stalePath = path.join(fixture.rootDir, "stale.md");
  await writeFile(stalePath, "# Stale\n\nTemporary review target\n");
  const stale = await graphql<{ createThread: { id: string } }>(server.url, {
    operationName: "CreateThread",
    query: `mutation CreateThread($input: CommentInput!) {
      createThread(input: $input) { id }
    }`,
    variables: {
      input: {
        path: "stale.md",
        body: "This old thread points at a file that disappeared",
        actor: { id: "human:tasuku", kind: "human", displayName: "Tasuku" },
        anchor: {
          surface: "source",
          canonical: {
            path: "stale.md",
            lineStart: 1,
            lineEnd: 1,
            quote: "# Stale",
          },
        },
      },
    },
  });
  await unlink(stalePath);

  const live = await graphql<{ createThread: { id: string } }>(server.url, {
    operationName: "CreateThread",
    query: `mutation CreateThread($input: CommentInput!) {
      createThread(input: $input) { id }
    }`,
    variables: {
      input: {
        path: "README.md",
        body: "Please review the live file",
        actor: { id: "human:tasuku", kind: "human", displayName: "Tasuku" },
        anchor: {
          surface: "source",
          canonical: {
            path: "README.md",
            lineStart: 1,
            lineEnd: 1,
            quote: "# Vivi Fixture",
          },
        },
      },
    },
  });

  const next = await runGoCommentsNext(server.url);
  expect(next.count).toBe(2);
  expect(next.thread).toMatchObject({
    id: live.createThread.id,
    path: "README.md",
    status: "open",
  });
  expect(next.thread?.id).not.toBe(stale.createThread.id);
  expect(next.file).toMatchObject({
    path: "README.md",
    viewerKind: "markdown",
    encoding: "utf8",
  });
  expect(next.source).toMatchObject({
    path: "README.md",
    available: true,
  });
  expect(next.source?.lines?.some((line) => line.anchor)).toBe(true);
  expect(next.diff).toMatchObject({
    path: "README.md",
    status: "available",
  });
});

it("explains claim contention when all open threads are leased by another actor", async () => {
  server = await startGoViviServer({
    rootDir: fixture.rootDir,
    dataDir: path.join(fixture.outsideDir, "claim-contention-cli-data"),
  });
  const created = await graphql<{ createThread: { id: string } }>(server.url, {
    operationName: "CreateThread",
    query: `mutation CreateThread($input: CommentInput!) {
      createThread(input: $input) { id }
    }`,
    variables: {
      input: {
        path: "README.md",
        body: "Please review before the next pass",
        actor: { id: "human:tasuku", kind: "human", displayName: "Tasuku" },
        anchor: {
          surface: "source",
          canonical: {
            path: "README.md",
            lineStart: 1,
            lineEnd: 1,
            quote: "# Vivi Fixture",
          },
        },
      },
    },
  });

  const firstClaim = await runGoCommentsClaim(server.url, "claude-code:e2e");
  expect(firstClaim.thread).toMatchObject({
    id: created.createThread.id,
    path: "README.md",
    status: "open",
  });
  expect(firstClaim.claim).toMatchObject({
    type: "thread_claimed",
    actor: { id: "claude-code:e2e" },
  });

  const contended = await runGoCommentsClaim(server.url, "codex:e2e");
  expect(contended).toMatchObject({
    thread: null,
    claim: null,
    count: 1,
    remaining: 0,
    summary: {
      recommendedAction: "wait_for_claim_release",
      openThreadCount: 1,
      mineCount: 0,
      unclaimedCount: 0,
      claimedByOthersCount: 1,
    },
  });
  expect(contended.summary.suggestedCommands).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        command: "comments work",
        intent: "start_resident_work_loop",
        primary: true,
        args: expect.arrayContaining([
          "comments",
          "work",
          "--wait",
          "--loop",
          "--idle-events",
        ]),
      }),
    ]),
  );
});

it("excludes stale source-unavailable threads from inbox work routing", async () => {
  server = await startGoViviServer({
    rootDir: fixture.rootDir,
    dataDir: path.join(fixture.outsideDir, "inbox-cli-data"),
  });
  const stalePath = path.join(fixture.rootDir, "stale.md");
  await writeFile(stalePath, "# Stale\n\nTemporary review target\n");
  const stale = await graphql<{ createThread: { id: string } }>(server.url, {
    operationName: "CreateThread",
    query: `mutation CreateThread($input: CommentInput!) {
      createThread(input: $input) { id }
    }`,
    variables: {
      input: {
        path: "stale.md",
        body: "This old thread should not be offered as active work",
        actor: { id: "human:tasuku", kind: "human", displayName: "Tasuku" },
        anchor: {
          surface: "source",
          canonical: {
            path: "stale.md",
            lineStart: 1,
            lineEnd: 1,
            quote: "# Stale",
          },
        },
      },
    },
  });
  await unlink(stalePath);

  const live = await graphql<{ createThread: { id: string } }>(server.url, {
    operationName: "CreateThread",
    query: `mutation CreateThread($input: CommentInput!) {
      createThread(input: $input) { id }
    }`,
    variables: {
      input: {
        path: "README.md",
        body: "Please review the live file",
        actor: { id: "human:tasuku", kind: "human", displayName: "Tasuku" },
        anchor: {
          surface: "source",
          canonical: {
            path: "README.md",
            lineStart: 1,
            lineEnd: 1,
            quote: "# Vivi Fixture",
          },
        },
      },
    },
  });

  const inbox = await runGoCommentsInbox(server.url);
  expect(inbox.count).toBe(2);
  expect(inbox.summary).toMatchObject({
    recommendedAction: "claim_open_work",
    openThreadCount: 1,
    unclaimedCount: 1,
  });
  expect(inbox.unclaimed.count).toBe(1);
  expect(inbox.unclaimed.threads).toEqual([
    expect.objectContaining({
      id: live.createThread.id,
      path: "README.md",
      status: "open",
    }),
  ]);
  expect(inbox.unclaimed.threads[0]?.id).not.toBe(stale.createThread.id);
  expect(inbox.sourceUnavailable).toMatchObject({
    count: 1,
    threads: [
      {
        id: stale.createThread.id,
        path: "stale.md",
        status: "open",
      },
    ],
  });
  expect(inbox.summary.suggestedCommands).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        command: "comments work",
        args: expect.arrayContaining(["--full", "--json"]),
      }),
    ]),
  );
});

async function graphql<T>(
  baseUrl: string,
  payload: {
    operationName: string;
    query: string;
    variables?: Record<string, unknown>;
  },
): Promise<T> {
  const response = await fetch(`${baseUrl}/graphql`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: baseUrl,
    },
    body: JSON.stringify(payload),
  });
  const body = (await response.json()) as {
    data?: T;
    errors?: Array<{ message: string }>;
  };
  if (!response.ok || body.errors?.length || !body.data) {
    throw new Error(
      `GraphQL failed with status ${response.status}: ${JSON.stringify(body)}`,
    );
  }
  return body.data;
}

async function runGoCommentsNext(baseUrl: string): Promise<NextCommentPayload> {
  const invocation = goCliInvocation([
    "comments",
    "next",
    "--url",
    baseUrl,
    "--actor",
    "codex:e2e",
    "--full",
    "--json",
  ]);
  const child = spawn(invocation.command, invocation.args, {
    cwd: process.cwd(),
    env: goEnv(),
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf8");
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once("exit", resolve);
    child.once("error", reject);
  });
  if (code !== 0) {
    throw new Error(
      `comments next exited ${code}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
    );
  }
  return JSON.parse(stdout) as NextCommentPayload;
}

async function runGoCommentsClaim(
  baseUrl: string,
  actor: string,
): Promise<ClaimCommentPayload> {
  const invocation = goCliInvocation([
    "comments",
    "claim",
    "--url",
    baseUrl,
    "--actor",
    actor,
    "--client-event-id",
    `claim-${actor}`,
    "--full",
    "--json",
  ]);
  const child = spawn(invocation.command, invocation.args, {
    cwd: process.cwd(),
    env: goEnv(),
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf8");
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once("exit", resolve);
    child.once("error", reject);
  });
  if (code !== 0) {
    throw new Error(
      `comments claim exited ${code}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
    );
  }
  return JSON.parse(stdout) as ClaimCommentPayload;
}

async function runGoCommentsInbox(
  baseUrl: string,
): Promise<InboxCommentPayload> {
  const invocation = goCliInvocation([
    "comments",
    "inbox",
    "--url",
    baseUrl,
    "--actor",
    "codex:e2e",
    "--json",
  ]);
  const child = spawn(invocation.command, invocation.args, {
    cwd: process.cwd(),
    env: goEnv(),
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf8");
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once("exit", resolve);
    child.once("error", reject);
  });
  if (code !== 0) {
    throw new Error(
      `comments inbox exited ${code}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
    );
  }
  return JSON.parse(stdout) as InboxCommentPayload;
}

interface GoProcessServer {
  url: string;
  close(): Promise<void>;
}

async function startGoViviServer(input: {
  rootDir: string;
  dataDir: string;
}): Promise<GoProcessServer> {
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

function startGoCommentsWatch(baseUrl: string): {
  nextEvent(): Promise<WatchEvent>;
  done: Promise<number | null>;
} {
  const invocation = goCliInvocation([
    "comments",
    "watch",
    "--url",
    baseUrl,
    "--actor",
    "claude-code:e2e",
    "--actor-name",
    "Claude Code",
    "--interval",
    "25ms",
    "--max-events",
    "2",
    "--full",
    "--json",
  ]);
  const child = spawn(invocation.command, invocation.args, {
    cwd: process.cwd(),
    env: goEnv(),
  });
  const events: WatchEvent[] = [];
  const waiters: Array<(event: WatchEvent) => void> = [];
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf8");
    let newline = stdout.indexOf("\n");
    while (newline >= 0) {
      const line = stdout.slice(0, newline).trim();
      stdout = stdout.slice(newline + 1);
      if (line) {
        const event = JSON.parse(line) as WatchEvent;
        const waiter = waiters.shift();
        if (waiter) waiter(event);
        else events.push(event);
      }
      newline = stdout.indexOf("\n");
    }
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });
  return {
    nextEvent() {
      const event = events.shift();
      if (event) return Promise.resolve(event);
      return Promise.race([
        new Promise<WatchEvent>((resolve) => waiters.push(resolve)),
        new Promise<WatchEvent>((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(
                  `timed out waiting for watch event\nstdout:\n${stdout}\nstderr:\n${stderr}`,
                ),
              ),
            10_000,
          ),
        ),
      ]);
    },
    done: new Promise<number | null>((resolve, reject) => {
      child.once("exit", (code) => resolve(code));
      child.once("error", reject);
    }),
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

function goCliInvocation(args: string[]): { command: string; args: string[] } {
  if (process.env.VIVI_GO_CLI) {
    return { command: process.env.VIVI_GO_CLI, args };
  }
  return { command: "go", args: ["run", "./cli", ...args] };
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
