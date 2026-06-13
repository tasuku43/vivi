import type { ChangeReviewSummary, TextDiff } from "../domain/change-review.js";
import type {
  FilePayload,
  FsEvent,
  TreeSnapshot,
  ViewerConfig,
} from "../domain/fs-node.js";

export interface FileSystemPort {
  readTree(): Promise<TreeSnapshot>;
  readFile(relativePath: string): Promise<FilePayload>;
  readHtmlPreview(relativePath: string): Promise<string>;
  getConfig?(): ViewerConfig;
}

export interface WatcherPort {
  start(onEvent: (event: FsEvent) => void): Promise<void>;
  stop(): Promise<void>;
}

export interface ChangeReviewPort {
  readChanges(): Promise<ChangeReviewSummary>;
  readDiff(relativePath: string): Promise<TextDiff>;
}

export interface ViewerServiceOptions {
  fileSystem: FileSystemPort;
  watcher?: WatcherPort;
  changeReview?: ChangeReviewPort;
}
