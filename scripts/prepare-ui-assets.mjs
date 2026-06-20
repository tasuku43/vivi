import { copyFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const source = require.resolve("mermaid/dist/mermaid.min.js");
const target = path.join(
  process.cwd(),
  "ui",
  "public",
  "vivi",
  "vendor",
  "mermaid.min.js",
);

await mkdir(path.dirname(target), { recursive: true });
await copyFile(source, target);
