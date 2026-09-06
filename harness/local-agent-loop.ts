import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

interface FeedbackFixture {
  name: string;
  human: {
    path: string;
    body: string;
    anchor: unknown;
    actor: { id: string; kind: string };
  };
  agent: { readAs: "codex" | "claude" };
}
interface Activity {
  id: string;
  type: string;
  actor: { id: string };
}
interface Thread {
  id: string;
  status: string;
  comments: Array<{ body: string }>;
}

export async function loadLocalAgentLoopFixture(
  file: string,
): Promise<FeedbackFixture> {
  const fixture = JSON.parse(await readFile(file, "utf8")) as FeedbackFixture;
  if (
    !fixture.human?.path ||
    !fixture.human?.body ||
    !["codex", "claude"].includes(fixture.agent?.readAs)
  )
    throw new Error(
      "fixture requires human path/body and agent.readAs codex|claude",
    );
  return fixture;
}

// The fake agent only receives feedback. It never claims work, posts a reply,
// or decides that human feedback is resolved.
export async function runLocalAgentLoop(input: {
  baseUrl: string;
  fixture: FeedbackFixture;
  cliPath?: string;
}) {
  const { baseUrl, fixture } = input;
  const cli = input.cliPath ?? path.resolve("vivi");
  const request = async <T>(
    query: string,
    variables: Record<string, unknown>,
    key: string,
  ): Promise<T> => {
    const response = await fetch(`${baseUrl}/graphql`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query, variables }),
    });
    const payload = (await response.json()) as {
      data: Record<string, T>;
      errors?: unknown[];
    };
    if (!response.ok || payload.errors?.length)
      throw new Error(
        `feedback harness request failed: ${JSON.stringify(payload.errors)}`,
      );
    return payload.data[key];
  };
  const draft = await request<{ id: string }>(
    "mutation CreateDraftReviewComment($input: DraftReviewCommentInput!) { createDraftReviewComment(input:$input) { id } }",
    { input: fixture.human },
    "createDraftReviewComment",
  );
  const run = async (markRead = false) =>
    (
      await promisify(execFile)(
        cli,
        [
          "inbox",
          baseUrl,
          ...(markRead ? ["--read-as", fixture.agent.readAs] : []),
        ],
        { timeout: 15_000 },
      )
    ).stdout;
  const hidden = await run();
  if (hidden.includes(fixture.human.body))
    throw new Error("private draft leaked to inbox");
  const batch = await request<{ threads: Thread[] }>(
    "mutation PublishDraftReviewComments($input: PublishDraftReviewCommentsInput) { publishDraftReviewComments(input:$input) { threads { id status comments { body } } } }",
    { input: { draftIds: [draft.id] } },
    "publishDraftReviewComments",
  );
  const threadId = batch.threads[0]?.id;
  if (!threadId) throw new Error("publication did not create a thread");
  const activities = () =>
    request<Activity[]>(
      "query CommentThreadActivities($threadId: ID!) { commentThreadActivities(threadId:$threadId) { id type actor { id } } }",
      { threadId },
      "commentThreadActivities",
    );
  const passive = await run();
  if (!passive.includes(threadId) || !passive.includes(fixture.human.path))
    throw new Error("inbox omitted published feedback context");
  if ((await activities()).some((a) => a.type === "thread_read"))
    throw new Error("passive inbox created a read receipt");
  const observed = await run(true);
  if (!observed.includes(threadId)) throw new Error("read-as omitted feedback");
  const receipts = (await activities()).filter((a) => a.type === "thread_read");
  if (!receipts.some((a) => a.actor.id === fixture.agent.readAs))
    throw new Error("read receipt was not recorded");
  const reread = await run();
  if (!reread.includes(threadId))
    throw new Error("observed feedback is no longer available");
  const threads = await request<Thread[]>(
    "query CommentThreads { commentThreads { id status comments { body } } }",
    {},
    "commentThreads",
  );
  const thread = threads.find((t) => t.id === threadId);
  if (thread?.status !== "open" || thread.comments.length !== 1)
    throw new Error("agent read changed feedback lifecycle or posted a reply");
  const followupBody = `${fixture.human.body} (follow-up)`;
  const followup = await request<{ id: string }>(
    "mutation CreateDraftReviewComment($input: DraftReviewCommentInput!) { createDraftReviewComment(input:$input) { id } }",
    { input: { ...fixture.human, threadId, body: followupBody } },
    "createDraftReviewComment",
  );
  await request(
    "mutation PublishDraftReviewComments($input: PublishDraftReviewCommentsInput) { publishDraftReviewComments(input:$input) { threads { id } } }",
    { input: { draftIds: [followup.id] } },
    "publishDraftReviewComments",
  );
  const pending = (await activities()).filter((a) => a.type === "thread_read");
  if (pending.length !== receipts.length)
    throw new Error("publication incorrectly marked new feedback read");
  const next = await run(true);
  if (!next.includes(JSON.stringify(followupBody)))
    throw new Error("inbox omitted newly published follow-up");
  const refreshed = (await activities()).filter(
    (a) => a.type === "thread_read",
  );
  if (!refreshed.some((a) => !receipts.some((old) => old.id === a.id)))
    throw new Error("new feedback did not receive a fresh read receipt");
  return {
    status: "passed" as const,
    name: fixture.name,
    threadId,
    stages: [
      "draft-private",
      "publish",
      "passive-read",
      "read-receipt",
      "reread",
      "follow-up",
      "fresh-read-receipt",
    ],
    receipts,
  };
}
