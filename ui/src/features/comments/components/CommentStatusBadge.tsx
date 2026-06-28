import type { ReactNode } from "react";
import type { CommentStatus } from "../../../domain/comments.js";
import styles from "./CommentStatusBadge.module.css";

export type CommentStatusTone =
  | CommentStatus
  | "accepted"
  | "draft"
  | "published"
  | "reviewed";

export function CommentStatusBadge({
  children,
  status,
}: {
  children: ReactNode;
  status: CommentStatusTone;
}) {
  return (
    <span className={commentStatusBadgeClassName(status)}>{children}</span>
  );
}

export function commentStatusBadgeClassName(status: CommentStatusTone): string {
  return [styles.status, styles[status], "comment-status", status]
    .filter(Boolean)
    .join(" ");
}
