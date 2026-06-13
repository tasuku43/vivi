import { expect, it } from "vitest";
import { parseArgs } from "../src/cli/main.js";

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
    "--no-html-scripts",
  ]);

  expect(args.root).toBe("docs");
  expect(args.host).toBe("127.0.0.1");
  expect(args.port).toBe(5000);
  expect(args.open).toBe(true);
  expect(args.allowHtmlScripts).toBe(false);
  expect(args.includeExtensions).toEqual(new Set(["md", "html", "ts"]));
});
