import { readFile, writeFile } from "node:fs/promises";

export type AgentLoopTerminalAction = "resolve" | "archive";
export type AgentKind = "human" | "claude_code" | "codex" | "unknown";

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
  threadId: string;
  terminalStatus: "resolved" | "archived";
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
}): Promise<LocalAgentLoopReport> {
  const baseUrl = input.baseUrl.replace(/\/+$/, "");
  const request = input.fetch ?? fetch;
  const stages: AgentLoopStageResult[] = [];

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
    const receipts = activities.filter(
      (activity) =>
        activity.type === "thread_read" &&
        activity.actor.id === input.fixture.agent.actor.id &&
        activity.clientEventId === input.fixture.agent.clientEventId,
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
    input.fixture.agent.terminalAction === "resolve" ? "resolved" : "archived";
  await runStage("terminal", stages, async () => {
    const field = `${input.fixture.agent.terminalAction}Thread`;
    const operation = `${capitalize(input.fixture.agent.terminalAction)}Thread`;
    const data = await graphql<Record<string, { id: string; status: string }>>(
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
    threadId: seeded.id,
    terminalStatus,
    stages,
    activities,
  };
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
      <div class="metric"><span>Thread</span><strong>${escapeHtml(report.threadId)}</strong></div>
      <div class="metric"><span>Terminal state</span><strong>${escapeHtml(report.terminalStatus)}</strong></div>
      <div class="metric"><span>Stages</span><strong>${report.stages.length} / ${report.stages.length} passed</strong></div>
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
