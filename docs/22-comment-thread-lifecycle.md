# CommentThread lifecycle

## Responsibilities

`CommentThread` is the review work item and conversation boundary. It owns the
stable id, file path, anchor, lifecycle status, lifecycle timestamps, and the
ordered collection of messages. Status changes always target a thread.

`Comment` is one immutable-identity message inside a thread. It owns the body,
actor, and message timestamps. `Comment.status`, `resolvedAt`, and `archivedAt`
remain readable for
v1 compatibility, but API responses project the owning thread lifecycle onto
those fields. New clients must not use message status as an independent review
state.

`CommentActor` is shared by comments and activity events. It has a stable
client-supplied `id`, a `kind` (`human`, `claude_code`, `codex`, or `unknown`),
and an optional display name. Missing actor data on legacy records is projected
as `unknown`. Actor identity is attribution, not authentication.

`DraftReviewComment` is outside the public thread lifecycle. It is a
pre-publish human review note with a path, body, actor, and anchor, but no
`open`, `resolved`, or `archived` status. Publishing drafts creates normal
`open` threads; it does not add `draft` to `CommentStatus`.

## Activity events

Activity is append-only observation history and never changes thread status.
For example, a coding agent can fetch open threads with actor request headers;
the server observes that read and appends `thread_read`, while the thread
remains `open`. The GUI can query the history and subscribe to live events to
show which actor has observed or changed the conversation.

The public event kinds are `thread_created`, `thread_read`, `comment_added`,
`comment_updated`, and `thread_status_changed`. Every event carries the same
`CommentActor` shape, a server id and timestamp, and relevant optional fields
such as `commentId`, `previousStatus`, and `status`.

Activity events are not public write resources in GraphQL. Reads are recorded
automatically when a request includes `X-Vivi-Actor-Id`; optional
`X-Vivi-Actor-Kind`, `X-Vivi-Actor-Name`, and `X-Vivi-Client-Event-Id` headers
provide attribution and idempotency. The client event id is scoped to the
thread, actor, and event type, so retrying a CLI request does not create
duplicate read receipts. `commentThreadActivities(threadId, after, first)`
provides bounded history; `commentThreadActivity(threadId)` streams new events
without replaying history.

## Status model

| Status     | UI                                                    | Active review | Default agent worklist              | Export                                  | Reopen       |
| ---------- | ----------------------------------------------------- | ------------- | ----------------------------------- | --------------------------------------- | ------------ |
| `open`     | Inline markers and the Open list                      | Included      | Included by querying `status: open` | Included in open/all exports            | Already open |
| `resolved` | Hidden inline; visible in the Resolved history filter | Excluded      | Excluded                            | Included when resolved/all is requested | Yes          |
| `archived` | Hidden inline; visible in the Archived history filter | Excluded      | Excluded                            | Included when archived/all is requested | Yes          |

Allowed transitions are `open -> resolved`, `open -> archived`,
`resolved -> open`, `resolved -> archived`, and `archived -> open`. Repeating
the current status is idempotent. `archived -> resolved` is rejected: reopen
first so the return to active review is explicit. A resolved or archived thread
must be reopened before another message can be added.

`acknowledged`, `in_progress`, assignment, and agent leases are future workflow
candidates. They are deliberately not statuses now; clients can safely reason
about the three-state lifecycle without guessing whether a transient agent
state is terminal.

Draft review comments are also deliberately not statuses. They are hidden from
`comments`, `commentThreads(status: open)`, and agent CLI worklists until the
user publishes the batch.

## Storage

Vivi keeps `$VIVI_DATA_DIR/comments.jsonl` as the message store. Its historical
one-message-per-line shape is unchanged. New messages add `threadId`, `source`,
optional `author`, and optional `reviewBatchId`; old rows remain valid.

Unpublished review drafts are stored separately in
`$VIVI_DATA_DIR/comment-drafts.jsonl`. Keeping drafts out of `comments.jsonl`
and the thread event log makes recovery, discard, and publish behavior explicit:
delete removes the draft row, while publish creates public comments and clears
the corresponding drafts.

Thread metadata is projected from messages and an append-only
`comment-threads.jsonl` event log:

```json
{"schemaVersion":1,"id":"...","type":"thread.created","threadId":"...","actor":{"id":"human:tasuku","kind":"human"},"at":"...","thread":{"id":"...","path":"README.md","anchor":{},"status":"open","createdAt":"...","updatedAt":"..."}}
{"schemaVersion":1,"id":"...","type":"thread.read","threadId":"...","actor":{"id":"claude-code:run-1","kind":"claude-code"},"clientEventId":"fetch-open-1","at":"..."}
{"schemaVersion":1,"id":"...","type":"thread.status_changed","threadId":"...","actor":{"id":"codex:run-2","kind":"codex"},"previousStatus":"open","status":"resolved","at":"..."}
```

For a legacy row without `threadId`, the projection uses `comment.id` as the
thread id and its stored status as the initial thread status. Reading does not
rewrite or migrate `comments.jsonl`. This on-read projection is the migration.

An event log was chosen over separate active/archive files because moving
records between files makes one status change a multi-file transaction. The
log keeps lifecycle writes append-only while preserving the established
message file and read-only historical data. Compaction can later write an
equivalent checkpoint without changing the projection contract.

## GraphQL and agent workflow

New integrations use:

- `createThread(input)` to create the review item and first message.
- `addComment(threadId, input)` to reply to an open thread.
- `updateComment(id, input)` to edit a message body.
- `resolveThread(id)`, `archiveThread(id)`, and `reopenThread(id)` for lifecycle.
- `draftReviewComments`, `createDraftReviewComment`,
  `updateDraftReviewComment`, `deleteDraftReviewComment`, and
  `publishDraftReviewComments` for the UI's pre-publish review batch.

`createComment`, status in `updateComment`, and `updateCommentThread` remain as
v1 compatibility operations. New coding-agent clients should query
`commentThreads(status: open)` with `X-Vivi-Actor-*` headers, preserve the
returned thread id while working, add their reply with an explicit origin, then
call a terminal lifecycle mutation. This makes retries and stale message ids
safer than updating each message independently.

`publishDraftReviewComments` returns a `PublishedReviewBatch` with one
`reviewBatchId`. Every resulting open thread and first comment carries that id,
allowing coding agents to group all threads from the same human publish action.

The CLI wrapper for that workflow is:

```bash
vivi comments active --actor claude-code --client-event-id fetch-open-1 --json
vivi comments show <thread-id> --json
vivi comments reply <thread-id> --body "Implemented in this branch" --actor codex --json
vivi comments resolve <thread-id> --actor codex --json
```

Use `archive` instead of `resolve` for intentionally dismissed work, and
`reopen` before replying to a resolved or archived thread. The CLI uses GraphQL
queries and mutations only; it does not write `$VIVI_DATA_DIR` files directly.

## Export and import

JSONL export is thread-aware. Each line is a self-contained schema v2
`commentThread` record with metadata and ordered `comments`. Status and path
filters operate on threads, not individual messages. Agent automation should
request `status: open`; an unfiltered export is a backup/history export.

Import is intentionally specified before it is exposed: accept schema v2
thread records, validate every path/anchor/status/origin, reject conflicting
thread or comment ids unless the records are byte-equivalent, append messages
before lifecycle events, and report per-record results. Legacy flat JSONL may
be imported through the same on-read projection. No import mutation or CLI flag
is shipped in this slice, so export remains one-way at the public API boundary.
