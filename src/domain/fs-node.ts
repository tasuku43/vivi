import type { ViewerKind } from "./viewer-kind.js";

export type NodeKind = "file" | "directory";

export interface FsNode {
  id: string;
  path: string;
  name: string;
  kind: NodeKind;
  parentPath: string | null;
  viewerKind?: ViewerKind;
  children?: FsNode[];
  size?: number;
  mtimeMs?: number;
  hash?: string;
  version?: number;
}

export interface TreeSnapshot {
  root: string;
  version: number;
  nodes: FsNode[];
}

export interface FilePayload {
  path: string;
  viewerKind: ViewerKind;
  encoding: "utf8" | "base64" | "none";
  content: string;
  etag: string;
  size: number;
  mtimeMs: number;
  mimeType?: string;
  truncated?: boolean;
  maxSizeBytes?: number;
}

export type FsEvent =
  | { type: "add"; path: string; kind: NodeKind; version: number }
  | { type: "change"; path: string; version: number; hash?: string }
  | { type: "unlink"; path: string; kind: NodeKind; version: number };

export interface ViewerConfig {
  root: string;
  allowHtmlScripts: boolean;
  maxFileSizeBytes: number;
}
