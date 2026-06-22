import { spawn, type ChildProcessByStdio } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import type { Readable } from "node:stream";

export type AgentLoopTerminalAction = "resolve" | "archive";
export type AgentKind = "human" | "claude_code" | "codex" | "unknown";
export type AgentLoopIntake = "query" | "watch" | "claim-wait" | "work";
export type AgentLoopTerminalTransport = "graphql" | "cli";

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
    followUp?: {
      body: string;
      actor?: AgentLoopActor;
    };
  };
  agent: {
    actor: AgentLoopActor;
    clientEventId: string;
    triage?: {
      decision: string;
      summary?: string;
      nextAction?: string;
      details?: string;
    };
    result?: {
      summary?: string;
      verification?: string[];
      details?: string;
    };
    replyBody: string;
    terminalAction: AgentLoopTerminalAction;
  };
}

export type AgentLoopStage =
  | "wait"
  | "watch"
  | "seed"
  | "read"
  | "receipt"
  | "claim"
  | "renew"
  | "follow"
  | "triage"
  | "reply"
  | "terminal"
  | "work"
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
  terminalTransport: AgentLoopTerminalTransport;
  threadId: string;
  terminalStatus: "resolved" | "archived";
  watchEvent?: {
    schemaVersion?: number;
    eventSchema?: string;
    eventSchemaCommand?: string[];
    reason: string;
    changes: string[];
    cursor: string;
    count: number;
    threadIds: string[];
    recommendedAction?: string;
    suggestedCommandIntents?: string[];
    itemCount?: number;
    sourceAvailable?: boolean;
    diffStatus?: string;
    activityCount?: number;
  };
  claimWait?: {
    threadId: string;
    clientEventId?: string;
    leaseExpiresAt?: string;
    sourceAvailable?: boolean;
    diffStatus?: string;
    activityCount?: number;
  };
  work?: {
    threadId: string;
    schemaVersion?: number;
    eventSchema?: string;
    eventSchemaCommand?: string[];
    sessionId?: string;
    sequence?: number;
    clientEventId?: string;
    leaseExpiresAt?: string;
    sourceAvailable?: boolean;
    diffStatus?: string;
    activityCount?: number;
    recommendedAction?: string;
    suggestedCommandIntents?: string[];
    terminalObserved?: boolean;
  };
  followEvent?: {
    threadId: string;
    schemaVersion?: number;
    eventSchema?: string;
    eventSchemaCommand?: string[];
    sessionId?: string;
    sequence?: number;
    reason: string;
    cursor: string;
    count: number;
    activityTypes: string[];
    summaryKinds?: string[];
    ownActivityCount?: number;
    externalActivityCount?: number;
    requiresAttention?: boolean;
    attentionReasons?: string[];
    recommendedAction?: string;
    suggestedCommandIntents?: string[];
    suggestedCommandSchemas?: string[];
    suggestedSchemaCommands?: string[][];
    commentBodies?: string[];
    sourceAvailable?: boolean;
    diffStatus?: string;
    terminalStatus?: string;
  };
  triage?: {
    decision: string;
    summary?: string;
    nextAction?: string;
    commentId: string;
    body: string;
  };
  triageEvent?: {
    threadId: string;
    activityTypes: string[];
    summaryKinds?: string[];
    ownTriageCommentCount?: number;
    externalTriageCommentCount?: number;
    requiresAttention?: boolean;
    recommendedAction?: string;
    suggestedCommandIntents?: string[];
    commentBodies?: string[];
  };
  terminalResult?: {
    outcome: string;
    summary?: string;
    verification?: string[];
    details?: string;
    body: string;
  };
  stages: AgentLoopStageResult[];
  activities: Array<{
    id?: string;
    type: string;
    actor: AgentLoopActor;
    commentId?: string;
    previousStatus?: string;
    status?: string;
    clientEventId?: string;
    leaseExpiresAt?: string;
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

export interface LocalAgentLoopCliOptions {
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string | undefined>;
  intervalMs?: number;
  timeoutMs?: number;
}

interface CommentsWatchEvent {
  type: string;
  schemaVersion?: number;
  eventSchema?: string;
  eventSchemaCommand?: string[];
  reason: string;
  changes: string[];
  cursor: string;
  count: number;
  summary?: {
    requiresAttention?: boolean;
    attentionReasons?: string[];
    recommendedAction?: string;
    openThreadCount?: number;
    suggestedCommands?: Array<{
      intent: string;
      command: string;
      args: string[];
      clientEventId?: string;
      reason: string;
    }>;
  };
  threads: Array<{
    id: string;
    status: string;
    comments: Array<{ body: string }>;
  }>;
  items?: CommentsWatchItem[];
}

interface CommentsWatchItem {
  thread: {
    id: string;
    path: string;
    status: string;
  };
  file?: {
    path: string;
    viewerKind: string;
    encoding: string;
  };
  source?: {
    path: string;
    available: boolean;
    reason?: string;
    anchorStartLine?: number;
    anchorEndLine?: number;
    lines?: Array<{ number: number; text: string; anchor: boolean }>;
  };
  diff?: {
    path: string;
    status: string;
    content?: string;
    reason?: string;
  };
  activities?: Array<{
    type: string;
    clientEventId?: string;
  }>;
}

interface CommentsFollowEvent {
  type: string;
  schemaVersion?: number;
  eventSchema?: string;
  eventSchemaCommand?: string[];
  sessionId?: string;
  sequence?: number;
  reason: string;
  threadId: string;
  cursor: string;
  count: number;
  summary?: CommentsActivityBatchSummary;
  activities: LocalAgentLoopReport["activities"];
  comments?: CommentsEventComment[];
  source?: {
    path?: string;
    available: boolean;
    reason?: string;
    anchorStartLine?: number;
    anchorEndLine?: number;
    lines?: Array<{ number: number; text: string; anchor: boolean }>;
  };
  diff?: {
    status: string;
    content?: string;
    reason?: string;
  };
}

interface CommentsActivityBatchSummary {
  kinds: string[];
  requiresAttention: boolean;
  attentionReasons: string[];
  recommendedAction: string;
  suggestedCommands?: Array<{
    intent: string;
    command: string;
    args: string[];
    clientEventId?: string;
    stdinRequired?: boolean;
    stdinSchema?: string;
    stdinSchemaCommand?: string[];
    stdinExample?: Record<string, unknown>;
    reason: string;
  }>;
  ownActivityCount: number;
  externalActivityCount: number;
  humanCommentCount: number;
  agentCommentCount: number;
  triageCommentCount: number;
  ownCommentCount: number;
  externalCommentCount: number;
  externalAgentCommentCount: number;
  ownTriageCommentCount: number;
  externalTriageCommentCount: number;
  commentUpdateCount: number;
  claimCount: number;
  ownClaimCount: number;
  externalClaimCount: number;
  releaseCount: number;
  ownReleaseCount: number;
  externalReleaseCount: number;
  statusChangeCount: number;
  ownStatusChangeCount: number;
  externalStatusChangeCount: number;
  readCount: number;
  threadCreatedCount: number;
  terminalStatus?: string;
}

interface CommentsWorkEvent {
  type: string;
  schemaVersion?: number;
  eventSchema?: string;
  eventSchemaCommand?: string[];
  sessionId?: string;
  sequence?: number;
  reason?: string;
  threadId?: string;
  cursor?: string;
  count?: number;
  thread?: {
    id: string;
    path?: string;
    status: string;
  };
  claim?: {
    id?: string;
    type: string;
    actor: AgentLoopActor;
    clientEventId?: string;
    leaseExpiresAt?: string;
  };
  source?: {
    available: boolean;
    reason?: string;
    lines?: Array<{ number: number; text: string; anchor: boolean }>;
  };
  diff?: {
    status: string;
    content?: string;
    reason?: string;
  };
  summary?: CommentsActivityBatchSummary;
  activities?: LocalAgentLoopReport["activities"];
  comments?: CommentsEventComment[];
}

interface CommentsEventComment {
  id: string;
  threadId: string;
  body: string;
  createdBy: AgentLoopActor;
  anchor?: unknown;
}

interface CommentsClaimPayload {
  thread: {
    id: string;
    path?: string;
    status: string;
  };
  claim: {
    type: string;
    actor: AgentLoopActor;
    clientEventId?: string;
    leaseExpiresAt?: string;
  };
  source?: {
    available: boolean;
    reason?: string;
    lines?: Array<{ number: number; text: string; anchor: boolean }>;
  };
  diff?: {
    status: string;
    content?: string;
    reason?: string;
  };
  activities?: Array<{
    type: string;
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
  intake?: AgentLoopIntake;
  watch?: LocalAgentLoopWatchOptions;
  terminalTransport?: AgentLoopTerminalTransport;
  cli?: LocalAgentLoopCliOptions;
}): Promise<LocalAgentLoopReport> {
  const baseUrl = input.baseUrl.replace(/\/+$/, "");
  const request = input.fetch ?? fetch;
  const intake = input.intake ?? "query";
  const terminalTransport = input.terminalTransport ?? "graphql";
  const stages: AgentLoopStageResult[] = [];
  let watch: CommentsWatchSession | null = null;
  let claimWait: CommentsClaimWaitSession | null = null;
  let work: CommentsWorkSession | null = null;
  let deliveredWatchEvent: CommentsWatchEvent | undefined;
  let deliveredWatchItem: CommentsWatchItem | undefined;
  let deliveredClaimPayload: CommentsClaimPayload | undefined;
  let deliveredWorkPayload: CommentsWorkEvent | undefined;
  let deliveredWorkTerminal = false;
  let deliveredFollowEvent: CommentsFollowEvent | undefined;
  let deliveredTriageEvent: CommentsFollowEvent | undefined;
  let deliveredTerminalResult:
    | {
        outcome: string;
        summary?: string;
        verification?: string[];
        details?: string;
        body: string;
      }
    | undefined;
  let deliveredTriage:
    | {
        triage: {
          decision: string;
          summary?: string;
          nextAction?: string;
          body: string;
        };
        comment: {
          id: string;
          threadId: string;
          body: string;
          createdBy: AgentLoopActor;
        };
        thread: {
          id: string;
          status: string;
        };
      }
    | undefined;

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
  if (intake === "claim-wait") {
    claimWait = startCommentsClaimWait({
      baseUrl,
      actor: input.fixture.agent.actor,
      clientEventId: `${input.fixture.agent.clientEventId}:claim-wait`,
      options: input.cli,
    });
    await runStage("wait", stages, async () => ({
      value: true,
      detail: "fake agent started comments claim --wait intake",
    }));
  }
  if (intake === "work") {
    work = startCommentsWork({
      baseUrl,
      actor: input.fixture.agent.actor,
      clientEventId: `${input.fixture.agent.clientEventId}:work`,
      options: input.cli,
    });
    await runStage("wait", stages, async () => ({
      value: true,
      detail: "fake agent started comments work --wait intake",
    }));
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
      if (claimWait) {
        const payload = await claimWait.payload();
        deliveredClaimPayload = payload;
        assert(
          payload.thread.id === seeded.id,
          `claim --wait returned ${payload.thread.id} instead of ${seeded.id}`,
        );
        assert(
          payload.claim.type === "thread_claimed" &&
            payload.claim.actor.id === input.fixture.agent.actor.id,
          "claim --wait did not record the agent lease",
        );
        assert(
          payload.claim.clientEventId ===
            `${input.fixture.agent.clientEventId}:claim-wait`,
          "claim --wait did not preserve the client event id",
        );
        assert(
          typeof payload.claim.leaseExpiresAt === "string" &&
            payload.claim.leaseExpiresAt.length > 0,
          "claim --wait did not return a lease expiry",
        );
        assert(
          payload.source?.available,
          "claim --wait --full did not return source context",
        );
        assert(
          payload.source.lines?.some((line) => line.anchor),
          "claim --wait source did not mark the human anchor line",
        );
        assert(
          payload.diff?.status === "available",
          "claim --wait --full did not return an available diff",
        );
        assert(
          payload.activities?.some(
            (activity) =>
              activity.type === "thread_claimed" &&
              activity.clientEventId === payload.claim.clientEventId,
          ),
          "claim --wait --full did not include the claim activity",
        );
        return {
          value: [payload.thread],
          detail: `fake agent claimed thread ${seeded.id} from comments claim --wait`,
        };
      }

      if (work) {
        const event = await work.nextEvent();
        deliveredWorkPayload = event;
        assert(
          event.type === "comment_work_claimed",
          `unexpected work event type ${event.type}`,
        );
        assert(
          event.thread?.id === seeded.id,
          `comments work returned ${event.thread?.id ?? "no thread"} instead of ${seeded.id}`,
        );
        assert(
          event.claim?.type === "thread_claimed" &&
            event.claim.actor.id === input.fixture.agent.actor.id,
          "comments work did not record the agent lease",
        );
        assert(
          event.claim.clientEventId ===
            `${input.fixture.agent.clientEventId}:work`,
          "comments work did not preserve the client event id",
        );
        assert(
          event.schemaVersion === 1 &&
            event.eventSchema === "commentWorkClaimedEvent" &&
            event.eventSchemaCommand?.includes("commentWorkClaimedEvent") &&
            typeof event.sessionId === "string" &&
            event.sessionId.length > 0 &&
            event.sequence === 1,
          "comments work did not emit stable stream metadata on claim",
        );
        assert(
          typeof event.claim.leaseExpiresAt === "string" &&
            event.claim.leaseExpiresAt.length > 0,
          "comments work did not return a lease expiry",
        );
        assert(
          event.source?.available,
          "comments work --full did not return source context",
        );
        assert(
          event.summary?.recommendedAction === "start_work" &&
            event.summary.suggestedCommands?.some(
              (command) =>
                command.intent === "acknowledge_initial_feedback" &&
                command.stdinRequired === true &&
                command.stdinSchema === "commentTriageFileInput" &&
                command.stdinExample?.decision === "fixing" &&
                String(command.stdinExample?.summary ?? "").includes(
                  "claimed",
                ) &&
                hasSuggestedWriteRetryKey(command),
            ) &&
            event.summary.suggestedCommands?.some(
              (command) =>
                command.intent === "complete_after_verification" &&
                command.stdinRequired === true &&
                command.stdinSchema === "commentResultFileInput" &&
                String(command.stdinExample?.summary ?? "").includes(
                  "Implemented",
                ) &&
                hasSuggestedWriteRetryKey(command),
            ) &&
            event.summary.suggestedCommands?.some(
              (command) =>
                command.intent === "handoff_after_blocked_or_needs_info" &&
                command.command === "comments release" &&
                command.stdinRequired === true &&
                command.stdinSchema === "commentTriageFileInput" &&
                command.stdinExample?.decision === "blocked" &&
                hasSuggestedWriteRetryKey(command),
            ) &&
            event.summary.suggestedCommands?.some(
              (command) =>
                command.intent === "archive_after_decision" &&
                command.command === "comments dismiss" &&
                command.stdinRequired === true &&
                command.stdinSchema === "commentResultFileInput" &&
                String(command.stdinExample?.summary ?? "").includes(
                  "archived",
                ) &&
                hasSuggestedWriteRetryKey(command),
            ),
          "comments work claim did not suggest the initial agent handoff",
        );
        assert(
          event.source.lines?.some((line) => line.anchor),
          "comments work source did not mark the human anchor line",
        );
        assert(
          event.diff?.status === "available",
          "comments work --full did not return an available diff",
        );
        assert(
          event.activities?.some(
            (activity) =>
              activity.type === "thread_claimed" &&
              activity.clientEventId === event.claim?.clientEventId,
          ),
          "comments work --full did not include the claim activity",
        );
        return {
          value: [event.thread],
          detail: `fake agent claimed thread ${seeded.id} from comments work`,
        };
      }

      if (watch) {
        const event = await watch.nextEvent();
        deliveredWatchEvent = event;
        assert(
          event.type === "comments_open_worklist",
          `unexpected watch event type ${event.type}`,
        );
        assert(
          event.schemaVersion === 1 &&
            event.eventSchema === "commentOpenWorklistEvent" &&
            event.eventSchemaCommand?.includes("commentOpenWorklistEvent"),
          "comments watch event did not include self-describing schema metadata",
        );
        assert(
          event.threads.some((thread) => thread.id === seeded.id),
          `open thread ${seeded.id} was not delivered by comments watch`,
        );
        assert(
          event.summary?.recommendedAction === "claim_open_work" &&
            event.summary?.openThreadCount === event.count &&
            event.summary?.suggestedCommands?.some(
              (command) =>
                command.intent === "claim_next_open_thread" &&
                command.command === "comments work" &&
                command.clientEventId?.startsWith("watch:") &&
                command.args.includes("--client-event-id") &&
                command.args.includes("--full"),
            ),
          "comments watch did not suggest the next claim command",
        );
        deliveredWatchItem = event.items?.find(
          (item) => item.thread.id === seeded.id,
        );
        assert(
          deliveredWatchItem,
          `open thread ${seeded.id} did not include a rich watch item`,
        );
        assert(
          deliveredWatchItem.source?.available,
          `rich watch item did not include available source context`,
        );
        assert(
          deliveredWatchItem.source.lines?.some((line) => line.anchor),
          `rich watch item source did not mark the human anchor line`,
        );
        assert(
          deliveredWatchItem.diff?.status === "available",
          `rich watch item did not include an available diff`,
        );
        assert(
          deliveredWatchItem.activities?.some(
            (activity) =>
              activity.type === "thread_read" &&
              activity.clientEventId ===
                `${input.fixture.agent.clientEventId}:${event.cursor}`,
          ),
          `rich watch item did not include the delivered read receipt`,
        );
        return {
          value: event.threads,
          detail: `fake agent received ${event.count} rich open thread item(s) from comments watch`,
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

    if (!claimWait && !work) {
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
    }

    const terminalStatus =
      input.fixture.agent.terminalAction === "resolve"
        ? "resolved"
        : "archived";
    let cliTerminalThread:
      | {
          id: string;
          status: string;
        }
      | undefined;
    if (terminalTransport === "cli") {
      if (!deliveredClaimPayload && !deliveredWorkPayload) {
        await runStage("claim", stages, async () => {
          const payload = await runCommentsClaim({
            baseUrl,
            threadId: seeded.id,
            actor: input.fixture.agent.actor,
            clientEventId: `${input.fixture.agent.clientEventId}:claim`,
            options: input.cli,
          });
          assert(
            payload.thread.id === seeded.id,
            "CLI claim changed thread identity",
          );
          assert(
            payload.claim.type === "thread_claimed" &&
              payload.claim.actor.id === input.fixture.agent.actor.id,
            "CLI claim did not record the agent lease",
          );
          assert(
            typeof payload.claim.leaseExpiresAt === "string" &&
              payload.claim.leaseExpiresAt.length > 0,
            "CLI claim did not return a lease expiry",
          );
          assert(
            payload.source?.available,
            "CLI claim --full did not return source context",
          );
          assert(
            payload.diff?.status === "available",
            "CLI claim --full did not return an available diff",
          );
          return {
            value: payload.claim,
            detail: `fake agent claimed thread ${seeded.id} with lease ${payload.claim.leaseExpiresAt}`,
          };
        });
      }

      if (!deliveredWorkPayload) {
        await runStage("renew", stages, async () => {
          const payload = await runCommentsRenew({
            baseUrl,
            threadId: seeded.id,
            actor: input.fixture.agent.actor,
            clientEventId: `${input.fixture.agent.clientEventId}:renew`,
            options: input.cli,
          });
          assert(
            payload.thread.id === seeded.id,
            "CLI renew changed thread identity",
          );
          assert(
            payload.renewal.type === "thread_claimed" &&
              payload.renewal.actor.id === input.fixture.agent.actor.id,
            "CLI renew did not refresh the agent lease",
          );
          assert(
            typeof payload.renewal.leaseExpiresAt === "string" &&
              payload.renewal.leaseExpiresAt.length > 0,
            "CLI renew did not return a lease expiry",
          );
          return {
            value: payload.renewal,
            detail: `fake agent renewed claim on thread ${seeded.id} until ${payload.renewal.leaseExpiresAt}`,
          };
        });
      }

      if (input.fixture.human.followUp) {
        await runStage("follow", stages, async () => {
          const followUp = input.fixture.human.followUp;
          assert(followUp, "follow stage requires a human follow-up fixture");
          const existingActivities = await readActivities(
            request,
            baseUrl,
            seeded.id,
          );
          const cursor = existingActivities.at(-1)?.id;
          assert(
            cursor,
            "thread did not have an activity cursor before follow",
          );
          const follow = work
            ? null
            : startCommentsFollow({
                baseUrl,
                threadId: seeded.id,
                cursor,
                actor: input.fixture.agent.actor,
                options: input.cli,
              });
          try {
            const followUpActor = followUp.actor ?? input.fixture.human.actor;
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
              "AddHumanFollowUp",
              `
                mutation AddHumanFollowUp(
                  $threadId: ID!
                  $input: AddCommentInput!
                ) {
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
                  body: followUp.body,
                  actor: followUpActor,
                },
              },
            );
            assert(
              data.addComment.threadId === seeded.id,
              "human follow-up changed thread identity",
            );
            assert(
              data.addComment.createdBy.id === followUpActor.id,
              "human follow-up actor was not preserved",
            );
            const event = work
              ? await nextWorkFollowEventMatching(
                  work,
                  (candidate) =>
                    candidate.type === "comment_thread_activity_batch" &&
                    candidate.threadId === seeded.id &&
                    candidate.activities.some(
                      (activity) =>
                        activity.type === "comment_added" &&
                        activity.commentId === data.addComment.id &&
                        activity.actor.id === followUpActor.id,
                    ),
                  "human follow-up comment activity",
                )
              : await follow!.nextEvent();
            deliveredFollowEvent = event;
            assert(
              event.type === "comment_thread_activity_batch",
              `unexpected follow event type ${event.type}`,
            );
            assert(
              event.threadId === seeded.id,
              `follow event targeted ${event.threadId}`,
            );
            assert(
              event.activities.some(
                (activity) =>
                  activity.type === "comment_added" &&
                  activity.commentId === data.addComment.id &&
                  activity.actor.id === followUpActor.id,
              ),
              "follow did not deliver the human follow-up comment activity",
            );
            assert(
              event.comments?.some(
                (comment) =>
                  comment.id === data.addComment.id &&
                  comment.threadId === seeded.id &&
                  comment.body === followUp.body &&
                  comment.createdBy.id === followUpActor.id,
              ),
              "follow did not include the human follow-up comment snapshot",
            );
            assert(
              event.source?.available === true &&
                event.source.path === input.fixture.human.path,
              "follow did not include source context for the human follow-up",
            );
            assert(
              event.summary?.humanCommentCount === 1 &&
                event.summary.externalActivityCount === 1 &&
                event.summary.requiresAttention &&
                event.summary.recommendedAction === "reconsider_work" &&
                event.eventSchema === "commentActivityBatchEvent" &&
                event.eventSchemaCommand?.includes(
                  "commentActivityBatchEvent",
                ) &&
                event.summary.kinds.includes("human_comment") &&
                event.summary.suggestedCommands?.some(
                  (command) =>
                    command.intent === "acknowledge_follow_up" &&
                    command.command === "comments triage" &&
                    command.stdinRequired === true &&
                    command.stdinSchema === "commentTriageFileInput" &&
                    command.stdinSchemaCommand?.includes(
                      "commentTriageFileInput",
                    ) &&
                    command.stdinExample?.decision === "fixing" &&
                    String(command.stdinExample?.summary ?? "").includes(
                      "follow-up",
                    ) &&
                    hasSuggestedWriteRetryKey(command),
                ) &&
                event.summary.suggestedCommands?.some(
                  (command) =>
                    command.intent === "archive_after_decision" &&
                    command.command === "comments dismiss" &&
                    command.stdinRequired === true &&
                    command.stdinSchema === "commentResultFileInput" &&
                    String(command.stdinExample?.summary ?? "").includes(
                      "archived",
                    ) &&
                    hasSuggestedWriteRetryKey(command),
                ) &&
                event.summary.suggestedCommands?.some(
                  (command) =>
                    command.intent === "handoff_after_blocked_or_needs_info" &&
                    command.command === "comments release" &&
                    command.stdinRequired === true &&
                    command.stdinSchema === "commentTriageFileInput" &&
                    command.stdinExample?.decision === "blocked" &&
                    hasSuggestedWriteRetryKey(command),
                ) &&
                event.summary.suggestedCommands?.some(
                  (command) =>
                    command.intent === "complete_after_verification" &&
                    command.command === "comments done" &&
                    command.stdinRequired === true &&
                    command.stdinSchema === "commentResultFileInput" &&
                    String(command.stdinExample?.summary ?? "").includes(
                      "Implemented",
                    ) &&
                    hasSuggestedWriteRetryKey(command),
                ),
              "follow did not summarize the human follow-up activity",
            );
            if (work) {
              assert(
                event.schemaVersion === deliveredWorkPayload?.schemaVersion &&
                  event.eventSchema === "commentActivityBatchEvent" &&
                  event.eventSchemaCommand?.includes(
                    "commentActivityBatchEvent",
                  ) &&
                  event.sessionId === deliveredWorkPayload?.sessionId &&
                  event.sequence === 2,
                "comments work follow-up did not continue the work stream metadata",
              );
            }
            return {
              value: event,
              detail: `fake agent followed human update ${data.addComment.id} at cursor ${event.cursor}`,
            };
          } finally {
            await follow?.close();
          }
        });
      }
    }
    if (input.fixture.agent.triage) {
      deliveredTriage = await runStage("triage", stages, async () => {
        const payload = await runCommentsTriage({
          baseUrl,
          threadId: seeded.id,
          actor: input.fixture.agent.actor,
          triage: input.fixture.agent.triage!,
          options: input.cli,
        });
        assert(
          payload.comment.threadId === seeded.id,
          "triage reply changed thread identity",
        );
        assert(
          payload.comment.createdBy.id === input.fixture.agent.actor.id,
          "triage actor was not preserved",
        );
        assert(
          payload.thread.status === "open",
          "triage should leave the thread open",
        );
        assert(
          payload.comment.body === payload.triage.body &&
            payload.triage.decision === input.fixture.agent.triage?.decision,
          "triage payload did not preserve structured decision data",
        );
        if (work) {
          const event = await nextWorkFollowEventMatching(
            work,
            (candidate) =>
              candidate.type === "comment_thread_activity_batch" &&
              candidate.threadId === seeded.id &&
              candidate.activities.some(
                (activity) =>
                  activity.type === "comment_added" &&
                  activity.commentId === payload.comment.id &&
                  activity.actor.id === input.fixture.agent.actor.id,
              ),
            "own triage comment activity",
          );
          assert(
            event.summary?.ownTriageCommentCount === 1 &&
              event.summary.triageCommentCount === 1 &&
              !event.summary.requiresAttention &&
              event.summary.recommendedAction === "ignore_own_activity" &&
              event.summary.kinds.includes("own_triage_comment") &&
              (event.summary.suggestedCommands?.length ?? 0) === 0,
            "comments work did not summarize the own triage activity",
          );
          deliveredTriageEvent = event;
        }
        return {
          value: payload,
          detail: `fake agent triaged thread ${seeded.id} as ${payload.triage.decision}`,
        };
      });
    }
    const reply = await runStage("reply", stages, async () => {
      if (terminalTransport === "cli") {
        const payload = await runCommentsTerminalShortcut({
          baseUrl,
          threadId: seeded.id,
          body: input.fixture.agent.replyBody,
          result: input.fixture.agent.result,
          actor: input.fixture.agent.actor,
          action: input.fixture.agent.terminalAction,
          options: input.cli,
        });
        assert(
          payload.comment.threadId === seeded.id,
          "CLI terminal shortcut changed thread identity",
        );
        assert(
          payload.comment.createdBy.id === input.fixture.agent.actor.id,
          "CLI terminal shortcut reply actor was not preserved",
        );
        assert(
          payload.thread.status === terminalStatus,
          `CLI terminal shortcut returned ${payload.thread.status}`,
        );
        cliTerminalThread = payload.thread;
        deliveredTerminalResult = payload.result;
        return {
          value: payload.comment,
          detail: `fake agent used comments ${terminalShortcutCommand(input.fixture.agent.terminalAction)} and replied with comment ${payload.comment.id}`,
        };
      }

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

    await runStage("terminal", stages, async () => {
      if (terminalTransport === "cli") {
        assert(
          cliTerminalThread?.status === terminalStatus,
          `CLI terminal shortcut did not move thread to ${terminalStatus}`,
        );
        return {
          value: cliTerminalThread,
          detail: `comments ${terminalShortcutCommand(input.fixture.agent.terminalAction)} moved thread to ${terminalStatus}`,
        };
      }

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

    if (work) {
      await runStage("work", stages, async () => {
        const event = await nextWorkFollowEventMatching(
          work!,
          (candidate) =>
            candidate.type === "comment_thread_activity_batch" &&
            candidate.threadId === seeded.id &&
            candidate.activities.some(
              (activity) =>
                activity.type === "thread_status_changed" &&
                activity.status === terminalStatus,
            ),
          "terminal status activity",
        );
        assert(
          event.type === "comment_thread_activity_batch",
          `unexpected work terminal event type ${event.type}`,
        );
        assert(
          event.threadId === seeded.id,
          `work terminal event targeted ${event.threadId}`,
        );
        assert(
          event.activities.some(
            (activity) =>
              activity.type === "thread_status_changed" &&
              activity.status === terminalStatus,
          ),
          "comments work did not deliver the terminal status activity",
        );
        assert(
          event.summary?.terminalStatus === terminalStatus &&
            event.summary.ownActivityCount >= 1 &&
            !event.summary.requiresAttention &&
            event.summary.recommendedAction === "finish_current_work" &&
            event.summary.kinds.includes("terminal_status"),
          "comments work did not summarize the terminal status activity",
        );
        assert(
          event.schemaVersion === deliveredWorkPayload?.schemaVersion &&
            event.sessionId === deliveredWorkPayload?.sessionId &&
            typeof event.sequence === "number" &&
            event.sequence > (deliveredFollowEvent?.sequence ?? 1),
          "comments work terminal event did not continue the work stream metadata",
        );
        await work!.done();
        deliveredWorkTerminal = true;
        return {
          value: event,
          detail: `comments work observed ${terminalStatus} and exited`,
        };
      });
    }

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
          (comment) => comment.id === reply.id && comment.body === reply.body,
        ),
        "agent reply was not retained on the thread",
      );
      if (input.fixture.human.followUp) {
        assert(
          thread.comments.some(
            (comment) => comment.body === input.fixture.human.followUp?.body,
          ),
          "human follow-up was not retained on the thread",
        );
      }
      const expectLeaseActivities =
        terminalTransport === "cli" ||
        Boolean(deliveredClaimPayload) ||
        Boolean(deliveredWorkPayload);
      const expectedCommentActivities = input.fixture.human.followUp
        ? ["comment_added", "comment_added"]
        : ["comment_added"];
      assertActivitySequence(
        activityData,
        expectLeaseActivities
          ? [
              "thread_created",
              "thread_claimed",
              ...(terminalTransport === "cli" && !deliveredWorkPayload
                ? ["thread_claimed"]
                : []),
              ...expectedCommentActivities,
              "thread_status_changed",
            ]
          : [
              "thread_created",
              "thread_read",
              ...expectedCommentActivities,
              "thread_status_changed",
            ],
      );
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
      terminalTransport,
      threadId: seeded.id,
      terminalStatus,
      watchEvent: deliveredWatchEvent
        ? {
            schemaVersion: deliveredWatchEvent.schemaVersion,
            eventSchema: deliveredWatchEvent.eventSchema,
            eventSchemaCommand: deliveredWatchEvent.eventSchemaCommand,
            reason: deliveredWatchEvent.reason,
            changes: deliveredWatchEvent.changes,
            cursor: deliveredWatchEvent.cursor,
            count: deliveredWatchEvent.count,
            threadIds: deliveredWatchEvent.threads.map((thread) => thread.id),
            recommendedAction: deliveredWatchEvent.summary?.recommendedAction,
            suggestedCommandIntents:
              deliveredWatchEvent.summary?.suggestedCommands?.map(
                (command) => command.intent,
              ) ?? [],
            itemCount: deliveredWatchEvent.items?.length ?? 0,
            sourceAvailable: deliveredWatchItem?.source?.available,
            diffStatus: deliveredWatchItem?.diff?.status,
            activityCount: deliveredWatchItem?.activities?.length ?? 0,
          }
        : undefined,
      claimWait: deliveredClaimPayload
        ? {
            threadId: deliveredClaimPayload.thread.id,
            clientEventId: deliveredClaimPayload.claim.clientEventId,
            leaseExpiresAt: deliveredClaimPayload.claim.leaseExpiresAt,
            sourceAvailable: deliveredClaimPayload.source?.available,
            diffStatus: deliveredClaimPayload.diff?.status,
            activityCount: deliveredClaimPayload.activities?.length ?? 0,
          }
        : undefined,
      work: deliveredWorkPayload
        ? {
            threadId: deliveredWorkPayload.thread?.id ?? "",
            schemaVersion: deliveredWorkPayload.schemaVersion,
            eventSchema: deliveredWorkPayload.eventSchema,
            eventSchemaCommand: deliveredWorkPayload.eventSchemaCommand,
            sessionId: deliveredWorkPayload.sessionId,
            sequence: deliveredWorkPayload.sequence,
            clientEventId: deliveredWorkPayload.claim?.clientEventId,
            leaseExpiresAt: deliveredWorkPayload.claim?.leaseExpiresAt,
            sourceAvailable: deliveredWorkPayload.source?.available,
            diffStatus: deliveredWorkPayload.diff?.status,
            activityCount: deliveredWorkPayload.activities?.length ?? 0,
            recommendedAction: deliveredWorkPayload.summary?.recommendedAction,
            suggestedCommandIntents:
              deliveredWorkPayload.summary?.suggestedCommands?.map(
                (command) => command.intent,
              ) ?? [],
            terminalObserved: deliveredWorkTerminal,
          }
        : undefined,
      followEvent: deliveredFollowEvent
        ? {
            threadId: deliveredFollowEvent.threadId,
            schemaVersion: deliveredFollowEvent.schemaVersion,
            eventSchema: deliveredFollowEvent.eventSchema,
            eventSchemaCommand: deliveredFollowEvent.eventSchemaCommand,
            sessionId: deliveredFollowEvent.sessionId,
            sequence: deliveredFollowEvent.sequence,
            reason: deliveredFollowEvent.reason,
            cursor: deliveredFollowEvent.cursor,
            count: deliveredFollowEvent.count,
            activityTypes: deliveredFollowEvent.activities.map(
              (activity) => activity.type,
            ),
            summaryKinds: deliveredFollowEvent.summary?.kinds,
            ownActivityCount: deliveredFollowEvent.summary?.ownActivityCount,
            externalActivityCount:
              deliveredFollowEvent.summary?.externalActivityCount,
            requiresAttention: deliveredFollowEvent.summary?.requiresAttention,
            attentionReasons: deliveredFollowEvent.summary?.attentionReasons,
            recommendedAction: deliveredFollowEvent.summary?.recommendedAction,
            suggestedCommandIntents:
              deliveredFollowEvent.summary?.suggestedCommands?.map(
                (command) => command.intent,
              ) ?? [],
            suggestedCommandSchemas:
              deliveredFollowEvent.summary?.suggestedCommands
                ?.map((command) => command.stdinSchema)
                .filter((schema): schema is string => Boolean(schema)) ?? [],
            suggestedSchemaCommands:
              deliveredFollowEvent.summary?.suggestedCommands
                ?.map((command) => command.stdinSchemaCommand)
                .filter((command): command is string[] =>
                  Array.isArray(command),
                ) ?? [],
            commentBodies:
              deliveredFollowEvent.comments?.map((comment) => comment.body) ??
              [],
            sourceAvailable: deliveredFollowEvent.source?.available,
            diffStatus: deliveredFollowEvent.diff?.status,
            terminalStatus: deliveredFollowEvent.summary?.terminalStatus,
          }
        : undefined,
      triage: deliveredTriage
        ? {
            decision: deliveredTriage.triage.decision,
            summary: deliveredTriage.triage.summary,
            nextAction: deliveredTriage.triage.nextAction,
            commentId: deliveredTriage.comment.id,
            body: deliveredTriage.comment.body,
          }
        : undefined,
      triageEvent: deliveredTriageEvent
        ? {
            threadId: deliveredTriageEvent.threadId,
            activityTypes: deliveredTriageEvent.activities.map(
              (activity) => activity.type,
            ),
            summaryKinds: deliveredTriageEvent.summary?.kinds,
            ownTriageCommentCount:
              deliveredTriageEvent.summary?.ownTriageCommentCount,
            externalTriageCommentCount:
              deliveredTriageEvent.summary?.externalTriageCommentCount,
            requiresAttention: deliveredTriageEvent.summary?.requiresAttention,
            recommendedAction: deliveredTriageEvent.summary?.recommendedAction,
            suggestedCommandIntents:
              deliveredTriageEvent.summary?.suggestedCommands?.map(
                (command) => command.intent,
              ) ?? [],
            commentBodies:
              deliveredTriageEvent.comments?.map((comment) => comment.body) ??
              [],
          }
        : undefined,
      terminalResult: deliveredTerminalResult,
      stages,
      activities,
    };
  } finally {
    await watch?.close();
    await claimWait?.close();
    await work?.close();
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
  const watchItemMetric = report.watchEvent
    ? `<div class="metric"><span>Rich items</span><strong>${report.watchEvent.itemCount ?? 0}</strong></div>
      <div class="metric"><span>Source context</span><strong>${escapeHtml(String(report.watchEvent.sourceAvailable ?? false))}</strong></div>
      <div class="metric"><span>Diff status</span><strong>${escapeHtml(report.watchEvent.diffStatus ?? "")}</strong></div>
      <div class="metric"><span>Activity events</span><strong>${report.watchEvent.activityCount ?? 0}</strong></div>`
    : "";
  const claimWaitMetric = report.claimWait
    ? `<div class="metric"><span>Claim lease</span><strong>${escapeHtml(report.claimWait.leaseExpiresAt ?? "")}</strong></div>
      <div class="metric"><span>Claim source</span><strong>${escapeHtml(String(report.claimWait.sourceAvailable ?? false))}</strong></div>
      <div class="metric"><span>Claim diff</span><strong>${escapeHtml(report.claimWait.diffStatus ?? "")}</strong></div>
      <div class="metric"><span>Claim activities</span><strong>${report.claimWait.activityCount ?? 0}</strong></div>`
    : "";
  const workMetric = report.work
    ? `<div class="metric"><span>Work lease</span><strong>${escapeHtml(report.work.leaseExpiresAt ?? "")}</strong></div>
      <div class="metric"><span>Work source</span><strong>${escapeHtml(String(report.work.sourceAvailable ?? false))}</strong></div>
      <div class="metric"><span>Work diff</span><strong>${escapeHtml(report.work.diffStatus ?? "")}</strong></div>
      <div class="metric"><span>Work terminal</span><strong>${escapeHtml(String(report.work.terminalObserved ?? false))}</strong></div>`
    : "";
  const followMetric = report.followEvent
    ? `<div class="metric"><span>Follow cursor</span><strong>${escapeHtml(report.followEvent.cursor)}</strong></div>
      <div class="metric"><span>Follow activities</span><strong>${escapeHtml(report.followEvent.activityTypes.join(", "))}</strong></div>`
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
      <div class="metric"><span>Terminal transport</span><strong>${escapeHtml(report.terminalTransport)}</strong></div>
      <div class="metric"><span>Thread</span><strong>${escapeHtml(report.threadId)}</strong></div>
      <div class="metric"><span>Terminal state</span><strong>${escapeHtml(report.terminalStatus)}</strong></div>
      <div class="metric"><span>Stages</span><strong>${report.stages.length} / ${report.stages.length} passed</strong></div>
      ${watchMetric}
      ${watchItemMetric}
      ${claimWaitMetric}
      ${workMetric}
      ${followMetric}
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

interface CommentsClaimWaitSession {
  payload(): Promise<CommentsClaimPayload>;
  close(): Promise<void>;
}

interface CommentsFollowSession {
  nextEvent(): Promise<CommentsFollowEvent>;
  close(): Promise<void>;
}

interface CommentsWorkSession {
  nextEvent(): Promise<CommentsWorkEvent>;
  done(): Promise<void>;
  close(): Promise<void>;
}

function startCommentsFollow(input: {
  baseUrl: string;
  threadId: string;
  cursor: string;
  actor: AgentLoopActor;
  options?: LocalAgentLoopCliOptions;
}): CommentsFollowSession {
  const timeoutMs = input.options?.timeoutMs ?? 10_000;
  const intervalMs = input.options?.intervalMs ?? 25;
  const baseArgs = input.options?.args ?? ["run", "./cli", "comments"];
  const args = [
    ...baseArgs,
    "follow",
    input.threadId,
    "--url",
    input.baseUrl,
    "--actor",
    input.actor.id,
    "--actor-kind",
    input.actor.kind,
    "--cursor",
    input.cursor,
    "--with-context",
    "--interval",
    `${intervalMs}ms`,
    "--max-events",
    "1",
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
  return createCommentsFollowSession(child, timeoutMs);
}

function startCommentsWork(input: {
  baseUrl: string;
  actor: AgentLoopActor;
  clientEventId: string;
  options?: LocalAgentLoopCliOptions;
}): CommentsWorkSession {
  const timeoutMs = input.options?.timeoutMs ?? 20_000;
  const intervalMs = input.options?.intervalMs ?? 25;
  const baseArgs = input.options?.args ?? ["run", "./cli", "comments"];
  const args = [
    ...baseArgs,
    "work",
    "--wait",
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
    "--full",
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
  return createCommentsWorkSession(child, timeoutMs);
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
    "--full",
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

function startCommentsClaimWait(input: {
  baseUrl: string;
  actor: AgentLoopActor;
  clientEventId: string;
  options?: LocalAgentLoopCliOptions;
}): CommentsClaimWaitSession {
  const timeoutMs = input.options?.timeoutMs ?? 20_000;
  const intervalMs = input.options?.intervalMs ?? 25;
  const baseArgs = input.options?.args ?? ["run", "./cli", "comments"];
  const args = [
    ...baseArgs,
    "claim",
    "--wait",
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
    "--full",
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
  let stdout = "";
  let stderr = "";
  let settled = false;
  const result = new Promise<CommentsClaimPayload>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(
        new Error(
          `comments claim --wait timed out\nstdout:\n${stdout}\nstderr:\n${stderr}`,
        ),
      );
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      if (code !== 0) {
        reject(
          new Error(
            `comments claim --wait exited with code=${code ?? "null"} signal=${signal ?? "null"}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
          ),
        );
        return;
      }
      try {
        resolve(JSON.parse(stdout) as CommentsClaimPayload);
      } catch (error) {
        reject(
          new Error(
            `comments claim --wait emitted invalid JSON: ${error instanceof Error ? error.message : String(error)}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
          ),
        );
      }
    });
  });

  return {
    payload() {
      return result;
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

async function runCommentsTerminalShortcut(input: {
  baseUrl: string;
  threadId: string;
  body: string;
  result?: NonNullable<LocalAgentLoopFixture["agent"]["result"]>;
  actor: AgentLoopActor;
  action: AgentLoopTerminalAction;
  options?: LocalAgentLoopCliOptions;
}): Promise<{
  result: {
    outcome: string;
    summary?: string;
    verification?: string[];
    details?: string;
    body: string;
  };
  comment: {
    id: string;
    threadId: string;
    body: string;
    createdBy: AgentLoopActor;
  };
  thread: {
    id: string;
    status: string;
  };
}> {
  const baseArgs = input.options?.args ?? ["run", "./cli", "comments"];
  const args = [
    ...baseArgs,
    terminalShortcutCommand(input.action),
    input.threadId,
    "--url",
    input.baseUrl,
    "--actor",
    input.actor.id,
    "--actor-kind",
    input.actor.kind,
    "--result-file",
    "-",
    "--require-claim",
    "--json",
  ];
  if (input.actor.displayName) {
    args.push("--actor-name", input.actor.displayName);
  }
  const { stdout } = await runProcess({
    command: input.options?.command ?? "go",
    args,
    cwd: input.options?.cwd ?? process.cwd(),
    env: { ...process.env, ...input.options?.env },
    stdin: JSON.stringify(input.result ?? { summary: input.body }),
    timeoutMs: input.options?.timeoutMs ?? 20_000,
  });
  return JSON.parse(stdout) as {
    result: {
      outcome: string;
      summary?: string;
      verification?: string[];
      details?: string;
      body: string;
    };
    comment: {
      id: string;
      threadId: string;
      body: string;
      createdBy: AgentLoopActor;
    };
    thread: {
      id: string;
      status: string;
    };
  };
}

async function runCommentsTriage(input: {
  baseUrl: string;
  threadId: string;
  actor: AgentLoopActor;
  triage: NonNullable<LocalAgentLoopFixture["agent"]["triage"]>;
  options?: LocalAgentLoopCliOptions;
}): Promise<{
  triage: {
    decision: string;
    summary?: string;
    nextAction?: string;
    body: string;
  };
  comment: {
    id: string;
    threadId: string;
    body: string;
    createdBy: AgentLoopActor;
  };
  thread: {
    id: string;
    status: string;
  };
}> {
  const baseArgs = input.options?.args ?? ["run", "./cli", "comments"];
  const args = [
    ...baseArgs,
    "triage",
    input.threadId,
    "--url",
    input.baseUrl,
    "--actor",
    input.actor.id,
    "--actor-kind",
    input.actor.kind,
    "--triage-file",
    "-",
    "--require-claim",
    "--json",
  ];
  if (input.actor.displayName) {
    args.push("--actor-name", input.actor.displayName);
  }
  const { stdout } = await runProcess({
    command: input.options?.command ?? "go",
    args,
    cwd: input.options?.cwd ?? process.cwd(),
    env: { ...process.env, ...input.options?.env },
    stdin: JSON.stringify({
      decision: input.triage.decision,
      summary: input.triage.summary,
      nextAction: input.triage.nextAction,
      details: input.triage.details,
    }),
    timeoutMs: input.options?.timeoutMs ?? 20_000,
  });
  return JSON.parse(stdout) as {
    triage: {
      decision: string;
      summary?: string;
      nextAction?: string;
      body: string;
    };
    comment: {
      id: string;
      threadId: string;
      body: string;
      createdBy: AgentLoopActor;
    };
    thread: {
      id: string;
      status: string;
    };
  };
}

async function runCommentsClaim(input: {
  baseUrl: string;
  threadId: string;
  actor: AgentLoopActor;
  clientEventId: string;
  options?: LocalAgentLoopCliOptions;
}): Promise<{
  thread: { id: string; status: string };
  claim: {
    type: string;
    actor: AgentLoopActor;
    leaseExpiresAt?: string;
  };
  source?: { available: boolean };
  diff?: { status: string };
}> {
  const baseArgs = input.options?.args ?? ["run", "./cli", "comments"];
  const args = [
    ...baseArgs,
    "claim",
    input.threadId,
    "--url",
    input.baseUrl,
    "--actor",
    input.actor.id,
    "--actor-kind",
    input.actor.kind,
    "--client-event-id",
    input.clientEventId,
    "--full",
    "--json",
  ];
  if (input.actor.displayName) {
    args.push("--actor-name", input.actor.displayName);
  }
  const { stdout } = await runProcess({
    command: input.options?.command ?? "go",
    args,
    cwd: input.options?.cwd ?? process.cwd(),
    env: { ...process.env, ...input.options?.env },
    timeoutMs: input.options?.timeoutMs ?? 20_000,
  });
  return JSON.parse(stdout) as {
    thread: { id: string; status: string };
    claim: {
      type: string;
      actor: AgentLoopActor;
      leaseExpiresAt?: string;
    };
    source?: { available: boolean };
    diff?: { status: string };
  };
}

async function runCommentsRenew(input: {
  baseUrl: string;
  threadId: string;
  actor: AgentLoopActor;
  clientEventId: string;
  options?: LocalAgentLoopCliOptions;
}): Promise<{
  thread: { id: string; status: string };
  renewal: {
    type: string;
    actor: AgentLoopActor;
    leaseExpiresAt?: string;
  };
}> {
  const baseArgs = input.options?.args ?? ["run", "./cli", "comments"];
  const args = [
    ...baseArgs,
    "renew",
    input.threadId,
    "--url",
    input.baseUrl,
    "--actor",
    input.actor.id,
    "--actor-kind",
    input.actor.kind,
    "--client-event-id",
    input.clientEventId,
    "--json",
  ];
  if (input.actor.displayName) {
    args.push("--actor-name", input.actor.displayName);
  }
  const { stdout } = await runProcess({
    command: input.options?.command ?? "go",
    args,
    cwd: input.options?.cwd ?? process.cwd(),
    env: { ...process.env, ...input.options?.env },
    timeoutMs: input.options?.timeoutMs ?? 20_000,
  });
  return JSON.parse(stdout) as {
    thread: { id: string; status: string };
    renewal: {
      type: string;
      actor: AgentLoopActor;
      leaseExpiresAt?: string;
    };
  };
}

function terminalShortcutCommand(
  action: AgentLoopTerminalAction,
): "done" | "dismiss" {
  return action === "resolve" ? "done" : "dismiss";
}

function runProcess(input: {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdin?: string;
  timeoutMs: number;
}): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(input.command, input.args, {
      cwd: input.cwd,
      env: input.env,
      stdio: [input.stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(
        new Error(
          `process timed out: ${input.command} ${input.args.join(" ")}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
        ),
      );
    }, input.timeoutMs);
    child.stdout!.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr!.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    if (input.stdin !== undefined) {
      child.stdin!.end(input.stdin);
    }
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(
        new Error(
          `process failed: ${input.command} ${input.args.join(" ")} code=${code ?? "null"} signal=${signal ?? "null"}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
        ),
      );
    });
  });
}

function followEventFromWork(event: CommentsWorkEvent): CommentsFollowEvent {
  assert(
    event.threadId,
    `comments work event ${event.type} did not include a thread id`,
  );
  assert(
    event.cursor,
    `comments work event ${event.type} did not include a cursor`,
  );
  return {
    type: event.type,
    schemaVersion: event.schemaVersion,
    eventSchema: event.eventSchema,
    eventSchemaCommand: event.eventSchemaCommand,
    sessionId: event.sessionId,
    sequence: event.sequence,
    reason: event.reason ?? "activity_changed",
    threadId: event.threadId,
    cursor: event.cursor,
    count: event.count ?? event.activities?.length ?? 0,
    summary: event.summary,
    activities: event.activities ?? [],
    comments: event.comments ?? [],
    source: event.source,
    diff: event.diff,
  };
}

async function nextWorkFollowEventMatching(
  work: CommentsWorkSession,
  matches: (event: CommentsFollowEvent) => boolean,
  description: string,
  maxEvents = 8,
): Promise<CommentsFollowEvent> {
  const seen: string[] = [];
  for (let index = 0; index < maxEvents; index += 1) {
    const event = followEventFromWork(await work.nextEvent());
    const activityTypes = event.activities
      .map((activity) =>
        activity.status ? `${activity.type}:${activity.status}` : activity.type,
      )
      .join(",");
    seen.push(
      `${event.type}[${activityTypes}]${event.summary?.recommendedAction ? `:${event.summary.recommendedAction}` : ""}`,
    );
    if (matches(event)) return event;
  }
  throw new Error(
    `comments work did not deliver the ${description}; saw ${seen.join(" | ")}`,
  );
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

function createCommentsWorkSession(
  child: ChildProcessByStdio<null, Readable, Readable>,
  timeoutMs: number,
): CommentsWorkSession {
  const events: CommentsWorkEvent[] = [];
  const waiters: Array<{
    resolve: (event: CommentsWorkEvent) => void;
    reject: (error: Error) => void;
  }> = [];
  const doneWaiters: Array<{
    resolve: () => void;
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
    while (doneWaiters.length > 0) {
      doneWaiters.shift()?.reject(error);
    }
  };
  const complete = () => {
    while (doneWaiters.length > 0) {
      doneWaiters.shift()?.resolve();
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
          const event = JSON.parse(line) as CommentsWorkEvent;
          const waiter = waiters.shift();
          if (waiter) waiter.resolve(event);
          else events.push(event);
        } catch (error) {
          fail(
            new Error(
              `comments work emitted invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
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
          `comments work exited with code=${code ?? "null"} signal=${signal ?? "null"}\nstderr:\n${stderr}`,
        ),
      );
      return;
    }
    complete();
  });

  return {
    nextEvent() {
      const event = events.shift();
      if (event) return Promise.resolve(event);
      if (failure) return Promise.reject(failure);
      if (closed) {
        return Promise.reject(
          new Error("comments work exited before delivering an event"),
        );
      }
      return new Promise<CommentsWorkEvent>((resolve, reject) => {
        let timer: NodeJS.Timeout;
        const waiter = {
          resolve(eventValue: CommentsWorkEvent) {
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
              `timed out waiting for comments work event\nstdout:\n${stdout}\nstderr:\n${stderr}`,
            ),
          );
        }, timeoutMs);
        waiters.push(waiter);
      });
    },
    done() {
      if (failure) return Promise.reject(failure);
      if (closed) return Promise.resolve();
      return new Promise<void>((resolve, reject) => {
        let timer: NodeJS.Timeout;
        const waiter = {
          resolve() {
            clearTimeout(timer);
            resolve();
          },
          reject(error: Error) {
            clearTimeout(timer);
            reject(error);
          },
        };
        timer = setTimeout(() => {
          const index = doneWaiters.indexOf(waiter);
          if (index >= 0) doneWaiters.splice(index, 1);
          reject(
            new Error(
              `timed out waiting for comments work to exit\nstdout:\n${stdout}\nstderr:\n${stderr}`,
            ),
          );
        }, timeoutMs);
        doneWaiters.push(waiter);
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

function createCommentsFollowSession(
  child: ChildProcessByStdio<null, Readable, Readable>,
  timeoutMs: number,
): CommentsFollowSession {
  const events: CommentsFollowEvent[] = [];
  const waiters: Array<{
    resolve: (event: CommentsFollowEvent) => void;
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
          const event = JSON.parse(line) as CommentsFollowEvent;
          const waiter = waiters.shift();
          if (waiter) waiter.resolve(event);
          else events.push(event);
        } catch (error) {
          fail(
            new Error(
              `comments follow emitted invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
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
          `comments follow exited with code=${code ?? "null"} signal=${signal ?? "null"}\nstderr:\n${stderr}`,
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
          new Error("comments follow exited before delivering an event"),
        );
      }
      return new Promise<CommentsFollowEvent>((resolve, reject) => {
        let timer: NodeJS.Timeout;
        const waiter = {
          resolve(eventValue: CommentsFollowEvent) {
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
              `timed out waiting for comments follow event\nstdout:\n${stdout}\nstderr:\n${stderr}`,
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
          id
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
          leaseExpiresAt
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

function hasSuggestedWriteRetryKey(
  command: NonNullable<
    CommentsActivityBatchSummary["suggestedCommands"]
  >[number],
): boolean {
  return (
    typeof command.clientEventId === "string" &&
    command.clientEventId.length > 0 &&
    command.args.includes("--client-event-id") &&
    command.args.includes(command.clientEventId)
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
