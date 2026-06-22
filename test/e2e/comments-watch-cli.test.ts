import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
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

it(
  "lets an agent watch the open comments worklist through the CLI",
  async () => {
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
    expect(changed.threads[0]).toMatchObject({
      id: created.createThread.id,
      path: "README.md",
      status: "open",
      comments: [
        expect.objectContaining({ body: "Please review the fixture intro" }),
      ],
    });
    expect(changed.cursor).not.toBe(initial.cursor);

    await expect(watch.done).resolves.toBe(0);
  },
  20_000,
);

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
  const binaryPath =
    process.env.VIVI_GO_CLI ??
    path.resolve(process.platform === "win32" ? "vivi.exe" : "vivi");
  if (existsSync(binaryPath)) {
    return { command: binaryPath, args };
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
