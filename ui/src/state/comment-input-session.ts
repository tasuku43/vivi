import type { CommentDraft } from "./comments.js";
import { commentAnchorThreadKey } from "./comments.js";

export type CommentInputSessionStatus = "open" | "collapsed" | "stale";

export interface CommentInputSession {
  id: string;
  draft: CommentDraft;
  body: string;
  status: CommentInputSessionStatus;
  rect?: CommentInputRect;
}

export interface CommentInputRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export type CommentInputSessionAction =
  | { type: "replace"; sessions: CommentInputSession[] }
  | { type: "start"; draft: CommentDraft; rect?: CommentInputRect }
  | {
      type: "change";
      draft: CommentDraft;
      body: string;
      rect?: CommentInputRect;
    }
  | { type: "collapse"; id: string }
  | { type: "discard"; id: string }
  | { type: "discard-anchors"; anchorKeys: string[] }
  | { type: "discard-empty-anchors"; anchorKeys: string[] }
  | { type: "mark-path-version"; path: string; fileHash: string }
  | { type: "reanchor"; id: string; draft: CommentDraft };

export function commentInputSessionId(draft: CommentDraft): string {
  return JSON.stringify([
    draft.threadId ?? null,
    commentAnchorThreadKey(draft.path, draft.anchor),
  ]);
}

export function commentInputSessionForDraft(
  sessions: readonly CommentInputSession[],
  draft: CommentDraft,
): CommentInputSession | undefined {
  const id = commentInputSessionId(draft);
  return (
    sessions.find((session) => session.id === id) ??
    sessions.find(
      (session) =>
        commentInputAnchorKey(session.draft) === commentInputAnchorKey(draft),
    )
  );
}

export function reduceCommentInputSessions(
  sessions: CommentInputSession[],
  action: CommentInputSessionAction,
): CommentInputSession[] {
  if (action.type === "replace") {
    return action.sessions;
  }
  if (action.type === "discard") {
    return sessions.filter((session) => session.id !== action.id);
  }
  if (action.type === "discard-anchors") {
    const keys = new Set(action.anchorKeys);
    return sessions.filter(
      (session) => !keys.has(commentInputAnchorKey(session.draft)),
    );
  }
  if (action.type === "discard-empty-anchors") {
    const keys = new Set(action.anchorKeys);
    return sessions.filter(
      (session) =>
        Boolean(session.body.trim()) ||
        !keys.has(commentInputAnchorKey(session.draft)),
    );
  }
  if (action.type === "collapse") {
    return sessions.map((session) =>
      session.id === action.id && session.status !== "stale"
        ? { ...session, status: "collapsed" }
        : session,
    );
  }
  if (action.type === "mark-path-version") {
    return sessions.map((session) => {
      if (session.draft.path !== action.path) return session;
      const anchoredHash = session.draft.anchor.canonical.fileHash;
      if (!anchoredHash || anchoredHash === action.fileHash) return session;
      return { ...session, status: "stale" };
    });
  }
  if (action.type === "reanchor") {
    return sessions.map((session) =>
      session.id === action.id
        ? { ...session, draft: action.draft, status: "open" }
        : session,
    );
  }

  const id = commentInputSessionId(action.draft);
  const existing = commentInputSessionForDraft(sessions, action.draft);
  if (!existing) {
    return [
      ...sessions,
      {
        id,
        draft: action.draft,
        body: action.type === "change" ? action.body : "",
        status: "open",
        rect: action.rect,
      },
    ];
  }
  return sessions.map((session) => {
    if (session.id !== existing.id) return session;
    return {
      ...session,
      id,
      draft: session.status === "stale" ? session.draft : action.draft,
      body: action.type === "change" ? action.body : session.body,
      status: session.status === "stale" ? "stale" : "open",
      rect: action.rect ?? session.rect,
    };
  });
}

export interface StoredCommentInputSessionsV1 {
  version: 1;
  root: string;
  updatedAt: number;
  sessions: CommentInputSession[];
}

export const commentInputSessionStorageKey = "vivi.commentInputSessions.v1";
export const commentInputSessionTtlMs = 30 * 24 * 60 * 60 * 1000;
export const maxStoredCommentInputSessions = 50;

export function commentInputSessionStorageKeyForRoot(root: string): string {
  return `${commentInputSessionStorageKey}:${encodeURIComponent(root)}`;
}

export function buildStoredCommentInputSessions(
  root: string,
  sessions: CommentInputSession[],
  now = Date.now(),
): StoredCommentInputSessionsV1 {
  return {
    version: 1,
    root,
    updatedAt: now,
    sessions: sessions.slice(-maxStoredCommentInputSessions),
  };
}

export function parseStoredCommentInputSessions(
  raw: string | null,
): StoredCommentInputSessionsV1 | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    if (!isStoredCommentInputSessions(value)) return null;
    return value;
  } catch {
    return null;
  }
}

export function restoreStoredCommentInputSessions(
  stored: StoredCommentInputSessionsV1 | null,
  root: string,
  now = Date.now(),
): CommentInputSession[] {
  if (!stored || stored.root !== root) return [];
  if (now - stored.updatedAt > commentInputSessionTtlMs) return [];
  return normalizeRestoredCommentInputSessions(
    stored.sessions.slice(-maxStoredCommentInputSessions),
  );
}

export function normalizeRestoredCommentInputSessions(
  sessions: readonly CommentInputSession[],
): CommentInputSession[] {
  const normalized = new Map<string, CommentInputSession>();
  for (const session of sessions) {
    if (session.status === "stale" && !session.body.trim()) continue;
    const key = restoredCommentInputAnchorKey(session.draft);
    const existing = normalized.get(key);
    normalized.set(
      key,
      existing && preferRestoredCommentInputSession(existing, session)
        ? existing
        : session,
    );
  }
  return [...normalized.values()];
}

export function unsavedCommentInputCount(
  sessions: readonly CommentInputSession[],
  path: string,
  surface?: string,
): number {
  return sessions.filter(
    (session) =>
      session.draft.path === path &&
      (!surface || session.draft.anchor.surface === surface) &&
      Boolean(session.body.trim()),
  ).length;
}

export function commentInputAnchorKey(draft: CommentDraft): string {
  return commentAnchorThreadKey(draft.path, draft.anchor);
}

function restoredCommentInputAnchorKey(draft: CommentDraft): string {
  const rendered = draft.anchor.rendered;
  if (draft.anchor.surface === "rendered" && rendered?.blockId) {
    return JSON.stringify([
      draft.path,
      draft.anchor.surface,
      rendered.kind,
      rendered.blockId,
    ]);
  }
  return commentInputAnchorKey(draft);
}

function preferRestoredCommentInputSession(
  current: CommentInputSession,
  candidate: CommentInputSession,
): boolean {
  const currentBody = Boolean(current.body.trim());
  const candidateBody = Boolean(candidate.body.trim());
  if (currentBody !== candidateBody) return currentBody;
  const currentFresh = current.status !== "stale";
  const candidateFresh = candidate.status !== "stale";
  if (currentFresh !== candidateFresh) return currentFresh;
  const currentThreaded = Boolean(current.draft.threadId);
  const candidateThreaded = Boolean(candidate.draft.threadId);
  if (currentThreaded !== candidateThreaded) return currentThreaded;
  return false;
}

function isStoredCommentInputSessions(
  value: unknown,
): value is StoredCommentInputSessionsV1 {
  return (
    isRecord(value) &&
    value.version === 1 &&
    typeof value.root === "string" &&
    typeof value.updatedAt === "number" &&
    Array.isArray(value.sessions) &&
    value.sessions.every(isCommentInputSession)
  );
}

function isCommentInputSession(value: unknown): value is CommentInputSession {
  if (!isRecord(value) || !isRecord(value.draft)) return false;
  const draft = value.draft;
  if (!isRecord(draft.anchor) || !isRecord(draft.anchor.canonical)) {
    return false;
  }
  const rect = value.rect;
  return (
    typeof value.id === "string" &&
    typeof value.body === "string" &&
    (value.status === "open" ||
      value.status === "collapsed" ||
      value.status === "stale") &&
    typeof draft.path === "string" &&
    typeof draft.viewerKind === "string" &&
    typeof draft.anchor.surface === "string" &&
    typeof draft.anchor.canonical.path === "string" &&
    (rect === undefined || isCommentInputRect(rect))
  );
}

function isCommentInputRect(value: unknown): value is CommentInputRect {
  return (
    isRecord(value) &&
    typeof value.left === "number" &&
    typeof value.top === "number" &&
    typeof value.width === "number" &&
    typeof value.height === "number"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
