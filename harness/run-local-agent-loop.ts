#!/usr/bin/env node
import path from "node:path";
import {
  loadLocalAgentLoopFixture,
  runLocalAgentLoop,
} from "./local-agent-loop.js";

try {
  const args = process.argv.slice(2);
  const options = {
    url: "",
    fixture: "test/fixtures/agent-loop/basic.json",
    cli: path.resolve("vivi"),
  };
  for (let i = 0; i < args.length; i++) {
    const key = args[i].slice(2);
    if (!["url", "fixture", "cli"].includes(key) || !args[i + 1])
      throw new Error(
        "Usage: npm run harness:agent-loop -- --url <url> [--fixture <path>] [--cli <binary>]",
      );
    options[key as keyof typeof options] = args[++i];
  }
  if (!options.url)
    throw new Error("--url is required; use an isolated fixture workspace");
  console.log(
    JSON.stringify(
      await runLocalAgentLoop({
        baseUrl: options.url,
        fixture: await loadLocalAgentLoopFixture(options.fixture),
        cliPath: options.cli,
      }),
      null,
      2,
    ),
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
