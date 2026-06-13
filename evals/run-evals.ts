import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NodeFileSystem } from "../src/infra/node-file-system.js";
import { formatLineReference } from "../src/ui/state/code-viewer.js";

interface EvalCase {
  name: string;
  fixture: string;
  expect: {
    containsPaths: string[];
    omitsPaths: string[];
    viewerKinds: Record<string, string>;
    openablePaths?: string[];
    codeReference?: {
      path: string;
      start: number;
      end: number;
      expected: string;
    };
  };
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const evalCase = JSON.parse(
  await readFile(path.join(root, "evals/cases/basic-tree.json"), "utf8"),
) as EvalCase;
const fs = new NodeFileSystem({ rootDir: path.join(root, evalCase.fixture) });
const tree = await fs.readTree();
const flat = flatten(tree.nodes);

for (const expectedPath of evalCase.expect.containsPaths) {
  if (!flat.has(expectedPath))
    throw new Error(`${evalCase.name}: missing ${expectedPath}`);
}
for (const omittedPath of evalCase.expect.omitsPaths) {
  if (flat.has(omittedPath))
    throw new Error(`${evalCase.name}: should omit ${omittedPath}`);
}
for (const [filePath, viewerKind] of Object.entries(
  evalCase.expect.viewerKinds,
)) {
  const node = flat.get(filePath);
  if (!node)
    throw new Error(`${evalCase.name}: missing viewer target ${filePath}`);
  if (node.viewerKind !== viewerKind)
    throw new Error(
      `${evalCase.name}: ${filePath} expected ${viewerKind} got ${node.viewerKind}`,
    );
}

for (const filePath of evalCase.expect.openablePaths ?? []) {
  const payload = await fs.readFile(filePath);
  if (payload.path !== filePath)
    throw new Error(`${evalCase.name}: ${filePath} opened as ${payload.path}`);
  if (payload.truncated)
    throw new Error(`${evalCase.name}: ${filePath} should not be truncated`);
  if (payload.encoding === "none")
    throw new Error(`${evalCase.name}: ${filePath} has no preview content`);
}

if (evalCase.expect.codeReference) {
  const reference = evalCase.expect.codeReference;
  const actual = formatLineReference(reference.path, {
    start: reference.start,
    end: reference.end,
  });
  if (actual !== reference.expected)
    throw new Error(
      `${evalCase.name}: expected code reference ${reference.expected} got ${actual}`,
    );
}

console.log(`eval passed: ${evalCase.name}`);

function flatten(nodes: any[]): Map<string, any> {
  const result = new Map<string, any>();
  const visit = (node: any) => {
    result.set(node.path, node);
    for (const child of node.children ?? []) visit(child);
  };
  for (const node of nodes) visit(node);
  return result;
}
