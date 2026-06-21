import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { CommentStorePort } from "../application/contracts.js";
import {
  buildCommentThreads,
  type CommentListFilters,
  type CommentActor,
  type CommentStatus,
  type CommentThread,
  type CommentThreadActivityEvent,
  type ViviComment,
} from "../domain/comments.js";

export interface NodeCommentStoreOptions {
  dataDir?: string;
  fileName?: string;
}

export class NodeCommentStore implements CommentStorePort {
  private readonly filePath: string;
  private readonly threadEventPath: string;
  private writeQueue: Promise<unknown> = Promise.resolve();

  constructor(options: NodeCommentStoreOptions = {}) {
    this.filePath = path.join(
      path.resolve(options.dataDir ?? defaultViviDataDir()),
      options.fileName ?? "comments.jsonl",
    );
    this.threadEventPath = path.join(
      path.dirname(this.filePath),
      "comment-threads.jsonl",
    );
  }

  async listComments(filters: CommentListFilters = {}): Promise<ViviComment[]> {
    const comments = await this.readAll();
    const threads = await this.listCommentThreads();
    const threadById = new Map(threads.map((thread) => [thread.id, thread]));
    return comments
      .filter(
        (comment) =>
          (!filters.path || comment.path === filters.path) &&
          (!filters.status ||
            threadById.get(comment.threadId ?? comment.id)?.status ===
              filters.status),
      )
      .map((comment) => {
        const thread = threadById.get(comment.threadId ?? comment.id);
        return {
          ...comment,
          status: thread?.status ?? comment.status,
          resolvedAt: thread?.resolvedAt,
          archivedAt: thread?.archivedAt,
        };
      });
  }

  async listCommentThreads(
    filters: CommentListFilters = {},
  ): Promise<CommentThread[]> {
    const comments = await this.readAll();
    const projected = new Map(
      buildCommentThreads(comments).map((thread) => [thread.id, thread]),
    );
    for (const event of await this.readThreadEvents()) {
      if (event.type === "thread.created" && event.thread) {
        const legacy = projected.get(event.thread.id);
        projected.set(event.thread.id, {
          ...event.thread,
          comments: legacy?.comments ?? event.thread.comments ?? [],
        });
      } else if (
        event.type === "thread.status_changed" &&
        event.threadId &&
        event.status
      ) {
        const thread = projected.get(event.threadId);
        if (!thread) continue;
        thread.status = event.status;
        thread.updatedAt = event.at ?? thread.updatedAt;
        thread.resolvedAt = event.status === "resolved" ? event.at : undefined;
        thread.archivedAt = event.status === "archived" ? event.at : undefined;
        if (event.status === "open") {
          thread.resolvedAt = undefined;
          thread.archivedAt = undefined;
        }
      }
    }
    return [...projected.values()]
      .map((thread) => ({
        ...thread,
        comments: thread.comments.map((comment) => ({
          ...comment,
          status: thread.status,
          resolvedAt: thread.resolvedAt,
          archivedAt: thread.archivedAt,
        })),
      }))
      .filter(
        (thread) =>
          (!filters.path || thread.path === filters.path) &&
          (!filters.status || thread.status === filters.status),
      );
  }

  async createCommentThread(thread: CommentThread): Promise<CommentThread> {
    await this.appendThreadEvent({
      schemaVersion: 1,
      id: randomUUID(),
      type: "thread.created",
      threadId: thread.id,
      actor: thread.comments[0]?.createdBy,
      at: thread.createdAt,
      thread: { ...thread, comments: [] },
    });
    return thread;
  }

  async updateCommentThreadStatus(
    id: string,
    status: CommentStatus,
    at: string,
  ): Promise<CommentThread> {
    const thread = (await this.listCommentThreads()).find(
      (item) => item.id === id,
    );
    if (!thread) throw new Error("comment thread not found");
    await this.appendThreadEvent({
      schemaVersion: 1,
      id: randomUUID(),
      type: "thread.status_changed",
      threadId: id,
      previousStatus: thread.status,
      actor: { id: "unknown", kind: "unknown" },
      status,
      at,
    });
    return (await this.listCommentThreads()).find((item) => item.id === id)!;
  }

  async listCommentThreadActivities(
    threadId: string,
    after?: string,
    first = 100,
  ): Promise<CommentThreadActivityEvent[]> {
    const events = (await this.readThreadEvents()).map(publicActivityEvent);
    const start = after
      ? events.findIndex((event) => event.id === after) + 1
      : 0;
    return events
      .slice(Math.max(0, start))
      .filter((event) => event.threadId === threadId)
      .slice(0, Math.min(Math.max(first, 1), 500));
  }

  async appendThreadReadActivity(
    threadId: string,
    actor: CommentActor,
    clientEventId?: string,
  ): Promise<CommentThreadActivityEvent> {
    if (
      !(await this.listCommentThreads()).some(
        (thread) => thread.id === threadId,
      )
    ) {
      throw new Error("comment thread not found");
    }
    const existing = clientEventId
      ? (await this.listCommentThreadActivities(threadId, undefined, 500)).find(
          (event) =>
            event.type === "thread_read" &&
            event.actor.id === actor.id &&
            event.clientEventId === clientEventId,
        )
      : undefined;
    if (existing) return existing;
    const event: ThreadEvent = {
      schemaVersion: 1,
      id: randomUUID(),
      type: "thread.read",
      threadId,
      actor,
      clientEventId,
      at: new Date().toISOString(),
    };
    await this.appendThreadEvent(event);
    return publicActivityEvent(event);
  }

  async getComment(id: string): Promise<ViviComment | null> {
    const comments = await this.readAll();
    return comments.find((comment) => comment.id === id) ?? null;
  }

  async createComment(comment: ViviComment): Promise<ViviComment> {
    await this.enqueueWrite(async () => {
      const comments = await this.readAll();
      comments.push(comment);
      await this.writeAll(comments);
    });
    if (comment.threadId && comment.threadId !== comment.id) {
      await this.appendThreadEvent({
        schemaVersion: 1,
        id: randomUUID(),
        type: "comment.added",
        threadId: comment.threadId,
        commentId: comment.id,
        actor: comment.createdBy,
        at: comment.createdAt,
      });
    }
    return comment;
  }

  async updateComment(comment: ViviComment): Promise<ViviComment> {
    await this.enqueueWrite(async () => {
      const comments = await this.readAll();
      const index = comments.findIndex((item) => item.id === comment.id);
      if (index < 0) throw new Error("comment not found");
      comments[index] = comment;
      await this.writeAll(comments);
    });
    await this.appendThreadEvent({
      schemaVersion: 1,
      id: randomUUID(),
      type: "comment.updated",
      threadId: comment.threadId ?? comment.id,
      commentId: comment.id,
      actor: comment.createdBy,
      at: comment.updatedAt,
    });
    return comment;
  }

  private async readAll(): Promise<ViviComment[]> {
    try {
      const text = await readFile(this.filePath, "utf8");
      return text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => JSON.parse(line) as ViviComment)
        .map((comment) => ({
          ...comment,
          source: comment.source ?? "unknown",
        }));
    } catch (error) {
      if (isMissingFileError(error)) return [];
      throw error;
    }
  }

  private async readThreadEvents(): Promise<ThreadEvent[]> {
    try {
      const text = await readFile(this.threadEventPath, "utf8");
      return text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => JSON.parse(line) as ThreadEvent);
    } catch (error) {
      if (isMissingFileError(error)) return [];
      throw error;
    }
  }

  private async appendThreadEvent(event: ThreadEvent): Promise<void> {
    await this.enqueueWrite(async () => {
      const events = await this.readThreadEvents();
      events.push(event);
      await mkdir(path.dirname(this.threadEventPath), { recursive: true });
      await writeFile(
        this.threadEventPath,
        `${events.map((item) => JSON.stringify(item)).join("\n")}\n`,
        "utf8",
      );
    });
  }

  private async writeAll(comments: ViviComment[]): Promise<void> {
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

interface ThreadEvent {
  schemaVersion: 1;
  type:
    | "thread.created"
    | "thread.status_changed"
    | "thread.read"
    | "comment.added"
    | "comment.updated";
  at?: string;
  thread?: CommentThread;
  threadId?: string;
  status?: CommentStatus;
  previousStatus?: CommentStatus;
  commentId?: string;
  clientEventId?: string;
  actor?: CommentActor;
  id?: string;
}

function publicActivityEvent(
  event: ThreadEvent,
  index = 0,
): CommentThreadActivityEvent {
  return {
    id: event.id ?? `legacy-activity-${index}`,
    threadId: event.threadId ?? event.thread?.id ?? "",
    type: event.type.replaceAll(".", "_") as CommentThreadActivityEvent["type"],
    actor: event.actor ?? { id: "unknown", kind: "unknown" },
    commentId: event.commentId,
    previousStatus: event.previousStatus,
    status: event.status,
    clientEventId: event.clientEventId,
    createdAt: event.at ?? event.thread?.createdAt ?? "",
  };
}

export function defaultViviDataDir(): string {
  if (process.env.VIVI_DATA_DIR) return process.env.VIVI_DATA_DIR;
  if (existsSync("/data")) return "/data";
  if (process.env.XDG_DATA_HOME)
    return path.join(process.env.XDG_DATA_HOME, "vivi");
  return path.join(homedir(), ".local", "share", "vivi");
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
