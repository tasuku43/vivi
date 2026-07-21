import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useState,
  type ReactNode,
} from "react";
import type { CommentDraft } from "../../state/comments.js";
import {
  buildStoredCommentInputSessions,
  commentInputSessionStorageKeyForRoot,
  commentInputSessionId,
  parseStoredCommentInputSessions,
  reduceCommentInputSessions,
  restoreStoredCommentInputSessions,
  type CommentInputSession,
  type CommentInputRect,
} from "../../state/comment-input-session.js";

interface CommentInputSessionContextValue {
  sessions: CommentInputSession[];
  setWorkspaceRoot: (root: string) => void;
  start: (draft: CommentDraft, rect?: CommentInputRect) => void;
  change: (draft: CommentDraft, body: string, rect?: CommentInputRect) => void;
  collapse: (id: string) => void;
  discard: (id: string) => void;
  markSaved: (id: string) => void;
  discardAnchors: (anchorKeys: string[]) => void;
  markPathVersion: (path: string, fileHash: string) => void;
  reanchor: (id: string, draft: CommentDraft) => void;
}

const emptyCommentInputSessionContext: CommentInputSessionContextValue = {
  sessions: [],
  setWorkspaceRoot: () => undefined,
  start: () => undefined,
  change: () => undefined,
  collapse: () => undefined,
  discard: () => undefined,
  markSaved: () => undefined,
  discardAnchors: () => undefined,
  markPathVersion: () => undefined,
  reanchor: () => undefined,
};

const CommentInputSessionContext =
  createContext<CommentInputSessionContextValue>(
    emptyCommentInputSessionContext,
  );

export function CommentInputSessionProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [sessions, dispatch] = useReducer(reduceCommentInputSessions, []);
  const [persistenceRoot, setPersistenceRoot] = useState<string | null>(null);
  const [hydratedRoot, setHydratedRoot] = useState<string | null>(null);
  const setWorkspaceRoot = useCallback((root: string) => {
    if (!root) return;
    let restored: CommentInputSession[] = [];
    try {
      restored = restoreStoredCommentInputSessions(
        parseStoredCommentInputSessions(
          window.localStorage.getItem(
            commentInputSessionStorageKeyForRoot(root),
          ),
        ),
        root,
      );
    } catch {
      // Storage can be unavailable in privacy-restricted browser contexts.
    }
    dispatch({ type: "replace", sessions: restored });
    setPersistenceRoot(root);
    setHydratedRoot(root);
  }, []);
  const start = useCallback(
    (draft: CommentDraft, rect?: CommentInputRect) =>
      dispatch({ type: "start", draft, rect }),
    [],
  );
  const change = useCallback(
    (draft: CommentDraft, body: string, rect?: CommentInputRect) =>
      dispatch({ type: "change", draft, body, rect }),
    [],
  );
  const collapse = useCallback(
    (id: string) => dispatch({ type: "collapse", id }),
    [],
  );
  const discard = useCallback(
    (id: string) => dispatch({ type: "discard", id }),
    [],
  );
  const markSaved = useCallback(
    (id: string) => dispatch({ type: "mark-saved", id }),
    [],
  );
  const discardAnchors = useCallback(
    (anchorKeys: string[]) => dispatch({ type: "discard-anchors", anchorKeys }),
    [],
  );
  const markPathVersion = useCallback(
    (path: string, fileHash: string) =>
      dispatch({ type: "mark-path-version", path, fileHash }),
    [],
  );
  const reanchor = useCallback(
    (id: string, draft: CommentDraft) =>
      dispatch({ type: "reanchor", id, draft }),
    [],
  );
  useEffect(() => {
    if (!persistenceRoot || hydratedRoot !== persistenceRoot) return;
    const key = commentInputSessionStorageKeyForRoot(persistenceRoot);
    try {
      if (!sessions.length) {
        window.localStorage.removeItem(key);
        return;
      }
      window.localStorage.setItem(
        key,
        JSON.stringify(
          buildStoredCommentInputSessions(persistenceRoot, sessions),
        ),
      );
    } catch {
      // Input remains available in memory when persistence is unavailable.
    }
  }, [hydratedRoot, persistenceRoot, sessions]);
  const value = useMemo<CommentInputSessionContextValue>(
    () => ({
      sessions,
      setWorkspaceRoot,
      start,
      change,
      collapse,
      discard,
      markSaved,
      discardAnchors,
      markPathVersion,
      reanchor,
    }),
    [
      change,
      collapse,
      discard,
      discardAnchors,
      markPathVersion,
      markSaved,
      reanchor,
      sessions,
      setWorkspaceRoot,
      start,
    ],
  );
  return (
    <CommentInputSessionContext.Provider value={value}>
      {children}
    </CommentInputSessionContext.Provider>
  );
}

export function useCommentInputSessions(): CommentInputSessionContextValue {
  return useContext(CommentInputSessionContext);
}

export function useCommentInputSession(draft: CommentDraft) {
  const context = useCommentInputSessions();
  const id = commentInputSessionId(draft);
  return {
    ...context,
    id,
    session: context.sessions.find((candidate) => candidate.id === id),
  };
}
