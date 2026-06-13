#!/usr/bin/env node
import path from "node:path";
import { ViewerService } from "../app/viewer-service.js";
import { openBrowser } from "../infra/browser-open.js";
import { GitChangeReview } from "../infra/git-change-review.js";
import { NodeFileSystem } from "../infra/node-file-system.js";
import { NodeWatcher } from "../infra/node-watcher.js";
import { startHttpServer } from "../server/http-server.js";

interface CliOptions {
  root: string;
  host: string;
  port: number;
  open: boolean;
  includeExtensions?: Set<string>;
  allowHtmlScripts: boolean;
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
    else if (arg === "--allow-html-scripts") options.allowHtmlScripts = true;
    else if (arg === "--no-html-scripts") options.allowHtmlScripts = false;
    else if (arg === "--help" || arg === "-h") {
      printHelp();
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
  });
  const watcher = new NodeWatcher({ rootDir });
  const changeReview = new GitChangeReview({ rootDir });
  const service = new ViewerService({ fileSystem, watcher, changeReview });
  const server = await startHttpServer({
    host: options.host,
    port: options.port,
    service,
    allowHtmlScripts: options.allowHtmlScripts,
  });
  console.log(`pathlens serving ${rootDir}`);
  console.log(server.url);
  installShutdownHandlers(server);
  if (options.open) {
    await openBrowser(server.url);
  }
}

export function installShutdownHandlers(
  server: ClosableServer,
  shutdownProcess: ShutdownProcess = process,
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
    console.log(`\npathlens received ${signal}; shutting down...`);
    void server
      .close()
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

function exitCodeForSignal(signal: NodeJS.Signals): number {
  return signal === "SIGINT" ? 130 : 143;
}

function printHelp(): void {
  console.log(
    `pathlens - live local viewer for Markdown, HTML, code, and assets\n\nUsage:\n  pathlens [root] [--host 127.0.0.1] [--port 4317] [--open] [--include md,html,ts] [--allow-html-scripts]\n`,
  );
}

function parseInclude(value: string): Set<string> {
  return new Set(
    value
      .split(",")
      .map((item) => item.trim().toLowerCase().replace(/^\./, ""))
      .filter(Boolean),
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
