import { expect, it } from "vitest";
import { helpText, parseArgs } from "../src/cli/main.js";

it("parses documented CLI switches", () => {
  const args = parseArgs([
    "docs",
    "--host",
    "127.0.0.1",
    "--port",
    "5000",
    "--open",
    "--include",
    "md,.html,ts",
    "--max-file-size",
    "2048",
    "--allow-html-scripts",
  ]);

  expect(args.root).toBe("docs");
  expect(args.host).toBe("127.0.0.1");
  expect(args.port).toBe(5000);
  expect(args.open).toBe(true);
  expect(args.allowHtmlScripts).toBe(true);
  expect(args.maxFileSizeBytes).toBe(2048);
  expect(args.includeExtensions).toEqual(new Set(["md", "html", "ts"]));
});

it("keeps HTML scripts disabled unless explicitly allowed", () => {
  expect(parseArgs([]).allowHtmlScripts).toBe(false);
  expect(parseArgs(["--no-html-scripts"]).allowHtmlScripts).toBe(false);
});

it("shows Vivi command help without the old pre-release name", () => {
  const help = helpText();
  expect(help).toContain("vivi - read-only visual workspace viewer");
  expect(help).toContain("vivi [root]");
  expect(help).toContain("--version");
  expect(help).not.toContain(["path", "lens"].join(""));
});
