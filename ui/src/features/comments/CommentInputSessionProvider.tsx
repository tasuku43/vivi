import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { CommentDraft } from "../../state/comments.js";
import {
  buildStoredCommentInputSessions,
  commentInputSessionForDraft,
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
  resumeIntent: {
    sessionId: string;
    revision: number;
    paneId: string | null;
  } | null;
  setWorkspaceRoot: (root: string) => void;
  start: (draft: CommentDraft, rect?: CommentInputRect) => void;
  change: (draft: CommentDraft, body: string, rect?: CommentInputRect) => void;
  collapse: (id: string) => void;
  resume: (id: string, paneId?: string | null) => void;
  acknowledgeResume: (revision: number, paneId?: string | null) => void;
  discard: (id: string) => void;
  discardAnchors: (anchorKeys: string[]) => void;
  discardEmptyAnchors: (anchorKeys: string[]) => void;
  markPathVersion: (path: string, fileHash: string) => void;
  reanchor: (id: string, draft: CommentDraft) => void;
}

const emptyCommentInputSessionContext: CommentInputSessionContextValue = {
  sessions: [],
  resumeIntent: null,
  setWorkspaceRoot: () => undefined,
  start: () => undefined,
  change: () => undefined,
  collapse: () => undefined,
  resume: () => undefined,
  acknowledgeResume: () => undefined,
  discard: () => undefined,
  discardAnchors: () => undefined,
  discardEmptyAnchors: () => undefined,
  markPathVersion: () => undefined,
  reanchor: () => undefined,
};

const CommentInputSessionContext =
  createContext<CommentInputSessionContextValue>(
    emptyCommentInputSessionContext,
  );
const CommentInputResumePaneContext = createContext<string | null>(null);

export function CommentInputSessionProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [sessions, dispatch] = useReducer(reduceCommentInputSessions, []);
  const [persistenceRoot, setPersistenceRoot] = useState<string | null>(null);
  const [hydratedRoot, setHydratedRoot] = useState<string | null>(null);
  const [resumeIntent, setResumeIntent] = useState<{
    sessionId: string;
    revision: number;
    paneId: string | null;
  } | null>(null);
  const resumeRevisionRef = useRef(0);
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
  const resume = useCallback((id: string, paneId: string | null = null) => {
    dispatch({ type: "expand", id });
    resumeRevisionRef.current += 1;
    setResumeIntent({
      sessionId: id,
      revision: resumeRevisionRef.current,
      paneId,
    });
  }, []);
  const acknowledgeResume = useCallback(
    (revision: number, paneId: string | null = null) => {
      setResumeIntent((current) =>
        current?.revision === revision && current.paneId === paneId
          ? null
          : current,
      );
    },
    [],
  );
  const discard = useCallback(
    (id: string) => dispatch({ type: "discard", id }),
    [],
  );
  const discardAnchors = useCallback(
    (anchorKeys: string[]) => dispatch({ type: "discard-anchors", anchorKeys }),
    [],
  );
  const discardEmptyAnchors = useCallback(
    (anchorKeys: string[]) =>
      dispatch({ type: "discard-empty-anchors", anchorKeys }),
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
      resumeIntent,
      setWorkspaceRoot,
      start,
      change,
      collapse,
      resume,
      acknowledgeResume,
      discard,
      discardAnchors,
      discardEmptyAnchors,
      markPathVersion,
      reanchor,
    }),
    [
      acknowledgeResume,
      change,
      collapse,
      discard,
      discardAnchors,
      discardEmptyAnchors,
      markPathVersion,
      reanchor,
      resume,
      resumeIntent,
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

export function CommentInputResumePaneProvider({
  paneId,
  children,
}: {
  paneId: string;
  children: ReactNode;
}) {
  return (
    <CommentInputResumePaneContext.Provider value={paneId}>
      {children}
    </CommentInputResumePaneContext.Provider>
  );
}

export function useCommentInputResumePaneId(): string | null {
  return useContext(CommentInputResumePaneContext);
}

export function useCommentInputSession(draft: CommentDraft) {
  const context = useCommentInputSessions();
  const computedId = commentInputSessionId(draft);
  const session = commentInputSessionForDraft(context.sessions, draft);
  return {
    ...context,
    id: session?.id ?? computedId,
    session,
  };
}
