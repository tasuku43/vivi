import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface ContractFixture {
  rootDir: string;
  outsideDir: string;
  cleanup(): Promise<void>;
}

export interface LargeFixture {
  rootDir: string;
  fileCount: number;
  cleanup(): Promise<void>;
}

export async function createContractFixture(): Promise<ContractFixture> {
  const parentDir = await mkdtemp(path.join(tmpdir(), "vivi-contract-"));
  const rootDir = path.join(parentDir, "workspace");
  const outsideDir = path.join(parentDir, "outside");
  await mkdir(rootDir, { recursive: true });
  await mkdir(outsideDir, { recursive: true });

  await mkdir(path.join(rootDir, "docs", "nested"), { recursive: true });
  await mkdir(path.join(rootDir, "empty-dir"), { recursive: true });
  await mkdir(path.join(rootDir, "assets"), { recursive: true });
  await mkdir(path.join(rootDir, "node_modules"), { recursive: true });
  await mkdir(path.join(rootDir, ".cache"), { recursive: true });

  await writeFile(
    path.join(rootDir, "README.md"),
    "# Vivi Fixture\n\n## Overview\n\nContract workspace\n",
  );
  await writeFile(path.join(rootDir, "docs", "guide.md"), "# Guide\n");
  await writeFile(
    path.join(rootDir, "docs", "nested", "note.txt"),
    "nested note\n",
  );
  await writeFile(
    path.join(rootDir, "index.html"),
    [
      "<!doctype html>",
      "<html><head><title>Fixture</title></head>",
      "<body>",
      "<h1>HTML Fixture</h1>",
      "<script>window.viviScriptRan = true;</script>",
      "</body></html>",
      "",
    ].join("\n"),
  );
  await writeFile(path.join(rootDir, "src.ts"), "export const value = 1;\n");
  await writeFile(
    path.join(rootDir, "agent-output"),
    "status=ok\nnext=review\n",
  );
  await writeFile(
    path.join(rootDir, "agent-cache"),
    Buffer.from([0x00, 0x01, 0x02, 0x03]),
  );
  await writeFile(path.join(rootDir, ".hidden.txt"), "hidden text\n");
  await writeFile(
    path.join(rootDir, "large.log"),
    `${"0123456789".repeat(300_000)}\n`,
  );
  await writeFile(
    path.join(rootDir, "assets", "pixel.png"),
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1]),
  );
  await writeFile(
    path.join(rootDir, "node_modules", "ignored.js"),
    "ignored\n",
  );
  await writeFile(path.join(rootDir, ".cache", "ignored.txt"), "ignored\n");
  await writeFile(path.join(outsideDir, "secret.txt"), "outside\n");
  await writeFile(path.join(rootDir, "deleted.md"), "# Deleted\n");

  await symlink("README.md", path.join(rootDir, "readme-link.md"));
  await symlink(
    path.join(outsideDir, "secret.txt"),
    path.join(rootDir, "outside-link.txt"),
  );

  await git(rootDir, "init");
  await git(rootDir, "config", "user.email", "vivi@example.test");
  await git(rootDir, "config", "user.name", "Vivi Contract");
  await git(
    rootDir,
    "add",
    "README.md",
    "docs/guide.md",
    "src.ts",
    "deleted.md",
  );
  await git(rootDir, "commit", "-m", "initial");

  await writeFile(
    path.join(rootDir, "README.md"),
    "# Vivi Fixture\n\n## Overview\n\nContract workspace changed\n",
  );
  await writeFile(path.join(rootDir, "src.ts"), "export const value = 2;\n");
  await git(rootDir, "add", "src.ts");
  await writeFile(path.join(rootDir, "docs", "guide.md"), "# Guide changed\n");
  await writeFile(path.join(rootDir, "untracked.md"), "# Untracked\n");
  await unlink(path.join(rootDir, "deleted.md"));

  return {
    rootDir,
    outsideDir,
    cleanup: () => rm(parentDir, { recursive: true, force: true }),
  };
}

async function git(cwd: string, ...args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd });
}

export async function createLargeFixture(
  options: {
    directories?: number;
    filesPerDirectory?: number;
  } = {},
): Promise<LargeFixture> {
  const directories = options.directories ?? 40;
  const filesPerDirectory = options.filesPerDirectory ?? 50;
  const parentDir = await mkdtemp(path.join(tmpdir(), "vivi-large-"));
  const rootDir = path.join(parentDir, "workspace");
  await mkdir(rootDir, { recursive: true });
  await writeFile(
    path.join(rootDir, "README.md"),
    "# Vivi Large Fixture\n\nGenerated medium workspace.\n",
  );

  let fileCount = 1;
  for (let dirIndex = 0; dirIndex < directories; dirIndex += 1) {
    const dir = path.join(rootDir, `pkg-${String(dirIndex).padStart(3, "0")}`);
    await mkdir(dir, { recursive: true });
    for (let fileIndex = 0; fileIndex < filesPerDirectory; fileIndex += 1) {
      await writeFile(
        path.join(dir, `file-${String(fileIndex).padStart(3, "0")}.ts`),
        `export const value${fileIndex} = ${dirIndex + fileIndex};\n`,
      );
      fileCount += 1;
    }
  }

  await git(rootDir, "init");
  await git(rootDir, "config", "user.email", "vivi@example.test");
  await git(rootDir, "config", "user.name", "Vivi Performance");
  await git(rootDir, "add", "README.md", "pkg-000/file-000.ts");
  await git(rootDir, "commit", "-m", "initial");
  await writeFile(
    path.join(rootDir, "pkg-000", "file-000.ts"),
    "export const value0 = 999;\n",
  );

  return {
    rootDir,
    fileCount,
    cleanup: () => rm(parentDir, { recursive: true, force: true }),
  };
}
