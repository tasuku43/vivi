import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const required = [
  "README.md",
  "AGENTS.md",
  "GOALS.md",
  "Makefile",
  "Taskfile.yml",
  "Dockerfile",
  ".dockerignore",
  "package.json",
  "src/cli/main.ts",
  "src/server/http-server.ts",
  "src/app/viewer-service.ts",
  "src/domain/fs-node.ts",
  "src/infra/node-file-system.ts",
  "src/ui/App.tsx",
  "docs/01-product-brief.md",
  "docs/02-requirements.md",
  "docs/03-cli-or-api-contract.md",
  "docs/04-data-model.md",
  "docs/05-evaluation.md",
  "docs/06-implementation-plan.md",
  "docs/07-non-goals.md",
  "docs/08-provider-or-adapter-contracts.md",
  "docs/09-codex-runbook.md",
  "docs/10-agent-context.md",
  "docs/11-agent-evaluation-loop.md",
  "docs/12-full-product-backlog.md",
  "docs/13-test-and-eval-strategy.md",
  "docs/14-architecture.md",
  "evals/cases/basic-tree.json",
  "evals/run-evals.ts",
  "test/domain/path-policy.test.ts",
  "test/e2e/server-contract.test.ts",
  ".github/workflows/ci.yml",
  ".github/workflows/release.yml",
];

const forbiddenFileNames = [
  ["first", "prompt.md"].join("-"),
  ["docs/11", "first", "codex", "prompt.md"].join("-"),
  [".codex/goals/pathlens", "full", "build.md"].join("-"),
];

const errors = [];
for (const file of required) {
  if (!existsSync(path.join(root, file)))
    errors.push(`missing required file: ${file}`);
}
for (const file of forbiddenFileNames) {
  if (existsSync(path.join(root, file)))
    errors.push(`forbidden prompt-like file exists: ${file}`);
}

const releaseWorkflowPath = path.join(root, ".github/workflows/release.yml");
if (existsSync(releaseWorkflowPath)) {
  const releaseWorkflow = readFileSync(releaseWorkflowPath, "utf8");
  const requiredReleaseSnippets = [
    'tags:\n      - "v*.*.*"',
    "RELEASE_TAG:",
    "^v[0-9]+\\.[0-9]+\\.[0-9]+$",
    "type=raw,value=${{ env.RELEASE_TAG }}",
    "type=raw,value=latest",
  ];

  for (const snippet of requiredReleaseSnippets) {
    if (!releaseWorkflow.includes(snippet)) {
      errors.push(
        `release workflow missing expected tag-release behavior: ${snippet}`,
      );
    }
  }
}

const dockerfilePath = path.join(root, "Dockerfile");
if (existsSync(dockerfilePath)) {
  const dockerfile = readFileSync(dockerfilePath, "utf8");
  const requiredDockerSnippets = [
    "GIT_OPTIONAL_LOCKS=0",
    "GIT_CONFIG_KEY_0=safe.directory",
    "GIT_CONFIG_VALUE_0=*",
    "apk add --no-cache git tini",
  ];

  for (const snippet of requiredDockerSnippets) {
    if (!dockerfile.includes(snippet)) {
      errors.push(`Dockerfile missing review-queue runtime support: ${snippet}`);
    }
  }
}

for (const file of walk(root)) {
  const rel = path.relative(root, file).split(path.sep).join("/");
  if (rel.startsWith(".git/") || rel.startsWith("node_modules/")) continue;
  if (statSync(file).isFile()) {
    const text = readFileSync(file, "utf8");
    if (/@(example|localhost)\b/.test(text)) continue;
    if (/@[A-Za-z0-9._%+-]+\.[A-Za-z]{2,}/.test(text)) {
      errors.push(`unexpected email-like token found in ${rel}`);
    }
  }
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log("scaffold validation passed");

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) yield* walk(full);
    else yield full;
  }
}
