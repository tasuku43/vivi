import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const nodeModules = path.join(process.cwd(), "node_modules");
if (existsSync(nodeModules)) {
  writeFileSync(
    path.join(nodeModules, "go.mod"),
    "module vivi-node-modules-boundary\n\ngo 1.22\n",
  );
}

const uiDist = path.join(process.cwd(), "ui", "dist");
if (!existsSync(uiDist)) {
  mkdirSync(uiDist, { recursive: true });
  writeFileSync(
    path.join(uiDist, "index.html"),
    "<!doctype html><title>Vivi development placeholder</title>\n",
  );
}
