import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const root = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();
const errors = [];
const workflowsDir = path.join(root, ".github", "workflows");
const sha = /^[0-9a-f]{40}$/;
const trustedActionOwners = new Set(["actions", "github"]);

for (const name of readdirSync(workflowsDir).filter((file) =>
  /\.ya?ml$/.test(file),
)) {
  const relative = `.github/workflows/${name}`;
  const source = readFileSync(path.join(workflowsDir, name), "utf8");
  const lines = source.split(/\r?\n/);

  lines.forEach((line, index) => {
    const match = line.match(/^\s*-?\s*uses:\s*([^\s#]+)(?:\s*#.*)?$/);
    if (!match || match[1].startsWith("./") || match[1].startsWith("docker://"))
      return;
    const separator = match[1].lastIndexOf("@");
    const ref = separator === -1 ? "" : match[1].slice(separator + 1);
    if (!sha.test(ref)) {
      errors.push(
        `${relative}:${index + 1}: action must use a full commit SHA: ${match[1]}`,
      );
    }
    const owner = match[1].slice(0, separator).split("/", 1)[0];
    if (!trustedActionOwners.has(owner)) {
      errors.push(
        `${relative}:${index + 1}: third-party action is not approved: ${match[1]}`,
      );
    }
  });

  if (!/^permissions:\s*(?:\{\}|read-all)\s*$/m.test(source)) {
    errors.push(
      `${relative}: workflow must declare top-level permissions: read-all or {}`,
    );
  }
  if (/pull_request_target\s*:|workflow_run\s*:/.test(source)) {
    errors.push(
      `${relative}: privileged trigger requires an explicit policy exception`,
    );
  }
  if (/permissions:\s*write-all/.test(source)) {
    errors.push(`${relative}: write-all is forbidden`);
  }
  if (
    /\b(?:event\.pull_request\.title|event\.pull_request\.body|head_ref)\s*}}/.test(
      source,
    ) &&
    /run:\s*[>|]/.test(source)
  ) {
    errors.push(
      `${relative}: do not interpolate untrusted GitHub context directly into shell scripts`,
    );
  }
}

const packageJson = JSON.parse(
  readFileSync(path.join(root, "package.json"), "utf8"),
);
for (const section of ["dependencies", "devDependencies"]) {
  for (const [name, version] of Object.entries(packageJson[section] ?? {})) {
    if (version === "latest" || version === "*") {
      errors.push(`package.json: ${section}.${name} must not use ${version}`);
    }
  }
}

const packageLock = JSON.parse(
  readFileSync(path.join(root, "package-lock.json"), "utf8"),
);
for (const [lockPath, meta] of Object.entries(packageLock.packages ?? {})) {
  const name = packageNameFromLockPath(lockPath);
  if (!name || !meta || typeof meta !== "object") continue;
  const version = meta.version;
  if (typeof version !== "string") continue;
  if (name === "js-yaml" && compareVersions(version, "4.2.0") < 0) {
    errors.push(
      `package-lock.json: ${lockPath} uses vulnerable js-yaml ${version}; require >=4.2.0`,
    );
  }
  if (name === "uuid" && vulnerableUuidVersion(version)) {
    errors.push(
      `package-lock.json: ${lockPath} uses vulnerable uuid ${version}; require a patched release`,
    );
  }
}

function packageNameFromLockPath(lockPath) {
  const marker = "node_modules/";
  const index = lockPath.lastIndexOf(marker);
  if (index === -1) return null;
  const parts = lockPath.slice(index + marker.length).split("/");
  return parts[0]?.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

function vulnerableUuidVersion(version) {
  return (
    compareVersions(version, "11.1.1") < 0 ||
    (compareVersions(version, "12.0.0") >= 0 &&
      compareVersions(version, "12.0.1") < 0) ||
    (compareVersions(version, "13.0.0") >= 0 &&
      compareVersions(version, "13.0.1") < 0)
  );
}

function compareVersions(left, right) {
  const leftParts = parseVersion(left);
  const rightParts = parseVersion(right);
  for (let index = 0; index < 3; index += 1) {
    const delta = leftParts[index] - rightParts[index];
    if (delta !== 0) return delta;
  }
  return 0;
}

function parseVersion(version) {
  return version
    .split("-", 1)[0]
    .split(".")
    .slice(0, 3)
    .map((part) => Number.parseInt(part, 10) || 0);
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log("supply-chain policy: ok");
}
