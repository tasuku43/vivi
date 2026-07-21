import { execFile, type ChildProcess } from "node:child_process";
import { promises as fs, type Stats } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { inflate } from "node:zlib";
import type { ChangeReviewPort } from "../application/contracts.js";
import {
  buildAddedFileDiff,
  buildDeletedFileDiff,
  buildFullFileDiff,
  parseGitPorcelainStatus,
  type ChangeReviewSummary,
  type DiffBaseOption,
  type DiffBaseSummary,
  type GitChange,
  type GitChangeKind,
  type TextDiff,
} from "../domain/change-review.js";
import {
  createPathExcluder,
  defaultIgnoredNames,
  isIgnoredPath,
  normalizeRelativePath,
} from "../domain/path-policy.js";

const inflateAsync = promisify(inflate);
const gitTimeoutReason = "Git command timed out while reading this workspace.";
const gitPartialTimeoutReason =
  "Git untracked scan timed out; showing tracked changes only.";
const defaultGitTimeoutMs = 2_000;
const defaultGitStatusTimeoutMs = 30_000;
const defaultGitStatusFallbackTimeoutMs = 10_000;

export interface GitChangeReviewOptions {
  rootDir: string;
  ignoredNames?: Set<string>;
  includeExtensions?: Set<string>;
  excludePatterns?: string[];
  maxDiffBytes?: number;
  gitCommands?: string[];
  gitTimeoutMs?: number;
  gitStatusTimeoutMs?: number;
  gitStatusFallbackTimeoutMs?: number;
  gitTimeoutCooldownMs?: number;
}

export class GitChangeReview implements ChangeReviewPort {
  private readonly rootDir: string;
  private readonly ignoredNames: Set<string>;
  private readonly includeExtensions?: Set<string>;
  private readonly isExcludedPath: (relativePath: string) => boolean;
  private readonly maxDiffBytes: number;
  private readonly gitCommands: string[];
  private readonly gitTimeoutMs: number;
  private readonly gitStatusTimeoutMs: number;
  private readonly gitStatusFallbackTimeoutMs: number;
  private readonly gitTimeoutCooldownMs: number;
  private readonly activeGitProcesses = new Set<ChildProcess>();
  private readonly activeGitCancels = new Set<() => void>();
  private gitSuppressedUntilMs = 0;
  private stopped = false;

  constructor(options: GitChangeReviewOptions) {
    this.rootDir = path.resolve(options.rootDir);
    this.ignoredNames = options.ignoredNames ?? defaultIgnoredNames;
    this.includeExtensions = options.includeExtensions;
    this.isExcludedPath = createPathExcluder(options.excludePatterns);
    this.maxDiffBytes = options.maxDiffBytes ?? 256 * 1024;
    this.gitCommands = options.gitCommands ?? defaultGitCommands;
    this.gitTimeoutMs =
      options.gitTimeoutMs ??
      readPositiveEnvMs("VIVI_GIT_TIMEOUT_MS") ??
      defaultGitTimeoutMs;
    this.gitStatusTimeoutMs =
      options.gitStatusTimeoutMs ??
      readPositiveEnvMs("VIVI_GIT_STATUS_TIMEOUT_MS") ??
      options.gitTimeoutMs ??
      readPositiveEnvMs("VIVI_GIT_TIMEOUT_MS") ??
      defaultGitStatusTimeoutMs;
    this.gitStatusFallbackTimeoutMs =
      options.gitStatusFallbackTimeoutMs ??
      readPositiveEnvMs("VIVI_GIT_STATUS_FALLBACK_TIMEOUT_MS") ??
      options.gitTimeoutMs ??
      readPositiveEnvMs("VIVI_GIT_TIMEOUT_MS") ??
      Math.min(this.gitStatusTimeoutMs, defaultGitStatusFallbackTimeoutMs);
    this.gitTimeoutCooldownMs = options.gitTimeoutCooldownMs ?? 30_000;
  }

  async readChanges(): Promise<ChangeReviewSummary> {
    if (this.isGitSuppressed()) {
      return {
        available: false,
        reason: gitTimeoutReason,
        changes: [],
      };
    }

    const workspace = await this.resolveGitWorkspace();
    if (!workspace.ok)
      return this.unavailableChanges(
        await this.explainGitFailure(workspace.reason),
      );

    const status = await this.gitStatus();
    if (!status.ok)
      return this.unavailableChanges(
        await this.explainGitFailure(status.reason),
      );

    const workspaceChanges = parseGitPorcelainStatus(status.stdout)
      .map((change) =>
        gitChangeToWorkspaceChange(change, workspace.workspacePrefix),
      )
      .filter((change): change is GitChange => Boolean(change))
      .filter((change) => !this.isHiddenPath(change.path));
    const changes = (
      await Promise.all(
        workspaceChanges.map((change) => this.classifyChange(change)),
      )
    )
      .flat()
      .filter((change) => this.isReviewablePath(change.path))
      .sort((a, b) => a.path.localeCompare(b.path));

    return {
      available: true,
      reason: status.reason,
      changes,
    };
  }

  async readDiffBases(): Promise<DiffBaseSummary> {
    const repo = await this.git(["rev-parse", "--show-toplevel"]);
    if (!repo.ok)
      return {
        available: false,
        reason: await this.explainGitFailure(repo.reason),
        options: [],
      };

    const log = await this.git([
      "log",
      "--max-count=8",
      "--format=%H%x00%h%x00%s%x00",
    ]);
    if (!log.ok)
      return {
        available: false,
        reason: await this.explainGitFailure(log.reason),
        options: [],
      };

    const commits = parseDiffBaseLog(log.stdout);
    return {
      available: true,
      options: [
        { ref: "HEAD", label: "HEAD", subject: commits[0]?.subject },
        ...commits.slice(1).map((commit, index) => ({
          ref: commit.sha,
          label: index === 0 ? "HEAD~1" : commit.shortSha,
          subject: commit.subject,
        })),
      ],
    };
  }

  async stop(): Promise<void> {
    this.stopped = true;
    for (const cancel of this.activeGitCancels) cancel();
    this.activeGitCancels.clear();
    for (const child of this.activeGitProcesses) {
      child.kill("SIGKILL");
      child.unref();
    }
    this.activeGitProcesses.clear();
  }

  async readDiff(relativePath: string, baseRef = "HEAD"): Promise<TextDiff> {
    const resolved = this.resolveInsideRoot(relativePath);
    if (!resolved.ok) return unavailable(relativePath, resolved.reason);
    const base = await this.resolveBaseRef(baseRef);
    if (!base.ok) return unavailable(resolved.relativePath, base.reason);

    const changes = await this.readChanges();
    if (!changes.available && isGitExecutableMissingReason(changes.reason)) {
      return this.readHeadDiffWithoutGit(resolved.relativePath, base.option);
    }
    if (!changes.available)
      return unavailable(
        resolved.relativePath,
        changes.reason ?? "Git unavailable",
      );

    const workspace = await this.resolveGitWorkspace();
    if (!workspace.ok)
      return unavailable(
        resolved.relativePath,
        await this.explainGitFailure(workspace.reason),
      );

    const change = changes.changes.find(
      (item) => item.path === resolved.relativePath,
    );
    if (!change) {
      const kind = await this.diffPathKind(resolved.absolutePath);
      if (kind === "directory" || kind === "embedded-repo") {
        return unavailableForKind(resolved.relativePath, kind);
      }
      return unavailable(
        resolved.relativePath,
        "No uncommitted Git change was found for this file.",
      );
    }

    if (change.status === "added" && base.option.ref === "HEAD")
      return this.readAddedDiff(change, base.option);
    if (change.status === "deleted" || change.status === "renamed")
      return this.readGitDiff(change.path, base.option, workspace);
    return this.readGitDiff(change.path, base.option, workspace);
  }

  private async readGitDiff(
    relativePath: string,
    base: DiffBaseOption,
    workspace: GitWorkspace,
  ): Promise<TextDiff> {
    const args = [
      "diff",
      ...(workspace.workspacePrefix
        ? [`--relative=${workspace.workspacePrefix}`]
        : []),
      "--unified=1000000",
      base.ref,
      "--",
      relativePath,
    ];
    const diff = await this.git(args, {
      maxBuffer: this.maxDiffBytes * 4 + 64 * 1024,
    });
    if (!diff.ok) return unavailable(relativePath, diff.reason);
    if (!diff.stdout.trim())
      return unavailable(
        relativePath,
        "No text diff is available for this file.",
      );
    if (Buffer.byteLength(diff.stdout, "utf8") > this.maxDiffBytes) {
      return {
        path: relativePath,
        status: "too-large",
        baseLabel: base.label,
        compareLabel: "working tree",
        content: "",
        reason: `Diff exceeds ${formatBytes(this.maxDiffBytes)}.`,
      };
    }
    if (diff.stdout.includes("Binary files "))
      return {
        path: relativePath,
        status: "binary",
        baseLabel: base.label,
        compareLabel: "working tree",
        content: "",
        reason: "Binary diff is not shown in Vivi.",
      };
    return {
      path: relativePath,
      status: "available",
      baseLabel: base.label,
      compareLabel: "working tree",
      content: diff.stdout,
    };
  }

  private async readAddedDiff(
    change: GitChange,
    base: DiffBaseOption,
  ): Promise<TextDiff> {
    const resolved = this.resolveInsideRoot(change.path);
    if (!resolved.ok) return unavailable(change.path, resolved.reason);
    const stat = await statFileForDiff(resolved.absolutePath);
    if (stat.ok === false) return unavailable(change.path, stat.reason);
    const fileStat = stat.value;
    if (fileStat.isDirectory()) {
      const kind = await this.diffPathKind(resolved.absolutePath);
      return unavailableForKind(change.path, kind);
    }
    if (fileStat.size > this.maxDiffBytes) {
      return {
        path: change.path,
        status: "too-large",
        baseLabel: base.label,
        compareLabel: "working tree",
        content: "",
        reason: `File exceeds ${formatBytes(this.maxDiffBytes)}.`,
      };
    }
    const bytes = await readFileForDiff(resolved.absolutePath);
    if (bytes.ok === false) return unavailable(change.path, bytes.reason);
    if (bytes.value.includes(0))
      return {
        path: change.path,
        status: "binary",
        baseLabel: base.label,
        compareLabel: "working tree",
        content: "",
        reason: "Binary diff is not shown in Vivi.",
      };
    return {
      path: change.path,
      status: "available",
      baseLabel: base.label,
      compareLabel: "working tree",
      content: buildAddedFileDiff(change.path, bytes.value.toString("utf8")),
    };
  }

  private async resolveBaseRef(
    ref: string,
  ): Promise<
    { ok: true; option: DiffBaseOption } | { ok: false; reason: string }
  > {
    if (ref === "HEAD") {
      return {
        ok: true,
        option: { ref: "HEAD", label: "HEAD" },
      };
    }
    const bases = await this.readDiffBases();
    if (!bases.available)
      return { ok: false, reason: bases.reason ?? "Git base unavailable" };
    const option = bases.options.find((item) => item.ref === ref);
    if (!option)
      return {
        ok: false,
        reason: "Diff base is not an allowed recent commit.",
      };
    return { ok: true, option };
  }

  private resolveInsideRoot(
    input: string,
    applyInclude = true,
  ):
    | { ok: true; absolutePath: string; relativePath: string }
    | { ok: false; reason: string } {
    const normalized = normalizeRelativePath(input);
    if (!normalized.ok) return { ok: false, reason: normalized.reason };
    if (!normalized.relativePath)
      return { ok: false, reason: "file path is required" };
    if (this.isExcludedPath(normalized.relativePath))
      return { ok: false, reason: "path is excluded" };
    if (isIgnoredPath(normalized.relativePath, this.ignoredNames))
      return { ok: false, reason: "path is ignored" };
    if (applyInclude && !this.isIncludedPath(normalized.relativePath))
      return { ok: false, reason: "path is excluded" };
    const absolutePath = path.resolve(this.rootDir, normalized.relativePath);
    const relativeToRoot = path.relative(this.rootDir, absolutePath);
    if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
      return { ok: false, reason: "path escapes root" };
    }
    return { ok: true, absolutePath, relativePath: normalized.relativePath };
  }

  private async resolveGitWorkspace(): Promise<
    ({ ok: true } & GitWorkspace) | { ok: false; reason: string }
  > {
    const repo = await this.git(["rev-parse", "--show-toplevel"], {
      timeoutMs: this.gitStatusTimeoutMs,
    });
    if (!repo.ok) return { ok: false, reason: repo.reason };
    const gitRoot = await realpathOrResolve(repo.stdout.trim());
    const workspaceRoot = await realpathOrResolve(this.rootDir);
    const relativeToGitRoot = path
      .relative(gitRoot, workspaceRoot)
      .split(path.sep)
      .join("/");
    const normalized = normalizeRelativePath(relativeToGitRoot);
    if (
      !normalized.ok ||
      relativeToGitRoot.startsWith("../") ||
      path.isAbsolute(relativeToGitRoot)
    ) {
      return { ok: false, reason: "workspace is outside the Git repository" };
    }
    return {
      ok: true,
      gitRoot,
      workspacePrefix: normalized.relativePath,
    };
  }

  private isReviewablePath(relativePath: string): boolean {
    if (this.isHiddenPath(relativePath)) return false;
    return this.isIncludedPath(relativePath);
  }

  private isIncludedPath(relativePath: string): boolean {
    if (!this.includeExtensions?.size) return true;
    const extension = path
      .extname(relativePath)
      .toLowerCase()
      .replace(/^\./, "");
    return this.includeExtensions.has(extension);
  }

  private isHiddenPath(relativePath: string): boolean {
    return (
      isIgnoredPath(relativePath, this.ignoredNames) ||
      this.isExcludedPath(relativePath)
    );
  }

  private async classifyChange(change: GitChange): Promise<GitChange[]> {
    if (change.status !== "added") return [{ ...change, kind: "file" }];

    const resolved = this.resolveInsideRoot(change.path, false);
    if (!resolved.ok) return [{ ...change, kind: "file" }];
    const link = await symlinkTargetPolicy(resolved.absolutePath, this.rootDir);
    if (link.kind === "external") return [];
    const stat = await statFileForDiff(resolved.absolutePath);
    if (!stat.ok) return [{ ...change, kind: "file" }];
    if (!stat.value.isDirectory()) return [{ ...change, kind: "file" }];

    if (await isEmbeddedGitRepository(resolved.absolutePath)) {
      return [{ ...change, kind: "embedded-repo" }];
    }

    return this.expandUntrackedDirectory(change.path, resolved.absolutePath);
  }

  private async expandUntrackedDirectory(
    relativePath: string,
    absolutePath: string,
  ): Promise<GitChange[]> {
    let entries: Array<{
      name: string;
      isDirectory(): boolean;
      isFile(): boolean;
      isSymbolicLink(): boolean;
    }>;
    try {
      entries = await fs.readdir(absolutePath, { withFileTypes: true });
    } catch {
      return [{ path: relativePath, status: "added", kind: "directory" }];
    }

    const changes: GitChange[] = [];
    for (const entry of entries) {
      const childRelativePath = `${relativePath}/${entry.name}`;
      if (this.isHiddenPath(childRelativePath)) continue;
      const childAbsolutePath = path.join(absolutePath, entry.name);
      if (entry.isSymbolicLink()) {
        const link = await symlinkTargetPolicy(childAbsolutePath, this.rootDir);
        if (link.kind === "external") continue;
      }
      if (entry.isDirectory()) {
        if (await isEmbeddedGitRepository(childAbsolutePath)) {
          changes.push({
            path: childRelativePath,
            status: "added",
            kind: "embedded-repo",
          });
          continue;
        }
        changes.push(
          ...(await this.expandUntrackedDirectory(
            childRelativePath,
            childAbsolutePath,
          )),
        );
        continue;
      }
      if (entry.isFile() || entry.isSymbolicLink()) {
        changes.push({
          path: childRelativePath,
          status: "added",
          kind: "file",
        });
      }
    }
    return changes;
  }

  private async diffPathKind(absolutePath: string): Promise<GitChangeKind> {
    const stat = await statFileForDiff(absolutePath);
    if (!stat.ok || !stat.value.isDirectory()) return "file";
    return (await isEmbeddedGitRepository(absolutePath))
      ? "embedded-repo"
      : "directory";
  }

  private unavailableChanges(reason: string): ChangeReviewSummary {
    if (reason === gitTimeoutReason) {
      this.gitSuppressedUntilMs = Date.now() + this.gitTimeoutCooldownMs;
    }
    return {
      available: false,
      reason,
      changes: [],
    };
  }

  private isGitSuppressed(): boolean {
    return Date.now() < this.gitSuppressedUntilMs;
  }

  private async gitStatus(): Promise<
    | { ok: true; stdout: string; reason?: string }
    | { ok: false; reason: string }
  > {
    const fullStatus = await this.git(
      ["status", "--porcelain=v1", "--untracked-files=all", "-z", "--", "."],
      {
        timeoutMs: this.gitStatusFallbackTimeoutMs,
      },
    );
    if (fullStatus.ok || fullStatus.reason !== gitTimeoutReason) {
      return fullStatus;
    }

    const trackedStatus = await this.git(
      ["status", "--porcelain=v1", "--untracked-files=no", "-z", "--", "."],
      {
        timeoutMs: this.gitStatusTimeoutMs,
      },
    );
    if (!trackedStatus.ok) return trackedStatus;
    return { ...trackedStatus, reason: gitPartialTimeoutReason };
  }

  private async git(
    args: string[],
    options: { maxBuffer?: number; timeoutMs?: number } = {},
  ): Promise<{ ok: true; stdout: string } | { ok: false; reason: string }> {
    let lastError: unknown = null;
    for (const command of this.gitCommands) {
      const result = await this.tryGit(command, args, options);
      if (result.ok) return result;
      lastError = result.error;
      if (!isCommandNotFound(result.error)) {
        return { ok: false, reason: gitErrorReason(result.error) };
      }
    }
    return {
      ok: false,
      reason: gitErrorReason(lastError),
    };
  }

  private async tryGit(
    command: string,
    args: string[],
    options: { maxBuffer?: number; timeoutMs?: number },
  ): Promise<{ ok: true; stdout: string } | { ok: false; error: unknown }> {
    return new Promise((resolve) => {
      if (this.stopped) {
        resolve({ ok: false, error: new GitCommandTimeoutError() });
        return;
      }

      let settled = false;
      let child: ChildProcess | null = null;
      const finish = (
        result: { ok: true; stdout: string } | { ok: false; error: unknown },
      ) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.activeGitCancels.delete(cancel);
        resolve(result);
      };
      const cancel = () => {
        child?.kill("SIGKILL");
        child?.unref();
        finish({ ok: false, error: new GitCommandTimeoutError() });
      };
      this.activeGitCancels.add(cancel);

      const timer = setTimeout(() => {
        cancel();
      }, options.timeoutMs ?? this.gitTimeoutMs);
      timer.unref();

      child = execFile(
        command,
        args,
        {
          cwd: this.rootDir,
          encoding: "utf8",
          killSignal: "SIGKILL",
          maxBuffer: options.maxBuffer ?? 512 * 1024,
        },
        (error, stdout) => {
          if (error) {
            finish({ ok: false, error });
            return;
          }
          finish({ ok: true, stdout });
        },
      );
      this.activeGitProcesses.add(child);
      child.once("close", () => this.activeGitProcesses.delete(child));
      if (this.stopped) {
        child.kill("SIGKILL");
        child.unref();
      }
    });
  }

  private async readHeadDiffWithoutGit(
    relativePath: string,
    base: DiffBaseOption,
  ): Promise<TextDiff> {
    const head = await readHeadBlob(this.rootDir, relativePath);
    if (!head.ok) return unavailable(relativePath, head.reason);
    const resolved = this.resolveInsideRoot(relativePath);
    if (!resolved.ok) return unavailable(relativePath, resolved.reason);

    let workingBytes: Buffer | null = null;
    try {
      workingBytes = await fs.readFile(resolved.absolutePath);
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error
          ? String((error as { code?: unknown }).code)
          : "";
      if (code !== "ENOENT")
        return unavailable(relativePath, fileSystemDiffReason(error));
    }

    const headBytes = head.content;
    if (headBytes.includes(0) || workingBytes?.includes(0)) {
      return {
        path: relativePath,
        status: "binary",
        baseLabel: base.label,
        compareLabel: "working tree",
        content: "",
        reason: "Binary diff is not shown in Vivi.",
      };
    }

    if (!workingBytes) {
      return {
        path: relativePath,
        status: "available",
        baseLabel: base.label,
        compareLabel: "working tree",
        content: buildDeletedFileDiff(relativePath, headBytes.toString("utf8")),
      };
    }

    if (headBytes.equals(workingBytes)) {
      return unavailable(
        relativePath,
        "No uncommitted Git change was found for this file.",
      );
    }

    const totalBytes = headBytes.byteLength + workingBytes.byteLength;
    if (totalBytes > this.maxDiffBytes) {
      return {
        path: relativePath,
        status: "too-large",
        baseLabel: base.label,
        compareLabel: "working tree",
        content: "",
        reason: `Diff exceeds ${formatBytes(this.maxDiffBytes)}.`,
      };
    }

    return {
      path: relativePath,
      status: "available",
      baseLabel: base.label,
      compareLabel: "working tree",
      content: buildFullFileDiff(
        relativePath,
        headBytes.toString("utf8"),
        workingBytes.toString("utf8"),
      ),
    };
  }

  private async explainGitFailure(reason: string): Promise<string> {
    if (
      !reason.includes("not a git repository") &&
      !reason.includes("not a Git repository")
    ) {
      return reason;
    }
    const externalGitDir = await findUnreadableExternalGitDir(this.rootDir);
    if (!externalGitDir) return reason;
    return [
      `Git metadata is referenced outside the served root at ${externalGitDir}, but that path is not mounted or readable.`,
      "If this is a Docker run from a linked Git worktree, also mount the output of `git rev-parse --path-format=absolute --git-common-dir` at the same absolute path.",
    ].join(" ");
  }
}

interface GitWorkspace {
  gitRoot: string;
  workspacePrefix: string;
}

function gitChangeToWorkspaceChange(
  change: GitChange,
  workspacePrefix: string,
): GitChange | null {
  const pathInWorkspace = gitPathToWorkspacePath(change.path, workspacePrefix);
  const originalPathInWorkspace = change.originalPath
    ? gitPathToWorkspacePath(change.originalPath, workspacePrefix)
    : null;

  if (change.status === "renamed") {
    if (pathInWorkspace && originalPathInWorkspace) {
      return {
        path: pathInWorkspace,
        originalPath: originalPathInWorkspace,
        status: "renamed",
      };
    }
    if (pathInWorkspace) return { path: pathInWorkspace, status: "added" };
    if (originalPathInWorkspace)
      return { path: originalPathInWorkspace, status: "deleted" };
    return null;
  }

  if (!pathInWorkspace) return null;
  return { ...change, path: pathInWorkspace };
}

function gitPathToWorkspacePath(
  gitRelativePath: string,
  workspacePrefix: string,
): string | null {
  const normalized = normalizeRelativePath(gitRelativePath);
  if (!normalized.ok || !normalized.relativePath) return null;
  if (!workspacePrefix) return normalized.relativePath;
  const prefix = `${workspacePrefix}/`;
  if (!normalized.relativePath.startsWith(prefix)) return null;
  const relativePath = normalized.relativePath.slice(prefix.length);
  return relativePath || null;
}

function unavailable(pathname: string, reason: string): TextDiff {
  return {
    path: pathname,
    status: "unavailable",
    baseLabel: "HEAD",
    compareLabel: "working tree",
    content: "",
    reason,
  };
}

function unavailableForKind(pathname: string, kind: GitChangeKind): TextDiff {
  if (kind === "embedded-repo") {
    return {
      ...unavailable(
        pathname,
        "Diff is not available because the selected path is an embedded Git repository.",
      ),
      kind,
    };
  }
  if (kind === "directory") {
    return {
      ...unavailable(
        pathname,
        "Diff is not available because the selected path is a directory.",
      ),
      kind,
    };
  }
  return unavailable(pathname, "No text diff is available for this file.");
}

async function statFileForDiff(
  absolutePath: string,
): Promise<{ ok: true; value: Stats } | { ok: false; reason: string }> {
  try {
    return { ok: true, value: await fs.stat(absolutePath) };
  } catch (error) {
    return { ok: false, reason: fileSystemDiffReason(error) };
  }
}

async function readFileForDiff(
  absolutePath: string,
): Promise<{ ok: true; value: Buffer } | { ok: false; reason: string }> {
  try {
    return { ok: true, value: await fs.readFile(absolutePath) };
  } catch (error) {
    return { ok: false, reason: fileSystemDiffReason(error) };
  }
}

async function symlinkTargetPolicy(
  absolutePath: string,
  rootDir: string,
): Promise<{ kind: "not-symlink" | "internal" | "external" }> {
  let stat: Stats;
  try {
    stat = await fs.lstat(absolutePath);
  } catch {
    return { kind: "not-symlink" };
  }
  if (!stat.isSymbolicLink()) return { kind: "not-symlink" };
  try {
    const rootRealPath = await realpathOrResolve(rootDir);
    const targetRealPath = await fs.realpath(absolutePath);
    return isInsidePath(rootRealPath, targetRealPath)
      ? { kind: "internal" }
      : { kind: "external" };
  } catch {
    return { kind: "external" };
  }
}

function isInsidePath(rootDir: string, target: string): boolean {
  const relative = path.relative(rootDir, target);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

export function fileSystemDiffReason(error: unknown): string {
  const code =
    error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code)
      : "";
  if (code === "ENOENT") return "File no longer exists in the working tree.";
  if (code === "EISDIR")
    return "Diff is not available because the selected path is a directory.";
  if (code === "EACCES" || code === "EPERM")
    return "File cannot be read due to filesystem permissions.";
  return "File cannot be read.";
}

async function isEmbeddedGitRepository(absolutePath: string): Promise<boolean> {
  try {
    await fs.stat(path.join(absolutePath, ".git"));
    return true;
  } catch {
    return false;
  }
}

async function realpathOrResolve(pathname: string): Promise<string> {
  try {
    return await fs.realpath(path.resolve(pathname));
  } catch {
    return path.resolve(pathname);
  }
}

function parseDiffBaseLog(
  output: string,
): { sha: string; shortSha: string; subject: string }[] {
  const fields = output.split("\0").filter(Boolean);
  const commits: { sha: string; shortSha: string; subject: string }[] = [];
  for (let index = 0; index + 2 < fields.length; index += 3) {
    commits.push({
      sha: (fields[index] ?? "").trim(),
      shortSha: (fields[index + 1] ?? "").trim(),
      subject: (fields[index + 2] ?? "").trim(),
    });
  }
  return commits.filter((commit) => commit.sha && commit.shortSha);
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export function gitErrorReason(error: unknown): string {
  const code =
    error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code)
      : "";
  const message = error instanceof Error ? error.message : String(error);
  if (isCommandTimedOut(error)) return gitTimeoutReason;
  if (code === "ENOENT" || message.includes("ENOENT"))
    return "Git executable was not found. Install Git or start vivi with Git on PATH.";
  if (message.includes("not a git repository"))
    return "This workspace is not a Git repository.";
  if (message.includes("maxBuffer"))
    return "Git output exceeded the review limit.";
  return message;
}

function isCommandTimedOut(error: unknown): boolean {
  if (error instanceof GitCommandTimeoutError) return true;
  return (
    typeof error === "object" &&
    error !== null &&
    Boolean((error as { killed?: unknown }).killed) &&
    ((error as { signal?: unknown }).signal === "SIGTERM" ||
      (error as { signal?: unknown }).signal === "SIGKILL" ||
      (error as { code?: unknown }).code === "ETIMEDOUT")
  );
}

class GitCommandTimeoutError extends Error {
  constructor() {
    super(gitTimeoutReason);
    this.name = "GitCommandTimeoutError";
  }
}

function isCommandNotFound(error: unknown): boolean {
  return gitErrorReason(error).startsWith("Git executable was not found.");
}

function isGitExecutableMissingReason(reason?: string): boolean {
  return reason?.startsWith("Git executable was not found.") ?? false;
}

function readPositiveEnvMs(name: string): number | undefined {
  const raw = process.env[name];
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

async function findUnreadableExternalGitDir(
  rootDir: string,
): Promise<string | null> {
  const dotGit = path.join(rootDir, ".git");
  try {
    const stat = await fs.stat(dotGit);
    if (!stat.isFile()) return null;
    const content = await fs.readFile(dotGit, "utf8");
    const gitDir = /^gitdir:\s*(.+)$/m.exec(content)?.[1]?.trim();
    if (!gitDir) return null;
    const absoluteGitDir = path.resolve(rootDir, gitDir);
    const relativeToRoot = path.relative(rootDir, absoluteGitDir);
    if (!relativeToRoot.startsWith("..") && !path.isAbsolute(relativeToRoot)) {
      return null;
    }
    try {
      await fs.access(absoluteGitDir);
      return null;
    } catch {
      return absoluteGitDir;
    }
  } catch {
    return null;
  }
}

const defaultGitCommands = [
  "git",
  "/usr/bin/git",
  "/opt/homebrew/bin/git",
  "/usr/local/bin/git",
];

async function readHeadBlob(
  rootDir: string,
  relativePath: string,
): Promise<{ ok: true; content: Buffer } | { ok: false; reason: string }> {
  const gitDir = await resolveGitDir(rootDir);
  if (!gitDir.ok) return gitDir;
  const headCommit = await readHeadCommit(gitDir.path);
  if (!headCommit.ok) return headCommit;
  const commit = await readGitObject(gitDir.path, headCommit.sha);
  if (!commit.ok) return commit;
  if (commit.type !== "commit")
    return { ok: false, reason: "HEAD does not point to a commit." };

  const treeSha = /^tree ([0-9a-f]{40})$/m.exec(
    commit.content.toString("utf8"),
  )?.[1];
  if (!treeSha) return { ok: false, reason: "HEAD commit has no tree." };

  const blobSha = await findBlobInTree(gitDir.path, treeSha, relativePath);
  if (!blobSha.ok) return blobSha;
  const blob = await readGitObject(gitDir.path, blobSha.sha);
  if (!blob.ok) return blob;
  if (blob.type !== "blob")
    return { ok: false, reason: "HEAD path is not a file." };
  return { ok: true, content: blob.content };
}

async function resolveGitDir(
  rootDir: string,
): Promise<{ ok: true; path: string } | { ok: false; reason: string }> {
  const dotGit = path.join(rootDir, ".git");
  try {
    const stat = await fs.stat(dotGit);
    if (stat.isDirectory()) return { ok: true, path: dotGit };
    const content = await fs.readFile(dotGit, "utf8");
    const gitDir = /^gitdir:\s*(.+)$/m.exec(content)?.[1]?.trim();
    if (!gitDir) return { ok: false, reason: "Git metadata was not found." };
    return {
      ok: true,
      path: path.resolve(rootDir, gitDir),
    };
  } catch {
    return { ok: false, reason: "This workspace is not a Git repository." };
  }
}

async function readHeadCommit(
  gitDir: string,
): Promise<{ ok: true; sha: string } | { ok: false; reason: string }> {
  const head = (await fs.readFile(path.join(gitDir, "HEAD"), "utf8")).trim();
  if (/^[0-9a-f]{40}$/.test(head)) return { ok: true, sha: head };
  const ref = /^ref:\s*(.+)$/.exec(head)?.[1]?.trim();
  if (!ref) return { ok: false, reason: "Git HEAD is invalid." };
  const refPath = path.join(gitDir, ref);
  try {
    const sha = (await fs.readFile(refPath, "utf8")).trim();
    if (/^[0-9a-f]{40}$/.test(sha)) return { ok: true, sha };
  } catch {
    const packed = await readPackedRef(gitDir, ref);
    if (packed) return { ok: true, sha: packed };
  }
  return { ok: false, reason: "Git HEAD ref was not found." };
}

async function readPackedRef(
  gitDir: string,
  ref: string,
): Promise<string | null> {
  try {
    const packed = await fs.readFile(path.join(gitDir, "packed-refs"), "utf8");
    for (const line of packed.split(/\r?\n/)) {
      if (line.startsWith("#") || !line.trim()) continue;
      const [sha, name] = line.split(" ");
      if (name === ref && sha && /^[0-9a-f]{40}$/.test(sha)) return sha;
    }
  } catch {
    return null;
  }
  return null;
}

async function readGitObject(
  gitDir: string,
  sha: string,
): Promise<
  { ok: true; type: string; content: Buffer } | { ok: false; reason: string }
> {
  const loosePath = path.join(gitDir, "objects", sha.slice(0, 2), sha.slice(2));
  let inflated: Buffer;
  try {
    inflated = await inflateAsync(await fs.readFile(loosePath));
  } catch {
    return {
      ok: false,
      reason:
        "Git object is packed; Git CLI is required for this repository state.",
    };
  }
  const nul = inflated.indexOf(0);
  if (nul < 0) return { ok: false, reason: "Git object is invalid." };
  const header = inflated.subarray(0, nul).toString("utf8");
  const type = header.split(" ")[0] ?? "";
  return { ok: true, type, content: inflated.subarray(nul + 1) };
}

async function findBlobInTree(
  gitDir: string,
  treeSha: string,
  relativePath: string,
): Promise<{ ok: true; sha: string } | { ok: false; reason: string }> {
  const segments = relativePath.split("/").filter(Boolean);
  let currentTree = treeSha;

  for (let index = 0; index < segments.length; index += 1) {
    const tree = await readGitObject(gitDir, currentTree);
    if (!tree.ok) return tree;
    if (tree.type !== "tree")
      return { ok: false, reason: "Git tree is invalid." };
    const entry = parseTreeEntries(tree.content).find(
      (item) => item.name === segments[index],
    );
    if (!entry)
      return {
        ok: false,
        reason: "No committed Git version was found for this file.",
      };
    if (index === segments.length - 1) {
      if (!entry.mode.startsWith("100"))
        return { ok: false, reason: "HEAD path is not a file." };
      return { ok: true, sha: entry.sha };
    }
    currentTree = entry.sha;
  }

  return { ok: false, reason: "file path is required" };
}

function parseTreeEntries(
  content: Buffer,
): { mode: string; name: string; sha: string }[] {
  const entries: { mode: string; name: string; sha: string }[] = [];
  let offset = 0;
  while (offset < content.length) {
    const space = content.indexOf(32, offset);
    const nul = content.indexOf(0, space + 1);
    if (space < 0 || nul < 0 || nul + 21 > content.length) break;
    const mode = content.subarray(offset, space).toString("utf8");
    const name = content.subarray(space + 1, nul).toString("utf8");
    const sha = content.subarray(nul + 1, nul + 21).toString("hex");
    entries.push({ mode, name, sha });
    offset = nul + 21;
  }
  return entries;
}
