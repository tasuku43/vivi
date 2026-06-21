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

## Storage

Vivi keeps `$VIVI_DATA_DIR/comments.jsonl` as the message store. Its historical
one-message-per-line shape is unchanged. New messages add `threadId`, `source`,
and optional `author`; old rows remain valid.

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

`createComment`, status in `updateComment`, and `updateCommentThread` remain as
v1 compatibility operations. New coding-agent clients should query
`commentThreads(status: open)` with `X-Vivi-Actor-*` headers, preserve the
returned thread id while working, add their reply with an explicit origin, then
call a terminal lifecycle mutation. This makes retries and stale message ids
safer than updating each message independently.

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
