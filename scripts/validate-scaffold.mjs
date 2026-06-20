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
  "go.mod",
  "cli/main.go",
  "server/server.go",
  "server/workspace/workspace.go",
  "scripts/prepare-go-workspace.mjs",
  "scripts/prepare-ui-assets.mjs",
  "scripts/run-go-build.mjs",
  "scripts/run-go-test.mjs",
  "cli/typescript/main.ts",
  "server/typescript/http/http-server.ts",
  "server/typescript/application/viewer-service.ts",
  "ui/package.json",
  "ui/src/app/App.tsx",
  "ui/src/application/ports/ViviClient.ts",
  "ui/src/infrastructure/vivi-api/restViviClient.ts",
  "ui/src/features/workbench/WorkbenchContainer.tsx",
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
  "docs/15-security-model.md",
  "docs/20-go-backend-design.md",
  "docs/install.md",
  "docs/release/releasing.md",
  "docs/release/homebrew/vivi.rb",
  "SECURITY.md",
  "evals/cases/basic-tree.json",
  "evals/run-evals.ts",
  "test/e2e/api-contract.test.ts",
  "test/domain/path-policy.test.ts",
  "test/e2e/server-contract.test.ts",
  "test/public-surface.test.ts",
  ".github/workflows/ci.yml",
  ".github/workflows/release.yml",
];

const forbiddenFileNames = [
  ["first", "prompt.md"].join("-"),
  ["docs/11", "first", "codex", "prompt.md"].join("-"),
  [".codex/goals/vivi", "full", "build.md"].join("-"),
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
    "release_tag:",
    "^v[0-9]+\\.[0-9]+\\.[0-9]+$",
    "vivi_Darwin_arm64.tar.gz",
    "vivi_Darwin_x86_64.tar.gz",
    "vivi_Linux_arm64.tar.gz",
    "vivi_Linux_x86_64.tar.gz",
    "checksums.txt",
    "go build",
    "actions/attest-build-provenance",
    "draft: false",
    "actions/create-github-app-token",
    "homebrew-tap",
    ".github/scripts/update-homebrew-formula.sh",
  ];

  for (const snippet of requiredReleaseSnippets) {
    if (!releaseWorkflow.includes(snippet)) {
      errors.push(
        `release workflow missing expected tag-release behavior: ${snippet}`,
      );
    }
  }
  const forbiddenReleaseSnippets = [
    "docker/build-push-action",
    "npm publish",
    "NODE_AUTH_TOKEN",
    "container registry",
  ];
  for (const snippet of forbiddenReleaseSnippets) {
    if (releaseWorkflow.toLowerCase().includes(snippet.toLowerCase())) {
      errors.push(
        `release workflow still contains forbidden publish path: ${snippet}`,
      );
    }
  }
}

const dockerfilePath = path.join(root, "Dockerfile");
if (existsSync(dockerfilePath)) {
  const dockerfile = readFileSync(dockerfilePath, "utf8");
  const requiredDockerSnippets = [
    "go build",
    "/app/vivi",
    "GIT_OPTIONAL_LOCKS=0",
    "GIT_CONFIG_KEY_0=safe.directory",
    "GIT_CONFIG_VALUE_0=*",
    "apk add --no-cache ca-certificates git tini",
  ];

  for (const snippet of requiredDockerSnippets) {
    if (!dockerfile.includes(snippet)) {
      errors.push(
        `Dockerfile missing review-queue runtime support: ${snippet}`,
      );
    }
  }
}

const readmePath = path.join(root, "README.md");
if (existsSync(readmePath)) {
  const readme = readFileSync(readmePath, "utf8");
  const installSection = section(readme, "## Install", "## Usage");
  const oldLowerName = ["path", "lens"].join("");
  const oldTitleName = ["Path", "Lens"].join("");
  if (new RegExp(`\\b${oldTitleName}\\b|\\b${oldLowerName}\\b`).test(readme)) {
    errors.push("README still contains legacy product naming");
  }
  if (/\bnpx\b|npm install|docker run/i.test(installSection)) {
    errors.push(
      "README install section still exposes npm or Docker as a general install route",
    );
  }
  for (const snippet of [
    "brew tap tasuku43/tap",
    "brew install vivi",
    "mise use -g github:tasuku43/vivi",
    "GitHub Releases",
  ]) {
    if (!installSection.includes(snippet)) {
      errors.push(
        `README install section missing Vivi install route: ${snippet}`,
      );
    }
  }
}

for (const file of walk(root)) {
  const rel = path.relative(root, file).split(path.sep).join("/");
  if (rel === "vivi") continue;
  if (
    rel.startsWith(".git/") ||
    rel.startsWith("node_modules/") ||
    rel.startsWith(".tmp-go-build-cache/") ||
    rel.startsWith(".tmp-go-mod-cache/") ||
    rel.startsWith("dist/") ||
    rel.startsWith("ui/dist/") ||
    rel.startsWith("ui/storybook-static/") ||
    rel.startsWith("ui/public/vivi/vendor/") ||
    rel.startsWith("coverage/") ||
    rel.startsWith("public/vivi/vendor/")
  ) {
    continue;
  }
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

function section(text, startHeading, endHeading) {
  const start = text.indexOf(startHeading);
  const end = text.indexOf(endHeading, start + startHeading.length);
  if (start < 0 || end < 0) return "";
  return text.slice(start, end);
}

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) yield* walk(full);
    else yield full;
  }
}
