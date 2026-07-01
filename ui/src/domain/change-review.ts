export type GitChangeStatus = "added" | "modified" | "deleted" | "renamed";
export type GitChangeKind = "file" | "directory" | "embedded-repo";

export interface GitChange {
  path: string;
  status: GitChangeStatus;
  kind?: GitChangeKind;
  originalPath?: string;
}

export interface ChangeReviewSummary {
  available: boolean;
  reason?: string;
  changes: GitChange[];
}

export type DiffStatus = "available" | "too-large" | "binary" | "unavailable";

export interface TextDiff {
  path: string;
  status: DiffStatus;
  kind?: GitChangeKind;
  baseLabel: string;
  baseRef?: string;
  compareLabel: string;
  diffHash?: string;
  content: string;
  reason?: string;
}
