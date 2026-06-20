import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";

export interface StartedServer {
  url: string;
  close(): Promise<void>;
}

export interface StartServerOptions {
  rootDir: string;
  host?: string;
  port?: number;
  allowHtmlScripts?: boolean;
  gitReviewTimeoutMs?: number;
  extraEnv?: Record<string, string>;
}

const defaultStartupTimeoutMs = 10_000;

export async function startViviServer({
  rootDir,
  host = "127.0.0.1",
  port = 0,
  allowHtmlScripts = false,
  gitReviewTimeoutMs,
  extraEnv,
}: StartServerOptions): Promise<StartedServer> {
  if (process.env.VIVI_E2E_BASE_URL) {
    return {
      url: process.env.VIVI_E2E_BASE_URL.replace(/\/+$/, ""),
      async close() {
        return undefined;
      },
    };
  }

  const command = process.env.VIVI_E2E_SERVER_COMMAND ?? process.execPath;
  const args = serverArgs({
    rootDir,
    host,
    port,
    allowHtmlScripts,
    gitReviewTimeoutMs,
  });
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...extraEnv,
      VIVI_GIT_STATUS_TIMEOUT_MS:
        gitReviewTimeoutMs === undefined
          ? process.env.VIVI_GIT_STATUS_TIMEOUT_MS
          : String(gitReviewTimeoutMs),
      VIVI_GIT_STATUS_FALLBACK_TIMEOUT_MS:
        gitReviewTimeoutMs === undefined
          ? process.env.VIVI_GIT_STATUS_FALLBACK_TIMEOUT_MS
          : String(gitReviewTimeoutMs),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  return waitForServerUrl(child);
}

function serverArgs(options: {
  rootDir: string;
  host: string;
  port: number;
  allowHtmlScripts: boolean;
  gitReviewTimeoutMs?: number;
}): string[] {
  const template = process.env.VIVI_E2E_SERVER_ARGS;
  const replacements: Record<string, string> = {
    "{root}": options.rootDir,
    "{host}": options.host,
    "{port}": String(options.port),
  };
  const args = template
    ? (JSON.parse(template) as string[])
    : [
        "--import",
        "tsx",
        "cli/typescript/main.ts",
        "{root}",
        "--host",
        "{host}",
        "--port",
        "{port}",
      ];

  const expanded = args.map((arg) => replacements[arg] ?? arg);
  if (options.allowHtmlScripts) {
    insertAppFlag(expanded, "--allow-html-scripts");
  }
  if (options.gitReviewTimeoutMs !== undefined && template) {
    insertAppFlag(
      expanded,
      "--git-review-timeout",
      `${options.gitReviewTimeoutMs}ms`,
    );
  }
  return expanded;
}

function insertAppFlag(args: string[], flag: string, value?: string): void {
  const insertion = value === undefined ? [flag] : [flag, value];
  const nodeEntrypointIndex = args.findIndex((arg) =>
    arg.endsWith("cli/typescript/main.ts"),
  );
  if (nodeEntrypointIndex >= 0) {
    args.splice(nodeEntrypointIndex + 1, 0, ...insertion);
    return;
  }
  args.unshift(...insertion);
}

function waitForServerUrl(
  child: ChildProcessByStdio<null, Readable, Readable>,
): Promise<StartedServer> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      fail(
        new Error(
          `timed out waiting for Vivi server URL\nstdout:\n${stdout}\nstderr:\n${stderr}`,
        ),
      );
    }, defaultStartupTimeoutMs);

    const cleanup = () => {
      clearTimeout(timer);
      child.stdout.off("data", onStdout);
      child.stderr.off("data", onStderr);
      child.off("exit", onExit);
      child.off("error", fail);
    };

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      child.kill("SIGTERM");
      reject(error);
    };

    const onStdout = (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      const url = /https?:\/\/[^\s]+/.exec(stdout)?.[0];
      if (!url || settled) return;
      settled = true;
      cleanup();
      resolve({
        url,
        close: () => closeChild(child),
      });
    };

    const onStderr = (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    };

    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      fail(
        new Error(
          `Vivi server exited before startup: code=${code ?? "null"} signal=${signal ?? "null"}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
        ),
      );
    };

    child.stdout.on("data", onStdout);
    child.stderr.on("data", onStderr);
    child.once("exit", onExit);
    child.once("error", fail);
  });
}

async function closeChild(
  child: ChildProcessByStdio<null, Readable, Readable>,
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
