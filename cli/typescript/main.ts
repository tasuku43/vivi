#!/usr/bin/env node
import path from "node:path";
import { ViewerService } from "../../server/typescript/application/viewer-service.js";
import { openBrowser } from "../../server/typescript/infrastructure/browser-open.js";
import { GitChangeReview } from "../../server/typescript/infrastructure/git-change-review.js";
import {
  NodeCommentStore,
  workspaceViviDataDir,
} from "../../server/typescript/infrastructure/node-comment-store.js";
import { NodeReviewLedgerStore } from "../../server/typescript/infrastructure/node-review-ledger-store.js";
import { NodeFileSystem } from "../../server/typescript/infrastructure/node-file-system.js";
import { NodeWatcher } from "../../server/typescript/infrastructure/node-watcher.js";
import { startHttpServer } from "../../server/typescript/http/http-server.js";

interface CliOptions {
  root: string;
  host: string;
  port: number;
  open: boolean;
  includeExtensions?: Set<string>;
  allowHtmlScripts: boolean;
  maxFileSizeBytes?: number;
}

interface ClosableServer {
  close: () => Promise<void>;
}

interface ShutdownProcess {
  on(
    signal: NodeJS.Signals,
    listener: (signal: NodeJS.Signals) => void,
  ): unknown;
  off?(
    signal: NodeJS.Signals,
    listener: (signal: NodeJS.Signals) => void,
  ): unknown;
  removeListener?(
    signal: NodeJS.Signals,
    listener: (signal: NodeJS.Signals) => void,
  ): unknown;
  exit(code?: number): never | void;
}

const shutdownTimeoutMs = 3_000;
export const version = "0.0.0";

export function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    root: ".",
    host: "127.0.0.1",
    port: 4317,
    open: false,
    allowHtmlScripts: false,
  };
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--host") options.host = argv[++i] ?? options.host;
    else if (arg === "--port") options.port = Number(argv[++i] ?? options.port);
    else if (arg === "--open") options.open = true;
    else if (arg === "--include")
      options.includeExtensions = parseInclude(argv[++i] ?? "");
    else if (arg === "--max-file-size")
      options.maxFileSizeBytes = parsePositiveInteger(argv[++i] ?? "");
    else if (arg === "--allow-html-scripts") options.allowHtmlScripts = true;
    else if (arg === "--no-html-scripts") options.allowHtmlScripts = false;
    else if (arg === "--version" || arg === "-v") {
      console.log(version);
      process.exit(0);
    } else if (arg === "--help" || arg === "-h") {
      console.log(helpText());
      process.exit(0);
    } else positional.push(arg);
  }

  if (positional[0]) options.root = positional[0];
  return options;
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const options = parseArgs(argv);
  const rootDir = path.resolve(options.root);
  const fileSystem = new NodeFileSystem({
    rootDir,
    includeExtensions: options.includeExtensions,
    allowHtmlScripts: options.allowHtmlScripts,
    maxFileSizeBytes: options.maxFileSizeBytes,
  });
  const watcher = new NodeWatcher({ rootDir });
  const changeReview = new GitChangeReview({ rootDir });
  const workspaceDataDir = workspaceViviDataDir(rootDir);
  const commentStore = new NodeCommentStore({
    dataDir: workspaceDataDir,
  });
  const reviewLedger = new NodeReviewLedgerStore({
    dataDir: workspaceDataDir,
  });
  const service = new ViewerService({
    fileSystem,
    watcher,
    changeReview,
    commentStore,
    reviewLedger,
  });
  const server = await startHttpServer({
    host: options.host,
    port: options.port,
    service,
    allowHtmlScripts: options.allowHtmlScripts,
  });
  console.log(`Vivi serving ${rootDir}`);
  console.log(server.url);
  installShutdownHandlers(server);
  if (options.open) {
    await openBrowser(server.url);
  }
}

export function installShutdownHandlers(
  server: ClosableServer,
  shutdownProcess: ShutdownProcess = process,
  closeTimeoutMs = shutdownTimeoutMs,
): () => void {
  let closing = false;
  const handlers = new Map<NodeJS.Signals, (signal: NodeJS.Signals) => void>();

  const removeHandlers = () => {
    for (const [signal, handler] of handlers) {
      if (shutdownProcess.off) shutdownProcess.off(signal, handler);
      else shutdownProcess.removeListener?.(signal, handler);
    }
    handlers.clear();
  };

  const shutdown = (signal: NodeJS.Signals) => {
    if (closing) {
      shutdownProcess.exit(exitCodeForSignal(signal));
      return;
    }

    closing = true;
    console.log(`\nVivi received ${signal}; shutting down...`);
    void closeWithDeadline(server, closeTimeoutMs)
      .then(() => {
        removeHandlers();
        shutdownProcess.exit(exitCodeForSignal(signal));
      })
      .catch((error) => {
        console.error(error instanceof Error ? error.message : error);
        removeHandlers();
        shutdownProcess.exit(1);
      });
  };

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    handlers.set(signal, shutdown);
    shutdownProcess.on(signal, shutdown);
  }

  return removeHandlers;
}

function closeWithDeadline(
  server: ClosableServer,
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve();
    }, timeoutMs);

    server.close().then(
      () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      },
      (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function exitCodeForSignal(signal: NodeJS.Signals): number {
  return signal === "SIGINT" ? 130 : 143;
}

export function helpText(): string {
  return [
    "vivi - local review adapter",
    "",
    "Usage:",
    "  vivi [root] [--host 127.0.0.1] [--port 4317] [--open] [--include md,html,ts] [--max-file-size 1048576] [--allow-html-scripts]",
    "",
    "Options:",
    "  --host <host>              Host to bind (default: 127.0.0.1)",
    "  --port <port>              Port to bind (default: 4317, 0 for random)",
    "  --open                     Open the browser after startup",
    "  --include <extensions>     Comma-separated extension allow-list",
    "  --max-file-size <bytes>    Rich preview byte limit",
    "  --allow-html-scripts       Allow scripts in HTML preview for trusted files",
    "  --version                  Print version",
    "  --help                     Show this help",
  ].join("\n");
}

function parseInclude(value: string): Set<string> {
  return new Set(
    value
      .split(",")
      .map((item) => item.trim().toLowerCase().replace(/^\./, ""))
      .filter(Boolean),
  );
}

function parsePositiveInteger(value: string): number | undefined {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
