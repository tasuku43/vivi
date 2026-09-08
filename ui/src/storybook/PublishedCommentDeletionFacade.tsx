import { DraftReviewCommentActionsProvider } from "../features/comments/DraftReviewCommentActions.js";
import { useRef, useState } from "react";
import type { ViviComment } from "../domain/comments.js";
import { CodeCommentThread } from "../features/comments/components/CodeCommentThread.js";
import { summarizeThreadActivity } from "../state/comment-activity.js";
import { sampleFiles } from "./fixtures/review-lab.js";
import styles from "./PublishedCommentDeletionFacade.module.css";

const file = sampleFiles.markdown;
export const deletionFeedback: ViviComment = {
  id: "published-feedback-1",
  threadId: "published-deletion-thread",
  path: file.path,
  viewerKind: "markdown",
  anchor: {
    surface: "source",
    canonical: {
      path: file.path,
      lineStart: 3,
      lineEnd: 3,
      fileHash: file.etag,
    },
  },
  body: "Please shorten this introduction.",
  createdBy: { id: "human:reviewer", kind: "human", displayName: "Human" },
  source: "human",
  status: "open",
  createdAt: "2026-09-08T09:00:00.000Z",
  updatedAt: "2026-09-08T09:00:00.000Z",
};

export interface PublishedCommentDeletionFacadeProps {
  comments: ViviComment[];
  recent?: boolean;
  pendingDraftCount?: number;
  seen?: boolean;
  outcome?: "success" | "fail-once" | "pending";
  onDeleteRequest: (id: string) => void;
}

/** Local fixture transitions only: no API, filesystem or subscription wiring. */
export function PublishedCommentDeletionFacade({
  comments: initialComments,
  recent = false,
  pendingDraftCount = 0,
  seen = false,
  outcome = "success",
  onDeleteRequest,
}: PublishedCommentDeletionFacadeProps) {
  const [comments, setComments] = useState(initialComments);
  const [open, setOpen] = useState(true);
  const [notice, setNotice] = useState("");
  const [hiddenRecent, setHiddenRecent] = useState(false);
  const failedOnce = useRef(false);
  const documentRef = useRef<HTMLHeadingElement>(null);
  const feedbackRemaining =
    (!seen && comments.length > 0) || pendingDraftCount > 0;
  const recentVisible = recent && !hiddenRecent && !feedbackRemaining;
  const activity = seen
    ? summarizeThreadActivity(
        [
          {
            id: "published-deletion-read",
            threadId: deletionFeedback.threadId!,
            type: "thread_read",
            actor: { id: "codex", kind: "codex", displayName: "Codex" },
            createdAt: "2026-09-08T09:02:00.000Z",
          },
        ],
        Date.parse("2026-09-08T09:03:00.000Z"),
      )
    : undefined;

  async function deleteComment(id: string) {
    onDeleteRequest(id);
    if (outcome === "pending") return new Promise<void>(() => {});
    if (outcome === "fail-once" && !failedOnce.current) {
      failedOnce.current = true;
      throw new Error("Fixture delete failed");
    }
    setComments((current) => current.filter((comment) => comment.id !== id));
    setNotice("Comment deleted.");
  }

  function closeThread() {
    setOpen(false);
    documentRef.current?.focus();
  }

  return (
    <DraftReviewCommentActionsProvider onDeletePublished={deleteComment}>
      <section
        className={styles.facade}
        aria-label="Published comment deletion facade"
      >
        <header className={styles.banner}>
          <strong>Published comment deletion · A</strong>
          <span>Storybook facade · fixture data</span>
        </header>
        <div className={styles.workspace}>
          <div className={styles.document}>
            <div className={styles.path}>
              {file.path} <span>Rendered</span>
            </div>
            <h2 ref={documentRef} tabIndex={-1}>
              A quiet place to read
            </h2>
            <p>Read local documents and leave feedback where it matters.</p>
            {comments.length > 0 && open ? (
              <CodeCommentThread
                thread={{
                  key: deletionFeedback.threadId!,
                  path: file.path,
                  lineStart: 3,
                  lineEnd: 3,
                  comments,
                }}
                draft={{
                  path: file.path,
                  viewerKind: "markdown",
                  anchor: deletionFeedback.anchor!,
                }}
                activity={activity}
                onClose={closeThread}
              />
            ) : comments.length > 0 ? (
              <button type="button" onClick={() => setOpen(true)}>
                Open comments
              </button>
            ) : null}
            <p className={styles.notice} role="status">
              {notice}
            </p>
            <p className={styles.note}>
              The document stays open when its feedback is deleted.
            </p>
          </div>
          <aside className={styles.inspector} aria-label="For you">
            <header>
              <strong>For you</strong>
              <span>{feedbackRemaining || recentVisible ? 1 : 0}</span>
            </header>
            <section aria-label="Feedback">
              <h3>Feedback</h3>
              {feedbackRemaining ? (
                <div className={styles.row}>
                  <strong>{file.path}</strong>
                  <small>A quiet place to read</small>
                  {comments.length > 0 && !seen ? (
                    <span className={styles.unseen}>Unseen</span>
                  ) : null}
                  {pendingDraftCount > 0 ? (
                    <span className={styles.unseen}>Pending draft</span>
                  ) : null}
                </div>
              ) : (
                <p className={styles.note}>No feedback to review</p>
              )}
            </section>
            <section aria-label="Recent">
              <h3>Recent</h3>
              {recentVisible ? (
                <div className={styles.row}>
                  <strong>{file.path}</strong>
                  <small>A quiet place to read</small>
                  <small>Opened · 2m ago</small>
                  <button type="button" onClick={() => setHiddenRecent(true)}>
                    Hide for now
                  </button>
                </div>
              ) : (
                <p className={styles.note}>No recent documents</p>
              )}
            </section>
          </aside>
        </div>
      </section>
    </DraftReviewCommentActionsProvider>
  );
}
