import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";

const nodeModules = path.join(process.cwd(), "node_modules");
if (existsSync(nodeModules)) {
  writeFileSync(
    path.join(nodeModules, "go.mod"),
    "module vivi-node-modules-boundary\n\ngo 1.22\n",
  );
}
