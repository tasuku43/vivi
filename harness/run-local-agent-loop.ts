#!/usr/bin/env node
import path from "node:path";
import {
  AgentLoopStageError,
  loadLocalAgentLoopFixture,
  runLocalAgentLoop,
  writeLocalAgentLoopHtmlReport,
} from "./local-agent-loop.js";

const options = parseArgs(process.argv.slice(2));

try {
  const fixture = await loadLocalAgentLoopFixture(options.fixture);
  const report = await runLocalAgentLoop({
    baseUrl: options.url,
    fixture,
    intake: options.intake,
  });
  if (options.html) {
    await writeLocalAgentLoopHtmlReport(report, options.html);
  }
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  if (error instanceof AgentLoopStageError) {
    console.error(
      JSON.stringify(
        {
          status: "failed",
          failedStage: error.stage,
          message: error.message,
          completedStages: error.completedStages,
        },
        null,
        2,
      ),
    );
  } else {
    console.error(error instanceof Error ? error.message : String(error));
  }
  process.exitCode = 1;
}

function parseArgs(args: string[]): {
  url: string;
  fixture: string;
  html?: string;
  intake?: "query" | "watch";
} {
  let url = process.env.VIVI_URL ?? "http://127.0.0.1:4317";
  let fixture = "test/fixtures/agent-loop/basic.json";
  let html: string | undefined;
  let intake: "query" | "watch" | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--url") url = requiredValue(args, ++index, arg);
    else if (arg === "--fixture") fixture = requiredValue(args, ++index, arg);
    else if (arg === "--html") html = requiredValue(args, ++index, arg);
    else if (arg === "--intake") {
      intake = parseIntake(requiredValue(args, ++index, arg));
    } else throw new Error(`unknown argument ${arg}`);
  }
  return {
    url: url.replace(/\/+$/, ""),
    fixture: path.resolve(fixture),
    html: html ? path.resolve(html) : undefined,
    intake,
  };
}

function requiredValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value) throw new Error(`${flag} requires a value`);
  return value;
}

function parseIntake(value: string): "query" | "watch" {
  if (value === "query" || value === "watch") return value;
  throw new Error(`--intake must be query or watch`);
}
