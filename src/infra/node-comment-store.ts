import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { CommentStorePort } from "../app/contracts.js";
import type {
  CommentListFilters,
  PathlensComment,
} from "../domain/comments.js";

export interface NodeCommentStoreOptions {
  dataDir?: string;
  fileName?: string;
}

export class NodeCommentStore implements CommentStorePort {
  private readonly filePath: string;
  private writeQueue: Promise<unknown> = Promise.resolve();

  constructor(options: NodeCommentStoreOptions = {}) {
    this.filePath = path.join(
      path.resolve(options.dataDir ?? defaultPathlensDataDir()),
      options.fileName ?? "comments.jsonl",
    );
  }

  async listComments(
    filters: CommentListFilters = {},
  ): Promise<PathlensComment[]> {
    const comments = await this.readAll();
    return comments.filter(
      (comment) =>
        (!filters.path || comment.path === filters.path) &&
        (!filters.status || comment.status === filters.status),
    );
  }

  async getComment(id: string): Promise<PathlensComment | null> {
    const comments = await this.readAll();
    return comments.find((comment) => comment.id === id) ?? null;
  }

  async createComment(comment: PathlensComment): Promise<PathlensComment> {
    await this.enqueueWrite(async () => {
      const comments = await this.readAll();
      comments.push(comment);
      await this.writeAll(comments);
    });
    return comment;
  }

  async updateComment(comment: PathlensComment): Promise<PathlensComment> {
    await this.enqueueWrite(async () => {
      const comments = await this.readAll();
      const index = comments.findIndex((item) => item.id === comment.id);
      if (index < 0) throw new Error("comment not found");
      comments[index] = comment;
      await this.writeAll(comments);
    });
    return comment;
  }

  private async readAll(): Promise<PathlensComment[]> {
    try {
      const text = await readFile(this.filePath, "utf8");
      return text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => JSON.parse(line) as PathlensComment);
    } catch (error) {
      if (isMissingFileError(error)) return [];
      throw error;
    }
  }

  private async writeAll(comments: PathlensComment[]): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const body = comments.map((comment) => JSON.stringify(comment)).join("\n");
    const tmpPath = `${this.filePath}.${process.pid}.tmp`;
    await writeFile(tmpPath, body ? `${body}\n` : "", "utf8");
    await rename(tmpPath, this.filePath);
  }

  private enqueueWrite<T>(write: () => Promise<T>): Promise<T> {
    const next = this.writeQueue.then(write, write);
    this.writeQueue = next.catch(() => undefined);
    return next;
  }
}

export function defaultPathlensDataDir(): string {
  if (process.env.PATHLENS_DATA_DIR) return process.env.PATHLENS_DATA_DIR;
  if (existsSync("/data")) return "/data";
  if (process.env.XDG_DATA_HOME)
    return path.join(process.env.XDG_DATA_HOME, "pathlens");
  return path.join(homedir(), ".local", "share", "pathlens");
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
