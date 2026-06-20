import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const modulePrefix = "github.com/tasuku43/vivi/";
const rules = [
  { from: "server/graphql", forbidden: "server/http" },
  { from: "server/http", forbidden: "server/graphql", optional: true },
  { from: "server/application", forbidden: "server/http" },
  { from: "server/application", forbidden: "server/graphql" },
  { from: "server", forbidden: "cli", shallow: true },
];

async function sourceFiles(directory, shallow = false) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  return (
    await Promise.all(
      entries.map((entry) => {
        const target = path.join(directory, entry.name);
        if (entry.name === "architecture_boundary_test.go") return [];
        if (entry.isDirectory()) return shallow ? [] : sourceFiles(target);
        return /\.(?:go|go\.fixture)$/.test(entry.name) ? [target] : [];
      }),
    )
  ).flat();
}

async function violations(directory, forbidden, options = {}) {
  const result = [];
  for (const file of await sourceFiles(directory, options.shallow)) {
    const source = await readFile(file, "utf8");
    if (source.includes(`"${modulePrefix}${forbidden}"`)) result.push(file);
  }
  return result;
}

for (const rule of rules) {
  const found = await violations(path.join(root, rule.from), rule.forbidden, rule);
  if (found.length) {
    throw new Error(`${rule.from} must not import ${rule.forbidden}: ${found.join(", ")}`);
  }
}

const fixtures = [
  ["graphql-imports-http.go.fixture", "server/http"],
  ["http-imports-graphql.go.fixture", "server/graphql"],
  ["application-imports-transport.go.fixture", "server/http"],
  ["server-imports-cli.go.fixture", "cli"],
];
const fixtureRoot = path.join(root, "scripts/fixtures/server-architecture");
for (const [name, forbidden] of fixtures) {
  const found = await violations(fixtureRoot, forbidden);
  if (!found.some((file) => file.endsWith(name))) {
    throw new Error(`architecture fixture was not rejected: ${name}`);
  }
}

console.log(
  `server architecture boundaries passed; rejected ${fixtures.length} intentional import violations`,
);
