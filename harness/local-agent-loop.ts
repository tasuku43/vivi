import { spawn, type ChildProcessByStdio } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import type { Readable } from "node:stream";

export type AgentLoopTerminalAction = "resolve" | "archive";
export type AgentKind = "human" | "claude_code" | "codex" | "unknown";
export type AgentLoopIntake = "query" | "watch";

export interface AgentLoopActor {
  id: string;
  kind: AgentKind;
  displayName?: string;
}

export interface LocalAgentLoopFixture {
  name: string;
  human: {
    actor: AgentLoopActor;
    path: string;
    body: string;
    anchor: unknown;
  };
  agent: {
    actor: AgentLoopActor;
    clientEventId: string;
    replyBody: string;
    terminalAction: AgentLoopTerminalAction;
  };
}

export type AgentLoopStage =
  | "watch"
  | "seed"
  | "read"
  | "receipt"
  | "reply"
  | "terminal"
  | "verify";

export interface AgentLoopStageResult {
  stage: AgentLoopStage;
  status: "passed";
  detail: string;
}

export interface LocalAgentLoopReport {
  fixture: string;
  status: "passed";
  intake: AgentLoopIntake;
  threadId: string;
  terminalStatus: "resolved" | "archived";
  watchEvent?: {
    reason: string;
    changes: string[];
    cursor: string;
    count: number;
    threadIds: string[];
  };
  stages: AgentLoopStageResult[];
  activities: Array<{
    type: string;
    actor: AgentLoopActor;
    commentId?: string;
    previousStatus?: string;
    status?: string;
    clientEventId?: string;
  }>;
}

export interface LocalAgentLoopWatchOptions {
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string | undefined>;
  intervalMs?: number;
  timeoutMs?: number;
}

interface CommentsWatchEvent {
  type: string;
  reason: string;
  changes: string[];
  cursor: string;
  count: number;
  threads: Array<{
    id: string;
    status: string;
    comments: Array<{ body: string }>;
  }>;
}

export class AgentLoopStageError extends Error {
  constructor(
    readonly stage: AgentLoopStage,
    message: string,
    readonly completedStages: AgentLoopStageResult[],
    options?: ErrorOptions,
  ) {
    super(`[agent-loop:${stage}] ${message}`, options);
    this.name = "AgentLoopStageError";
  }
}

export async function loadLocalAgentLoopFixture(
  fixturePath: string,
): Promise<LocalAgentLoopFixture> {
  return JSON.parse(
    await readFile(fixturePath, "utf8"),
  ) as LocalAgentLoopFixture;
}

export async function runLocalAgentLoop(input: {
  baseUrl: string;
  fixture: LocalAgentLoopFixture;
  fetch?: typeof fetch;
  intake?: AgentLoopIntake;
  watch?: LocalAgentLoopWatchOptions;
}): Promise<LocalAgentLoopReport> {
  const baseUrl = input.baseUrl.replace(/\/+$/, "");
  const request = input.fetch ?? fetch;
  const intake = input.intake ?? "query";
  const stages: AgentLoopStageResult[] = [];
  let watch: CommentsWatchSession | null = null;
  let deliveredWatchEvent: CommentsWatchEvent | undefined;

  if (intake === "watch") {
    watch = startCommentsWatch({
      baseUrl,
      actor: input.fixture.agent.actor,
      clientEventId: input.fixture.agent.clientEventId,
      options: input.watch,
    });
    await runStage("watch", stages, async () => {
      const event = await watch!.nextEvent();
      assert(
        event.type === "comments_open_worklist",
        `unexpected watch event type ${event.type}`,
      );
      assert(event.count === 0, "watch initial worklist was not empty");
      return {
        value: event,
        detail: `fake agent started comments watch at cursor ${event.cursor}`,
      };
    });
  }

  try {
    const seeded = await runStage("seed", stages, async () => {
      const data = await graphql<{
        createThread: {
          id: string;
          status: string;
          comments: Array<{ body: string }>;
        };
      }>(
        request,
        baseUrl,
        "CreateThread",
        `
          mutation CreateThread($input: CommentInput!) {
            createThread(input: $input) {
              id
              status
              comments {
                body
              }
            }
          }
        `,
        {
          input: {
            path: input.fixture.human.path,
            body: input.fixture.human.body,
            anchor: input.fixture.human.anchor,
            actor: input.fixture.human.actor,
          },
        },
      );
      assert(data.createThread.status === "open", "seeded thread is not open");
      assert(
        data.createThread.comments[0]?.body === input.fixture.human.body,
        "seeded human comment is missing",
      );
      return {
        value: data.createThread,
        detail: `human opened thread ${data.createThread.id}`,
      };
    });

    const read = await runStage("read", stages, async () => {
      if (watch) {
        const event = await watch.nextEvent();
        deliveredWatchEvent = event;
        assert(
          event.type === "comments_open_worklist",
          `unexpected watch event type ${event.type}`,
        );
        assert(
          event.threads.some((thread) => thread.id === seeded.id),
          `open thread ${seeded.id} was not delivered by comments watch`,
        );
        return {
          value: event.threads,
          detail: `fake agent received ${event.count} open thread(s) from comments watch`,
        };
      }

      const data = await graphql<{
        commentThreads: Array<{ id: string; status: string }>;
      }>(
        request,
        baseUrl,
        "ViviCommentThreads",
        `
          query ViviCommentThreads {
            commentThreads(status: open) {
              id
              status
            }
          }
        `,
        {},
        actorHeaders(
          input.fixture.agent.actor,
          input.fixture.agent.clientEventId,
        ),
      );
      assert(
        data.commentThreads.some((thread) => thread.id === seeded.id),
        `open thread ${seeded.id} was not returned to the fake agent`,
      );
      return {
        value: data.commentThreads,
        detail: `fake agent read ${data.commentThreads.length} open thread(s)`,
      };
    });
    void read;

    await runStage("receipt", stages, async () => {
      const activities = await readActivities(request, baseUrl, seeded.id);
      const expectedClientEventId = deliveredWatchEvent
        ? `${input.fixture.agent.clientEventId}:${deliveredWatchEvent.cursor}`
        : input.fixture.agent.clientEventId;
      const receipts = activities.filter(
        (activity) =>
          activity.type === "thread_read" &&
          activity.actor.id === input.fixture.agent.actor.id &&
          activity.clientEventId === expectedClientEventId,
      );
      assert(
        receipts.length === 1,
        `expected one read receipt, got ${receipts.length}`,
      );
      return {
        value: receipts[0],
        detail: `read receipt recorded for ${input.fixture.agent.actor.id}`,
      };
    });

    const reply = await runStage("reply", stages, async () => {
      const data = await graphql<{
        addComment: {
          id: string;
          threadId: string;
          body: string;
          createdBy: AgentLoopActor;
        };
      }>(
        request,
        baseUrl,
        "AddComment",
        `
          mutation AddComment($threadId: ID!, $input: AddCommentInput!) {
            addComment(threadId: $threadId, input: $input) {
              id
              threadId
              body
              createdBy {
                id
                kind
                displayName
              }
            }
          }
        `,
        {
          threadId: seeded.id,
          input: {
            body: input.fixture.agent.replyBody,
            actor: input.fixture.agent.actor,
          },
        },
      );
      assert(
        data.addComment.threadId === seeded.id,
        "reply changed thread identity",
      );
      assert(
        data.addComment.createdBy.id === input.fixture.agent.actor.id,
        "reply actor was not preserved",
      );
      return {
        value: data.addComment,
        detail: `fake agent replied with comment ${data.addComment.id}`,
      };
    });

    const terminalStatus =
      input.fixture.agent.terminalAction === "resolve"
        ? "resolved"
        : "archived";
    await runStage("terminal", stages, async () => {
      const field = `${input.fixture.agent.terminalAction}Thread`;
      const operation = `${capitalize(input.fixture.agent.terminalAction)}Thread`;
      const data = await graphql<
        Record<string, { id: string; status: string }>
      >(
        request,
        baseUrl,
        operation,
        `mutation ${operation}($id: ID!, $actor: CommentActorInput) {
        ${field}(id: $id, actor: $actor) { id status }
      }`,
        { id: seeded.id, actor: input.fixture.agent.actor },
      );
      assert(
        data[field]?.status === terminalStatus,
        `terminal mutation returned ${data[field]?.status ?? "no status"}`,
      );
      return {
        value: data[field],
        detail: `fake agent moved thread to ${terminalStatus}`,
      };
    });

    const activities = await runStage("verify", stages, async () => {
      const [threadData, activityData] = await Promise.all([
        graphql<{
          commentThreads: Array<{
            id: string;
            status: string;
            comments: Array<{ id: string; body: string }>;
          }>;
        }>(
          request,
          baseUrl,
          "ViviCommentThreads",
          `
            query ViviCommentThreads($status: CommentStatus) {
              commentThreads(status: $status) {
                id
                status
                comments {
                  id
                  body
                }
              }
            }
          `,
          { status: terminalStatus },
        ),
        readActivities(request, baseUrl, seeded.id),
      ]);
      const thread = threadData.commentThreads.find(
        (item) => item.id === seeded.id,
      );
      assert(
        thread?.status === terminalStatus,
        "thread did not retain terminal status",
      );
      assert(
        thread.comments.some(
          (comment) =>
            comment.id === reply.id &&
            comment.body === input.fixture.agent.replyBody,
        ),
        "agent reply was not retained on the thread",
      );
      assertActivitySequence(activityData, [
        "thread_created",
        "thread_read",
        "comment_added",
        "thread_status_changed",
      ]);
      const terminalActivity = [...activityData]
        .reverse()
        .find((activity) => activity.type === "thread_status_changed");
      assert(
        terminalActivity?.actor.id === input.fixture.agent.actor.id,
        "terminal lifecycle actor was not preserved",
      );
      return {
        value: activityData,
        detail: "thread, reply, actors, and activity order verified",
      };
    });

    return {
      fixture: input.fixture.name,
      status: "passed",
      intake,
      threadId: seeded.id,
      terminalStatus,
      watchEvent: deliveredWatchEvent
        ? {
            reason: deliveredWatchEvent.reason,
            changes: deliveredWatchEvent.changes,
            cursor: deliveredWatchEvent.cursor,
            count: deliveredWatchEvent.count,
            threadIds: deliveredWatchEvent.threads.map((thread) => thread.id),
          }
        : undefined,
      stages,
      activities,
    };
  } finally {
    await watch?.close();
  }
}

export async function writeLocalAgentLoopHtmlReport(
  report: LocalAgentLoopReport,
  outputPath: string,
): Promise<void> {
  await writeFile(outputPath, renderLocalAgentLoopHtmlReport(report), "utf8");
}

export function renderLocalAgentLoopHtmlReport(
  report: LocalAgentLoopReport,
): string {
  const stages = report.stages
    .map(
      (stage, index) => `
        <li>
          <span class="index">${index + 1}</span>
          <div><strong>${escapeHtml(stage.stage)}</strong><p>${escapeHtml(stage.detail)}</p></div>
          <span class="pass">passed</span>
        </li>`,
    )
    .join("");
  const activities = report.activities
    .map(
      (activity) => `
        <tr>
          <td>${escapeHtml(activity.type)}</td>
          <td>${escapeHtml(activity.actor.id)}</td>
          <td>${escapeHtml(activity.status ?? activity.clientEventId ?? activity.commentId ?? "")}</td>
        </tr>`,
    )
    .join("");
  const watchMetric = report.watchEvent
    ? `<div class="metric"><span>Watch cursor</span><strong>${escapeHtml(report.watchEvent.cursor)}</strong></div>`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Vivi Local Agent Loop</title>
  <style>
    :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, sans-serif; background: #eef1f4; color: #192028; }
    * { box-sizing: border-box; }
    body { margin: 0; }
    main { width: min(980px, calc(100% - 40px)); margin: 36px auto; }
    header { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; border-bottom: 1px solid #c9d0d7; padding-bottom: 20px; }
    h1 { margin: 0; font-size: 30px; letter-spacing: 0; }
    header p { margin: 8px 0 0; color: #5a6570; }
    .status { color: #17663a; font-weight: 700; text-transform: uppercase; }
    .summary { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin: 20px 0 28px; }
    .metric { background: #fff; border: 1px solid #d4d9de; border-radius: 6px; padding: 14px 16px; }
    .metric span { display: block; color: #65717c; font-size: 12px; text-transform: uppercase; }
    .metric strong { display: block; margin-top: 5px; overflow-wrap: anywhere; }
    section { margin-top: 26px; }
    h2 { font-size: 16px; margin: 0 0 10px; }
    ol { list-style: none; margin: 0; padding: 0; background: #fff; border: 1px solid #d4d9de; border-radius: 6px; }
    li { min-height: 62px; display: grid; grid-template-columns: 34px 1fr auto; align-items: center; gap: 12px; padding: 10px 14px; border-bottom: 1px solid #e4e7ea; }
    li:last-child { border-bottom: 0; }
    li p { margin: 3px 0 0; color: #5e6872; font-size: 13px; }
    .index { width: 26px; height: 26px; display: grid; place-items: center; background: #263544; color: #fff; border-radius: 50%; font-size: 12px; }
    .pass { color: #17663a; background: #e4f4e9; border: 1px solid #b8dfc4; border-radius: 999px; padding: 4px 9px; font-size: 12px; }
    table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #d4d9de; }
    th, td { padding: 11px 13px; text-align: left; border-bottom: 1px solid #e4e7ea; font-size: 13px; }
    th { background: #f7f8f9; color: #53606b; font-size: 12px; text-transform: uppercase; }
    @media (max-width: 680px) { main { width: min(100% - 24px, 980px); margin: 20px auto; } header { align-items: flex-start; flex-direction: column; } .summary { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <main>
    <header>
      <div><h1>Vivi Local Agent Loop</h1><p>${escapeHtml(report.fixture)}</p></div>
      <div class="status">${escapeHtml(report.status)}</div>
    </header>
    <div class="summary">
      <div class="metric"><span>Intake</span><strong>${escapeHtml(report.intake)}</strong></div>
      <div class="metric"><span>Thread</span><strong>${escapeHtml(report.threadId)}</strong></div>
      <div class="metric"><span>Terminal state</span><strong>${escapeHtml(report.terminalStatus)}</strong></div>
      <div class="metric"><span>Stages</span><strong>${report.stages.length} / ${report.stages.length} passed</strong></div>
      ${watchMetric}
    </div>
    <section><h2>Loop stages</h2><ol>${stages}</ol></section>
    <section>
      <h2>Recorded activity</h2>
      <table><thead><tr><th>Type</th><th>Actor</th><th>Context</th></tr></thead><tbody>${activities}</tbody></table>
    </section>
  </main>
</body>
</html>`;
}

interface CommentsWatchSession {
  nextEvent(): Promise<CommentsWatchEvent>;
  close(): Promise<void>;
}

function startCommentsWatch(input: {
  baseUrl: string;
  actor: AgentLoopActor;
  clientEventId: string;
  options?: LocalAgentLoopWatchOptions;
}): CommentsWatchSession {
  const timeoutMs = input.options?.timeoutMs ?? 10_000;
  const intervalMs = input.options?.intervalMs ?? 25;
  const baseArgs = input.options?.args ?? ["run", "./cli", "comments", "watch"];
  const args = [
    ...baseArgs,
    "--url",
    input.baseUrl,
    "--actor",
    input.actor.id,
    "--actor-kind",
    input.actor.kind,
    "--client-event-id",
    input.clientEventId,
    "--interval",
    `${intervalMs}ms`,
    "--max-events",
    "2",
    "--json",
  ];
  if (input.actor.displayName) {
    args.push("--actor-name", input.actor.displayName);
  }

  const child = spawn(input.options?.command ?? "go", args, {
    cwd: input.options?.cwd ?? process.cwd(),
    env: { ...process.env, ...input.options?.env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  return createCommentsWatchSession(child, timeoutMs);
}

function createCommentsWatchSession(
  child: ChildProcessByStdio<null, Readable, Readable>,
  timeoutMs: number,
): CommentsWatchSession {
  const events: CommentsWatchEvent[] = [];
  const waiters: Array<{
    resolve: (event: CommentsWatchEvent) => void;
    reject: (error: Error) => void;
  }> = [];
  let stdout = "";
  let stderr = "";
  let closed = false;
  let failure: Error | null = null;

  const fail = (error: Error) => {
    if (failure) return;
    failure = error;
    while (waiters.length > 0) {
      waiters.shift()?.reject(error);
    }
  };

  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf8");
    let newline = stdout.indexOf("\n");
    while (newline >= 0) {
      const line = stdout.slice(0, newline).trim();
      stdout = stdout.slice(newline + 1);
      if (line) {
        try {
          const event = JSON.parse(line) as CommentsWatchEvent;
          const waiter = waiters.shift();
          if (waiter) waiter.resolve(event);
          else events.push(event);
        } catch (error) {
          fail(
            new Error(
              `comments watch emitted invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
            ),
          );
        }
      }
      newline = stdout.indexOf("\n");
    }
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });
  child.once("error", (error) => {
    fail(error);
  });
  child.once("exit", (code, signal) => {
    closed = true;
    if (code !== 0) {
      fail(
        new Error(
          `comments watch exited with code=${code ?? "null"} signal=${signal ?? "null"}\nstderr:\n${stderr}`,
        ),
      );
    }
  });

  return {
    nextEvent() {
      const event = events.shift();
      if (event) return Promise.resolve(event);
      if (failure) return Promise.reject(failure);
      if (closed) {
        return Promise.reject(
          new Error(`comments watch exited before delivering another event`),
        );
      }
      return new Promise<CommentsWatchEvent>((resolve, reject) => {
        let timer: NodeJS.Timeout;
        const waiter = {
          resolve(eventValue: CommentsWatchEvent) {
            clearTimeout(timer);
            resolve(eventValue);
          },
          reject(error: Error) {
            clearTimeout(timer);
            reject(error);
          },
        };
        timer = setTimeout(() => {
          const index = waiters.indexOf(waiter);
          if (index >= 0) waiters.splice(index, 1);
          reject(
            new Error(
              `timed out waiting for comments watch event\nstdout:\n${stdout}\nstderr:\n${stderr}`,
            ),
          );
        }, timeoutMs);
        waiters.push(waiter);
      });
    },
    async close() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          resolve();
        }, 2_000);
        child.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
        child.kill("SIGTERM");
      });
    },
  };
}

async function readActivities(
  request: typeof fetch,
  baseUrl: string,
  threadId: string,
) {
  const data = await graphql<{
    commentThreadActivities: LocalAgentLoopReport["activities"];
  }>(
    request,
    baseUrl,
    "ViviCommentThreadActivities",
    `
      query ViviCommentThreadActivities($threadId: ID!) {
        commentThreadActivities(threadId: $threadId, first: 100) {
          type
          actor {
            id
            kind
            displayName
          }
          commentId
          previousStatus
          status
          clientEventId
        }
      }
    `,
    { threadId },
  );
  return data.commentThreadActivities;
}

async function runStage<T>(
  stage: AgentLoopStage,
  completedStages: AgentLoopStageResult[],
  action: () => Promise<{ value: T; detail: string }>,
): Promise<T> {
  try {
    const result = await action();
    completedStages.push({ stage, status: "passed", detail: result.detail });
    return result.value;
  } catch (error) {
    throw new AgentLoopStageError(
      stage,
      error instanceof Error ? error.message : String(error),
      [...completedStages],
      { cause: error },
    );
  }
}

async function graphql<T>(
  request: typeof fetch,
  baseUrl: string,
  operationName: string,
  query: string,
  variables: Record<string, unknown>,
  headers: Record<string, string> = {},
): Promise<T> {
  const response = await request(`${baseUrl}/graphql`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ operationName, query, variables }),
  });
  const payload = (await response.json()) as {
    data?: T;
    errors?: Array<{ message: string }>;
  };
  if (!response.ok) throw new Error(`GraphQL HTTP ${response.status}`);
  if (payload.errors?.length) {
    throw new Error(payload.errors.map((error) => error.message).join("; "));
  }
  if (!payload.data) throw new Error("GraphQL response did not include data");
  return payload.data;
}

function actorHeaders(
  actor: AgentLoopActor,
  clientEventId: string,
): Record<string, string> {
  return {
    "X-Vivi-Actor-Id": actor.id,
    "X-Vivi-Actor-Kind": actor.kind,
    ...(actor.displayName ? { "X-Vivi-Actor-Name": actor.displayName } : {}),
    "X-Vivi-Client-Event-Id": clientEventId,
  };
}

function assertActivitySequence(
  activities: LocalAgentLoopReport["activities"],
  expected: string[],
): void {
  const actual = activities.map((activity) => activity.type);
  let cursor = 0;
  for (const type of actual) {
    if (type === expected[cursor]) cursor += 1;
  }
  assert(
    cursor === expected.length,
    `activity sequence mismatch: expected ${expected.join(" -> ")}, got ${actual.join(" -> ")}`,
  );
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
