import { readdirSync, readFileSync, statSync } from "node:fs";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const rootPath = fileURLToPath(root);
const manifestPath = new URL(
  "../ui/src/storybook/storybook-lab.manifest.json",
  import.meta.url,
);
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

const errors = [];
const storyIndex = new Map();
const storyFiles = new Set(manifest.storyFiles ?? []);

for (const storyFile of storyFiles) {
  const url = new URL(`../${storyFile}`, import.meta.url);
  let source = "";
  try {
    source = readFileSync(url, "utf8");
  } catch {
    errors.push(`Missing Storybook file listed in manifest: ${storyFile}`);
    continue;
  }
  const title = source.match(/title:\s*["']([^"']+)["']/)?.[1];
  if (!title) {
    errors.push(`${storyFile} is missing a static Storybook title`);
    continue;
  }
  for (const match of source.matchAll(/^export const ([A-Za-z0-9_]+)/gm)) {
    const storySource = source.slice(match.index ?? 0, nextExportIndex(source, match.index));
    storyIndex.set(`${title}/${match[1]}`, {
      file: storyFile,
      story: match[1],
      title,
      hasPlay:
        new RegExp(`export const ${match[1]}[\\s\\S]*?play\\s*:`).test(
          storySource,
        ) || new RegExp(`${match[1]}\\.play\\s*=`).test(source),
      hasInteractionTag:
        /tags\s*:\s*\[[^\]]*["']interaction["']/.test(storySource) ||
        new RegExp(`${match[1]}\\.tags\\s*=\\s*\\[[^\\]]*["']interaction["']`).test(
          source,
        ),
    });
  }
}

for (const storyFile of storyFilesFromDisk()) {
  if (!storyFiles.has(storyFile)) {
    errors.push(
      `Story file is not listed in storybook-lab.manifest.json: ${storyFile}`,
    );
  }
}

for (const surface of manifest.surfaces ?? []) {
  if (!surface.id || !surface.label || !surface.intent) {
    errors.push(`Every surface needs id, label, and intent: ${surface.id}`);
  }
  if (!surface.requiredStories?.length) {
    errors.push(`Surface ${surface.id} must list requiredStories`);
  }
  for (const storyId of surface.requiredStories ?? []) {
    if (!storyIndex.has(storyId)) {
      errors.push(`Surface ${surface.id} references missing story: ${storyId}`);
    }
  }
  for (const storyId of surface.interactionStories ?? []) {
    const entry = storyIndex.get(storyId);
    if (!entry) {
      errors.push(
        `Surface ${surface.id} references missing interaction story: ${storyId}`,
      );
    } else if (!entry.hasPlay) {
      errors.push(
        `Interaction story ${storyId} must define a Storybook play function`,
      );
    } else if (!entry.hasInteractionTag) {
      errors.push(
        `Interaction story ${storyId} must include tags: ["interaction"]`,
      );
    }
  }
}

if (!manifest.agentWorkflow?.length) {
  errors.push("Manifest must describe the agentWorkflow");
}

if (errors.length) {
  console.error("Storybook lab verification failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(
  `Storybook lab verified: ${storyIndex.size} stories across ${storyFiles.size} files and ${manifest.surfaces.length} product surfaces.`,
);

function nextExportIndex(source, start = 0) {
  const next = source.indexOf("\nexport const ", (start ?? 0) + 1);
  return next < 0 ? source.length : next;
}

function storyFilesFromDisk() {
  const files = [];
  walk(new URL("../ui/src/", import.meta.url));
  return files;

  function walk(dir) {
    for (const entry of readdirSync(dir)) {
      const url = new URL(`${entry}`, dir.href.endsWith("/") ? dir : `${dir}/`);
      const stat = statSync(url);
      if (stat.isDirectory()) {
        walk(new URL(`${entry}/`, dir));
      } else if (entry.endsWith(".stories.tsx")) {
        files.push(relative(rootPath, fileURLToPath(url)));
      }
    }
  }
}
