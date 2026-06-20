import { spawnSync } from "node:child_process";
import path from "node:path";

const root = process.cwd();
const eslint = path.join(
  root,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "eslint.cmd" : "eslint",
);
const fixtures = [
  "src/features/architecture-feature-import.violation.ts",
  "src/features/architecture-fetch.violation.ts",
  "src/application/architecture-react.violation.ts",
  "src/domain/architecture-domain-import.violation.ts",
  "src/features/architecture-dto-import.violation.ts",
  "src/features/architecture-graphql-generated.violation.ts",
  "src/application/architecture-graphql-generated.violation.ts",
  "src/domain/architecture-graphql-generated.violation.ts",
  "src/shared/architecture-graphql-generated.violation.ts",
];

for (const fixture of fixtures) {
  const result = spawnSync(eslint, ["--no-ignore", fixture], {
    cwd: path.join(root, "ui"),
    encoding: "utf8",
  });
  if (result.status === 0) {
    throw new Error(`architecture violation was not rejected: ${fixture}`);
  }
  const output = `${result.stdout}\n${result.stderr}`;
  if (!output.includes("no-restricted-")) {
    throw new Error(
      `fixture failed for an unexpected reason: ${fixture}\n${output}`,
    );
  }
}

console.log(
  `architecture lint rejected ${fixtures.length} intentional violations`,
);
