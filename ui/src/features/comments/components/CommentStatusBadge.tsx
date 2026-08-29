import type { ReactNode } from "react";
import styles from "./CommentStatusBadge.module.css";

export type CommentStatusTone = "draft" | "published";

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
