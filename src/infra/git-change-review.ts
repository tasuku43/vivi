import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { ChangeReviewPort } from "../app/contracts.js";
import {
  buildAddedFileDiff,
  parseGitPorcelainStatus,
  type ChangeReviewSummary,
  type GitChange,
  type TextDiff,
} from "../domain/change-review.js";
import {
  defaultIgnoredNames,
  isIgnoredPath,
  normalizeRelativePath,
} from "../domain/path-policy.js";

const execFileAsync = promisify(execFile);

export interface GitChangeReviewOptions {
  rootDir: string;
  ignoredNames?: Set<string>;
  maxDiffBytes?: number;
}

export class GitChangeReview implements ChangeReviewPort {
  private readonly rootDir: string;
  private readonly ignoredNames: Set<string>;
  private readonly maxDiffBytes: number;

  constructor(options: GitChangeReviewOptions) {
    this.rootDir = path.resolve(options.rootDir);
    this.ignoredNames = options.ignoredNames ?? defaultIgnoredNames;
    this.maxDiffBytes = options.maxDiffBytes ?? 256 * 1024;
  }

  async readChanges(): Promise<ChangeReviewSummary> {
    const repo = await this.git(["rev-parse", "--show-toplevel"]);
    if (!repo.ok) return { available: false, reason: repo.reason, changes: [] };

    const status = await this.git(["status", "--porcelain=v1", "-z", "--"]);
    if (!status.ok)
      return { available: false, reason: status.reason, changes: [] };

    return {
      available: true,
      changes: parseGitPorcelainStatus(status.stdout).filter((change) =>
        this.isReviewablePath(change.path),
      ),
    };
  }

  async readDiff(relativePath: string): Promise<TextDiff> {
    const resolved = this.resolveInsideRoot(relativePath);
    if (!resolved.ok) return unavailable(relativePath, resolved.reason);

    const changes = await this.readChanges();
    if (!changes.available)
      return unavailable(
        resolved.relativePath,
        changes.reason ?? "Git unavailable",
      );

    const change = changes.changes.find(
      (item) => item.path === resolved.relativePath,
    );
    if (!change)
      return unavailable(
        resolved.relativePath,
        "No uncommitted Git change was found for this file.",
      );

    if (change.status === "added") return this.readAddedDiff(change);
    if (change.status === "deleted" || change.status === "renamed")
      return this.readGitDiff(change.path);
    return this.readGitDiff(change.path);
  }

  private async readGitDiff(relativePath: string): Promise<TextDiff> {
    const diff = await this.git(["diff", "--", relativePath], {
      maxBuffer: this.maxDiffBytes + 64 * 1024,
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
        baseLabel: "HEAD",
        compareLabel: "working tree",
        content: "",
        reason: `Diff exceeds ${formatBytes(this.maxDiffBytes)}.`,
      };
    }
    if (diff.stdout.includes("Binary files "))
      return {
        path: relativePath,
        status: "binary",
        baseLabel: "HEAD",
        compareLabel: "working tree",
        content: "",
        reason: "Binary diff is not shown in pathlens.",
      };
    return {
      path: relativePath,
      status: "available",
      baseLabel: "HEAD",
      compareLabel: "working tree",
      content: diff.stdout,
    };
  }

  private async readAddedDiff(change: GitChange): Promise<TextDiff> {
    const resolved = this.resolveInsideRoot(change.path);
    if (!resolved.ok) return unavailable(change.path, resolved.reason);
    const stat = await fs.stat(resolved.absolutePath);
    if (stat.size > this.maxDiffBytes) {
      return {
        path: change.path,
        status: "too-large",
        baseLabel: "HEAD",
        compareLabel: "working tree",
        content: "",
        reason: `File exceeds ${formatBytes(this.maxDiffBytes)}.`,
      };
    }
    const bytes = await fs.readFile(resolved.absolutePath);
    if (bytes.includes(0))
      return {
        path: change.path,
        status: "binary",
        baseLabel: "HEAD",
        compareLabel: "working tree",
        content: "",
        reason: "Binary diff is not shown in pathlens.",
      };
    return {
      path: change.path,
      status: "available",
      baseLabel: "HEAD",
      compareLabel: "working tree",
      content: buildAddedFileDiff(change.path, bytes.toString("utf8")),
    };
  }

  private resolveInsideRoot(
    input: string,
  ):
    | { ok: true; absolutePath: string; relativePath: string }
    | { ok: false; reason: string } {
    const normalized = normalizeRelativePath(input);
    if (!normalized.ok) return { ok: false, reason: normalized.reason };
    if (!normalized.relativePath)
      return { ok: false, reason: "file path is required" };
    if (!this.isReviewablePath(normalized.relativePath))
      return { ok: false, reason: "path is ignored" };
    const absolutePath = path.resolve(this.rootDir, normalized.relativePath);
    const relativeToRoot = path.relative(this.rootDir, absolutePath);
    if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
      return { ok: false, reason: "path escapes root" };
    }
    return { ok: true, absolutePath, relativePath: normalized.relativePath };
  }

  private isReviewablePath(relativePath: string): boolean {
    return !isIgnoredPath(relativePath, this.ignoredNames);
  }

  private async git(
    args: string[],
    options: { maxBuffer?: number } = {},
  ): Promise<{ ok: true; stdout: string } | { ok: false; reason: string }> {
    try {
      const result = await execFileAsync("git", args, {
        cwd: this.rootDir,
        encoding: "utf8",
        maxBuffer: options.maxBuffer ?? 512 * 1024,
      });
      return { ok: true, stdout: result.stdout };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("not a git repository"))
        return { ok: false, reason: "This workspace is not a Git repository." };
      if (message.includes("maxBuffer"))
        return { ok: false, reason: "Git output exceeded the review limit." };
      return { ok: false, reason: message };
    }
  }
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

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}
